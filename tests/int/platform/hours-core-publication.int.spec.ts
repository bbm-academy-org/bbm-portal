// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  buildMattermostPreview,
  createPublicationBatch,
  isPeriodMutationLocked,
  mutateHoursDocument,
  readHoursDocument,
  recordPublicationDelivery,
  saveAssessment,
  setPeriodStatus,
  updatePeriod,
} from '@/lib/hours'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { auditEventsFor, auditWatermark } from './audit-helpers'
import {
  fixtureWrite,
  seedMember,
  seedParticipant,
  seedPeriod,
  truncateHoursTables,
} from './hours-core-helpers'

/**
 * Кто пишет в этих сюитах (спека 201 EARS-7, EARS-25). `portal` + непустой
 * actor — ровно то, что приходит из Server Action после гейта сессии; без
 * контекста запись отклонит `core.audit_row_change()` на помеченном пуле.
 */
const TEST_ACTOR = { actorEmail: 'anton@bbm.academy', source: 'portal' } as const

/**
 * The spec-100 publication batch on `core` (spec 124: EARS-6, EARS-22, EARS-31).
 *
 * Since #274 (spec 201 EARS-31) the batch's messages are rows of
 * `core.hours_publication_message`, keyed `(period_id, position)`, and delivery
 * addresses a message BY POSITION (spec 100 req. 2/10) rather than by an index
 * into a `jsonb` array. So the assertions here are about the legacy array being
 * rebuilt from those rows unchanged across N delivery steps, about a delivery
 * step touching exactly ONE row, and about the fingerprint's input being pinned
 * to the legacy participant fields, which is what keeps an unrelated `member`
 * touch from invalidating a correct preview.
 */

const db = getPlatformDb()

const PERIOD = 'p-july'

async function seedPeriodWithTwoAssessments(): Promise<void> {
  const anton = await seedMember({ email: 'anton@bbm.academy', name: 'Антон', role: 'Продукт' })
  const eduard = await seedMember({
    email: 'eduard@bbm.academy',
    name: 'Эдуард',
    role: 'Операции',
  })
  await seedParticipant(anton, { forkMin: 300_000, forkMax: 400_000, grade: 'III', sortKey: 0 })
  await seedParticipant(eduard, { sortKey: 1 })
  await seedPeriod({
    id: PERIOD,
    label: 'Июль 2026',
    from: '2026-07-01',
    to: '2026-07-31',
    status: 'open',
  })

  for (const email of ['anton@bbm.academy', 'eduard@bbm.academy']) {
    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      saveAssessment(
        doc,
        {
          periodId: PERIOD,
          email,
          hours: 40,
          method: 'period',
          weekendHours: 0,
          splitPercent: 50,
        },
        '2026-08-01T10:00:00.000Z',
      ),
    )
  }
  await mutateHoursDocument(TEST_ACTOR, (doc) => setPeriodStatus(doc, PERIOD, 'closed'))
}

async function startBatch(): Promise<string> {
  const preview = buildMattermostPreview(await readHoursDocument(), PERIOD)
  const created = await mutateHoursDocument(TEST_ACTOR, (doc) =>
    createPublicationBatch(doc, PERIOD, preview.preview_fingerprint, '2026-08-03T09:00:00.000Z'),
  )
  if (!created.ok) throw new Error(`batch not created: ${created.error}`)
  return preview.preview_fingerprint
}

beforeEach(async () => {
  await truncateHoursTables(db)
})

afterAll(async () => {
  await closePlatformDb()
})

describe('the publication batch (EARS-6)', () => {
  it('EARS-6: a period holds at most one batch — the second attempt is refused', async () => {
    await seedPeriodWithTwoAssessments()
    const fingerprint = await startBatch()

    const second = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      createPublicationBatch(doc, PERIOD, fingerprint, '2026-08-03T09:05:00.000Z'),
    )
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('unreachable')
    expect(second.error).toBe('У периода уже есть незавершённая попытка публикации.')

    const rows = (await db.execute(sql`select count(*)::int as n from core.hours_publication`)).rows
    expect(rows[0]).toEqual({ n: 1 })
  })

  it('EARS-6: the message array keeps its order and length across every delivery update', async () => {
    await seedPeriodWithTwoAssessments()
    await startBatch()

    const initial = (await readHoursDocument()).publications?.[0]
    expect(initial?.messages.map((message) => message.email)).toEqual([
      'anton@bbm.academy',
      'eduard@bbm.academy',
    ])
    const texts = initial!.messages.map((message) => message.text)

    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      recordPublicationDelivery(doc, PERIOD, 0, 'sent', '2026-08-03T09:01:00.000Z'),
    )
    const midway = (await readHoursDocument()).publications?.[0]
    expect(midway?.status).toBe('sending')
    expect(midway?.messages.map((message) => message.delivery)).toEqual(['sent', 'pending'])
    expect(midway?.messages.map((message) => message.text)).toEqual(texts)

    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      recordPublicationDelivery(doc, PERIOD, 1, 'sent', '2026-08-03T09:02:00.000Z'),
    )
    const done = (await readHoursDocument()).publications?.[0]
    expect(done?.status).toBe('published')
    expect(done?.published_at).toBe('2026-08-03T09:02:00.000Z')
    expect(done?.messages.map((message) => message.sent_at)).toEqual([
      '2026-08-03T09:01:00.000Z',
      '2026-08-03T09:02:00.000Z',
    ])
    expect(done?.messages.map((message) => message.text)).toEqual(texts)
    expect(Object.keys(done!.messages[0])).toEqual(['email', 'text', 'delivery', 'sent_at'])
  })

  it('EARS-6: a publication record carries exactly the legacy keys', async () => {
    await seedPeriodWithTwoAssessments()
    await startBatch()
    const publication = (await readHoursDocument()).publications?.[0]
    expect(Object.keys(publication!)).toEqual([
      'period_id',
      'status',
      'started_at',
      'published_at',
      'preview_fingerprint',
      'messages',
    ])
  })

  it('EARS-31: a sending batch locks the period’s label, dates and reopening', async () => {
    await seedPeriodWithTwoAssessments()
    await startBatch()

    const doc = await readHoursDocument()
    expect(isPeriodMutationLocked(doc, PERIOD)).toBe(true)

    const edited = await mutateHoursDocument(TEST_ACTOR, (current) =>
      updatePeriod(current, {
        id: PERIOD,
        label: 'Июль',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-15',
      }),
    )
    expect(edited.ok).toBe(false)
    if (edited.ok) throw new Error('unreachable')
    expect(edited.error).toContain('уже начата')

    const reopened = await mutateHoursDocument(TEST_ACTOR, (current) =>
      setPeriodStatus(current, PERIOD, 'open'),
    )
    expect(reopened.ok).toBe(false)
  })
})

