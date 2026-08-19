// @vitest-environment node
import { Client } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { mutateHoursDocument, readHoursDocument, saveAssessment } from '@/lib/hours'
import { HOURS_LOCK_KEY } from '@/lib/hours/core/lock'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { requirePlatformDatabaseUrl } from '@/lib/platform/db/config'

import { seedMember, seedParticipant, seedPeriod, truncateHoursTables } from './hours-core-helpers'

/**
 * Кто пишет в этих сюитах (спека 201 EARS-7, EARS-25). `portal` + непустой
 * actor — ровно то, что приходит из Server Action после гейта сессии; без
 * контекста запись отклонит `core.audit_row_change()` на помеченном пуле.
 */
const TEST_ACTOR = { actorEmail: 'anton@bbm.academy', source: 'portal' } as const

/**
 * The module-wide advisory lock (spec 124 EARS-10) — the direct analogue of
 * today's in-process mutex (081 §13).
 *
 * Two assertions, because either alone is weak. By OUTCOME: two concurrent saves
 * of the same (period, member) both succeed and leave one row — without mutual
 * exclusion each would read «no row yet» and the second insert would hit the
 * unique index. By MECHANISM: an independent connection holding
 * `pg_advisory_lock` on the module key makes a mutation WAIT, which pins both the
 * lock function and the exact key rather than inferring them from a happy path.
 */

const db = getPlatformDb()

async function seedOpenPeriodWithParticipant(): Promise<void> {
  const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
  await seedParticipant(id, { forkMin: 300_000, forkMax: 400_000, grade: 'III', sortKey: 0 })
  await seedPeriod({
    id: 'p-july',
    label: 'Июль 2026',
    from: '2026-07-01',
    to: '2026-07-31',
    status: 'open',
  })
}

function save(hours: number, at: string) {
  return mutateHoursDocument(TEST_ACTOR, (doc) =>
    saveAssessment(
      doc,
      {
        periodId: 'p-july',
        email: 'anton@bbm.academy',
        hours,
        method: 'period',
        weekendHours: 0,
        splitPercent: 50,
      },
      at,
    ),
  )
}

beforeEach(async () => {
  await truncateHoursTables(db)
})

afterAll(async () => {
  await closePlatformDb()
})

describe('the hours advisory lock (EARS-10)', () => {
  it('EARS-10: two concurrent mutations serialize — both succeed, one row, no lost upsert', async () => {
    await seedOpenPeriodWithParticipant()

    const [first, second] = await Promise.all([
      save(40, '2026-08-01T10:00:00.000Z'),
      save(41, '2026-08-01T10:00:01.000Z'),
    ])
    expect([first.ok, second.ok]).toEqual([true, true])

    const doc = await readHoursDocument()
    expect(doc.assessments).toHaveLength(1)
    expect([40, 41]).toContain(doc.assessments[0].hours)
  })

  it('EARS-10: a mutation waits for the module lock key held by another connection', async () => {
    await seedOpenPeriodWithParticipant()

    const holder = new Client({ connectionString: requirePlatformDatabaseUrl(process.env) })
    await holder.connect()
    try {
      await holder.query('select pg_advisory_lock($1::bigint)', [HOURS_LOCK_KEY])

      let settled = false
      const pending = save(40, '2026-08-01T10:00:00.000Z').then((result) => {
        settled = true
        return result
      })

      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(settled, 'the mutation must block on the module lock, not proceed past it').toBe(false)

      await holder.query('select pg_advisory_unlock($1::bigint)', [HOURS_LOCK_KEY])
      const result = await pending
      expect(result.ok).toBe(true)
    } finally {
      await holder.end()
    }
  })
})
