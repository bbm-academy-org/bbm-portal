/**
 * `core.finance_counterparty` — who is being paid (spec 339 EARS-532).
 *
 * A reference from day one rather than free text (owner decision 30,
 * 2026-08-26): «what did we pay X» has to be a query, and the corpus's «Сервис»
 * line is the donor of the field.
 *
 * **Why this table lands with the intake spine (#381) and not with the
 * reference strand (#383).** `finance_intake_item.counterparty_id` is a real FK
 * in the spec's data-model row, and a foreign key needs its target to exist in
 * the same migration. So the TABLE is created here — the columns and the
 * case-insensitive uniqueness EARS-532 fixes — while the module BEHAVIOUR the
 * clause describes (inline creation from the forms, the admin rename, the
 * proposal-shaped cabinet row) is #383's and is deliberately not written here.
 * EARS-532 therefore stays deferred in `tools/lint/ears-test-lint.mjs`: this PR
 * ships its storage, not its clause.
 *
 * `created_by` is an integer with **no drizzle reference**, exactly as
 * `finance_posting.member_id` is: the FK to `core.member(id)` is written by hand
 * in the migration, because declaring it here would import `schema/member/` into
 * `schema/finance/` — the import ADR-004 §6 keeps out of a module.
 */
import { sql } from 'drizzle-orm'
import { integer, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'

export const financeCounterparty = core.table(
  'finance_counterparty',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** FK → `core.member(id)`, added as SQL in the migration. */
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitively unique (EARS-532): «Anthropic» and «anthropic» are one
    // counterparty, and the database is what makes that true rather than a
    // convention every form has to remember.
    uniqueIndex('finance_counterparty_name_unique').on(sql`lower(btrim(${table.name}))`),
  ],
)

export type FinanceCounterpartyRow = typeof financeCounterparty.$inferSelect
export type FinanceCounterpartyInsert = typeof financeCounterparty.$inferInsert
