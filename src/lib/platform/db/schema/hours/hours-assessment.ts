/**
 * `core.hours_assessment` — one participant's self-assessment for one period
 * (spec 124 EARS-1, EARS-4, EARS-21; canon: spec 081 §14, §15, §20).
 *
 * One row per (`period`, `member`) — the unique constraint below IS the identity,
 * and a save is an upsert on it (EARS-4). The surrogate `id` exists only to carry
 * ORDER: EARS-21 puts assessments in the identity-PK order assigned in JSON array
 * order at import, so new rows append.
 *
 * The value domains are a digit-for-digit contract (spec 124's column-type table),
 * not a choice this file is free to revisit:
 *
 *  - `hours`, `weekend_hours`, `split_percent` — `double precision`: fractional by
 *    construction (`round1()` steps, the 0.5-step weekend slider, the week tab's
 *    `weekdays/5` multiplication, and a server that accepts fractional percents).
 *  - `hourly_rate` — `double precision` holding the UNROUNDED effective rate
 *    (`400000/344 = 1163.0465116279069`). `numeric` re-serializes differently and
 *    would break both the export diff of the cutover (EARS-11/EARS-27) and
 *    recompute parity.
 *  - `monthly_rate`, `accrual`, `cash_amount`, `invest_amount`, `weekday_count` —
 *    `integer`: all `Math.round` outputs (081 §6 rounding order). `monthly_rate`
 *    is nullable, and null is meaningful: the «только часы» mode (EARS-28).
 *  - `saved_at` — `text`, the exact `toISOString()` string, because it appears
 *    verbatim in the owner's export.
 *
 * These are FROZEN snapshots: a later fork/grade change never rewrites them
 * (081 §15). The one thing that does is a period date edit, and then only from
 * each row's own stored `monthly_rate` (EARS-30).
 *
 * `member_id` references `core.member(id)`; that FK is declared in SQL in the
 * migration, not here — see the header of `./hours-participant.ts` for why
 * (ADR-004 §6) and the integration test that asserts it exists.
 */
import { sql } from 'drizzle-orm'
import { check, doublePrecision, integer, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { hoursPeriod } from './hours-period'

export const hoursAssessment = core.table(
  'hours_assessment',
  {
    /** Identity order (EARS-21), never the row's business key. */
    id: serial('id').primaryKey(),
    periodId: text('period_id')
      .notNull()
      .references(() => hoursPeriod.id),
    /** FK → `core.member(id)`, added as SQL in the migration. */
    memberId: integer('member_id').notNull(),
    hours: doublePrecision('hours').notNull(),
    method: text('method').notNull(),
    weekendHours: doublePrecision('weekend_hours').notNull(),
    splitPercent: doublePrecision('split_percent').notNull(),
    monthlyRate: integer('monthly_rate'),
    hourlyRate: doublePrecision('hourly_rate'),
    accrual: integer('accrual').notNull(),
    cashAmount: integer('cash_amount').notNull(),
    investAmount: integer('invest_amount').notNull(),
    weekdayCount: integer('weekday_count').notNull(),
    savedAt: text('saved_at').notNull(),
  },
  (table) => [
    check('hours_assessment_method_allowed', sql`${table.method} in ('period', 'week', 'day')`),
    uniqueIndex('hours_assessment_period_member_unique').on(table.periodId, table.memberId),
  ],
)

export type HoursAssessmentRow = typeof hoursAssessment.$inferSelect
export type HoursAssessmentInsert = typeof hoursAssessment.$inferInsert
