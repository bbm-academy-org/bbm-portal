'use client'

import type { HttpError } from '@refinedev/core'
import { useTable } from '@refinedev/react-table'
import type { Column, ColumnDef, SortingState, Updater } from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import React from 'react'

import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { DataTable } from '@/ui/refine-ui/data-table/data-table'
import { DataTableSorter } from '@/ui/refine-ui/data-table/data-table-sorter'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs'
import { cn } from '@/ui/utils'

import { formatDate, REQUESTS_RESOURCE } from './constants'
import type {
  DisplayCurrencyCode,
  RequestBoardItem,
  RequestBoardReferences,
  RequestsSnapshot,
} from './request-board-contract'
import { currencyPrecision } from './request-board-model'
import {
  DEFAULT_QUEUE_SCOPE,
  DEFAULT_QUEUE_SORT,
  DISPLAY_CURRENCIES,
  DISPLAY_CURRENCY_STORAGE_KEY,
  EMPTY_QUEUE_FILTERS,
  filterQueueRows,
  formatDisplayMoney,
  formatOriginalMoney,
  isNewRequest,
  isOverdue,
  missingRateNote,
  newCountLabel,
  parseStoredDisplayCurrency,
  QUEUE_GROUPS,
  QUEUE_PERIODS,
  QUEUE_SCOPES,
  queueAuthors,
  queueGroupRows,
  queueGroupStages,
  queueKpis,
  queueOutcome,
  queuePayee,
  queueRowAct,
  queueRowTitle,
  rateStaleness,
  requestAge,
  requestCountLabel,
  sumInDisplay,
  type QueueAct,
  type QueueFilters,
  type QueuePeriod,
  type QueueScope,
  type QueueSort,
  type QueueSortKey,
  type QueueStage,
  type QueueSum,
} from './request-queue-model'
import { RequestSourceLink } from './RequestSourceLink'

/**
 * THE OWNER'S PAYMENT QUEUE — the default view of `/p/finance/requests`
 * (spec 339 §I, EARS-536…541/549/551/552; issue #550).
 *
 * LAYOUT is the owner-approved prototype `design-source/finance/RequestPaymentQueue.html`
 * (`fidelity: wireframe`, owner «Го» on BBMP-281, Антон, 2026-11-17): three sums
 * on top that filter on click, one toolbar (search · submitter · project ·
 * period · ₽/$/€ · scope), then the groups in the order a decision moves a
 * request through them, each a heading with its count, hint and sum over its
 * own table. The LOOK is the stock shadcn/Refine theme (`Design-fidelity: GO —
 * Антон, 2026-09-03` on the same glob): every group's table is the whitelist's
 * List block, the controls are the kit's, and nothing is boxed in a box — the
 * sums and the group headings are type, not cards.
 *
 * Deviations from the prototype taken on the review of PR #562 (UX 1–8), each
 * an agent's composition decision recorded in the PR:
 *  - the AMOUNT is always the LAST column, the row act (or, in a closed group,
 *    what closed it) sits before it — so a group heading's sum and its rows'
 *    amounts share one right edge in every group;
 *  - a group shows the act column only when it has an act, and a closed group
 *    shows what the archive is read for instead: the payment date, the reason;
 *  - on a phone a row is ONE stacked cell (when · who → payee · what) beside
 *    the amount and its act — the block's own horizontal scroll hid the amount.
 *
 * ONE MOMENT, ONE ORDER. The rows are the screen's ONE snapshot read (the same
 * object the chrome, the board and the sheet read), handed to each group's
 * block as its data; one sort state drives every group (EARS-539), one display
 * currency every amount and every sum (EARS-549). The conversion itself was
 * done on the server (`queue-display.ts`) — this file adds exact values up and
 * formats them, nothing more.
 *
 * NOTHING HERE IS A BOUNDARY: a row act is offered to `finance-approve` only,
 * and the module refuses it to anyone else however it is reached (EARS-541).
 */
