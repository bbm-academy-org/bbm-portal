// @vitest-environment node
import { readFileSync } from 'node:fs'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { createExpenseRequest, FinanceRefusal } from '@/lib/finance'

import {
  ENTRY,
  fixtureWrite,
  seedIntakeReferences,
  truncateFinanceTables,
  type FinanceIntakeRefs,
} from './finance-helpers'
import { asMigrator } from './privilege-helpers'

/**
 * The `0017` repair against REALITY (#517; owner go, Антон, 2026-09-22).
 *
 * A migration runs ONCE, on a database no test has met yet, so the only honest
 * way to assert what it does is to lift its own block out of the committed SQL
 * and re-run it here — the shape `audit-columns.int.spec.ts` established for
 * `0016` §6. Reading the REAL text rather than a paraphrase is what keeps this
 * an assertion about the migration instead of about a copy that can drift.
 *
 * Re-running is legitimate rather than a trick, and that is itself one of the
 * claims below: the block selects on a `source_system=` line inside `note`,
 * which the first pass removes, so a second pass is a no-op by construction.
 */
const REPAIR_MARKER = 'DO $intake_provenance_repair$'

function repairBlock(): string {
  const migration = readFileSync(
    'src/lib/platform/db/migrations/0017_finance_intake_provenance.sql',
    'utf8',
  )
  const start = migration.indexOf(REPAIR_MARKER)
  const end = migration.indexOf('$intake_provenance_repair$;', start)
  if (start === -1 || end === -1) {
    throw new Error(
      'finance-intake-provenance: the repair block was not found in ' +
        '0017_finance_intake_provenance.sql — this assertion reads the real migration, so a ' +
        'renamed block must be followed here rather than silently skipped',
    )
  }
  return migration.slice(start, end + REPAIR_MARKER.length - 'DO '.length)
}

/** The block issues `ALTER TABLE … DISABLE TRIGGER USER`, which asks for OWNERSHIP. */
async function runRepair(): Promise<void> {
  await asMigrator(async (client) => {
    await client.query(repairBlock())
  })
}

const db = getPlatformDb()

/**
 * Row 6 of the reconstruction, VERBATIM — the Higgsfield request the issue's
 * acceptance criterion names (post `q41r3h4nxjnozgft493okar9tw`, written
 * 2026-04-20T14:21:39Z). The first line is the human sentence; everything under
 * it is the `key=value` block that should never have been in `note`.
 */
const ROW_6_NOTE = [
  'Higgsfield Ultra — генерация изображений и видео для производства сериала.',
  'source_system=mattermost',
  'source_post_id=q41r3h4nxjnozgft493okar9tw',
  'source_created_at=2026-04-20T14:21:39Z',
  'source_approval_post_id=6axpwfenzbgpjeuc9asmksma9c',
  'source_approved_at=2026-04-20T14:39:08Z',
  'invoice_number=SCWV2ZVQ-0001',
  'requested_amount=310.00 USD',
  'actual_amount=243.00 USD',
].join('\n')

/** One of the ten rows where ONE post was split into several intake items. */
const SPLIT_NOTE = [
  'Higgsfield — доля в общем платеже.',
  'source_system=mattermost',
  'source_post_id=dhyq4p4yepgwzy9qk5p5iw65uc',
  'source_created_at=2026-05-12T09:15:00Z',
  'source_item=higgsfield',
  // The corpus really does record a key with an empty value; it means «this
  // key applies and is blank», which is not the same as an absent key.
  'source_occurred_on=',
].join('\n')

/** A human note with no provenance block at all — the repair must not touch it. */
const HUMAN_NOTE = 'Оплатили картой, чек приложу позже. Итого=12000 рублей.'

let refs: FinanceIntakeRefs

/**
 * An intake row written RAW, exactly as the reconstruction left it: `note`
 * carrying the block, `source_ref` null, `created_at` the reconstruction's own
 * clock. It goes in through the MIGRATING connection with user triggers off,
 * because `created_at` is immutable (`0016` §3) and the fixture has to be able
 * to claim a wrong one for the repair to correct.
 */
async function seedReconstructedRow(note: string): Promise<number> {
  return asMigrator(async (client) => {
    await client.query('alter table core.finance_intake_item disable trigger user')
    try {
      const { rows } = await client.query<{ id: number }>(
        `insert into core.finance_intake_item
           (source, kind, status, amount, currency, project_id, counterparty_id,
            purpose_id, note, created_by, created_at, updated_at)
         values ('request', 'expense', 'submitted', 31000, 'RUB', $1, $2, $3, $4, $5,
                 timestamptz '2026-09-20 11:00:00+00', timestamptz '2026-09-20 11:00:00+00')
         returning id`,
        [refs.projectId, refs.counterpartyId, refs.purposeId, note, refs.entryMemberId],
      )
      return Number(rows[0]!.id)
    } finally {
      await client.query('alter table core.finance_intake_item enable trigger user')
    }
  })
}

type RepairedRow = {
  note: string | null
  source_ref: string | null
  provenance: Record<string, string> | null
  /** `db.execute` hands raw driver values back, so the instant arrives as text. */
  created_at: string
}

async function readRow(id: number): Promise<RepairedRow> {
  const { rows } = await db.execute<RepairedRow>(
    sql`select note, source_ref, provenance, created_at
        from core.finance_intake_item where id = ${id}`,
  )
  return rows[0]!
}

beforeEach(async () => {
  await truncateFinanceTables()
  refs = await seedIntakeReferences()
})

afterAll(async () => {
  await closePlatformDb()
})

