import type {
  CbrRateReason,
  ExpenseRequestStage,
  FinanceDocumentKind,
  FinanceIntakeStatus,
  FinanceProductBinding,
} from '@/lib/finance'

export type RequestReference = { id: number; name: string }

export type RequestBoardDocument = {
  id: number
  filename: string
  mime: string
  size: number
  kind: FinanceDocumentKind
  uploadedAt: string
}

/** The three currencies the queue's ₽ / $ / € switch offers (EARS-549). */
export const DISPLAY_CURRENCY_CODES = ['RUB', 'USD', 'EUR'] as const
export type DisplayCurrencyCode = (typeof DISPLAY_CURRENCY_CODES)[number]

/**
 * One request's amount in one display currency (spec 339 EARS-549/550/551,
 * #550), computed on the server from the ledger's record and the stored CBR
 * series — the browser never sees a rate table and never converts.
 *
 * `amount` is rounded once; `numerator / denominator` is the exact value, so a
 * SUM of many rows adds exact values and rounds once at the end (EARS-549).
 * All three are bigint minor units of the display currency, as strings.
 */
export type QueueDisplayAmount =
  | {
      kind: 'converted'
      amount: string
      numerator: string
      denominator: string
      basis: 'same_currency' | 'ledger_amount' | 'ledger_step' | 'cbr'
      /** The CBR quote date used, for `basis: 'cbr'` — what the sheet names. */
      rateDate: string | null
      reason: CbrRateReason | null
    }
  /** CBR has no quote on or before `date` for `currency` (EARS-551). */
  | { kind: 'no_rate'; currency: string; date: string }

export type RequestBoardItem = {
  id: number
  own: boolean
  status: FinanceIntakeStatus
  /** The EARS-535 queue stage (#549) — a reading of the spine, never a status. */
  stage: ExpenseRequestStage
  /** Whether a ready document is attached — the «без чека» fact (#551 renders it). */
  hasDocument: boolean
  /** The posted reimbursement that settles this request, if any (EARS-528). */
  settledBy: number | null
  /**
   * The EARS-548 snapshot token, for `finance-approve` readers only (null
   * otherwise). Only this LIST carries it — the single-request read does not —
   * so every row act and the sheet take it from the list row they were opened
   * from (lead note on #550).
   */
  snapshot: string | null
  /** The request in each display currency (EARS-549/550/551). */
  display: Record<DisplayCurrencyCode, QueueDisplayAmount>
  /**
   * The date money moved — NULL while an unposted pre-spend request has none
   * (EARS-533). No surface renders that emptiness as a value.
   */
  occurredOn: string | null
  /**
   * WHEN THE REQUEST WAS FILED — «Подана» (#517). An ISO instant; the audit
   * column `created_at`, which every row carries since #516 and which migration
   * `0017` set from the Mattermost post for the 47 reconstructed rows.
   */
  createdAt: string
  /** WHERE it was filed: a link, or a source system's identifier. Null when none. */
  sourceRef: string | null
  /** The same thing as an openable URL, resolved SERVER-SIDE. Null when unresolvable. */
  sourceUrl: string | null
  /** What to call that link on screen — «Mattermost», a host, or the ref itself. */
  sourceLabel: string | null
  amount: string
  currency: string
  paidAmount: string | null
  paidCurrency: string | null
  note: string | null
  alreadyPaid: boolean
  personalFunds: boolean
  createdBy?: number
  createdByName?: string
  /** The member a `personal_funds` request is owed to — «Кому платим» (EARS-538). */
  memberId?: number | null
  memberName?: string | null
  decidedBy?: number | null
  decidedByName?: string | null
  postedByName?: string | null
  decidedAt?: string | null
  refusalReason: string | null
  operationId: number | null
  operation?: {
    id: number
    occurredOn: string
    postings: Array<{ accountName: string; amount: string; currency: string }>
  } | null
  purpose: (RequestReference & { categoryId: number | null; categoryName: string | null }) | null
  project: RequestReference
  product: RequestReference | null
  account: (RequestReference & { currency: string }) | null
  counterparty: RequestReference | null
  documents: RequestBoardDocument[]
  proposal?: { id: number; text: string; status: string } | null
}

export type RequestBoardReferences = {
  accounts: Array<RequestReference & { currency: string }>
  counterparties: RequestReference[]
  currencies: Array<{ code: string; name: string; precision: number }>
  products: Array<RequestReference & { projectId: number }>
  projects: RequestReference[]
  purposes: Array<
    RequestReference & { categoryId: number | null; productBinding: FinanceProductBinding }
  >
}

export type RequestsSnapshot = {
  permissions: { canApprove: boolean; canEnter: boolean }
  references: RequestBoardReferences
  requests: RequestBoardItem[]
  liabilities: Array<{
    memberId: number
    memberName: string
    currency: string
    balance: string
  }>
  /**
   * The CBR store's age (EARS-552): the newest stored effective date (null when
   * none is stored) and today in Moscow, so the page can say the rates are stale.
   */
  fx: { latestRateDate: string | null; today: string }
}

export type CreateRequestBody = {
  /** Null for a pre-spend request: the posting act supplies it (EARS-533). */
  occurredOn: string | null
  /** Null for own funds, and for a pre-spend request that names none yet. */
  accountId: number | null
  amount: string
  currency: string
  paidAmount?: string | null
  paidCurrency?: string | null
  purposeId: number | null
  purposeProposal?: string | null
  projectId: number
  productId?: number | null
  counterpartyId?: number | null
  counterpartyName?: string | null
  note?: string | null
  /** Optional and FILING-ONLY: provenance is immutable after submit (EARS-555). */
  sourceRef?: string | null
  alreadyPaid: boolean
  personalFunds: boolean
}
