/**
 * `core.finance_category` — expense categories (spec 338 EARS-307).
 *
 * SHIPS EMPTY, and that is a requirement rather than an accident: owner decision
 * 11 says the category list is DERIVED from real spending in F2, not invented up
 * front. No migration, seed or fixture inserts a row here; the integration test
 * of EARS-307 asserts the table is empty on a freshly migrated database.
 *
 * `allocable` states whether the category's amounts flow into a product's unit
 * cost or are a period cost of the fund/project (Accounting policy, ruling 1).
 * F1 stores the flag and posts nothing from it — EARS-334 keeps every allocation
 * out of the ledger; F3 reads it.
 */
import { boolean, serial, text, timestamp } from 'drizzle-orm/pg-core'

import { core } from '../core'

export const financeCategory = core.table('finance_category', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** Unit cost vs period cost (ruling 1). Read by F3, never posted from. */
  allocable: boolean('allocable').notNull(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
})

export type FinanceCategoryRow = typeof financeCategory.$inferSelect
export type FinanceCategoryInsert = typeof financeCategory.$inferInsert
