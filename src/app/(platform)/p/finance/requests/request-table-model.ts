import type { RequestBoardItem } from './request-board-contract'
import type { FinanceRequestBoardAct } from './request-board-model'

/**
 * THE TABLE VIEW OF `/p/finance/requests` — owner decision 35 (Антон,
 * 2026-09-14, issue #115), PRD 339 US-2/US-3.
 *
 * The route stays ONE page. What changed is which view it opens on: every
 * signed-in member now reads the whole queue as a TABLE — date, submitter,
 * amount, purpose, status, refusal reason — with a «мои / все» filter
 * preselected on «мои». The picked kanban (Stage-A option D, #339) is not
 * retired: it becomes a view TOGGLE offered to `finance-approve`, who also gets
 * the approve / refuse acts as row actions in the table.
 *
 * Everything here is pure, for the same reason `request-board-model.ts` is: the
 * questions «whose requests are these», «which order» and «who may act on this
 * row» are answerable without a DOM, and a screen that answers them inline is a
 * screen whose rules can only be checked by rendering it.
 *
 * NONE OF THIS IS A BOUNDARY. Reading is open to every platform member
 * (EARS-530, decision 32) and the acts are refused by the module itself
 * (EARS-501) however the API is reached. What lives here is the AFFORDANCE.
 */

export type RequestTableScope = 'mine' | 'all'
export type RequestsView = 'table' | 'board'

/** «Мои» is preselected: the reader's own filings are what they came for. */
export const DEFAULT_REQUEST_TABLE_SCOPE: RequestTableScope = 'mine'

export const REQUEST_TABLE_SCOPES: readonly { value: RequestTableScope; label: string }[] = [
  { value: 'mine', label: 'Мои' },
  { value: 'all', label: 'Все' },
]

/** Where the reader's chosen view is remembered — this browser, nothing else. */
export const REQUESTS_VIEW_STORAGE_KEY = 'bbm.finance.requests.view'

/**
 * The visible rows, filtered and ordered.
 *
 * THE SORT KEY IS THE BOARD'S. `groupRequestsByStatus` files an undated
 * pre-spend intent ABOVE the dated cards of its column (EARS-533: the money has
 * not moved, so the item is not «oldest» — it has no date at all), and the two
 * views of the same queue must not disagree about what «newest first» means.
 * Equal dates break by the newer id.
 */
export function requestTableRows(
  requests: readonly RequestBoardItem[],
  scope: RequestTableScope,
): RequestBoardItem[] {
  const key = (request: RequestBoardItem) => request.occurredOn ?? '9999-12-31'
  return requests
    .filter((request) => scope === 'all' || request.own)
    .slice()
    .sort((left, right) => key(right).localeCompare(key(left)) || right.id - left.id)
}

/**
 * The acts a row offers, in the order they are rendered.
 *
 * Only the approve role acts (EARS-501/502), and only on the two statuses that
 * have a decision left in them — the same pair `canDragRequest` lets the board
 * pick up. `confirm` is deliberately NOT a row act: posting needs the
 * confirming document read and, for a pre-spend item, the money facts entered
 * (EARS-511/533), and neither is readable from a table row.
 */
export function requestRowActs(
  request: RequestBoardItem,
  canApprove: boolean,
): FinanceRequestBoardAct[] {
  if (!canApprove) return []
  if (request.status === 'submitted') return ['approve', 'refuse']
  if (request.status === 'approved') return ['refuse']
  return []
}

/** The board is the approve role's view of the queue (decision 35). */
export function canToggleRequestsView(canApprove: boolean): boolean {
  return canApprove
}

/**
 * The view this reader opens on: the stored choice where it is still theirs to
 * make, the table otherwise. A stored «board» left by a session that once held
 * `finance-approve` is not a way back into a view the role no longer grants.
 */
export function resolveRequestsView(stored: string | null, canApprove: boolean): RequestsView {
  if (stored === 'board' && canToggleRequestsView(canApprove)) return 'board'
  return 'table'
}

