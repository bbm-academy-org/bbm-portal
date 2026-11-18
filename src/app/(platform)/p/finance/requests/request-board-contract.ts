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

/** Факт, Рынок and Переплата of one payment in one display currency — minor units, as strings. */
export type MarketDisplayFigures = { fact: string; market: string; overpayment: string }

/**
 * The §J «Курс против рынка» block of one request (spec 339 EARS-557…563,
 * #551), built on the server from the #558 read model — the browser receives
 * figures, never a rate table, and computes nothing (EARS-553/563).
 */
export type RequestMarketBlock =
  | {
      kind: 'measured'
      /** The payment date — the date money moved (EARS-557). */
      date: string
      /** The CBR quote that valued the document side (USDT / USDC: the USD one). */
      rate: { currency: string; rateDate: string; nominal: number; valueRub: string }
      /** What the account (or the member's card) lost: `amount` includes `fee`. */
      fact: {
        amount: string
        currency: string
        fee: { amount: string; currency: string } | null
        /** The paying account; `null` — the member's own card. */
        account: string | null
      }
      /** (Факт / Рынок − 1) in tenths of a percent, signed — the ROUBLE figure (EARS-562/566). */
      percentTenths: string | null
      /** «хуже рынка на X,X%» / «лучше рынка на X,X%» / «как на рынке» (EARS-559). */
      wording: string
      /** Per display currency; `null` where that currency has no rate on the payment date. */
      display: Record<DisplayCurrencyCode, MarketDisplayFigures | null>
    }
  /** EARS-558: no CBR quote within 14 days of the payment date. */
  | { kind: 'no_rate'; currency: string; date: string }
  /** EARS-560: the money moved, what it cost is not in the ledger yet. */
  | { kind: 'not_posted'; statedPaidAmount: string | null }

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
  /** The fee recorded with the spend, in its own currency (EARS-513/544); null when none. */
  feeAmount: string | null
  feeCurrency: string | null
  /**
   * The §J block (EARS-563): a posted foreign-currency payment or a «факт не
   * внесён» request; `null` for everything else, a same-currency request among
   * them — and then the sheet shows no block.
   */
  market: RequestMarketBlock | null
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
