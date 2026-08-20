// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { readHoursDocument } from '@/lib/hours'
import type { HoursDocument } from '@/lib/hours'
import { HoursImportRefusal, importDocument, type HoursRowCounts } from '@/lib/hours/core/import'
import { HOURS_LOCK_KEY } from '@/lib/hours/core/lock'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'

import {
  compareExports,
  verdictLines,
  type ExportComparison,
} from '../../../tools/platform/hours-export-diff'
import { readJsonDocument } from '../../../tools/platform/hours-json'
import { parseMemberDataset, seedMembers } from '../../../tools/platform/member-seed'
import { verifyHours } from '../../../tools/platform/hours-verify'
import { fixtureWrite, truncateHoursTables } from './hours-core-helpers'

/**
 * The cutover import and its verdict (spec 124 EARS-13, EARS-16, EARS-27),
 * against the REAL `core` tables.
 *
 * The clause under test is «carry production history VERBATIM or write nothing»,
 * and every half of it is the database's: one transaction (so a constraint that
 * fires on the last period leaves no first period behind), the digit-for-digit
 * round-trip of an UNROUNDED `hourly_rate` through `double precision`, and the
 * `sort_key` / identity-PK order that reproduces the JSON array order (EARS-21).
 * A mock would assert the tool's opinion of all three.
 *
 * The fixture under `./fixtures/hours.json` is a miniature of the production
 * document — three participants, a closed and an open period, a «только часы»
 * assessment with null money snapshots, an unrounded rate, and one delivered
 * publication batch. The production dataset itself is never committed (EARS-14).
 *
 * **Where the driver went.** Until #256 the import had a CLI
 * (`pnpm platform:hours:import`, `tools/platform/hours-import.ts`) and this suite
 * drove it. After the owner accepted the cutover that command was removed — `core`
 * is the master, a second import is never wanted, and a one-liner able to write
 * over live history is a hazard with no remaining use. The MECHANICS stayed
 * (`@/lib/hours/core/import.ts`): they are how the production rows got there, they
 * are the restore path from the `hours.json.<date>` archive, and this suite is now
 * their only driver — `importFixture` below is the four lines the CLI used to wrap.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB — see
 * `.claude/rules/parallel-sessions.md`, "Platform database"), loaded from `.env`
 * by `vitest.setup.ts`. Run: `pnpm exec vitest run tests/int/platform`.
 */

const db = getPlatformDb()

function fixture(name: string): string {
  return join(__dirname, 'fixtures', name)
}

function fingerprint(file: string): string {
  const stat = statSync(file)
  return [
    createHash('sha256').update(readFileSync(file)).digest('hex'),
    stat.size,
    stat.mtimeMs,
  ].join(' ')
}

async function rowCounts() {
  const rows = (
    await db.execute(sql`select
      (select count(*) from core.hours_period) as periods,
      (select count(*) from core.hours_participant) as participants,
      (select count(*) from core.hours_assessment) as assessments,
      (select count(*) from core.hours_publication) as publications,
      (select count(*) from core.hours_publication_message) as messages`)
  ).rows as Array<Record<string, string | number>>
  return Object.fromEntries(
    Object.entries(rows[0]).map(([table, count]) => [table, Number(count)]),
  ) as Record<'periods' | 'participants' | 'assessments' | 'publications', number>
}

type ImportOutcome = {
  summary: HoursRowCounts
  comparison: ExportComparison
  lines: string[]
}

/**
 * Read a fixture through the frozen archive reader and import it into `core`, in
 * ONE transaction that first takes the module advisory lock (EARS-10, EARS-13),
 * then produce the EARS-27 verdict against what `core` would export afterwards.
 *
 * The post-import export is read AFTER the transaction commits, deliberately:
 * EARS-27's question is «what would the owner download now», and the only honest
 * answer comes from the same read path `/p/hours/admin/export` uses.
 */
async function importFixture(file: string): Promise<ImportOutcome> {
  const source: HoursDocument = await readJsonDocument(file)
  // `cli:int-fixture` (spec 201 EARS-7), NOT a `cli:hours-import` — the import
  // COMMAND was deleted with the JSON store (#263) and this harness is the only
  // caller `importDocument()` has left, so naming a script that does not exist
  // would put a lie in the ledger. `platformTransaction` takes the module
  // advisory lock as the transaction's first statement exactly as the shipped
  // import did (spec 124 EARS-10, EARS-13).
  const summary = await platformTransaction(
    { actorEmail: null, source: 'cli:int-fixture' },
    async (tx) => importDocument(tx, source),
    { lockKey: HOURS_LOCK_KEY },
  )
  const core = await readHoursDocument()
  const comparison = compareExports(source, core)
  return { summary, comparison, lines: verdictLines(comparison) }
}

beforeEach(async () => {
  await truncateHoursTables(db)
  await seedMembers(
    parseMemberDataset(JSON.parse(readFileSync(fixture('member-seed.json'), 'utf8')) as unknown),
  )
})

afterAll(async () => {
  await closePlatformDb()
})

