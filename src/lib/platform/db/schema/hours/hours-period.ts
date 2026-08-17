/**
 * `core.hours_period` — a self-assessment period (spec 124 EARS-1, EARS-5,
 * EARS-21; behavioural canon: spec 081 §14, §24).
 *
 * Owned by the hours module (`src/lib/hours` / `src/modules/hours`); no other
 * module may import this file (ADR-004 §6, `module-must-not-import-foreign-tables`).
 *
 * Three column choices here are contracts, not preferences (spec 124, the
 * column-type table):
 *
 *  - `id` is `text`, not a generated key: today's ids are `randomUUID()` strings
 *    and the cutover import carries them verbatim, so migrated history keeps its
 *    identifiers (EARS-5, EARS-13).
 *  - `date_from` / `date_to` are `text` ISO `YYYY-MM-DD`. A `date` column comes
 *    back from node-postgres as a local-midnight JS `Date`, and `calendar.ts` is
 *    built to never parse a `Date` for exactly that reason (081 §1): a one-day
 *    shift moves every weekday count, hence every rate and accrual. Lexical ISO
 *    ordering is also what `date_from <= date_to` and the overlap check use.
 *  - `sort_key` exists because the PK cannot carry order (the ids are preserved
 *    uuids), and EARS-21 requires every rendered list to reproduce today's
 *    insertion order with an explicit `ORDER BY`.
 *
 * The partial unique index is the structural half of «at most one open period»
 * (EARS-5): the JSON-level check in `document.ts` still fires first and produces
 * the readable refusal, and this index is what the SQL escape hatch cannot talk
 * its way around.
 */
import { sql } from 'drizzle-orm'
import { check, integer, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'

export const hoursPeriod = core.table(
  'hours_period',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    dateFrom: text('date_from').notNull(),
    dateTo: text('date_to').notNull(),
    status: text('status').notNull(),
    sortKey: integer('sort_key').notNull(),
  },
  (table) => [
    check('hours_period_status_allowed', sql`${table.status} in ('open', 'closed')`),
    uniqueIndex('hours_period_single_open')
      .on(table.status)
      .where(sql`${table.status} = 'open'`),
  ],
)

export type HoursPeriodRow = typeof hoursPeriod.$inferSelect
export type HoursPeriodInsert = typeof hoursPeriod.$inferInsert
