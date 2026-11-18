import type { RequestBoardItem, RequestsSnapshot } from './request-board-contract'

/**
 * THE VIEW SWITCH OF `/p/finance/requests` and the requests REGISTER the data
 * provider answers `getList` with — owner decision 35 (Антон, 2026-09-14,
 * issue #115), PRD 339 US-2/US-3.
 *
 * The route stays ONE page. Since spec 339 §I (#550) its default view is the
 * owner's payment queue (`request-queue-model.ts`, `RequestsQueue.tsx`), which
 * replaced the decision-35 flat table; the picked kanban (Stage-A option D,
 * #339) stays a view TOGGLE offered to `finance-approve`. What is left here is
 * that toggle and the register's selection rules.
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
 * The view a SKELETON may promise, which is a different question (#388 defect
 * C, eyes-on matrix of 2026-09-16).
 *
 * `resolveRequestsView` needs the role, and the role arrives with the snapshot
 * that is still in flight — so while loading there is nothing to check a stored
 * «board» against. The skeleton takes the stored choice at its word: a browser
 * that last chose the board had the role when it did, and the worst case is one
 * grey frame of the wrong shape for a reader who has since lost it. Anything
 * unstored, unreadable or unknown gets the DEFAULT, the table, which is also
 * all the route's own `loading.tsx` can ever promise — a server has no browser
 * to ask.
 */
export function requestsLoadingView(stored: string | null): RequestsView {
  return stored === 'board' ? 'board' : 'table'
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
export function requestAmountTotals(
  rows: readonly { amount: string; currency: string }[],
): RequestAmountTotal[] {
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
  // «Подана» (#517). Keyed by the COLUMN id (`filed`), not by its accessor
  // `createdAt`: refine sends `sorters: [{ field: <column id> }]`, and a key
  // named after the accessor made this sorter a silent no-op (#525 review B1).
  // An ISO instant compares correctly as a string, and unlike the money date
  // every row has one — which is what makes it the column the merged first
  // cell offers its sorter on.
  filed: (request) => request.createdAt,
  createdByName: (request) => request.createdByName ?? '',
  // Minor units, zero-padded: a string compare over money is only honest once
  // every value is the same width.
  amount: (request) => request.amount.padStart(24, '0'),
  purpose: (request) => request.purpose?.name ?? request.proposal?.text ?? '',
  status: (request) => request.status,
  refusalReason: (request) => request.refusalReason ?? '',
}

/**
 * The visible slice, for either register.
 *
 * A page size of nothing means «the whole register on one page» — the shape a
 * caller that does not page asks for — and so does a zero, which is how the
 * block spells «no paging» rather than an empty page.
 */
function pageOf<Row>(rows: Row[], query: { currentPage?: number; pageSize?: number }): Row[] {
  const pageSize = query.pageSize ?? rows.length
  const currentPage = query.currentPage ?? 1
  const from = pageSize > 0 ? (currentPage - 1) * pageSize : 0
  return pageSize > 0 ? rows.slice(from, from + pageSize) : rows.slice()
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

  return {
    rows: pageOf(filtered, query),
    total: filtered.length,
    totals: requestAmountTotals(filtered),
  }
}

/**
 * THE LIABILITIES REGISTER — the same three rules, over a different register
 * (#388 round-7 blocker).
 *
 * «Кому BBM должен» is read through the SAME List block as the requests
 * register, which means `@refinedev/react-table` drives its sorter and its
 * pager server-side (`manualSorting` / `manualPagination`) and the provider is
 * the only place either can be honoured. A register whose sorter reorders
 * nothing is the defect class the stand was rejected for on 2026-09-15: a
 * control whose STATE changes while its DATA does not.
 *
 * A liability is a BALANCE, not a record with an id of its own — the member and
 * the currency are what identify it, so the row carries the composite the block
 * needs to key it, and that composite is also the tie-break.
 */
export type LiabilityRegisterRow = RequestsSnapshot['liabilities'][number] & { id: string }

/** The columns «Обязательства» offers, by the ids `LiabilityPanel` declares. */
const LIABILITY_SORT_KEYS: Record<string, (row: LiabilityRegisterRow) => string> = {
  memberName: (row) => row.memberName,
  // Minor units, zero-padded — the same reason `amount` is padded above.
  balance: (row) => row.balance.padStart(24, '0'),
}

export function selectLiabilityPage(
  liabilities: readonly RequestsSnapshot['liabilities'][number][],
  query: { sorters?: readonly RequestSorter[]; currentPage?: number; pageSize?: number },
): { rows: LiabilityRegisterRow[]; total: number } {
  const rows: LiabilityRegisterRow[] = liabilities.map((liability) => ({
    ...liability,
    id: `${liability.memberId}-${liability.currency}`,
  }))

  const sorter = query.sorters?.find((candidate) => candidate.field in LIABILITY_SORT_KEYS)
  if (sorter !== undefined) {
    const key = LIABILITY_SORT_KEYS[sorter.field]!
    const direction = sorter.order === 'desc' ? -1 : 1
    rows.sort(
      (left, right) =>
        direction * (key(left).localeCompare(key(right)) || left.id.localeCompare(right.id)),
    )
  }

  // `total` is the size of the WHOLE register, never of the visible page: it is
  // what the block counts its pages off.
  return { rows: pageOf(rows, query), total: rows.length }
}