describe('delivery addresses a message by position (EARS-31 step 3)', () => {
  it('writes one child row per message at its position, in preview order', async () => {
    await seedPeriodWithTwoAssessments()
    await startBatch()

    const { rows } = await db.execute<{ position: number; email: string; delivery: string }>(
      sql`select "position", email, delivery from core.hours_publication_message
          where period_id = ${PERIOD} order by "position"`,
    )
    expect(rows).toEqual([
      { position: 0, email: 'anton@bbm.academy', delivery: 'pending' },
      { position: 1, email: 'eduard@bbm.academy', delivery: 'pending' },
    ])
  })

  it('a delivery step updates exactly the row at that position and leaves the others alone', async () => {
    await seedPeriodWithTwoAssessments()
    await startBatch()

    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      recordPublicationDelivery(doc, PERIOD, 0, 'sent', '2026-08-03T09:01:00.000Z'),
    )

    const { rows } = await db.execute<{
      position: number
      delivery: string
      sent_at: string | null
    }>(
      sql`select "position", delivery, sent_at from core.hours_publication_message
          where period_id = ${PERIOD} order by "position"`,
    )
    expect(rows).toEqual([
      { position: 0, delivery: 'sent', sent_at: '2026-08-03T09:01:00.000Z' },
      { position: 1, delivery: 'pending', sent_at: null },
    ])
  })

  it('an already-delivered message of a `sending` batch is not re-sent — the replayed position is refused', async () => {
    await seedPeriodWithTwoAssessments()
    await startBatch()

    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      recordPublicationDelivery(doc, PERIOD, 0, 'sent', '2026-08-03T09:01:00.000Z'),
    )
    const replay = await mutateHoursDocument(TEST_ACTOR, (doc) =>
      recordPublicationDelivery(doc, PERIOD, 0, 'sent', '2026-08-03T09:03:00.000Z'),
    )
    expect(replay.ok).toBe(false)
    if (replay.ok) throw new Error('unreachable')
    expect(replay.error).toBe('Сообщение уже обработано или не найдено.')

    // The delivered row kept its own timestamp — the replay changed nothing.
    const { rows } = await db.execute<{ sent_at: string | null }>(
      sql`select sent_at from core.hours_publication_message
          where period_id = ${PERIOD} and "position" = 0`,
    )
    expect(rows[0].sent_at).toBe('2026-08-03T09:01:00.000Z')
  })

  it('the audit ledger records one small diff per delivery step, naming the composite pk', async () => {
    await seedPeriodWithTwoAssessments()
    await startBatch()
    const mark = await auditWatermark(db)

    await mutateHoursDocument(TEST_ACTOR, (doc) =>
      recordPublicationDelivery(doc, PERIOD, 0, 'sent', '2026-08-03T09:01:00.000Z'),
    )

    // ONE row, naming ONE message — the whole reason EARS-31 normalises the
    // batch. On the old `jsonb` column the same step would have been «the
    // messages array changed», once per delivered message.
    const events = await auditEventsFor(db, mark, 'hours_publication_message')
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('data.hours_publication_message.update')
    expect(events[0].pk).toEqual({ period_id: PERIOD, position: 0 })
    expect(Object.keys(events[0].diff).sort()).toEqual(['delivery', 'sent_at'])
    expect(events[0].diff.delivery).toEqual({ old: 'pending', new: 'sent' })
    expect(events[0].diff.sent_at).toEqual({ old: null, new: '2026-08-03T09:01:00.000Z' })
    expect(events[0].actor_email).toBe('anton@bbm.academy')
    expect(events[0].source).toBe('portal')
  })
})

describe('the preview fingerprint (EARS-22)', () => {
  it('EARS-22: a member-only column change does not move the fingerprint; a role change does', async () => {
    await seedPeriodWithTwoAssessments()
    const before = buildMattermostPreview(await readHoursDocument(), PERIOD).preview_fingerprint

    await fixtureWrite((tx) =>
      tx.execute(
        sql`update core.member set timezone = 'Asia/Tbilisi', status = 'inactive',
                updated_at = now() where email = 'anton@bbm.academy'`,
      ),
    )
    const afterMemberOnlyTouch = buildMattermostPreview(
      await readHoursDocument(),
      PERIOD,
    ).preview_fingerprint
    expect(afterMemberOnlyTouch).toBe(before)

    await fixtureWrite((tx) =>
      tx.execute(sql`update core.member set role = 'Технологии' where email = 'anton@bbm.academy'`),
    )
    const afterRoleChange = buildMattermostPreview(
      await readHoursDocument(),
      PERIOD,
    ).preview_fingerprint
    expect(afterRoleChange).not.toBe(before)
  })
})
