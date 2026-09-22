/**
 * `auditColumns()` — the four columns every `core` row carries (#516, owner
 * rule, Антон, 2026-09-22; ADR-004 amendment A2).
 *
 * `created_at` / `created_by` / `updated_at` / `updated_by` are mandatory on
 * every platform table BY DEFAULT, as a hard rule. They are the per-row answer
 * to «when and by whom was this created / last changed» — the question every
 * screen and every query asks, and the one the append-only journal
 * `core.audit_event` (spec 201) answers only by scanning. The journal stays: it
 * is the diff HISTORY, these are the row's own current facts, and neither
 * replaces the other.
 *
 * **Maintenance is a database TRIGGER, not the write layer.** `core.audit_columns_stamp()`
 * (migration `0016_audit_columns.sql`) fires `BEFORE INSERT OR UPDATE` on every
 * table and stamps the four values, so a write through `platformTransaction()`,
 * a `cli:*` script, a fixture and a hand-run `psql` statement are all attributed
 * the same way — by the database, once, rather than by every caller
 * remembering. The actor is resolved from the SAME session variable the audit
 * journal reads (`app.actor_email` → `core.member.id`), so the two records
 * cannot disagree about who wrote the row. An unmarked connection stamps a NULL
 * actor rather than raising: refusing a context-less write is already
 * `core.audit_row_change()`'s job, and two refusals for one cause would only
 * make the message worse.
 *
 * `created_at` / `created_by` are IMMUTABLE — the trigger restores the OLD
 * values on every UPDATE, so an accidental `set created_by = …` cannot rewrite
 * provenance.
 *
 * **`created_by` / `updated_by` carry NO drizzle reference** on purpose: the FK
 * to `core.member(id)` is written by hand in the migration (`ON DELETE SET
 * NULL`), because declaring it here would import `schema/member/` into every
 * other module's schema directory — the import ADR-004 §6 keeps out of a
 * module. Same shape as `finance_intake_item.created_by` and
 * `finance_posting.member_id` (spec 338 EARS-322).
 *
 * **A table that needs `created_by NOT NULL`** — `finance_counterparty` and
 * `finance_intake_item`, where the submitter is a required fact of the row —
 * re-declares that one column AFTER the spread rather than making the helper
 * generic. A later key wins in an object literal, the SQL name stays
 * `created_by`, and the helper keeps one return type instead of a conditional
 * one (#516 decision 3).
 */
import { integer, timestamp } from 'drizzle-orm/pg-core'

/**
 * The four audit columns, spread into a `core.table(…)` column object.
 *
 * ```ts
 * export const widget = core.table('widget', {
 *   id: serial('id').primaryKey(),
 *   name: text('name').notNull(),
 *   ...auditColumns(),
 * })
 * ```
 *
 * The guard `pnpm lint:audit-columns` (BLOCK) fails a `core` table that carries
 * none of them, and `tests/int/platform/audit-columns.int.spec.ts` asserts the
 * columns AND the stamping trigger against the really-migrated database.
 */
export function auditColumns() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer('updated_by'),
  }
}
