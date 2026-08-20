// @vitest-environment node
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { readHoursDocument } from '@/lib/hours'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { refusalText } from './audit-helpers'
import { fixtureWrite, seedPeriod, truncateHoursTables } from './hours-core-helpers'

/**
 * `core.hours_publication_message` — the expand and the backfill (spec 201
 * EARS-31 steps 1–2, issue #274).
 *
 * Three questions this file answers against the REALLY migrated database:
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
 *  3. **The Release-A read fallback.** A batch that an app rollback created with
 *     no child rows at all is still read whole, from the legacy `jsonb` column
 *     (`docs/runbooks/migrations-expand-contract.md`, «The two-release split»).
 *
 * The backfill assertion runs **the statement the migration ships**, extracted
 * from the file between its two markers, rather than a re-typed copy of it: the
 * migration has already been applied by the time a test runs, so a copy here
 * would prove a second implementation correct and say nothing about the shipped
 * one. Re-running it over a freshly seeded legacy row is how its idempotency is
 * asserted, and re-running it after the legacy array has MOVED ON — the app
 * rollback's signature — is how its reconciliation is (`ON CONFLICT … DO UPDATE`,
 * the `jsonb` array authoritative in that window).
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

  it('reconciles a position the legacy array moved on for — the app-rollback window (#281)', async () => {
    // The window the re-run exists for: the previous app code writes the `jsonb`
    // array ONLY, and for a batch that already had child rows every delivery it
    // records is an UPDATE at an EXISTING position. `DO NOTHING` would skip
    // exactly those and leave `pending` where the message was in fact sent — and
    // the rolled-forward code would then re-send it.
    await seedPeriod({ id: 'p-july', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })
    await seedLegacyPublication({
      periodId: 'p-july',
      status: 'sending',
      publishedAt: null,
      messages: [
        { email: 'anton@bbm.academy', text: 'первое', delivery: 'pending', sent_at: null },
        { email: 'eduard@bbm.academy', text: 'второе', delivery: 'pending', sent_at: null },
      ],
    })

    const statement = await backfillStatement()
    await fixtureWrite((tx) => tx.execute(sql.raw(statement)))
    expect((await childRows('p-july')).map((row) => row.delivery)).toEqual(['pending', 'pending'])

    // The rolled-back app delivers message 0, into the array and nowhere else.
    await fixtureWrite((tx) =>
      tx.execute(sql`update core.hours_publication
        set messages = jsonb_set(
          jsonb_set(messages, '{0,delivery}', '"sent"'),
          '{0,sent_at}', '"2026-08-03T09:01:00.000Z"')
        where period_id = 'p-july'`),
    )

    await fixtureWrite((tx) => tx.execute(sql.raw(statement)))

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
        delivery: 'pending',
        sent_at: null,
      },
    ])
  })

  it('writes no row for a batch whose array is empty', async () => {
    // `CROSS JOIN LATERAL jsonb_array_elements` drops the parent row when the
    // array has no elements — asserted rather than left to be noticed, because
    // the alternative (a LEFT JOIN LATERAL) would insert a row of NULLs and hit
    // the NOT NULLs sideways.
    await seedPeriod({ id: 'p-july', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })
    await seedLegacyPublication({
      periodId: 'p-july',
      status: 'incomplete',
      publishedAt: null,
      messages: [],
    })

    const statement = await backfillStatement()
    await fixtureWrite((tx) => tx.execute(sql.raw(statement)))

    expect(await childRows('p-july')).toEqual([])
  })
})

describe('the read fallback of Release A (expand/contract)', () => {
  it('reads a batch that has no child rows out of the legacy jsonb column', async () => {
    // The shape an app rollback leaves behind: the previous code created the
    // batch, so it exists in `messages` and in no child row. Without the
    // fallback this loads as a `sending` publication with zero messages — a
    // period locked for mutation (spec 100 req. 12/15) with nobody to deliver to.
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

    expect(await childRows('p-july')).toEqual([])

    const publication = (await readHoursDocument()).publications?.[0]
    expect(publication?.messages).toEqual([
      {
        email: 'anton@bbm.academy',
        text: 'первое',
        delivery: 'sent',
        sent_at: '2026-08-03T09:01:00.000Z',
      },
      { email: 'eduard@bbm.academy', text: 'второе', delivery: 'pending', sent_at: null },
    ])
    // Key order too: the fallback is on the export path (spec 124 EARS-11).
    expect(JSON.stringify(publication?.messages[1])).toBe(
      '{"email":"eduard@bbm.academy","text":"второе","delivery":"pending","sent_at":null}',
    )
  })

  it('prefers the child rows once they exist — the array is not consulted', async () => {
    await seedPeriod({ id: 'p-july', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })
    await seedLegacyPublication({
      periodId: 'p-july',
      status: 'sending',
      publishedAt: null,
      messages: [
        { email: 'anton@bbm.academy', text: 'из массива', delivery: 'pending', sent_at: null },
      ],
    })
    await fixtureWrite((tx) =>
      tx.execute(sql`insert into core.hours_publication_message
        (period_id, "position", email, text, delivery, sent_at)
        values ('p-july', 0, 'anton@bbm.academy', 'из таблицы', 'sent', '2026-08-03T09:01:00.000Z')`),
    )

    const publication = (await readHoursDocument()).publications?.[0]
    expect(publication?.messages).toEqual([
      {
        email: 'anton@bbm.academy',
        text: 'из таблицы',
        delivery: 'sent',
        sent_at: '2026-08-03T09:01:00.000Z',
      },
    ])
  })

  it('refuses a corrupted legacy array instead of loading a broken batch', async () => {
    await seedPeriod({ id: 'p-july', label: 'Июль', from: '2026-07-01', to: '2026-07-31' })
    await fixtureWrite((tx) =>
      tx.execute(sql`insert into core.hours_publication
        (period_id, status, started_at, published_at, preview_fingerprint, messages)
        values ('p-july', 'sending', '2026-08-03T09:00:00.000Z', null, 'fingerprint',
                '[{"email": "anton@bbm.academy"}]'::jsonb)`),
    )

    await expect(readHoursDocument()).rejects.toThrow(/повреждённое сообщение/)
  })
})
