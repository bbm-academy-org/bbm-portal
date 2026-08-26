/**
 * `core.finance_project` — one flat level of cost objects (spec 338 EARS-304,
 * EARS-321; owner decision 16: no hierarchy in v1).
 *
 * Exactly one row carries `is_fund` — «Фонд BBM», seeded by the migration. It is
 * the project every entity-level amount lands on, which is why EARS-321 can say
 * "every income/expense posting names a project" without an exception clause:
 * the fund IS the answer for anything not attributable to a named project.
 *
 * The partial unique index below is what makes "exactly one" a database fact
 * rather than a module habit; the module adds the readable refusals for
 * retiring or duplicating it.
 */
import { sql } from 'drizzle-orm'
import { boolean, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'

export const financeProject = core.table(
  'finance_project',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** The single fund row (EARS-304); seeded by the migration. */
    isFund: boolean('is_fund').notNull().default(false),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('finance_project_single_fund')
      .on(table.isFund)
      .where(sql`${table.isFund}`),
  ],
)

export type FinanceProjectRow = typeof financeProject.$inferSelect
export type FinanceProjectInsert = typeof financeProject.$inferInsert
