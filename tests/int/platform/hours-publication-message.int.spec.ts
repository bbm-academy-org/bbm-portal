// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { refusalText } from './audit-helpers'
import { fixtureWrite, seedPeriod, truncateHoursTables } from './hours-core-helpers'

/**
 * `core.hours_publication_message` — the table's SHAPE against the really
 * migrated database (spec 201 EARS-31 step 1, issue #274): the FK to
 * `core.hours_publication`, the `UNIQUE (period_id, position)` — delivered as the
 * composite PRIMARY KEY, whose unique index IS that constraint — and the
 * `delivery` CHECK mirroring `PublicationDelivery` (`src/lib/hours/types.ts`).
 *
 * **This file used to test two more things, and #281 took the SUBJECT of both
 * away rather than the coverage.** They are named here because a reader of the
 * diff that removed them deserves to find out where each went instead of
 * inferring that it was dropped:
 *
 *  - **The backfill (EARS-31 step 2).** It ran the statement `0004` ships,
 *    extracted from between the file's markers, over a publication seeded in its
 *    pre-#274 shape — the `jsonb` array on the parent row. The contract release
 *    #281 (`0005_hours_publication_drop_messages.sql`) dropped that column, so
 *    there is no longer any way to seed the input the statement reads: by the
 *    time any test connects, the migration chain has already run to its end.
 *    What survives is what CAN still be asserted —
 *    `tests/unit/hours-publication-contract-migration.spec.ts` pins that `0005`
 *    re-runs that same statement byte-for-byte and re-runs it BEFORE the drop,
 *    which is the property the contract release actually depends on. The proof
 *    that the statement is correct, idempotent and reconciling was made against
 *    a real database at `0004` and is in this file's history.
 *  - **The Release-A read fallback.** It covered the app-rollback window between
 *    the two releases (`docs/runbooks/migrations-expand-contract.md`, «The
 *    two-release split»): a batch created by rolled-back code had no child rows
 *    and was read whole from the array instead, and the next save materialised
 *    ALL of it. Both the fallback in `src/lib/hours/core/load.ts` and the healing
 *    path in `persist.ts` are gone with the column — the window they covered is
 *    closed, and `0005`'s first statement is what closes it.
 *
 * The publication behaviour that outlives all of this — messages read back in
 * `position` order, delivery addressing ONE row, the ledger recording one small
 * diff per step — is `tests/int/platform/hours-core-publication.int.spec.ts`.
 */

const db = getPlatformDb()

/**
 * A parent batch row with no messages of its own.
 *
 * Since #281 that is all a `core.hours_publication` row IS: the child table is
 * the only representation of a batch's messages there is, so the fixture writes
 * the parent and the tests below add child rows through SQL when they need them.
 */
async function seedPublication(input: {
  periodId: string
  status: 'sending' | 'published' | 'incomplete'
  publishedAt: string | null
}): Promise<void> {
  await fixtureWrite((tx) =>
    tx.execute(sql`insert into core.hours_publication
      (period_id, status, started_at, published_at, preview_fingerprint)
      values (${input.periodId}, ${input.status}, '2026-08-03T09:00:00.000Z',
              ${input.publishedAt}, 'fingerprint')`),
  )
}

beforeEach(async () => {
  await truncateHoursTables(db)
})

afterAll(async () => {
  await closePlatformDb()
})

describe('the expand — core.hours_publication_message (EARS-31 step 1)', () => {
  it('carries the FK to core.hours_publication, ON DELETE CASCADE', async () => {
    const { rows } = await db.execute<{ delete_rule: string; column_name: string }>(
      sql`select rc.delete_rule, kcu.column_name
          from information_schema.table_constraints tc
          join information_schema.referential_constraints rc
            on rc.constraint_name = tc.constraint_name
           and rc.constraint_schema = tc.constraint_schema
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name
           and kcu.constraint_schema = tc.constraint_schema
          where tc.table_schema = 'core'
            and tc.table_name = 'hours_publication_message'
            and tc.constraint_type = 'FOREIGN KEY'`,
    )
    expect(rows).toEqual([{ delete_rule: 'CASCADE', column_name: 'period_id' }])
  })

  it('is unique on (period_id, position) — the composite primary key', async () => {
    const { rows } = await db.execute<{ column_name: string }>(
      sql`select kcu.column_name
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name
           and kcu.constraint_schema = tc.constraint_schema
          where tc.table_schema = 'core'
            and tc.table_name = 'hours_publication_message'
            and tc.constraint_type = 'PRIMARY KEY'
          order by kcu.ordinal_position`,
    )
    expect(rows.map((r) => r.column_name)).toEqual(['period_id', 'position'])
  })

  it('refuses a `delivery` value outside PublicationDelivery', async () => {
    await seedPeriod({ id: 'p-1', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })
    await seedPublication({ periodId: 'p-1', status: 'sending', publishedAt: null })
    // drizzle wraps the pg error, so the constraint name is read off the whole
    // `cause` chain rather than off the thrown object's own message.
    const refusal = await fixtureWrite((tx) =>
      tx.execute(sql`insert into core.hours_publication_message
          (period_id, "position", email, text, delivery, sent_at)
          values ('p-1', 0, 'a@bbm.academy', 'text', 'delivered', null)`),
    ).catch((err: unknown) => refusalText(err))
    expect(refusal).toMatch(/hours_publication_message_delivery_allowed/)
  })

  it('refuses a second row at the same position of the same batch', async () => {
    await seedPeriod({ id: 'p-1', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })
    await seedPublication({ periodId: 'p-1', status: 'sending', publishedAt: null })
    const insert = () =>
      fixtureWrite((tx) =>
        tx.execute(sql`insert into core.hours_publication_message
          (period_id, "position", email, text, delivery, sent_at)
          values ('p-1', 0, 'a@bbm.academy', 'text', 'pending', null)`),
      )
    await insert()
    await expect(insert()).rejects.toThrow()
  })
})
