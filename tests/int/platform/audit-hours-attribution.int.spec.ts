// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createPeriod, mutateHoursDocument, saveAssessment, upsertParticipant } from '@/lib/hours'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { auditEventsSince, auditWatermark } from './audit-helpers'
import { seedMember, seedParticipant, seedPeriod, truncateHoursTables } from './hours-core-helpers'

/**
 * Every hours mutation entrypoint carries its actor into the database
 * (spec 201 EARS-9, EARS-24, EARS-25 — issue #273, acceptance scenario 1).
 *
 * EARS-9 states the property as a defect class rather than a feature: «a ledger
 * row originating from an authenticated request and reading `db-direct`, or
 * carrying a NULL actor, is a defect, and the integration tier shall assert
 * against it for every hours mutation entrypoint». That is what this file is —
 * it drives the store the way `src/modules/hours/actions.ts` drives it, one
 * mutation per shipped entrypoint, and asserts on the rows that appear.
 *
 * The Server Actions themselves are not called here: they open `auth()` and a
 * Next request scope. What they contribute — `sessionEmail(session)` +
 * `source: 'portal'` — is exactly the context passed below. That the actions
 * really contribute it is asserted where the actions run, against the store
 * double's recorded `state.contexts`:
 * `tests/unit/hours-actions.spec.ts` («EARS-25: аудит-контекст мутации приходит
 * из сессии, а не из константы», all five admin mutations plus
 * `saveAssessmentAction`) and `tests/unit/hours-publication-actions.spec.ts`
 * («EARS-25: the publication action carries its session actor into every
 * transaction», the batch plus every delivery step). Between them the eight
 * mutation entrypoints of `src/modules/hours/actions.ts` are covered; this file
 * asserts what happens to that context once it reaches Postgres.
 */

const db = getPlatformDb()

const ACTOR = { actorEmail: 'anton@bbm.academy', source: 'portal' } as const

beforeEach(async () => {
  await truncateHoursTables(db)
  const memberId = await seedMember({ email: 'anton@bbm.academy', name: 'Антон', role: 'CEO' })
  await seedParticipant(memberId, { forkMin: 300000, forkMax: 500000, grade: 'II', sortKey: 0 })
  await seedPeriod({
    id: 'p-july',
    label: 'Июль',
    from: '2026-07-01',
    to: '2026-07-31',
    status: 'open',
  })
})

afterAll(async () => {
  await closePlatformDb()
})

describe('hours mutations carry their actor', () => {
  it('EARS-25: scenario 1 — an admin edit of the shared registry lands attributed to the editor', async () => {
    const mark = await auditWatermark(db)

    const result = await mutateHoursDocument(ACTOR, (doc) =>
      upsertParticipant(doc, {
        email: 'anton@bbm.academy',
        name: 'Антон Сидоров',
        role: 'CTO',
        forkMin: 300000,
        forkMax: 500000,
        grade: 'II',
      }),
    )
    expect(result.ok).toBe(true)

    const rows = await auditEventsSince(db, mark)
    const memberRow = rows.find((row) => row.table_name === 'member')
    expect(memberRow).toMatchObject({
      event_type: 'data.member.update',
      source: 'portal',
      actor_email: 'anton@bbm.academy',
    })
    // Scenario 1 as the spec writes it: the owner edits a participant's ROLE —
    // a column of the shared registry — and the diff names it with both values
    // (EARS-17 after the 2026-08-19 revision: service data is not a contact).
    expect(memberRow?.diff).toEqual({
      name: { old: 'Антон', new: 'Антон Сидоров' },
      role: { old: 'CEO', new: 'CTO' },
    })
    // «когда» — the mutation's own moment, defaulted by the ledger itself.
    expect(Date.parse(String(memberRow?.created_at))).toBeGreaterThan(Date.now() - 60_000)
  })

  it('EARS-9: no row written by a mutation entrypoint reads db-direct or carries a NULL actor', async () => {
    const mark = await auditWatermark(db)

    await mutateHoursDocument(ACTOR, (doc) =>
      createPeriod(
        doc,
        { label: 'Август', dateFrom: '2026-08-01', dateTo: '2026-08-31' },
        'p-august',
      ),
    )
    await mutateHoursDocument(ACTOR, (doc) =>
      saveAssessment(
        doc,
        {
          periodId: 'p-july',
          email: 'anton@bbm.academy',
          hours: 100,
          method: 'period',
          weekendHours: 0,
          splitPercent: 50,
        },
        new Date().toISOString(),
      ),
    )

    const rows = await auditEventsSince(db, mark)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.source).toBe('portal')
      expect(row.actor_email).toBe('anton@bbm.academy')
    }
    expect(rows.map((row) => row.event_type)).toContain('data.hours_period.insert')
    expect(rows.map((row) => row.event_type)).toContain('data.hours_assessment.insert')
  })

  it('EARS-3: a mutation the domain refuses writes nothing at all to the ledger', async () => {
    const mark = await auditWatermark(db)

    const refused = await mutateHoursDocument(ACTOR, (doc) =>
      createPeriod(doc, { label: '', dateFrom: '2026-09-01', dateTo: '2026-09-30' }, 'p-empty'),
    )

    expect(refused.ok).toBe(false)
    expect(await auditEventsSince(db, mark)).toEqual([])
  })
})
