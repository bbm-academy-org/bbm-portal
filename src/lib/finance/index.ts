/**
 * The finance module — the public surface of the BBM ledger (ADR-002 §3, spec
 * `docs/specs/338-ledger-core.md` EARS-323).
 *
 * Everything outside `src/lib/finance` imports from THIS file and from nowhere
 * else inside the module; the module's tables live in
 * `src/lib/platform/db/schema/finance/` and only this module may touch them
 * (ADR-004 §6). Both halves of that boundary are machine-checked by
 * `pnpm boundaries` — `module-must-not-import-foreign-tables` and
 * `route-layer-must-not-import-tables` — so a route that reaches for a table
 * handle goes red rather than merely being impolite.
 *
 * What F1a delivers, and what it deliberately does not:
 *
 *  - reference management (EARS-301…309), the fact core (EARS-310…322),
 *    conversions with frozen rates (EARS-318/319/328/329), and the balance /
 *    register / exception queries;
 *  - EVERY write demands `platform-admin` from the actor and is refused here,
 *    however the URL was reached (EARS-330); reading is deliberately wider and
 *    is gated by the surface (EARS-325, F1b/#357);
 *  - NO opening-balance mechanism (EARS-317): an account starts at zero and its
 *    balance is the sum of its postings, always;
 *  - NO allocation, absorption or apportionment of any kind (EARS-334): an
 *    amount reaches a cost object only by having been RECORDED with that
 *    dimension. Such views are F3 overlays computed from postings, and there is
 *    no function here that could write one;
 *  - NO edit or delete of a recorded fact (EARS-313): the only correction is
 *    `reverseOperation`.
 *
 * The workspace declaration, `/p/finance` and the `/p/admin/finance/*` resources
 * (EARS-324/325/326) are #357 and are not exported here yet.
 */

// ── who may write, and how the write is attributed (EARS-330; spec 201) ──────
export { assertFinanceWriteAccess, financeAuditContext } from './core/actor'
export type { FinanceActor } from './core/actor'
export { FinanceAccessRefusal, FinanceRefusal } from './core/errors'
export type { AuditContext, AuditSource } from '@/lib/platform/db/transaction'

// ── the invariants of a fact (EARS-311/312/320/321/327/331) ──────────────────
export {
  assertBalancedPerCurrency,
  assertPostingCurrencyMatchesAccount,
  assertProductBinding,
  assertProjectOnResultPostings,
  resolvePostingCategory,
} from './core/invariants'
export type { AccountFacts, PostingDraft } from './core/invariants'

// ── minimal-unit arithmetic (EARS-310/318/328) ───────────────────────────────
export { convertMinorUnits, costBasisAtAverage, parseRate } from './core/money'
export type { ParsedRate } from './core/money'

// ── the reference tables (EARS-301…309) ──────────────────────────────────────
export {
  createAccount,
  createCategory,
  createCurrency,
  createProduct,
  createProject,
  createPurpose,
  deleteReferenceRow,
  listAccounts,
  listCategories,
  listCurrencies,
  listProducts,
  listProjects,
  listPurposes,
  retireReferenceRow,
  systemAccount,
  updateAccount,
  updateCategory,
  updateCurrency,
  updateProduct,
  updateProject,
  updatePurpose,
} from './references'
export type {
  FinanceAccountView,
  FinanceCategoryView,
  FinanceCurrencyView,
  FinanceProductView,
  FinanceProjectView,
  FinancePurposeView,
  FinanceReferenceTable,
} from './references'

// ── the fact core (EARS-310…316, EARS-320…322, EARS-327) ─────────────────────
export { recordOperation, reverseOperation } from './operations'
export type { RecordOperationInput, RecordedOperation } from './operations'

// ── conversions with frozen rates (EARS-318/319/328/329) ─────────────────────
export { recordConversion } from './conversions'
export type { ConversionStepInput, RecordConversionInput } from './conversions'

// ── the read side: balances, register, the exception list (EARS-317/333) ─────
export { accountBalances, listRegister, postingsMissingOptionalProduct } from './queries'
export type { AccountBalance, RegisterEntry, MissingProductPosting } from './queries'

// ── the enums the ledger fixes (EARS-305/306/316) ────────────────────────────
export {
  FINANCE_ACCOUNT_KINDS,
  FINANCE_MONEY_ACCOUNT_KINDS,
  FINANCE_SYSTEM_ACCOUNT_KINDS,
} from '@/lib/platform/db/schema/finance/finance-account'
export type {
  FinanceAccountKind,
  FinanceMoneyAccountKind,
  FinanceSystemAccountKind,
} from '@/lib/platform/db/schema/finance/finance-account'
export { FINANCE_OPERATION_SOURCES } from '@/lib/platform/db/schema/finance/finance-operation'
export type { FinanceOperationSource } from '@/lib/platform/db/schema/finance/finance-operation'
export { FINANCE_PRODUCT_BINDINGS } from '@/lib/platform/db/schema/finance/finance-purpose'
export type { FinanceProductBinding } from '@/lib/platform/db/schema/finance/finance-purpose'
