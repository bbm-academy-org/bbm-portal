// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'

import {
  AUDIT_COLUMNS,
  AUDIT_COLUMNS_EXEMPT_TABLES,
} from '../../../tools/lint/audit-coverage-allowlist.mjs'
import { FIXTURE_AUDIT_CTX, fixtureWrite } from './hours-core-helpers'

/**
 * The audit columns against REALITY (#516; owner rule, Антон, 2026-09-22).
 *
 * The truth-level half of the rule, run from the BLOCK `platform-int` job: the
 * static guard `pnpm lint:audit-columns` reads the DECLARATION, this file reads
 * `information_schema`, `pg_trigger` and the stamped rows themselves. The two
 * check different things on purpose — a column declared in TypeScript and a
 * column that exists in the database are not the same claim, and the migration
 * is what has to make them agree.
 *
 * The set of tables is read from the catalog rather than enumerated, so a table
 * landing without the columns turns this red without anyone editing a list.
 */

const db = getPlatformDb()

/** Every `core` base table that is not a structural exemption. */
async function coveredTables(): Promise<string[]> {
  const { rows } = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables
        where table_schema = 'core' and table_type = 'BASE TABLE'
        order by table_name`,
  )
  return rows.map((r) => r.table_name).filter((t) => !(t in AUDIT_COLUMNS_EXEMPT_TABLES))
}

afterAll(async () => {
  await closePlatformDb()
})

describe('the audit columns exist on every `core` table', () => {
  it('declares all four columns, with the shape the helper promises', async () => {
    const { rows } = await db.execute<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(
      sql`select table_name, column_name, data_type, is_nullable, column_default
          from information_schema.columns
          where table_schema = 'core' and column_name = any(${sql.raw(
            `array[${AUDIT_COLUMNS.map((c) => `'${c}'`).join(',')}]`,
          )})`,
    )

    const byTable = new Map<string, Map<string, (typeof rows)[number]>>()
    for (const row of rows) {
      if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Map())
      byTable.get(row.table_name)?.set(row.column_name, row)
    }

    const missing: string[] = []
    const wrongShape: string[] = []
    for (const table of await coveredTables()) {
      for (const column of AUDIT_COLUMNS) {
        const col = byTable.get(table)?.get(column)
        if (!col) {
          missing.push(`${table}.${column}`)
          continue
        }
        if (column.endsWith('_at')) {
          // Both timestamps are NOT NULL with a `now()` default: a row with no
          // answer to «when» is the state this rule exists to remove.
          if (col.data_type !== 'timestamp with time zone' || col.is_nullable !== 'NO') {
            wrongShape.push(`${table}.${column} is ${col.data_type} nullable=${col.is_nullable}`)
          }
        } else if (col.data_type !== 'integer') {
          wrongShape.push(`${table}.${column} is ${col.data_type}`)
        }
      }
    }

    expect(missing).toEqual([])
    expect(wrongShape).toEqual([])
  })

  it('carries the `core.audit_columns_stamp()` trigger, BEFORE INSERT OR UPDATE', async () => {
    const { rows } = await db.execute<{ table_name: string }>(
      sql`select cls.relname as table_name
          from pg_trigger tg
          join pg_class cls on cls.oid = tg.tgrelid
          where tg.tgfoid = 'core.audit_columns_stamp'::regproc
            and not tg.tgisinternal
            -- 2 = BEFORE row trigger, 4 = INSERT, 16 = UPDATE (pg_trigger.tgtype)
            and (tg.tgtype & 2) = 2
            and (tg.tgtype & 4) = 4
            and (tg.tgtype & 16) = 16`,
    )
    const stamped = new Set(rows.map((r) => r.table_name))
    const unstamped = (await coveredTables()).filter((t) => !stamped.has(t))
    expect(unstamped).toEqual([])
  })

  it('`created_by` / `updated_by` point at `core.member(id)`', async () => {
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n
          from pg_constraint con
          join pg_class cls on cls.oid = con.conrelid
          join pg_namespace nsp on nsp.oid = cls.relnamespace
          join pg_attribute att on att.attrelid = cls.oid and att.attnum = any(con.conkey)
          where nsp.nspname = 'core'
            and con.contype = 'f'
            and con.confrelid = 'core.member'::regclass
            and att.attname in ('created_by', 'updated_by')`,
    )
    // Two per covered table — the rule has no per-table exception.
    expect(rows[0].n).toBe((await coveredTables()).length * 2)
  })

  it('the exempt tables are the two structural ones, and they really carry no stamp trigger', async () => {
    expect(Object.keys(AUDIT_COLUMNS_EXEMPT_TABLES).sort()).toEqual([
      '__drizzle_migrations',
      'audit_event',
    ])
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n
          from pg_trigger tg
          join pg_class cls on cls.oid = tg.tgrelid
          where tg.tgfoid = 'core.audit_columns_stamp'::regproc
            and cls.relname in ('audit_event', '__drizzle_migrations')`,
    )
    expect(rows[0].n).toBe(0)
  })
})

describe('the trigger stamps the row', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const actorEmail = `audit-columns-actor-${suffix}@example.com`
  const subjectEmail = `audit-columns-subject-${suffix}@example.com`

  async function readRow(email: string) {
    const { rows } = await db.execute<{
      id: number
      created_at: string
      created_by: number | null
      updated_at: string
      updated_by: number | null
    }>(
      sql`select id, created_at, created_by, updated_at, updated_by
          from core.member where email = ${email}`,
    )
    return rows[0]
  }

  afterAll(async () => {
    await fixtureWrite((tx) =>
      tx.execute(sql`delete from core.member where email in (${actorEmail}, ${subjectEmail})`),
    )
  })

  it('writes the actor and both timestamps on INSERT, resolving the email the journal reads', async () => {
    // The actor is seeded by the fixture door — no human behind it — so the
    // actor's OWN row legitimately carries a null `created_by`.
    await fixtureWrite((tx) =>
      tx.execute(sql`insert into core.member (slug, email, name)
                     values (${`actor-${suffix}`}, ${actorEmail}, 'Audit columns actor')`),
    )
    const actor = await readRow(actorEmail)
    expect(actor.created_by).toBeNull()
    expect(actor.created_at).not.toBeNull()

    // And now a write with a human behind it: `app.actor_email` is set by
    // `platformTransaction`, and the SAME variable the journal reads resolves
    // the id the row records.
    await platformTransaction({ actorEmail, source: 'portal' }, (tx) =>
      tx.execute(sql`insert into core.member (slug, email, name)
                     values (${`subject-${suffix}`}, ${subjectEmail}, 'Audit columns subject')`),
    )
    const subject = await readRow(subjectEmail)
    expect(subject.created_by).toBe(actor.id)
    expect(subject.updated_by).toBe(actor.id)
    expect(subject.created_at).toEqual(subject.updated_at)
  })

  it('agrees with the journal about the moment — both read the transaction clock', async () => {
    const subject = await readRow(subjectEmail)
    const { rows } = await db.execute<{ created_at: string; actor_email: string | null }>(
      sql`select created_at, actor_email from core.audit_event
          where table_name = 'member' and event_type = 'data.member.insert'
            and pk->>'id' = ${String(subject.id)}
          order by id asc limit 1`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].actor_email).toBe(actorEmail)
    // The invariant the BACKFILL restores for every pre-existing row: the
    // column and the journal entry carry the same instant, because `now()` is
    // the transaction timestamp on both sides.
    expect(new Date(rows[0].created_at).toISOString()).toBe(
      new Date(subject.created_at).toISOString(),
    )
  })

  it('bumps `updated_at` / `updated_by` on UPDATE and leaves `created_*` alone — even when the statement sets them', async () => {
    const before = await readRow(subjectEmail)

    await platformTransaction(FIXTURE_AUDIT_CTX, (tx) =>
      tx.execute(sql`update core.member
                     set name = 'Renamed by nobody',
                         created_at = timestamptz '2000-01-01 00:00:00+00',
                         created_by = ${before.id}
                     where email = ${subjectEmail}`),
    )

    const after = await readRow(subjectEmail)
    // Immutable: the statement asked for both and got neither.
    expect(new Date(after.created_at).toISOString()).toBe(new Date(before.created_at).toISOString())
    expect(after.created_by).toBe(before.created_by)
    // The fixture door has no human behind it, so the last writer is «nobody we
    // can name» rather than a fabricated actor.
    expect(after.updated_by).toBeNull()
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    )
  })
})

describe('the backfill left no row claiming to be changed before it was created', () => {
  it('holds on every `core` table', async () => {
    const offenders: string[] = []
    for (const table of await coveredTables()) {
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.raw(`core."${table}"`)} where created_at > updated_at`,
      )
      if (rows[0].n > 0) offenders.push(`${table} (${rows[0].n} row(s))`)
    }
    expect(offenders).toEqual([])
  })
})
