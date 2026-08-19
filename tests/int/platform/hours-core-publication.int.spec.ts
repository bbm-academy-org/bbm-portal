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
 * The batch is the one node of the document that is NOT relational — a `jsonb`
 * array whose element order and length are a correctness property, because
 * delivery addresses messages BY INDEX (spec 100 req. 2/10). So the assertions
 * here are about the array surviving N rewrites unchanged, and about the
 * fingerprint's input being pinned to the legacy participant fields, which is
 * what keeps an unrelated `member` touch from invalidating a correct preview.
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
