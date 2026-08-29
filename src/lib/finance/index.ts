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
 *  - EVERY write is refused here, however the URL was reached, by the gate that
 *    matches its KIND: reference administration demands `platform-admin`
 *    (EARS-330 as amended, EARS-529), the ledger — posting and reversing —
 *    demands `finance-approve`, and the intake demands `finance-entry` with the
 *    submitter carve-out (EARS-501/502, #380). Reading is deliberately wider:
 *    `/p/finance` stays open to every platform member (EARS-530/EARS-325) and is
 *    gated by the surface (F1b/#357);
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

// ── who may write, and how the write is attributed (EARS-330/501/502/529; spec 201) ──
export {
  assertFinanceIntakeAccess,
  assertFinanceLedgerAccess,
  assertFinanceReferenceAccess,
  financeAuditContext,
  FINANCE_APPROVE_ROLE,
  FINANCE_ENTRY_ROLE,
  FINANCE_FLOW_ROLES,
} from './core/actor'
export type { FinanceActor, FinanceFlowRole, FinanceIntakeAct } from './core/actor'
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

// ── counterparty + missing-purpose references (spec 339 EARS-532/526) ───────
export { createCounterparty, listCounterparties, renameCounterparty } from './counterparties'
export type { FinanceCounterpartyView } from './counterparties'
export {
  createPurposeProposal,
  dismissPurposeProposal,
  listPurposeProposals,
  resolvePurposeProposal,
} from './purpose-proposals'
export type { FinancePurposeProposalStatus, FinancePurposeProposalView } from './purpose-proposals'

// ── the fact core (EARS-310…316, EARS-320…322, EARS-327) ─────────────────────
export { recordOperation, reverseOperation } from './operations'
export type { RecordOperationInput, RecordedOperation } from './operations'

// ── conversions with frozen rates (EARS-318/319/328/329) ─────────────────────
export { recordConversion } from './conversions'
export type { ConversionStepInput, RecordConversionInput } from './conversions'

// ── the intake spine (spec 339 EARS-503/504/524/525) ─────────────────────────
export {
  createIntakeItem,
  createIntakeItems,
  editIntakeItem,
  FinanceIntakeDuplicate,
  getIntakeItem,
  listIntakeItems,
  transitionIntakeItem,
} from './intake/items'
export type {
  CreateIntakeItemInput,
  EditIntakeItemPatch,
  FinanceIntakeBulkOutcome,
  FinanceIntakeDuplicateLine,
  FinanceIntakeItemView,
  ListIntakeItemsFilter,
} from './intake/items'
// `registerIntakeProducer` is deliberately NOT re-exported. Registration is a
// LOAD-TIME act inside the module (`./intake/sources` registers the four sources
// spec 339 fixes), and the registry is a module-global `Map` keyed by source: a
// mutator crossing the module boundary would let any caller silently redefine
// `manual` at runtime. A future producer is registered from inside
// `src/lib/finance`, the way these four are.
export {
  backfillSourceRef,
  listIntakeProducers,
  resolveIntakeProducer,
  resolveIntakeSourceRef,
} from './intake/sources'
export type {
  FinanceIntakeNaturalKey,
  FinanceIntakeProducer,
  FinanceIntakeRefInput,
  FinanceIntakeSourceRefPolicy,
} from './intake/sources'
export {
  assertIntakeTransition,
  findIntakeTransition,
  isIntakeMoneyField,
  isTerminalIntakeStatus,
  planIntakeEdit,
  FINANCE_INTAKE_ACTS,
  FINANCE_INTAKE_MONEY_FIELDS,
  FINANCE_INTAKE_TERMINAL_STATUSES,
  FINANCE_INTAKE_TRANSITIONS,
} from './intake/status'
export type {
  FinanceIntakeTransitionAct,
  FinanceIntakeEditPlan,
  FinanceIntakeGate,
  FinanceIntakeMoneyField,
  FinanceIntakeTransition,
} from './intake/status'

// ── the confirming documents (spec 339 EARS-514/515/516/523) ─────────────────
// The raw storage capability and `storage_key` stay inside this module. Public
// callers get only gated document operations; diagnostics must not become an
// authorization or immutability bypass (EARS-516/523).
export {
  assertFinanceDocumentUpload,
  assertFinanceDocumentBytes,
  attachFinanceDocument,
  deleteFinanceDocument,
  detachFinanceDocument,
  FinanceDocumentUploadPending,
  listFinanceDocuments,
  readFinanceDocument,
  resumeFinanceDocumentUpload,
  setFinanceDocumentKind,
  uploadFinanceDocument,
  FINANCE_DOCUMENT_MAX_BYTES,
} from './documents/documents'
export type {
  FinanceDocumentContent,
  FinanceDocumentView,
  UploadFinanceDocumentInput,
} from './documents/documents'
export {
  FINANCE_DOCUMENT_KINDS,
  FINANCE_DOCUMENT_MIME_TYPES,
} from '@/lib/platform/db/schema/finance/finance-document'
export type {
  FinanceDocumentKind,
  FinanceDocumentMimeType,
} from '@/lib/platform/db/schema/finance/finance-document'

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
export {
  FINANCE_INTAKE_KINDS,
  FINANCE_INTAKE_SOURCES,
  FINANCE_INTAKE_STATUSES,
} from '@/lib/platform/db/schema/finance/finance-intake-item'
export type {
  FinanceIntakeKind,
  FinanceIntakeSource,
  FinanceIntakeStatus,
} from '@/lib/platform/db/schema/finance/finance-intake-item'
export { FINANCE_PRODUCT_BINDINGS } from '@/lib/platform/db/schema/finance/finance-purpose'
export type { FinanceProductBinding } from '@/lib/platform/db/schema/finance/finance-purpose'
