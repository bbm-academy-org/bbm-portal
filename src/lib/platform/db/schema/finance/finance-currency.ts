/**
 * `core.finance_currency` — the currencies the ledger may record in
 * (spec `docs/specs/338-ledger-core.md`, EARS-301/302/303).
 *
 * The PK is the ISO-ish CODE itself (`RUB`, `THB`, `USDT`), not a surrogate: a
 * currency is named by its code everywhere a human writes one down, and every
 * other finance table carries that code rather than a join-only integer.
 *
 * `precision` is the number of decimal places of the currency's MINIMAL unit —
 * RUB 2, THB 2, USDT 6 — and it is the exponent that turns a stored `bigint`
 * amount into a human number. EARS-303 freezes it the moment a posting exists in
 * the currency: changing it later would silently restate every amount already
 * recorded, which is exactly what EARS-309/319 forbid. The freeze is enforced in
 * the module (a readable refusal), not by a constraint — the database cannot see
 * "is this currency used" cheaply enough to make a CHECK honest.
 *
 * `retired_at` is the whole of EARS-308's retirement: a retired currency stays
 * valid on every posting already recorded and stops being offered for new ones.
 * There is deliberately no `is_active` boolean next to it — one nullable stamp
 * carries both the state and the day it changed.
 */
import { sql } from 'drizzle-orm'
import { check, integer, text, timestamp } from 'drizzle-orm/pg-core'

import { core } from '../core'

export const financeCurrency = core.table(
  'finance_currency',
  {
    /** The code IS the key (EARS-301). */
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    /** Decimal places of the minimal unit; frozen once used (EARS-303). */
    precision: integer('precision').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    check('finance_currency_code_shape', sql`${table.code} = upper(btrim(${table.code}))`),
    check('finance_currency_precision_range', sql`${table.precision} between 0 and 18`),
  ],
)

export type FinanceCurrencyRow = typeof financeCurrency.$inferSelect
export type FinanceCurrencyInsert = typeof financeCurrency.$inferInsert
