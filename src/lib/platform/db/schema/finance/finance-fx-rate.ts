/**
 * `core.finance_fx_rate` — the Bank of Russia daily rates, by effective date
 * (spec `docs/specs/339-ledger-intake.md` §I, EARS-552/553; issue #548).
 *
 * A PRESENTATION source only (EARS-553): the requests queue converts amounts
 * into one display currency with these rates, and nothing else reads them — no
 * posting, conversion step, balance, F1b card or F3 report. That is why
 * `currency` carries no foreign key to `finance_currency`: CBR quotes ~55
 * currencies, the ledger registers the handful it records in, and a rate is not
 * a ledger fact that a registered currency could vouch for.
 *
 * `rate_date` is the CBR EFFECTIVE date (`ValCurs/@Date`), not the date asked:
 * a weekend or holiday `date_req` answers with the previous business day's
 * document, and storing the asked date would invent rates CBR never set.
 * `value_rub` is the roubles per `nominal` units exactly as CBR printed them
 * (decimal text, point separator) — never a float, never pre-divided.
 *
 * Written only by `syncCbrRates` under `system:finance-fx-sync`; a row is never
 * updated, a re-run inserts nothing it already holds (the unique key).
 */
import { sql } from 'drizzle-orm'
import { check, date, integer, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { auditColumns } from '../audit-columns'

export const financeFxRate = core.table(
  'finance_fx_rate',
  {
    id: serial('id').primaryKey(),
    /** The rate source; `cbr` is the only one (EARS-552). */
    source: text('source').notNull(),
    /** ISO code as CBR quotes it (`CharCode`). */
    currency: text('currency').notNull(),
    /** CBR effective date, `ValCurs/@Date`. */
    rateDate: date('rate_date', { mode: 'string' }).notNull(),
    nominal: integer('nominal').notNull(),
    /** Roubles per `nominal` units, exact decimal text. */
    valueRub: text('value_rub').notNull(),
    ...auditColumns(),
  },
  (table) => [
    check('finance_fx_rate_source_known', sql`${table.source} in ('cbr')`),
    check('finance_fx_rate_currency_shape', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('finance_fx_rate_nominal_positive', sql`${table.nominal} > 0`),
    check('finance_fx_rate_value_decimal', sql`${table.valueRub} ~ '^[0-9]+(\\.[0-9]+)?$'`),
    check('finance_fx_rate_value_positive', sql`(${table.valueRub})::numeric > 0`),
    uniqueIndex('finance_fx_rate_source_currency_date_unique').on(
      table.source,
      table.currency,
      table.rateDate,
    ),
  ],
)

export type FinanceFxRateRow = typeof financeFxRate.$inferSelect
export type FinanceFxRateInsert = typeof financeFxRate.$inferInsert
