/**
 * `core.finance_purpose` — what an operation was FOR, and the one place where
 * product attributability is decided (spec 338 EARS-306/320/331/332; Accounting
 * policy, ruling 2).
 *
 * `product_binding` is MASTER DATA. The operator recording an operation supplies
 * a product VALUE and never a binding (EARS-331); whoever defines the purpose
 * ran ruling 2's two questions once, and the binding is their answer:
 *
 *  - `required`  — every operation on this purpose names a product;
 *  - `forbidden` — none may;
 *  - `optional`  — it may, and the ones that do not are the exception list
 *                  EARS-333 exposes so the taxonomy converges from use.
 *
 * This is the mainstream shape (Business Central `Value Posting`, SAP field
 * status, Sage Intacct's required-dimension checkbox), not an invention.
 *
 * `category_id` is nullable because the category table SHIPS EMPTY (EARS-307):
 * a purpose created before F2 derives the category list has nothing to link to.
 * EARS-306 requires the link WHERE the list is non-empty, which is a module
 * rule — the database cannot express "not null once another table is populated".
 *
 * Changing a binding rewrites NOTHING (EARS-332): postings made under the old
 * rule stand exactly as posted, and the change itself is recorded by the
 * universal edit audit (spec 201), not by a journal of this table's own.
 */
import { sql } from 'drizzle-orm'
import { check, integer, serial, text, timestamp } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financeCategory } from './finance-category'

export const FINANCE_PRODUCT_BINDINGS = ['required', 'forbidden', 'optional'] as const
export type FinanceProductBinding = (typeof FINANCE_PRODUCT_BINDINGS)[number]

export const financePurpose = core.table(
  'finance_purpose',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** Nullable while the category list is empty (EARS-306/307). */
    categoryId: integer('category_id').references(() => financeCategory.id),
    productBinding: text('product_binding').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'finance_purpose_product_binding_allowed',
      sql`${table.productBinding} in ('required', 'forbidden', 'optional')`,
    ),
  ],
)

export type FinancePurposeRow = typeof financePurpose.$inferSelect
export type FinancePurposeInsert = typeof financePurpose.$inferInsert
