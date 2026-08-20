// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import {
  AUDIT_COLUMN_EXCLUSIONS,
  AUDIT_TABLE_ALLOWLIST,
  AUDIT_VALUE_WHITELIST,
  rationaleIsBlank,
} from '../../../tools/lint/audit-coverage-allowlist.mjs'

/**
 * Coverage against REALITY (spec 201 EARS-21, EARS-22, EARS-29, EARS-33 —
 * issue #273, acceptance scenario 10).
 *
 * This is the truth-level half of coverage and it runs in the BLOCK
 * `platform-int` job, so the database-state question — «does every audited table
 * still carry its trigger?» — blocks from day 0 while the migration-chain guard
 * of EARS-19 (`tools/lint/audit-coverage-lint.mjs`, issue #276) soaks at WARN.
 * The two check different things on purpose: the guard sees the allowlist and
 * its written rationale, this file sees `pg_trigger`.
 *
 * Coverage is defined BY CONSTRUCTION, not by enumeration: the set below is
 * whatever `core` currently holds, read from the catalog. Adding a table to
 * `core` without a trigger therefore turns this red without anyone editing a
 * list — which is the clause (EARS-22); the six tables of today are only its
 * current value.
 */

const db = getPlatformDb()

/** Tables of `core` that are not the ledger's own bookkeeping infrastructure. */
async function coreTables(): Promise<string[]> {
  const { rows } = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables
        where table_schema = 'core' and table_type = 'BASE TABLE'
        order by table_name`,
  )
  return rows.map((r) => r.table_name)
}

/** table → the trigger's `TG_ARGV`, read back from `pg_trigger.tgargs`. */
async function attachedTriggers(): Promise<Map<string, string[]>> {
  const { rows } = await db.execute<{ table_name: string; args: string[] | null }>(
    sql`select cls.relname as table_name,
               (select array_agg(arg order by ordinality)
                from unnest(string_to_array(encode(tg.tgargs, 'escape'), '\\000')) with ordinality as u(arg, ordinality)
                where arg <> '') as args
        from pg_trigger tg
        join pg_class cls on cls.oid = tg.tgrelid
        where tg.tgfoid = 'core.audit_row_change'::regproc and not tg.tgisinternal`,
  )
  return new Map(rows.map((r) => [r.table_name, r.args ?? []]))
}

afterAll(async () => {
  await closePlatformDb()
})

describe('audit coverage against the migrated database', () => {
  it('EARS-21: every `core` table either carries the capture trigger or is an allowlisted absence with a rationale', async () => {
    const attached = await attachedTriggers()
    const uncovered: string[] = []

    for (const table of await coreTables()) {
      if (attached.has(table)) continue
      const rationale = AUDIT_TABLE_ALLOWLIST[table]
      if (rationaleIsBlank(rationale)) uncovered.push(table)
    }

    expect(uncovered).toEqual([])
  })

  it('EARS-33: `core.hours_publication` is an allowlisted absence carrying its own rationale, not a silent one', async () => {
    const attached = await attachedTriggers()
    expect(attached.has('hours_publication')).toBe(false)
    expect(AUDIT_TABLE_ALLOWLIST.hours_publication).toBe(
      'blocked on EARS-31 — `messages` must go first',
    )
    // The stop was on the ORDER, not on the two tasks' sequencing: while
    // `messages` existed under an attached trigger it would have been audited BY
    // VALUE (EARS-17 whitelists the hours tables' columns), putting frozen
    // message texts into a ledger nothing can redact. The CONTRACT release
    // (#281, migration `0005_hours_publication_drop_messages.sql`) removed the
    // column, so the obstacle EARS-31 named is gone — asserted here against the
    // really migrated database rather than taken on the migration's word.
    //
    // The allowlist entry nevertheless STAYS until #275: attaching the trigger
    // to `core.hours_publication` is that release's whole subject (EARS-33), and
    // the rationale string is fixed verbatim by the spec until it is removed
    // together with the entry. An entry that outlives its reason by one release
    // is EARS-22 working — the absence is visible — not a stale list.
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.columns
          where table_schema = 'core' and table_name = 'hours_publication'
            and column_name = 'messages'`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('EARS-22: the allowlist has no stale entry — a table that got its trigger must leave the list', async () => {
    const attached = await attachedTriggers()
    const stale = Object.keys(AUDIT_TABLE_ALLOWLIST).filter((table) => attached.has(table))
    expect(stale).toEqual([])
  })

  it('EARS-29: every column of an audited table is either whitelisted by value or excluded with a rationale', async () => {
    const attached = await attachedTriggers()
    const findings: string[] = []

    for (const [table, args] of attached) {
      const { rows } = await db.execute<{ column_name: string }>(
        sql`select column_name from information_schema.columns
            where table_schema = 'core' and table_name = ${table}`,
      )
      for (const { column_name: column } of rows) {
        if (args.includes(column)) continue
        if (!rationaleIsBlank(AUDIT_COLUMN_EXCLUSIONS[`${table}.${column}`])) continue
        findings.push(`${table}.${column}`)
      }
    }

    expect(findings).toEqual([])
  })

  it('EARS-16: the whitelist mirror matches `pg_trigger.tgargs` exactly — the mirror cannot drift into a lie', async () => {
    const attached = await attachedTriggers()
    const actual = Object.fromEntries([...attached].map(([table, args]) => [table, args.sort()]))
    const expected = Object.fromEntries(
      Object.entries(AUDIT_VALUE_WHITELIST).map(([table, cols]) => [table, [...cols].sort()]),
    )
    expect(actual).toEqual(expected)
  })

  it('EARS-15: drizzle’s own bookkeeping table carries no capture trigger', async () => {
    const attached = await attachedTriggers()
    expect(attached.has('__drizzle_migrations')).toBe(false)
  })
})
