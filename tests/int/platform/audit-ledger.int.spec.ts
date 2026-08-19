// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { refusedWith } from './audit-helpers'

/**
 * The ledger itself: shape, indexes and the append-only guard (spec 201,
 * issue #273 — acceptance scenarios 3 and 5).
 *
 * These are assertions about a REALLY MIGRATED database, not about our opinion
 * of one. `core.audit_event` has no drizzle table file on purpose, so nothing
 * here can be checked by a type: the table, its nine columns, its four indexes
 * and its two guard triggers exist only as SQL in
 * `src/lib/platform/db/migrations/0003_universal_edit_audit.sql`, and this file
 * is what reads them back out of the catalog.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB — see
 * `.claude/rules/parallel-sessions.md`, «Platform database»). Run:
 * `pnpm exec vitest run tests/int/platform`.
 */

const db = getPlatformDb()

afterAll(async () => {
  await closePlatformDb()
})

describe('core.audit_event', () => {
  it('EARS-11: carries the nine first-class columns the ledger is defined by', async () => {
    const { rows } = await db.execute<{ column_name: string; is_nullable: string }>(
      sql`select column_name, is_nullable from information_schema.columns
          where table_schema = 'core' and table_name = 'audit_event'`,
    )
    expect(rows.map((r) => r.column_name).sort()).toEqual([
      'actor_email',
      'created_at',
      'diff',
      'event_type',
      'id',
      'pk',
      'source',
      'table_name',
      'txid',
    ])
    // `actor_email` is the ONE nullable column: an actor-less source (a script,
    // a migration, an unmarked psql session) is legal; a source-less row is not.
    expect(rows.filter((r) => r.is_nullable === 'YES').map((r) => r.column_name)).toEqual([
      'actor_email',
    ])
  })

  it('EARS-11: carries the BRIN index on created_at and the three BTREE indexes', async () => {
    const { rows } = await db.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where schemaname = 'core' and tablename = 'audit_event'`,
    )
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]))

    expect(byName.get('audit_event_created_at_brin')).toMatch(/USING brin \(created_at\)/)
    expect(byName.get('audit_event_table_created_at')).toMatch(
      /USING btree \(table_name, created_at DESC\)/,
    )
    expect(byName.get('audit_event_actor_created_at')).toMatch(
      /USING btree \(actor_email, created_at DESC\)/,
    )
    expect(byName.get('audit_event_table_pk')).toMatch(/USING btree \(table_name, pk\)/)
  })

  it('EARS-11: `id` is an identity primary key, so a row cannot choose its own place in history', async () => {
    const { rows } = await db.execute<{ is_identity: string }>(
      sql`select is_identity from information_schema.columns
          where table_schema = 'core' and table_name = 'audit_event' and column_name = 'id'`,
    )
    expect(rows[0].is_identity).toBe('YES')

    const { rows: pk } = await db.execute<{ attname: string }>(
      sql`select att.attname from pg_index idx
          join pg_attribute att on att.attrelid = idx.indrelid and att.attnum = any (idx.indkey)
          where idx.indrelid = 'core.audit_event'::regclass and idx.indisprimary`,
    )
    expect(pk.map((r) => r.attname)).toEqual(['id'])
  })

  it('EARS-12: scenario 3 — UPDATE and DELETE on the ledger are refused by the row-level trigger', async () => {
    await expect(db.execute(sql`update core.audit_event set diff = '{}'::jsonb`)).rejects.toSatisfy(
      refusedWith(/core\.audit_event is append-only: UPDATE is refused/),
    )

    await expect(db.execute(sql`delete from core.audit_event`)).rejects.toSatisfy(
      refusedWith(/core\.audit_event is append-only: DELETE is refused/),
    )
  })

  it('EARS-12: scenario 5 — TRUNCATE is refused too, by the statement-level trigger', async () => {
    // The one a ROW-level trigger would have let through in silence: `TRUNCATE`
    // fires no row triggers at all, so without a `FOR EACH STATEMENT` guard the
    // table's most destructive operation is the one nothing sees.
    await expect(db.execute(sql`truncate core.audit_event`)).rejects.toSatisfy(
      refusedWith(/core\.audit_event is append-only: TRUNCATE is refused/),
    )
  })

  it('EARS-12: both guard triggers exist, at the right level, and are SECURITY DEFINER with a pinned search_path', async () => {
    const { rows } = await db.execute<{ tgname: string; level: string; timing: string }>(
      sql`select tgname,
                 case when (tgtype & 1) = 1 then 'row' else 'statement' end as level,
                 case when (tgtype & 2) = 2 then 'before' else 'after' end as timing
          from pg_trigger
          where tgrelid = 'core.audit_event'::regclass and not tgisinternal
          order by tgname`,
    )
    expect(rows).toEqual([
      { tgname: 'audit_event_append_only_row', level: 'row', timing: 'before' },
      { tgname: 'audit_event_append_only_truncate', level: 'statement', timing: 'before' },
    ])

    const { rows: fns } = await db.execute<{ proname: string; prosecdef: boolean; cfg: string[] }>(
      sql`select proname, prosecdef, proconfig as cfg from pg_proc
          where pronamespace = 'core'::regnamespace
            and proname in ('audit_row_change', 'audit_event_append_only')
          order by proname`,
    )
    expect(fns.map((f) => f.proname)).toEqual(['audit_event_append_only', 'audit_row_change'])
    for (const fn of fns) {
      expect(fn.prosecdef).toBe(true)
      expect(fn.cfg).toContain('search_path=pg_catalog, core')
    }
  })

  it('EARS-15: the ledger carries no capture trigger of its own — recursion is structurally impossible', async () => {
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_trigger
          where tgrelid = 'core.audit_event'::regclass
            and not tgisinternal
            and tgfoid = 'core.audit_row_change'::regproc`,
    )
    expect(rows[0].n).toBe(0)
  })
})