describe('0017 lifts the provenance block out of `note`', () => {
  it('splits row 6 into a human note, a provenance object, a ref and a filing moment', async () => {
    const id = await seedReconstructedRow(ROW_6_NOTE)

    await runRepair()

    const row = await readRow(id)
    expect(row.note).toBe(
      'Higgsfield Ultra — генерация изображений и видео для производства сериала.',
    )
    expect(row.provenance).toEqual({
      source_system: 'mattermost',
      source_post_id: 'q41r3h4nxjnozgft493okar9tw',
      source_created_at: '2026-04-20T14:21:39Z',
      source_approval_post_id: '6axpwfenzbgpjeuc9asmksma9c',
      source_approved_at: '2026-04-20T14:39:08Z',
      invoice_number: 'SCWV2ZVQ-0001',
      requested_amount: '310.00 USD',
      actual_amount: '243.00 USD',
    })
    expect(row.source_ref).toBe('q41r3h4nxjnozgft493okar9tw')
    // The acceptance criterion's own instant, not the reconstruction's clock.
    expect(new Date(row.created_at).toISOString()).toBe('2026-04-20T14:21:39.000Z')
  })

  it('disambiguates a split post with `#<source_item>`, and keeps an empty value', async () => {
    const id = await seedReconstructedRow(SPLIT_NOTE)

    await runRepair()

    const row = await readRow(id)
    expect(row.source_ref).toBe('dhyq4p4yepgwzy9qk5p5iw65uc#higgsfield')
    expect(row.provenance?.source_occurred_on).toBe('')
    expect(row.note).toBe('Higgsfield — доля в общем платеже.')
  })

  it('leaves a note that carries no provenance block completely alone', async () => {
    const id = await seedReconstructedRow(HUMAN_NOTE)

    await runRepair()

    const row = await readRow(id)
    expect(row.note).toBe(HUMAN_NOTE)
    expect(row.provenance).toBeNull()
    expect(row.source_ref).toBeNull()
    expect(new Date(row.created_at).toISOString()).toBe('2026-09-20T11:00:00.000Z')
  })

  it('is idempotent — a second run changes nothing', async () => {
    const id = await seedReconstructedRow(ROW_6_NOTE)

    await runRepair()
    const first = await readRow(id)
    await runRepair()
    const second = await readRow(id)

    expect(second).toEqual(first)
  })
})

/**
 * The Postgres refusal, through drizzle's wrapper.
 *
 * `db.execute` rejects with its own «Failed query» Error and hangs the driver's
 * error — the one carrying the constraint NAME — off `cause`. Asserting on the
 * outer message alone would pass for any failure at all, which is exactly what
 * a constraint test must not do, so the whole chain is flattened first.
 */
async function refusalOf(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    const chain: string[] = []
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      chain.push(current.message)
    }
    return chain.join(' | ')
  }
  throw new Error('the statement was accepted, but the constraint had to refuse it')
}

describe('the revised EARS-503 source_ref policy', () => {
  async function insertWith(source: string, sourceRef: string | null): Promise<number> {
    const result = await fixtureWrite((tx) =>
      tx.execute<{ id: number }>(sql`
      insert into core.finance_intake_item
        (source, kind, status, occurred_on, account_id, amount, currency, project_id,
         counterparty_id, purpose_id, created_by, source_ref)
      values (${source}, 'expense', 'draft', '2026-08-20', ${refs.accountId}, 4200, 'RUB',
              ${refs.projectId}, ${refs.counterpartyId}, ${refs.purposeId},
              ${refs.entryMemberId}, ${sourceRef})
      returning id
    `),
    )
    return Number(result.rows[0]!.id)
  }

  it('accepts a `request` that names where it was filed', async () => {
    await expect(
      insertWith('request', 'https://chat.bbm.academy/bbm/pl/abc'),
    ).resolves.toBeDefined()
  })

  it('still accepts a `request` with no ref at all', async () => {
    await expect(insertWith('request', null)).resolves.toBeDefined()
  })

  it('still refuses a `backfill` row that carries none', async () => {
    expect(await refusalOf(insertWith('backfill', null))).toContain(
      'finance_intake_item_source_ref_policy',
    )
  })

  it('still refuses a second request naming the same source', async () => {
    await insertWith('request', 'q41r3h4nxjnozgft493okar9tw')
    expect(await refusalOf(insertWith('request', 'q41r3h4nxjnozgft493okar9tw'))).toContain(
      'finance_intake_item_source_ref_unique',
    )
  })
})

describe('a request files the link to where it was made (#517, EARS-535)', () => {
  function filing(sourceRef: string | null) {
    return {
      occurredOn: null,
      accountId: null,
      amount: 42_000n,
      currency: 'RUB',
      purposeId: refs.purposeId,
      projectId: refs.projectId,
      counterpartyId: refs.counterpartyId,
      sourceRef,
    }
  }

  it('stores the link verbatim and leaves `provenance` alone', async () => {
    const filed = await createExpenseRequest(ENTRY, filing('https://chat.bbm.academy/bbm/pl/abc'))

    expect(filed.sourceRef).toBe('https://chat.bbm.academy/bbm/pl/abc')
    // Provenance is what a SOURCE said; a member's own filing says nothing
    // structured, and the column stays empty rather than being invented.
    expect(filed.provenance).toBeNull()
  })

  it('files without one — the field is optional, not merely nullable', async () => {
    expect((await createExpenseRequest(ENTRY, filing(null))).sourceRef).toBeNull()
  })

  it('refuses a second request naming the same source (EARS-504 still holds)', async () => {
    await createExpenseRequest(ENTRY, filing('https://chat.bbm.academy/bbm/pl/once'))
    await expect(
      createExpenseRequest(ENTRY, filing('https://chat.bbm.academy/bbm/pl/once')),
    ).rejects.toBeInstanceOf(FinanceRefusal)
  })
})