export type RequestsQueueProps = {
  requests: readonly RequestBoardItem[]
  references: RequestBoardReferences
  canApprove: boolean
  fx: RequestsSnapshot['fx']
  /** The view toggle of the approve role, placed at the end of the toolbar row. */
  toolbarEnd?: React.ReactNode
  onOpen: (request: RequestBoardItem) => void
  onAct: (request: RequestBoardItem, act: QueueAct) => void
}

// ── the remembered display currency, as an external store (EARS-549) ────────

const currencyListeners = new Set<() => void>()

function readStoredCurrency(): string | null {
  try {
    return window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredCurrency(next: DisplayCurrencyCode): void {
  try {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, next)
  } catch {
    // The choice holds for this visit; only its memory is refused.
  }
  for (const listener of currencyListeners) listener()
}

function subscribeStoredCurrency(listener: () => void): () => void {
  currencyListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    currencyListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const serverStoredCurrency = () => null

// ── the phone layout switch ─────────────────────────────────────────────────

/**
 * Below the kit's mobile breakpoint (`src/ui/hooks/use-mobile.ts`, 768 px) a
 * row is drawn as one stacked cell. An external store rather than the kit hook
 * because the screen also renders where `matchMedia` does not exist (the unit
 * stand) — there it is simply the wide layout.
 */
const NARROW_QUERY = '(max-width: 767px)'

function narrowQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null
}

function subscribeNarrow(listener: () => void): () => void {
  const query = narrowQuery()
  query?.addEventListener('change', listener)
  return () => query?.removeEventListener('change', listener)
}

const readNarrow = () => narrowQuery()?.matches ?? false
const serverNarrow = () => false

function useNarrow(): boolean {
  return React.useSyncExternalStore(subscribeNarrow, readNarrow, serverNarrow)
}

// ── formatting ──────────────────────────────────────────────────────────────

const FILED_DAY = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: 'numeric',
  month: 'short',
})
const FILED_YEAR = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric' })

/** «16 нояб.», with the year only when it is not this year — the prototype's date. */
function filedDay(iso: string, now: Date): string {
  const instant = new Date(iso)
  const year = FILED_YEAR.format(instant)
  return year === FILED_YEAR.format(now)
    ? FILED_DAY.format(instant)
    : `${FILED_DAY.format(instant)} ${year}`
}

/** A calendar date («2026-10-29») read as that Moscow day. */
function calendarDay(date: string, now: Date): string {
  return filedDay(`${date}T12:00:00+03:00`, now)
}

function SumText({
  sum,
  currency,
  stacked = false,
}: {
  sum: QueueSum
  currency: DisplayCurrencyCode
  /** The «без N заявок» note on its own line — a narrow heading has no room beside the sum. */
  stacked?: boolean
}) {
  const note = missingRateNote(sum.missing)
  return (
    <>
      {sum.amount === null ? '—' : formatDisplayMoney(sum.amount, currency)}
      {note === null ? null : (
        <span
          className={cn('text-xs font-normal text-muted-foreground', stacked ? 'block' : 'ml-1.5')}
        >
          {note}
        </span>
      )}
    </>
  )
}

const ACT_LABEL: Record<QueueAct, string> = {
  approve: 'Одобрить',
  'mark-paid': 'Отметить оплату',
  'mark-reimbursed': 'Отметить возврат',
}

/** The row act names its row — ten «Одобрить» buttons tell a screen reader nothing. */
function actAccessibleName(act: QueueAct, id: number): string {
  if (act === 'approve') return `Одобрить заявку №${id}`
  if (act === 'mark-paid') return `Отметить оплату заявки №${id}`
  return `Отметить возврат по заявке №${id}`
}

