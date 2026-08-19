// @vitest-environment node
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { refusalText } from './audit-helpers'
import { fixtureWrite, seedPeriod, truncateHoursTables } from './hours-core-helpers'

/**
 * `core.hours_publication_message` — the expand and the backfill (spec 201
 * EARS-31 steps 1–2, issue #274).
 *
 * Two questions this file answers against the REALLY migrated database:
 *
 *  1. **Shape.** The table exists with the FK to `core.hours_publication`, the
 *     `UNIQUE (period_id, position)` — delivered as the composite PRIMARY KEY,
 *     whose unique index IS that constraint — and the `delivery` CHECK
 *     mirroring `PublicationDelivery` (`src/lib/hours/types.ts`).
 *  2. **The backfill.** Every element of a legacy `messages` array lands as one
 *     child row with its ordinal as `position` and its per-message
 *     `delivery`/`sent_at` preserved — **including an in-flight `sending`
 *     batch**, whose partially delivered state is exactly what must survive: a
 *     `sending` batch blocks period mutations (spec 100 req. 12/15), and a
 *     cutover that lost the per-message flags would either re-send delivered
 *     messages or strand the batch.
 *
 * The backfill assertion runs **the statement the migration ships**, extracted
 * from the file between its two markers, rather than a re-typed copy of it: the
 * migration has already been applied by the time a test runs, so a copy here
 * would prove a second implementation correct and say nothing about the shipped
 * one. Re-running it over a freshly seeded legacy row is also how its
 * idempotency is asserted (it is `ON CONFLICT DO NOTHING`).
 */

const db = getPlatformDb()

const MIGRATION = path.join(
  process.cwd(),
  'src/lib/platform/db/migrations/0004_hours_publication_message.sql',
)

/** The shipped backfill statement, between the markers the migration carries. */
async function backfillStatement(): Promise<string> {
  const sqlText = await readFile(MIGRATION, 'utf8')
  const match = /-- >>> backfill\n([\s\S]*?)\n-- <<< backfill/.exec(sqlText)
  if (!match) throw new Error(`no backfill markers in ${MIGRATION}`)
  return match[1]
}

/** A publication in its PRE-#274 shape: the parent row alone, messages in jsonb. */
async function seedLegacyPublication(input: {
  periodId: string
  status: 'sending' | 'published' | 'incomplete'
  publishedAt: string | null
  messages: Array<{ email: string; text: string; delivery: string; sent_at: string | null }>
}): Promise<void> {
  await fixtureWrite((tx) =>
    tx.execute(sql`insert into core.hours_publication
      (period_id, status, started_at, published_at, preview_fingerprint, messages)
      values (${input.periodId}, ${input.status}, '2026-08-03T09:00:00.000Z',
              ${input.publishedAt}, 'fingerprint',
              ${JSON.stringify(input.messages)}::jsonb)`),
  )
}

async function childRows(periodId: string) {
  const { rows } = await db.execute<{
    position: number
    email: string
    text: string
    delivery: string
    sent_at: string | null
  }>(
    sql`select "position", email, text, delivery, sent_at
        from core.hours_publication_message
        where period_id = ${periodId}
        order by "position"`,
  )
  return rows
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
    await seedLegacyPublication({
      periodId: 'p-1',
      status: 'sending',
      publishedAt: null,
      messages: [],
    })
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
    await seedLegacyPublication({
      periodId: 'p-1',
      status: 'sending',
      publishedAt: null,
      messages: [],
    })
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

describe('the backfill (EARS-31 step 2)', () => {
  it('migrates every element with its ordinal as position, preserving delivery and sent_at — including an in-flight `sending` batch', async () => {
    await seedPeriod({ id: 'p-june', label: 'Июнь', from: '2026-06-01', to: '2026-06-30' })
    await seedPeriod({ id: 'p-july', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })

    // A finished batch: everything delivered, each with its own timestamp.
    await seedLegacyPublication({
      periodId: 'p-june',
      status: 'published',
      publishedAt: '2026-07-02T09:02:00.000Z',
      messages: [
        {
          email: 'anton@bbm.academy',
          text: '**Верификация часов — Антон**',
          delivery: 'sent',
          sent_at: '2026-07-02T09:01:00.000Z',
        },
        {
          email: 'eduard@bbm.academy',
          text: '**Верификация часов — Эдуард**',
          delivery: 'sent',
          sent_at: '2026-07-02T09:02:00.000Z',
        },
      ],
    })

    // An IN-FLIGHT batch: message 0 delivered, 1 failed, 2 never attempted. This
    // is the state that must survive the cutover intact (spec 100 req. 12/15).
    await seedLegacyPublication({
      periodId: 'p-july',
      status: 'sending',
      publishedAt: null,
      messages: [
        {
          email: 'anton@bbm.academy',
          text: 'первое',
          delivery: 'sent',
          sent_at: '2026-08-03T09:01:00.000Z',
        },
        { email: 'eduard@bbm.academy', text: 'второе', delivery: 'failed', sent_at: null },
        { email: 'maria@bbm.academy', text: 'третье', delivery: 'pending', sent_at: null },
      ],
    })

    const statement = await backfillStatement()
    await fixtureWrite((tx) => tx.execute(sql.raw(statement)))

    expect(await childRows('p-june')).toEqual([
      {
        position: 0,
        email: 'anton@bbm.academy',
        text: '**Верификация часов — Антон**',
        delivery: 'sent',
        sent_at: '2026-07-02T09:01:00.000Z',
      },
      {
        position: 1,
        email: 'eduard@bbm.academy',
        text: '**Верификация часов — Эдуард**',
        delivery: 'sent',
        sent_at: '2026-07-02T09:02:00.000Z',
      },
    ])

    expect(await childRows('p-july')).toEqual([
      {
        position: 0,
        email: 'anton@bbm.academy',
        text: 'первое',
        delivery: 'sent',
        sent_at: '2026-08-03T09:01:00.000Z',
      },
      {
        position: 1,
        email: 'eduard@bbm.academy',
        text: 'второе',
        delivery: 'failed',
        sent_at: null,
      },
      {
        position: 2,
        email: 'maria@bbm.academy',
        text: 'третье',
        delivery: 'pending',
        sent_at: null,
      },
    ])
  })

  it('is idempotent — a second run changes nothing and touches no row', async () => {
    await seedPeriod({ id: 'p-july', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })
    await seedLegacyPublication({
      periodId: 'p-july',
      status: 'sending',
      publishedAt: null,
      messages: [
        {
          email: 'anton@bbm.academy',
          text: 'первое',
          delivery: 'sent',
          sent_at: '2026-08-03T09:01:00.000Z',
        },
        { email: 'eduard@bbm.academy', text: 'второе', delivery: 'pending', sent_at: null },
      ],
    })

    const statement = await backfillStatement()
    await fixtureWrite((tx) => tx.execute(sql.raw(statement)))
    const first = await childRows('p-july')
    await fixtureWrite((tx) => tx.execute(sql.raw(statement)))

    expect(await childRows('p-july')).toEqual(first)
    expect(first).toHaveLength(2)
  })
})
