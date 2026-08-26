/**
 * `core.finance_conversion_step` — one exchange step of a conversion operation
 * (spec 338 EARS-318/319; owner decision 18).
 *
 * A conversion is ONE operation made of ordered steps; each step records the
 * ACTUAL rate as it stood at the operation, and each step's fee is a posting of
 * its own referencing the step (`finance_posting.conversion_step_id`).
 *
 * `rate` is TEXT, not `numeric`, and that is the point of EARS-319: the ledger
 * shows the rate of its day a year later, digit for digit as it was recorded. A
 * `numeric` column re-serializes (trailing zeros, scale coercion), which is a
 * quiet restatement of a recorded fact. The CHECK below keeps the text a decimal
 * literal so a reader can still cast it; nothing in the estate rewrites it.
 *
 * The rate's ORIENTATION, fixed once here so no caller has to guess: it is
 * `to_currency` MAJOR units per one `from_currency` MAJOR unit — the form a
 * human writes on a receipt («1 USDT = 34.50 THB»). Converting stored minimal
 * units therefore also carries the two currencies' precisions, which is what
 * `src/lib/finance/core/money.ts` does.
 */
import { sql } from 'drizzle-orm'
import { check, integer, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financeCurrency } from './finance-currency'
import { financeOperation } from './finance-operation'

export const financeConversionStep = core.table(
  'finance_conversion_step',
  {
    id: serial('id').primaryKey(),
    operationId: integer('operation_id')
      .notNull()
      .references(() => financeOperation.id),
    /** 1-based order within the chain. */
    stepNo: integer('step_no').notNull(),
    fromCurrency: text('from_currency')
      .notNull()
      .references(() => financeCurrency.code),
    toCurrency: text('to_currency')
      .notNull()
      .references(() => financeCurrency.code),
    /** As recorded, never restated (EARS-319). */
    rate: text('rate').notNull(),
  },
  (table) => [
    check('finance_conversion_step_no_positive', sql`${table.stepNo} >= 1`),
    check('finance_conversion_step_rate_decimal', sql`${table.rate} ~ '^[0-9]+(\\.[0-9]+)?$'`),
    check('finance_conversion_step_rate_nonzero', sql`(${table.rate})::numeric > 0`),
    check(
      'finance_conversion_step_currencies_differ',
      sql`${table.fromCurrency} <> ${table.toCurrency}`,
    ),
    uniqueIndex('finance_conversion_step_operation_no_unique').on(table.operationId, table.stepNo),
  ],
)

export type FinanceConversionStepRow = typeof financeConversionStep.$inferSelect
export type FinanceConversionStepInsert = typeof financeConversionStep.$inferInsert