const SORTER_LABEL: Record<QueueSortKey, string> = {
  filed: 'Сортировать по дате подачи',
  author: 'Сортировать по заявителю',
  payee: 'Сортировать по получателю',
  purpose: 'Сортировать по назначению',
  amount: 'Сортировать по сумме',
}

function Sorter({ column, sortKey }: { column: Column<RequestBoardItem>; sortKey: QueueSortKey }) {
  return (
    <DataTableSorter
      column={column}
      title={SORTER_LABEL[sortKey]}
      aria-label={SORTER_LABEL[sortKey]}
    />
  )
}

// ── the cells ───────────────────────────────────────────────────────────────

type CellContext = {
  currency: DisplayCurrencyCode
  now: Date
  references: RequestBoardReferences
  onOpen: (request: RequestBoardItem) => void
  onAct: (request: RequestBoardItem, act: QueueAct) => void
}

/** «новая» — the newest submissions are found at a glance (review of #562, UX «последняя заявка»). */
function NewMark({ request, now }: { request: RequestBoardItem; now: Date }) {
  if (!isNewRequest(request.createdAt, now)) return null
  return <Badge variant="secondary">новая</Badge>
}

function AgeText({ request, now }: { request: RequestBoardItem; now: Date }) {
  const age = requestAge(request.createdAt, now)
  const overdue = isOverdue(request.stage, age.days)
  return (
    <span
      data-overdue={overdue ? 'true' : undefined}
      className={overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}
    >
      {age.label}
    </span>
  )
}

/**
 * «На что» — what the AUTHOR wrote in bold, the number and the purpose muted
 * under it (`queueRowTitle`). The bold line is the row's named control: the
 * block owns its `TableRow`, so a whole-row click is outside its API (and is
 * what `lint:interaction-states` exists for).
 */
function TitleCell({
  request,
  onOpen,
  wrap,
}: {
  request: RequestBoardItem
  onOpen: (request: RequestBoardItem) => void
  wrap: boolean
}) {
  const { title, subtitle } = queueRowTitle(request)
  return (
    <div className="min-w-0">
      <Button
        variant="link"
        className={cn(
          'block h-auto max-w-full p-0 text-left font-medium text-foreground',
          wrap ? 'line-clamp-2 whitespace-normal' : 'truncate',
        )}
        aria-label={`Заявка №${request.id}: ${title}`}
        title={title}
        onClick={() => onOpen(request)}
      >
        {title}
      </Button>
      <span className="block truncate text-xs text-muted-foreground" title={subtitle}>
        {subtitle}
      </span>
    </div>
  )
}

function AmountCell({ request, context }: { request: RequestBoardItem; context: CellContext }) {
  const { currency, references } = context
  const shown = request.display[currency]
  const original = formatOriginalMoney(
    request.amount,
    request.currency,
    currencyPrecision(references.currencies, request.currency),
  )
  if (shown.kind === 'no_rate') {
    return (
      <>
        <span className="block font-medium">{original}</span>
        <span className="block text-xs text-muted-foreground">нет курса</span>
      </>
    )
  }
  return (
    <>
      <span className="block font-medium">
        {formatDisplayMoney(BigInt(shown.amount), currency)}
      </span>
      {request.currency === currency ? null : (
        <span className="block text-xs text-muted-foreground">{original}</span>
      )}
    </>
  )
}

function ActButton({
  request,
  act,
  onAct,
}: {
  request: RequestBoardItem
  act: QueueAct
  onAct: (request: RequestBoardItem, act: QueueAct) => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={actAccessibleName(act, request.id)}
      onClick={() => onAct(request, act)}
    >
      {ACT_LABEL[act]}
    </Button>
  )
}

/** What closed the request, as the phone's last line: «оплачено 29 окт.», «отказ: …». */
function OutcomeLine({ request, now }: { request: RequestBoardItem; now: Date }) {
  const outcome = queueOutcome(request)
  if (outcome === null) return null
  const text =
    outcome.kind === 'paid'
      ? `оплачено ${calendarDay(outcome.date, now)}`
      : `отказ: ${outcome.reason}`
  return (
    <span className="block truncate text-xs text-muted-foreground" title={text}>
      {text}
    </span>
  )
}

