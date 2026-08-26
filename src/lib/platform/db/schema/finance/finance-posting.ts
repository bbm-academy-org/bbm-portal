/**
 * `core.finance_posting` — the atomic fact (spec 338 EARS-310…313, EARS-320…322,
 * EARS-327/328, EARS-334).
 *
 * A posting names an account, a signed `bigint` amount in that currency's
 * MINIMAL units (debit > 0, credit < 0) and the currency itself. Every operation
 * sums to zero PER CURRENCY (EARS-311), and a posting's currency must equal its
 * account's (EARS-312) — both are module refusals with readable messages, not
 * constraints, because neither is expressible per row.
 *
 * `amount` is `bigint` and never `numeric`: minimal units are integers by
 * construction, and an integer cannot acquire a rounding error the way a decimal
 * silently can. `mode: 'bigint'` hands JS a `BigInt` rather than a `number`,
 * so a USDT amount past 2^53 minimal units is exact rather than nearly right.
 *
 * The P&L dimensions ride HERE, on the posting, not on the operation: an
 * operation's money leg carries no project while its expense leg does, and one
 * operation can name two products. `project_id` is required on every posting
 * touching a system income/expense account (EARS-321) — a module rule, since the
 * account's kind lives in another row.
 *
 * `member_id` is an integer with **no drizzle reference**: its FK to
 * `core.member(id)` is written by hand in the migration, because declaring it
 * here would import `schema/member/` into `schema/finance/` — the very thing
 * ADR-004 §6 keeps out of a module. `tests/int/platform/finance-core.int.spec.ts`
 * reads the constraint back out of `information_schema` (EARS-322).
 *
 * IMMUTABLE (EARS-313), guarded by the migration's trigger as well as by the
 * module. There is no `allocated` column, no absorption rate and no allocation
 * run anywhere (EARS-334): an amount reaches a cost object only by having been
 * recorded with that dimension.
 */
import { bigint, integer, serial, text } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financeAccount } from './finance-account'
import { financeCategory } from './finance-category'
import { financeConversionStep } from './finance-conversion-step'
import { financeOperation } from './finance-operation'
import { financeProduct } from './finance-product'
import { financeProject } from './finance-project'

export const financePosting = core.table('finance_posting', {
  id: serial('id').primaryKey(),
  operationId: integer('operation_id')
    .notNull()
    .references(() => financeOperation.id),
  accountId: integer('account_id')
    .notNull()
    .references(() => financeAccount.id),
  /** Signed minimal units: debit > 0, credit < 0 (EARS-310). */
  amount: bigint('amount', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
  projectId: integer('project_id').references(() => financeProject.id),
  categoryId: integer('category_id').references(() => financeCategory.id),
  productId: integer('product_id').references(() => financeProduct.id),
  /** FK → `core.member(id)`, added as SQL in the migration (EARS-322). */
  memberId: integer('member_id'),
  conversionStepId: integer('conversion_step_id').references(() => financeConversionStep.id),
})

export type FinancePostingRow = typeof financePosting.$inferSelect
export type FinancePostingInsert = typeof financePosting.$inferInsert
