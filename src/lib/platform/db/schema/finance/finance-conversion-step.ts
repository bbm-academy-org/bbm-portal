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
 * ## The rate is TESTIMONY; the amounts are the FACT
 *
 * `rate` records the number the operator wrote down, and the module does not
 * derive anything from it — `from_amount`/`to_amount` (the postings) are what
 * the ledger computes with, including the realized FX of EARS-328.
 *
 * That is deliberate, and it is not a gap left by laziness: a recorded rate has
 * no machine-determinable ORIENTATION. A human writes «35» for a THB→USDT
 * exchange and «35» again for the USDT→THB one back, because both times they
 * mean «35 бат за один USDT» — the price of the thing being traded, not a ratio
 * keyed to the step's direction. Declaring one orientation and validating
 * against it would make one of those two entries a refusal for being written
 * the way every receipt in Thailand writes it, and would put the module in the
 * business of correcting the operator's testimony about what the day's rate was.
 *
 * The consequence, stated so nobody later reads a guarantee that is not here: a
 * step CAN carry a rate that its own amounts do not imply, and the ledger stores
 * both. The amounts are authoritative everywhere; a reader of `rate` (F3) is
 * reading what a person recorded, and should render it as such.
 *
 * `src/lib/finance/core/money.ts` holds the minimal-unit arithmetic for a caller
 * that DOES know its orientation — a future intake computing an amount from a
 * quoted rate. It is not applied to this column.
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