// ── the columns of one group ────────────────────────────────────────────────

/**
 * What the column before the amount carries in a group: the row act, the
 * payment date, the refusal reason — or nothing, and then there is no column.
 */
type GroupSlot = 'act' | 'paid' | 'refused' | null

function groupSlot(stage: QueueStage, canApprove: boolean): GroupSlot {
  if (queueRowAct(stage, canApprove) !== null) return 'act'
  if (stage === 'paid') return 'paid'
  if (stage === 'refused') return 'refused'
  return null
}

function sortableHeader(label: string, sortKey: QueueSortKey, alignEnd = false) {
  const Header = ({ column }: { column: Column<RequestBoardItem> }) => (
    <div className={cn('flex items-center gap-1', alignEnd && 'ml-auto')}>
      {label}
      <Sorter column={column} sortKey={sortKey} />
    </div>
  )
  Header.displayName = `QueueHeader(${sortKey})`
  return Header
}

function amountColumn(context: CellContext, size: number, withAct: boolean, stage: QueueStage) {
  const column: ColumnDef<RequestBoardItem> = {
    id: 'amount',
    size,
    header: sortableHeader('Сумма', 'amount', true),
    cell: ({ row }) => {
      const act = withAct ? queueRowAct(stage, true) : null
      return (
        <div className="space-y-1.5 text-right tabular-nums">
          <div>
            <AmountCell request={row.original} context={context} />
          </div>
          {act === null ? null : (
            <ActButton request={row.original} act={act} onAct={context.onAct} />
          )}
        </div>
      )
    },
  }
  return column
}

/** The phone row: one stacked cell, then the amount with its act under it. */
function narrowColumns(
  context: CellContext,
  stage: QueueStage,
  slot: GroupSlot,
): ColumnDef<RequestBoardItem>[] {
  const { now, onOpen } = context
  return [
    {
      id: 'filed',
      size: 210,
      header: sortableHeader('Заявка', 'filed'),
      cell: ({ row }) => {
        const request = row.original
        const payee = queuePayee(request)
        return (
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
              <span>{filedDay(request.createdAt, now)}</span>
              <span aria-hidden>·</span>
              <AgeText request={request} now={now} />
              <RequestSourceLink request={request} compact />
              <NewMark request={request} now={now} />
            </div>
            <span className="block truncate text-xs">
              {request.createdByName ?? '—'} → {payee.name}
              {payee.paidSelf ? (
                <span className="text-muted-foreground"> · заплатил(а) сам(а)</span>
              ) : null}
            </span>
            <TitleCell request={request} onOpen={onOpen} wrap />
            <OutcomeLine request={request} now={now} />
          </div>
        )
      },
    },
    amountColumn(context, 150, slot === 'act', stage),
  ]
}

