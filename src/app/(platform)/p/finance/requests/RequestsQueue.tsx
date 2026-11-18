'use client'

import type { HttpError } from '@refinedev/core'
import { useTable } from '@refinedev/react-table'
import type { Column, ColumnDef, SortingState, Updater } from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import React from 'react'

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
import { currencyPrecision, formatRequestMoney, requestPurposeLabel } from './request-board-model'
import {
  DEFAULT_QUEUE_SCOPE,
  DEFAULT_QUEUE_SORT,
  DISPLAY_CURRENCIES,
  DISPLAY_CURRENCY_STORAGE_KEY,
  EMPTY_QUEUE_FILTERS,
  filterQueueRows,
  formatDisplayMoney,
  isOverdue,
  missingRateNote,
  parseStoredDisplayCurrency,
  QUEUE_GROUPS,
  QUEUE_PERIODS,
  QUEUE_SCOPES,
  queueAuthors,
  queueGroupRows,
  queueGroupStages,
  queueKpis,
  queuePayee,
  queueRowAct,
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

function SumText({ sum, currency }: { sum: QueueSum; currency: DisplayCurrencyCode }) {
  const note = missingRateNote(sum.missing)
  return (
    <>
      {sum.amount === null ? '—' : formatDisplayMoney(sum.amount, currency)}
      {note === null ? null : (
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{note}</span>
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
  // One clock for the page: every age on it is measured from the same instant.
  const [now] = React.useState(() => new Date())

  const kpis = React.useMemo(() => queueKpis(requests, currency), [requests, currency])
  const visible = React.useMemo(
    () => filterQueueRows(requests, filters, { scope, now }),
    [requests, filters, scope, now],
  )
  const authors = React.useMemo(() => queueAuthors(requests), [requests])
  const stale = rateStaleness(fx.latestRateDate, fx.today)

  const columns = React.useMemo<ColumnDef<RequestBoardItem>[]>(() => {
    const defined: ColumnDef<RequestBoardItem>[] = [
      {
        id: 'filed',
        size: 130,
        header: ({ column }) => (
          <>
            Подана
            <Sorter column={column} sortKey="filed" />
          </>
        ),
        cell: ({ row }) => {
          const request = row.original
          const age = requestAge(request.createdAt, now)
          const overdue = isOverdue(request.stage, age.days)
          return (
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                <span>{filedDay(request.createdAt, now)}</span>
                <RequestSourceLink request={request} compact />
              </div>
              <span
                data-overdue={overdue ? 'true' : undefined}
                className={cn(
                  'block text-xs',
                  overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                )}
              >
                {age.label}
              </span>
            </div>
          )
        },
      },
      {
        id: 'author',
        size: 150,
        header: ({ column }) => (
          <>
            От кого
            <Sorter column={column} sortKey="author" />
          </>
        ),
        cell: ({ row }) => (
          <span className="block truncate" title={row.original.createdByName}>
            {row.original.createdByName ?? '—'}
          </span>
        ),
      },
      {
        id: 'payee',
        size: 170,
        header: ({ column }) => (
          <>
            Кому платим
            <Sorter column={column} sortKey="payee" />
          </>
        ),
        cell: ({ row }) => {
          const payee = queuePayee(row.original)
          return (
            <div className="min-w-0">
              <span className="block truncate" title={payee.name}>
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
        size: 320,
        header: ({ column }) => (
          <>
            На что
            <Sorter column={column} sortKey="purpose" />
          </>
        ),
        // OPENING A ROW IS A NAMED CONTROL. The block owns its `TableRow`, so a
        // whole-row click is outside its API (and is what
        // `lint:interaction-states` exists for); the purpose — what a reader
        // recognises a request by — is the control, named with the number.
        cell: ({ row }) => {
          const request = row.original
          const label = requestPurposeLabel(request)
          return (
            <div className="min-w-0">
              <Button
                variant="link"
                className="block h-auto max-w-full truncate p-0 text-left font-medium text-foreground"
                aria-label={`Заявка №${request.id}: ${label}`}
                title={label}
                onClick={() => onOpen(request)}
              >
                {label}
              </Button>
              {request.note === null ? null : (
                <span className="block truncate text-xs text-muted-foreground" title={request.note}>
                  {request.note}
                </span>
              )}
            </div>
          )
        },
      },
      {
        id: 'amount',
        size: 150,
        header: ({ column }) => (
          <div className="ml-auto flex items-center gap-1">
            Сумма
            <Sorter column={column} sortKey="amount" />
          </div>
        ),
        cell: ({ row }) => {
          const request = row.original
          const shown = request.display[currency]
          const original = formatRequestMoney(
            request.amount,
            request.currency,
            currencyPrecision(references.currencies, request.currency),
          )
          if (shown.kind === 'no_rate') {
            return (
              <div className="text-right tabular-nums">
                <span className="block font-medium">{original}</span>
                <span className="block text-xs text-muted-foreground">нет курса</span>
              </div>
            )
          }
          return (
            <div className="text-right tabular-nums">
              <span className="block font-medium">
                {formatDisplayMoney(BigInt(shown.amount), currency)}
              </span>
              {request.currency === currency ? null : (
                <span className="block text-xs text-muted-foreground">{original}</span>
              )}
            </div>
          )
        },
      },
    ]
    if (canApprove) {
      defined.push({
        id: 'act',
        size: 170,
        enableSorting: false,
        header: () => <span className="sr-only">Действие</span>,
        cell: ({ row }) => {
          const act = queueRowAct(row.original.stage, canApprove)
          if (act === null) return null
          return (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                aria-label={actAccessibleName(act, row.original.id)}
                onClick={() => onAct(row.original, act)}
              >
                {ACT_LABEL[act]}
              </Button>
            </div>
          )
        },
      })
    }
    return defined
  }, [canApprove, currency, now, onAct, onOpen, references.currencies])

  const stages = queueGroupStages(scope, kpi)

  return (
    <div className="space-y-6">
      {/* THE THREE SUMS (EARS-537) — over every request, whatever is searched
          or filtered; a click shows only that group, a second click restores
          the scope. Type, not cards: the prototype draws them bare. */}
      <div role="group" aria-label="Итоги очереди" className="grid gap-4 sm:grid-cols-3 sm:gap-8">
        {kpis.map((entry) => {
          const on = kpi === entry.stage
          return (
            <Button
              key={entry.stage}
              variant="ghost"
              aria-pressed={on}
              onClick={() => setKpi(on ? null : entry.stage)}
              className="-mx-2 h-auto flex-col items-start gap-0.5 px-2 py-1.5 text-left font-normal whitespace-normal"
            >
              <span
                className={cn(
                  'text-sm',
                  on ? 'text-foreground underline underline-offset-4' : 'text-muted-foreground',
                )}
              >
                {entry.label}
              </span>
              <span className="font-heading text-2xl font-semibold tracking-tight tabular-nums">
                <SumText sum={entry.sum} currency={currency} />
              </span>
              <span className="text-sm text-muted-foreground">
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
          it on the right. It wraps on a narrow screen rather than scrolling. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Поиск по заявкам"
          placeholder="Поиск: кто, кому, на что, № заявки"
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          className="w-full sm:w-72"
        />
        <Select
          value={filters.author === null ? ALL : String(filters.author)}
          onValueChange={(value) =>
            setFilters((current) => ({ ...current, author: value === ALL ? null : Number(value) }))
          }
        >
          <SelectTrigger aria-label="Заявитель" className="min-w-0">
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
            setFilters((current) => ({ ...current, project: value === ALL ? null : Number(value) }))
          }
        >
          <SelectTrigger aria-label="Проект" className="min-w-0">
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
          <SelectTrigger aria-label="Период" className="min-w-0">
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
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
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

      {stages.map((stage) => {
        const group = QUEUE_GROUPS[stage]
        const rows = queueGroupRows(visible, stage, sort, currency)
        const isCollapsed = kpi === null && (collapsed[stage] ?? group.collapsedByDefault)
        const sum = sumInDisplay(rows, currency)
        return (
          <section key={stage} aria-label={group.title} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-heading text-base font-semibold">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((current) => ({ ...current, [stage]: !isCollapsed }))}
                  className="-ml-2 gap-1 px-2 text-base font-semibold aria-expanded:bg-transparent hover:bg-muted"
                >
                  {isCollapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
                  {group.title}
                </Button>
              </h2>
              <span className="text-sm text-muted-foreground tabular-nums">{rows.length}</span>
              {group.hint === '' ? null : (
                <span className="hidden text-sm text-muted-foreground md:inline">{group.hint}</span>
              )}
              {rows.length === 0 ? null : (
                <span className="ml-auto text-sm font-medium tabular-nums">
                  <SumText sum={sum} currency={currency} />
                </span>
              )}
            </div>
            {isCollapsed ? null : rows.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Ничего нет</p>
            ) : (
              <QueueGroupTable rows={rows} columns={columns} sort={sort} onSort={setSort} />
            )}
          </section>
        )
      })}
    </div>
  )
}
