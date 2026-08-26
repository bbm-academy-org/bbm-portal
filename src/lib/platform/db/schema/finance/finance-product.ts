/**
 * `core.finance_product` — a product, sitting DIRECTLY under its project
 * (spec 338 EARS-301; owner decision 16: one flat level on each side).
 *
 * There is no `capitalization` column and there never will be one: a product's
 * capitalization is its direct costs plus its directly attributable overhead,
 * read off postings (Accounting policy, ruling 1). Storing it would be a second
 * source of truth that a reversal silently invalidates.
 *
 * `sale_price` is the LIST price the owner maintains — it is reference data, not
 * a posting, and it is deliberately nullable together with its currency: a
 * product that is not sold on its own has neither. The CHECK below keeps the
 * pair whole, because a price without a currency is not a price.
 */
import { sql } from 'drizzle-orm'
import { bigint, check, integer, serial, text, timestamp } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financeCurrency } from './finance-currency'
import { financeProject } from './finance-project'

export const financeProduct = core.table(
  'finance_product',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => financeProject.id),
    name: text('name').notNull(),
    /** Minimal units of `sale_price_currency`, like every amount here. */
    salePrice: bigint('sale_price', { mode: 'bigint' }),
    salePriceCurrency: text('sale_price_currency').references(() => financeCurrency.code),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'finance_product_sale_price_paired',
      sql`(${table.salePrice} is null) = (${table.salePriceCurrency} is null)`,
    ),
  ],
)

export type FinanceProductRow = typeof financeProduct.$inferSelect
export type FinanceProductInsert = typeof financeProduct.$inferInsert
