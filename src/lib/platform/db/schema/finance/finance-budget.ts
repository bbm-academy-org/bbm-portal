/**
 * `core.finance_budget` — a spending LIMIT, never postings (spec 338 §D
 * EARS-338).
 *
 * A budget is plan, and plan stays plan until the fact happens: this row creates
 * no posting, moves no balance and sits on no account. Every figure read against
 * it (EARS-340…345) is a read model over postings, stored nowhere.
 *
 * No history table exists: each change of the limit runs through
 * `platformTransaction` with the signed-in actor, so `core.audit_event` (spec
 * 201) already records it (EARS-339). A budget is retired, never deleted.
 *
 * In v1 only the fund project carries a budget and only one unretired budget per
 * project exists (EARS-338). The fund rule is a module refusal (it needs the
 * project row); the one-unretired rule is ALSO a partial unique index, so two
 * concurrent creates cannot both land. The amount is data entered through the
 * module's handlers and appears in no migration, seed or fixture.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  integer,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { core } from '../core'
import { auditColumns } from '../audit-columns'
import { financeCurrency } from './finance-currency'
import { financeProject } from './finance-project'

export const financeBudget = core.table(
  'finance_budget',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => financeProject.id),
    name: text('name').notNull(),
    /** The limit, minimal units of `currency`. */
    limitAmount: bigint('limit_amount', { mode: 'bigint' }).notNull(),
    currency: text('currency')
      .notNull()
      .references(() => financeCurrency.code),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    check('finance_budget_limit_positive', sql`${table.limitAmount} > 0`),
    check('finance_budget_name_present', sql`length(btrim(${table.name})) > 0`),
    uniqueIndex('finance_budget_one_live_per_project')
      .on(table.projectId)
      .where(sql`${table.retiredAt} is null`),
  ],
)

export type FinanceBudgetRow = typeof financeBudget.$inferSelect
export type FinanceBudgetInsert = typeof financeBudget.$inferInsert