function wideColumns(
  context: CellContext,
  stage: QueueStage,
  slot: GroupSlot,
): ColumnDef<RequestBoardItem>[] {
  const { now, onOpen, onAct } = context
  const columns: ColumnDef<RequestBoardItem>[] = [
    {
      id: 'filed',
      size: 130,
      header: sortableHeader('Подана', 'filed'),
      cell: ({ row }) => {
        const request = row.original
        return (
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
              <span>{filedDay(request.createdAt, now)}</span>
              <RequestSourceLink request={request} compact />
              <NewMark request={request} now={now} />
            </div>
            <span className="block text-xs">
              <AgeText request={request} now={now} />
            </span>
          </div>
        )
      },
    },
    {
      id: 'author',
      size: 140,
      header: sortableHeader('От кого', 'author'),
      cell: ({ row }) => (
        <span
          className="line-clamp-2 whitespace-normal break-words"
          title={row.original.createdByName}
        >
          {row.original.createdByName ?? '—'}
        </span>
      ),
    },
    {
      id: 'payee',
      size: 180,
      header: sortableHeader('Кому платим', 'payee'),
      cell: ({ row }) => {
        const payee = queuePayee(row.original)
        return (
          <div className="min-w-0">
            <span className="line-clamp-2 whitespace-normal break-words" title={payee.name}>
              {payee.name}
            </span>
            {payee.paidSelf ? (
              <span className="block text-xs text-muted-foreground">заплатил(а) сам(а)</span>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'purpose',
      size: 360,
      header: sortableHeader('На что', 'purpose'),
      cell: ({ row }) => <TitleCell request={row.original} onOpen={onOpen} wrap={false} />,
    },
  ]
  if (slot === 'act') {
    columns.push({
      id: 'act',
      size: 150,
      enableSorting: false,
      header: () => <span className="sr-only">Действие</span>,
      cell: ({ row }) => {
        const act = queueRowAct(stage, true)
        return act === null ? null : (
          <div className="flex justify-end">
            <ActButton request={row.original} act={act} onAct={onAct} />
          </div>
        )
      },
    })
  } else if (slot === 'paid' || slot === 'refused') {
    columns.push({
      id: 'outcome',
      size: slot === 'paid' ? 120 : 220,
      enableSorting: false,
      header: () => <span>{slot === 'paid' ? 'Оплачено' : 'Причина отказа'}</span>,
      cell: ({ row }) => {
        const outcome = queueOutcome(row.original)
        if (outcome === null) return <span className="text-muted-foreground">—</span>
        if (outcome.kind === 'paid') {
          return <span className="tabular-nums">{calendarDay(outcome.date, now)}</span>
        }
        return (
          <span className="line-clamp-2 whitespace-normal break-words" title={outcome.reason}>
            {outcome.reason}
          </span>
        )
      },
    })
  }
  columns.push(amountColumn(context, 150, false, stage))
  return columns
}

// ── one group's table ───────────────────────────────────────────────────────

/**
 * One group through the whitelist's List block. The block is driven by
 * `useTable` as the whitelist settles; what this screen gives it is the rows of
 * the ONE snapshot it already holds (`data`) and the page's shared order, so
 * the hook's own list read is switched off — a group is a slice of a moment
 * the screen has, never a second read of it — and the pager is not drawn: a
 * group is the whole set of requests at one stage.
 */
function QueueGroupTable({
  rows,
  columns,
  sort,
  onSort,
}: {
  rows: RequestBoardItem[]
  columns: ColumnDef<RequestBoardItem>[]
  sort: QueueSort
  onSort: (next: QueueSort) => void
}) {
  const sorting = React.useMemo<SortingState>(() => [{ id: sort.key, desc: sort.desc }], [sort])
  const onSortingChange = React.useCallback(
    (updater: Updater<SortingState>) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      // The sorter toggles in multi mode; the column it touched is the one that
      // is not the current key, or the current key itself flipped.
      const touched = next.find((entry) => entry.id !== sort.key) ?? next[0]
      onSort(
        touched === undefined
          ? DEFAULT_QUEUE_SORT
          : { key: touched.id as QueueSortKey, desc: touched.desc },
      )
    },
    [onSort, sort.key, sorting],
  )

  const table = useTable<RequestBoardItem, HttpError>({
    columns,
    data: rows,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableSortingRemoval: false,
    refineCoreProps: {
      resource: REQUESTS_RESOURCE,
      pagination: { mode: 'off' },
      filters: { mode: 'off' },
      sorters: { mode: 'off' },
      queryOptions: { enabled: false },
    },
  })

  return <DataTable table={table} paginated={false} />
}

function QueueGroup({
  stage,
  rows,
  isCollapsed,
  onToggle,
  context,
  canApprove,
  narrow,
  sort,
  onSort,
}: {
  stage: QueueStage
  rows: RequestBoardItem[]
  isCollapsed: boolean
  onToggle: () => void
  context: CellContext
  canApprove: boolean
  narrow: boolean
  sort: QueueSort
  onSort: (next: QueueSort) => void
}) {
  const group = QUEUE_GROUPS[stage]
  const { currency, now } = context
  const sum = sumInDisplay(rows, currency)
  const slot = groupSlot(stage, canApprove)
  const columns = React.useMemo(
    () => (narrow ? narrowColumns(context, stage, slot) : wideColumns(context, stage, slot)),
    [context, narrow, slot, stage],
  )
  const fresh = rows.filter((request) => isNewRequest(request.createdAt, now)).length
  return (
    <section aria-label={group.title} className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-heading text-base font-semibold">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={!isCollapsed}
            onClick={onToggle}
            className="-ml-2 gap-1 px-2 text-base font-semibold aria-expanded:bg-transparent hover:bg-muted"
          >
            {isCollapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
            {group.title}
          </Button>
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">{rows.length}</span>
        {fresh === 0 ? null : <Badge variant="secondary">{newCountLabel(fresh)}</Badge>}
        {group.hint === '' ? null : (
          <span className="hidden text-sm text-muted-foreground md:inline">{group.hint}</span>
        )}
        {rows.length === 0 ? null : (
          // `pr-2` is the block's cell padding: the heading's sum ends where
          // the amounts of its rows end — the last column of every group.
          <span className="ml-auto pr-2 text-right text-sm font-medium tabular-nums">
            <SumText sum={sum} currency={currency} stacked={narrow} />
          </span>
        )}
      </div>
      {isCollapsed ? null : rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Ничего нет</p>
      ) : (
        <QueueGroupTable rows={rows} columns={columns} sort={sort} onSort={onSort} />
      )}
    </section>
  )
}

// ── the screen ──────────────────────────────────────────────────────────────

const ALL = 'all'

export function RequestsQueue({
  requests,
  references,
  canApprove,
  fx,
  toolbarEnd,
  onOpen,
  onAct,
}: RequestsQueueProps) {
  const [scope, setScope] = React.useState<QueueScope>(DEFAULT_QUEUE_SCOPE)
  const [kpi, setKpi] = React.useState<QueueStage | null>(null)
  const [filters, setFilters] = React.useState<QueueFilters>(EMPTY_QUEUE_FILTERS)
  const [sort, setSort] = React.useState<QueueSort>(DEFAULT_QUEUE_SORT)
  const [collapsed, setCollapsed] = React.useState<Partial<Record<QueueStage, boolean>>>({})
  const stored = React.useSyncExternalStore(
    subscribeStoredCurrency,
    readStoredCurrency,
    serverStoredCurrency,
  )
  const currency = parseStoredDisplayCurrency(stored)
  const narrow = useNarrow()
  // One clock for the page: every age on it is measured from the same instant.
  const [now] = React.useState(() => new Date())

  const kpis = React.useMemo(() => queueKpis(requests, currency), [requests, currency])
  const visible = React.useMemo(
    () => filterQueueRows(requests, filters, { scope, now }),
    [requests, filters, scope, now],
  )
  const authors = React.useMemo(() => queueAuthors(requests), [requests])
  const stale = rateStaleness(fx.latestRateDate, fx.today)
  const context = React.useMemo<CellContext>(
    () => ({ currency, now, references, onOpen, onAct }),
    [currency, now, references, onOpen, onAct],
  )

  const stages = queueGroupStages(scope, kpi)

  return (
    <div className="space-y-6">
      {/* THE THREE SUMS (EARS-537) — over every request, whatever is searched
          or filtered; a click shows only that group, a second click restores
          the scope. Type, not cards: the prototype draws them bare. On a phone
          they sit in one row, so the first request is not a screen away. */}
      <div role="group" aria-label="Итоги очереди" className="grid grid-cols-3 gap-2 sm:gap-8">
        {kpis.map((entry) => {
          const on = kpi === entry.stage
          return (
            <Button
              key={entry.stage}
              variant="ghost"
              aria-pressed={on}
              onClick={() => setKpi(on ? null : entry.stage)}
              className="-mx-2 h-auto min-w-0 flex-col items-start gap-0.5 px-2 py-1.5 text-left font-normal whitespace-normal"
            >
              <span
                className={cn(
                  'text-xs sm:text-sm',
                  on ? 'text-foreground underline underline-offset-4' : 'text-muted-foreground',
                )}
              >
                {entry.label}
              </span>
              <span className="font-heading text-base font-semibold tracking-tight tabular-nums sm:text-2xl">
                <SumText sum={entry.sum} currency={currency} stacked={narrow} />
              </span>
              <span className="text-xs text-muted-foreground sm:text-sm">
                {requestCountLabel(entry.sum.count)}
              </span>
            </Button>
          )
        })}
      </div>

      {stale === null ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {stale.kind === 'none'
            ? 'Курсов ЦБ в базе нет — суммы в другой валюте не пересчитаны.'
            : `Курсы ЦБ устарели: последние от ${formatDate(stale.since)}.`}
        </p>
      )}

      {/* ONE TOOLBAR, the prototype's: what to look for on the left, how to show
          it on the right. When the row is too narrow for both it breaks as two
          whole halves — the filters, then the switches — never control by
          control. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Input
            type="search"
            aria-label="Поиск по заявкам"
            placeholder="Поиск: кто, кому, на что, №"
            value={filters.query}
            onChange={(event) =>
              setFilters((current) => ({ ...current, query: event.target.value }))
            }
            className="w-full sm:w-60"
          />
          <Select
            value={filters.author === null ? ALL : String(filters.author)}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,
                author: value === ALL ? null : Number(value),
              }))
            }
          >
            <SelectTrigger aria-label="Заявитель" className="min-w-0 flex-1 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все заявители</SelectItem>
              {authors.map((author) => (
                <SelectItem key={author.id} value={String(author.id)}>
                  {author.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.project === null ? ALL : String(filters.project)}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,
                project: value === ALL ? null : Number(value),
              }))
            }
          >
            <SelectTrigger aria-label="Проект" className="min-w-0 flex-1 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все проекты</SelectItem>
              {references.projects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.period}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, period: value as QueuePeriod }))
            }
          >
            <SelectTrigger aria-label="Период" className="min-w-0 flex-1 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUEUE_PERIODS.map((period) => (
                <SelectItem key={period.value} value={period.value}>
                  {period.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={currency}
            onValueChange={(next) => writeStoredCurrency(parseStoredDisplayCurrency(next))}
          >
            <TabsList aria-label="Валюта отображения">
              {DISPLAY_CURRENCIES.map((option) => (
                <TabsTrigger key={option.code} value={option.code}>
                  {option.symbol}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs
            value={scope}
            onValueChange={(next) => {
              setScope(next as QueueScope)
              setKpi(null)
            }}
          >
            <TabsList aria-label="Какие заявки">
              {QUEUE_SCOPES.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {toolbarEnd}
        </div>
      </div>

      {stages.map((stage) => (
        <QueueGroup
          key={stage}
          stage={stage}
          rows={queueGroupRows(visible, stage, sort, currency)}
          isCollapsed={kpi === null && (collapsed[stage] ?? QUEUE_GROUPS[stage].collapsedByDefault)}
          onToggle={() =>
            setCollapsed((current) => ({
              ...current,
              [stage]: !(current[stage] ?? QUEUE_GROUPS[stage].collapsedByDefault),
            }))
          }
          context={context}
          canApprove={canApprove}
          narrow={narrow}
          sort={sort}
          onSort={setSort}
        />
      ))}
    </div>
  )
}