/**
 * Whether the refusal-reason column is on the table at all.
 *
 * A column that is empty for every visible row is six columns' worth of width
 * spent saying nothing — and at 390 px the width is the whole budget. The
 * reason appears when there is a refusal to read, and the column with it.
 */
export function tableShowsRefusalReason(rows: readonly RequestBoardItem[]): boolean {
  return rows.some((row) => row.status === 'refused' || row.refusalReason !== null)
}

export type RequestAmountTotal = { currency: string; amount: string }

/**
 * THE TOTALS ROW (#388, owner acceptance 2026-09-15).
 *
 * A register of money in more than one currency has no single total, so the
 * footer carries one sum per currency rather than an arithmetically false one.
 * Minor units all the way — `amount` is the same integer string the contract
 * carries, and it is the screen that formats it.
 */
export function requestAmountTotals(rows: readonly RequestBoardItem[]): RequestAmountTotal[] {
  const sums = new Map<string, bigint>()
  for (const row of rows) {
    sums.set(row.currency, (sums.get(row.currency) ?? 0n) + BigInt(row.amount))
  }
  return [...sums].map(([currency, amount]) => ({ currency, amount: amount.toString() }))
}

export type RequestSorter = { field: string; order: 'asc' | 'desc' }

export type RequestPageQuery = {
  /** «Мои» — the reader's own filings only. Absent means the whole queue. */
  own?: boolean
  sorters?: readonly RequestSorter[]
  currentPage?: number
  pageSize?: number
}

export type RequestPage = {
  rows: RequestBoardItem[]
  /** The size of the FILTERED register — what the pager counts pages of. */
  total: number
  /** The money of the filtered register, not of the visible page. */
  totals: RequestAmountTotal[]
}

/**
 * The comparable value of a sortable column, by the column's own id.
 *
 * A column the reader cannot sort by has no entry here, and a sorter naming
 * one leaves the register in its default order rather than shuffling it.
 */
const SORT_KEYS: Record<string, (request: RequestBoardItem) => string> = {
  // An intent has no date at all (EARS-533); it sorts as the far future so the
  // two views of this queue agree about what «newest first» means.
  occurredOn: (request) => request.occurredOn ?? '9999-12-31',
  createdByName: (request) => request.createdByName ?? '',
  // Minor units, zero-padded: a string compare over money is only honest once
  // every value is the same width.
  amount: (request) => request.amount.padStart(24, '0'),
  purpose: (request) => request.purpose?.name ?? request.proposal?.text ?? '',
  status: (request) => request.status,
  refusalReason: (request) => request.refusalReason ?? '',
}

/**
 * WHAT `getList` ANSWERS WITH — the filter, the order and the page, as pure
 * data (#388 wave 3).
 *
 * The requests surface is driven by the whitelist's List block
 * (`docs/design/ui-whitelist.md` → «List»), which means Refine's `useTable`
 * owns paging, sorting and filtering and asks the data provider for ONE page.
 * The provider reads the board snapshot and answers through this function, so
 * the three rules a register lives by are testable without a DOM and without a
 * network.
 */
export function selectRequestPage(
  requests: readonly RequestBoardItem[],
  query: RequestPageQuery,
): RequestPage {
  const filtered = requestTableRows(requests, query.own === true ? 'mine' : 'all')

  const sorter = query.sorters?.find((candidate) => candidate.field in SORT_KEYS)
  if (sorter !== undefined) {
    const key = SORT_KEYS[sorter.field]!
    const direction = sorter.order === 'desc' ? -1 : 1
    filtered.sort(
      (left, right) => direction * (key(left).localeCompare(key(right)) || left.id - right.id),
    )
  }

  const pageSize = query.pageSize ?? filtered.length
  const currentPage = query.currentPage ?? 1
  const from = pageSize > 0 ? (currentPage - 1) * pageSize : 0
  const rows = pageSize > 0 ? filtered.slice(from, from + pageSize) : filtered.slice()

  return { rows, total: filtered.length, totals: requestAmountTotals(filtered) }
}
