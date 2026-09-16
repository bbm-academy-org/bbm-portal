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

/**
 * THE DESKTOP WIDTH BUDGET OF THE REGISTER (#388 defect B, eyes-on matrix of
 * 2026-09-16).
 *
 * The block lays the table out `table-layout: fixed` and writes each column's
 * declared `size` into the cell's inline `width`, so the SUM of the sizes is
 * the table's width — there is no reflow to save a plan that overspends. At
 * 1440×900 the `/p` shell gives this surface a 1110 px container; the previous
 * plan declared 1200 px (1420 with the refusal column), the table measured
 * 1214 px, «Отклонить…» was cut mid-word and the row's «Открыть» — the only
 * control wave 3 leaves for opening a request — was laid out at x 1291–1369 and
 * never painted.
 *
 * 1110 is therefore a CEILING the plan is checked against, not a target: the
 * plan below spends at most 1080 of it in its widest combination. Below `sm`
 * the table still scrolls sideways, and the swipe hint above it still says so —
 * that is the accepted phone behaviour, not this budget's business.
 */
export const REQUEST_TABLE_WIDTH_BUDGET = 1110

export type RequestTableColumnId =
  'occurredOn' | 'createdByName' | 'amount' | 'purpose' | 'status' | 'actions'

export type RequestTableColumn = { id: RequestTableColumnId; size: number }

/** What each column is worth in the budget, in the reading order it is spent. */
const REQUEST_TABLE_COLUMN_WIDTHS: Record<RequestTableColumnId, number> = {
  occurredOn: 116,
  createdByName: 140,
  amount: 124,
  purpose: 210,
  status: 190,
  actions: 300,
}

/** A reader who cannot act has ONE control in the trailing column: «Открыть». */
const REQUEST_TABLE_READ_ONLY_ACTIONS_WIDTH = 130

/**
 * The columns this reader's register carries, in reading order, with the width
 * each is given.
 *
 * TWO THINGS COME OUT OF THE PLAN, and both are the agent's composition call
 * (`.claude/rules/design-process.md` §1 — composition, control choice and
 * grouping are the agent's; the visual language is the owner's):
 *
 *  - «Кто подал» is NOT on the table under «Мои». Every row of that scope names
 *    the same person — the reader — so the column is 140 px spent repeating the
 *    heading. It returns the moment the scope widens to «Все», which is the only
 *    scope where the answer varies.
 *  - THE REFUSAL REASON IS NO LONGER A COLUMN. It is the second line of the
 *    «Статус» cell, under the badge that says «Отклонена» — the reason explains
 *    exactly that status and nothing else, and a column of its own cost 220 px
 *    that the seventh column pushed «Открыть» off the screen with. Nothing is
 *    lost: the cell carries the reason, and the details sheet carries it in
 *    full.
 */
export function requestTableColumnPlan({
  scope,
  canApprove,
}: {
  scope: RequestTableScope
  canApprove: boolean
}): RequestTableColumn[] {
  const ids: RequestTableColumnId[] = [
    'occurredOn',
    ...(scope === 'all' ? (['createdByName'] as const) : []),
    'amount',
    'purpose',
    'status',
  ]
  return [
    ...ids.map((id) => ({ id, size: REQUEST_TABLE_COLUMN_WIDTHS[id] })),
    {
      id: 'actions' as const,
      size: canApprove
        ? REQUEST_TABLE_COLUMN_WIDTHS.actions
        : REQUEST_TABLE_READ_ONLY_ACTIONS_WIDTH,
    },
  ]
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