describe('the cutover import (EARS-13)', () => {
  it('EARS-13: carries the whole document verbatim — ids, timestamps, snapshots and array order', async () => {
    const source = await readJsonDocument(fixture('hours.json'))

    const result = await importFixture(fixture('hours.json'))

    expect(result.summary).toEqual({
      periods: 2,
      participants: 3,
      assessments: 3,
      publications: 1,
      messages: 2,
    })

    const core = await readHoursDocument()
    expect(core).toEqual(source)
    // The export is a BYTE contract, not merely a structural one (EARS-11).
    expect(JSON.stringify(core, null, 2)).toBe(JSON.stringify(source, null, 2))

    // Digit-for-digit: the unrounded effective rate must survive `double precision`.
    const rates = (await db.execute(sql`select hourly_rate from core.hours_assessment order by id`))
      .rows as Array<{ hourly_rate: number | null }>
    expect(rates.map((row) => row.hourly_rate)).toEqual([
      1163.0465116279069,
      668.6046511627907,
      null,
    ])

    // Array position became sort_key / identity order (EARS-21).
    const order = (
      await db.execute(sql`select p.sort_key, m.email
                           from core.hours_participant p
                           join core.member m on m.id = p.member_id
                           order by p.sort_key`)
    ).rows as Array<{ sort_key: number; email: string }>
    expect(order).toEqual([
      { sort_key: 0, email: 'vasya.pupkin@bbm.academy' },
      { sort_key: 1, email: 'lena.testova@bbm.academy' },
      { sort_key: 2, email: 'petr.fakov@bbm.academy' },
    ])
    const periodOrder = (
      await db.execute(sql`select id, sort_key from core.hours_period order by sort_key`)
    ).rows as Array<{ id: string; sort_key: number }>
    expect(periodOrder.map((row) => row.id)).toEqual(source.periods.map((period) => period.id))
  })

  it('EARS-13: refuses non-empty hours tables, naming them, and writes nothing a second time', async () => {
    await importFixture(fixture('hours.json'))
    const before = await rowCounts()

    const rerun = importFixture(fixture('hours.json'))
    await expect(rerun).rejects.toBeInstanceOf(HoursImportRefusal)
    await expect(rerun).rejects.toThrow(/hours_period/)

    expect(await rowCounts()).toEqual(before)
  })

  it('EARS-13: aborts with the list of emails that have no member, writing nothing', async () => {
    const run = importFixture(fixture('hours-unknown-email.json'))

    await expect(run).rejects.toBeInstanceOf(HoursImportRefusal)
    await expect(run).rejects.toThrow(/ghost\.nobody@bbm\.academy/)
    await expect(run).rejects.toThrow(/another\.ghost@bbm\.academy/)

    expect(await rowCounts()).toEqual({
      periods: 0,
      participants: 0,
      assessments: 0,
      publications: 0,
      messages: 0,
    })
  })

  it('EARS-13: runs as ONE transaction — a constraint firing late leaves nothing behind', async () => {
    // Two open periods: the partial unique index of EARS-5 fires on the SECOND
    // period insert, after the first one has already been written.
    await expect(importFixture(fixture('hours-two-open.json'))).rejects.toThrow()

    expect(await rowCounts()).toEqual({
      periods: 0,
      participants: 0,
      assessments: 0,
      publications: 0,
      messages: 0,
    })
  })
})

describe('the source document (EARS-16)', () => {
  it('EARS-16: a successful import never mutates the source hours.json', async () => {
    const file = fixture('hours.json')
    const before = fingerprint(file)

    await importFixture(file)

    expect(fingerprint(file)).toBe(before)
  })

  it('EARS-16: an aborted import never mutates the source hours.json either', async () => {
    const file = fixture('hours-unknown-email.json')
    const before = fingerprint(file)

    await expect(importFixture(file)).rejects.toThrow()

    expect(fingerprint(file)).toBe(before)
  })
})

describe('the cutover verdict (EARS-27)', () => {
  it('EARS-27: the import ends in VERDICT: identical on a document it carried whole', async () => {
    const result = await importFixture(fixture('hours.json'))

    expect(result.comparison.identical).toBe(true)
    expect(result.comparison.byteIdentical).toBe(true)
    expect(result.lines).toEqual(['VERDICT: identical'])
  })

  it('EARS-27: the standalone verify names the differing paths after a row is tampered with', async () => {
    await importFixture(fixture('hours.json'))

    await fixtureWrite((tx) =>
      tx.execute(
        sql`update core.hours_assessment set accrual = accrual + 1, saved_at = '2026-08-17T00:00:00.000Z'
            where id = (select min(id) from core.hours_assessment)`,
      ),
    )

    const verdict = await verifyHours(fixture('hours.json'))

    expect(verdict.comparison.identical).toBe(false)
    expect(verdict.comparison.paths.map((entry) => entry.path)).toEqual([
      'assessments[0].accrual',
      'assessments[0].saved_at',
    ])
    expect(verdict.lines[0]).toBe('VERDICT: differs — 2 path(s)')
    expect(verdict.lines.join('\n')).toContain('assessments[0].accrual')
  })

  it('EARS-27: verify on an empty database reports the whole document as differing, never as identical', async () => {
    const verdict = await verifyHours(fixture('hours.json'))

    expect(verdict.comparison.identical).toBe(false)
    expect(verdict.comparison.paths.length).toBeGreaterThan(0)
  })
})
