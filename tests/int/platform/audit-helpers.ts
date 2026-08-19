import { sql } from 'drizzle-orm'

import type { PlatformDb } from '@/lib/platform/db/client'

/**
 * Reading the audit ledger in the integration tier (spec 201, EARS-11, EARS-23).
 *
 * **Why a watermark and not a truncate.** Every other suite here starts from
 * `truncate table …`; `core.audit_event` cannot be reset that way and that is the
 * point — `BEFORE TRUNCATE … FOR EACH STATEMENT` refuses it (EARS-12), and a
 * fixture that could empty the ledger would be the exact hole the clause exists
 * to close. So a test takes the current high-water mark first and asserts on what
 * appended after it. The ledger therefore grows across runs of this suite, by
 * design: append-only means append-only for us too.
 *
 * Reads go through the `sql` template rather than a drizzle table handle: the
 * ledger deliberately has NO table file (spec §«No drizzle table file for the
 * ledger»), because a `pgTable('audit_event')` stub would enter drizzle-kit's
 * snapshot and let a later `generate` emit a duplicate `CREATE TABLE` for a table
 * whose two guard triggers drizzle cannot describe.
 */
export type AuditRow = {
  id: string
  /**
   * A string, not a `Date`: the ledger has no drizzle table file, so these rows
   * come back through `db.execute(sql\`…\`)`, which hands over `pg`'s raw text
   * for a timestamptz rather than a parsed value.
   */
  created_at: string
  event_type: string
  table_name: string
  actor_email: string | null
  source: string
  pk: Record<string, unknown>
  diff: Record<string, { old?: unknown; new?: unknown; changed?: true }>
  txid: string
}

/** The ledger's current high-water mark; `0` on an empty ledger. */
export async function auditWatermark(db: PlatformDb): Promise<string> {
  const { rows } = await db.execute<{ mark: string }>(
    sql`select coalesce(max(id), 0)::text as mark from core.audit_event`,
  )
  return rows[0].mark
}

/** Everything appended after `mark`, oldest first. */
export async function auditEventsSince(db: PlatformDb, mark: string): Promise<AuditRow[]> {
  const { rows } = await db.execute<AuditRow>(
    sql`select id::text as id, created_at, event_type, table_name, actor_email, source,
               pk, diff, txid
        from core.audit_event
        where id > ${mark}::bigint
        order by id`,
  )
  return rows
}

/** The same, narrowed to one table — «вся история вот этой таблицы». */
export async function auditEventsFor(
  db: PlatformDb,
  mark: string,
  tableName: string,
): Promise<AuditRow[]> {
  return (await auditEventsSince(db, mark)).filter((row) => row.table_name === tableName)
}

/**
 * The whole message chain of a failed query.
 *
 * drizzle wraps a `pg` error in its own `DrizzleQueryError` whose message is
 * only «Failed query: …» and hangs the original off `cause`. Asserting on the
 * thrown object's `.message` alone therefore never sees a trigger's RAISE — the
 * assertion would pass or fail for the wrong reason. Same unwrapping the member
 * module does for SQLSTATEs (`pgErrorCode`), applied to text.
 */
export function refusalText(err: unknown): string {
  const parts: string[] = []
  let node = err as { message?: unknown; cause?: unknown } | undefined
  while (node) {
    if (typeof node.message === 'string') parts.push(node.message)
    node = node.cause as typeof node
  }
  return parts.join(' | ')
}

/** `expect(...).rejects` for a refusal that arrives wrapped. */
export function refusedWith(pattern: RegExp): (err: unknown) => boolean {
  return (err) => pattern.test(refusalText(err))
}
