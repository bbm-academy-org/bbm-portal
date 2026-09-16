'use client'

import type { HttpError } from '@refinedev/core'
import { useTable } from '@refinedev/react-table'
import type { Column, ColumnDef } from '@tanstack/react-table'
import React from 'react'

import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DataTable } from '@/ui/refine-ui/data-table/data-table'
import { DataTableSorter } from '@/ui/refine-ui/data-table/data-table-sorter'

import {
  formatDate,
  REQUESTS_RESOURCE,
  REQUEST_STATUS_BADGE_VARIANT,
  REQUEST_STATUS_LABELS,
} from './constants'
import type { RequestBoardItem, RequestBoardReferences } from './request-board-contract'
import {
  currencyPrecision,
  formatRequestMoney,
  requestPurposeLabel,
  type FinanceRequestBoardAct,
} from './request-board-model'
import {
  REQUEST_TABLE_NO_MOVEMENT_LABEL,
  requestAmountTotals,
  requestRowActs,
  requestTableColumnPlan,
  requestTableRows,
  type RequestTableColumnId,
  type RequestTableScope,
} from './request-table-model'

const PAGE_SIZE = 25

const ACT_LABELS: Record<FinanceRequestBoardAct, string> = {
  approve: 'Одобрить',
  refuse: 'Отклонить…',
  confirm: 'Провести',
}

/** The kit's sorter, with the aria text this kit has no i18n layer to give it. */
function Sorter({ column, label }: { column: Column<RequestBoardItem>; label: string }) {
  return <DataTableSorter column={column} title={label} aria-label={label} />
}

/**
 * THE DEFAULT VIEW OF `/p/finance/requests` — owner decision 35 (Антон,
 * 2026-09-14, #115), PRD 339 US-2/US-3, rebuilt on the whitelist's List block
 * on 2026-09-15 (owner acceptance of the same day, #388 wave 3).
 *
 * REUSE — the ladder, honestly climbed this time. `docs/design/ui-whitelist.md`
 * SETTLES «a register of records with paging» as the Refine `data-table` block
 * driven by `useTable`, and a settled row is an IMPORT, not a bespoke
 * candidate. The justification this file used to carry — «the block wants a
 * paged resource and this surface reads one snapshot through `useCustom`» — is
 * withdrawn: TanStack accepts any array, and the provider now answers `getList`
 * from that same snapshot (`request-board-provider.ts`). What is left for this
 * screen is exactly what the whitelist row says is left: its `ColumnDef[]`. The
 * head, the rows, the loading skeleton, the empty state, the pager and (since
 * #388) the totals row are the block's.
 *
 * THE COLUMNS, in reading order: when, who, how much, what for, where it
 * stands. «Назначение» carries the free-text note under the purpose because
 * that is what a member recognises their own request by; the purpose alone
 * reads as a category, not as «my microphone». WHICH of them this reader gets,
 * and what each may cost in width, is `requestTableColumnPlan`'s answer — «Кто
 * подал» is off the table under «Мои», and the refusal reason is the second
 * line of the status cell rather than a seventh column (#388 defect B, eyes-on
 * matrix of 2026-09-16: at 1440 px the seven-column table overflowed its
 * container and the row's «Открыть» was never painted).
 *
 * AN HONEST DATE HEADER (owner acceptance 2026-09-15). The column used to
 * promise «Дата» and answer «не двигались» for a pre-spend intent. The header
 * now names what the value IS — «Деньги ушли» — so an empty answer answers the
 * question that was asked. The column is deliberately NOT split: the contract
 * carries no filing date to put in a second column (EARS-533 gives a request
 * one date, and only once the money moves), so splitting would invent a value.
 *
 * ROWS ARE THE BLOCK'S, AND SO IS OPENING ONE. The block renders its own
 * `TableRow`; hanging an `onClick` on that primitive is outside the block's API
 * and is the interaction-state defect `pnpm lint:interaction-states` is written
 * for. Each row therefore carries a NAMED «Открыть» control — one target,
 * reachable by pointer and by keyboard — and no hover underline anywhere.
 *
 * NOTHING HERE IS A BOUNDARY. Reading is open to every platform member
 * (EARS-530), and every act is re-refused by the module itself (EARS-501).
 */
type RequestsTableProps = {
  /** The whole register this reader may see — the footer adds up ALL of it. */
  requests: readonly RequestBoardItem[]
  references: RequestBoardReferences
  canApprove: boolean
  scope: RequestTableScope
  onOpen: (request: RequestBoardItem) => void
  onAct: (request: RequestBoardItem, act: FinanceRequestBoardAct) => void
}

/**
 * A NEW SCOPE IS A NEW REGISTER, AND A NEW REGISTER IS A REMOUNT (#388 defect
 * A, eyes-on matrix of 2026-09-16).
 *
 * `useTable` seeds Refine's filter STATE once, at mount —
 * `useState(setInitialFilters(preferredPermanentFilters, defaultFilter ?? []))`
 * in `@refinedev/core@5.0.12` — and every later query is
 * `unionFilters(preferredPermanentFilters, filters)`. A change of `permanent`
 * therefore ADDS to that state and never removes what is already in it: the
 * `own eq true` seeded for «Мои» survived «Все» forever, so the provider was
 * asked for the reader's own rows under both scopes while the footer summed the
 * whole register. Keying the hook's component on the scope re-seeds that state
 * from scratch, which is the only thing that clears it.
 *
 * The alternative — driving the scope with `setFilters([...], 'replace')` — was
 * rejected for the reason the withdrawn comment below already names:
 * `@refinedev/react-table` mirrors TanStack's `columnFilters` into Refine's
 * filters on every render, so an imperatively pushed filter is overwritten by
 * the empty column state before the query runs. The scope is not a column
 * filter; it stays `permanent`, and the remount is what makes `permanent` mean
 * what it says.
 *
 * The remount also answers the paging question for free: page 2 of the previous
 * scope means nothing, and a fresh mount starts at page 1 without an effect.
 */
export function RequestsTable(props: RequestsTableProps) {
  return <RequestsRegister key={props.scope} {...props} />
}

function RequestsRegister({
  requests,
  references,
  canApprove,
  scope,
  onOpen,
  onAct,
}: RequestsTableProps) {
  // The register as the scope narrows it — what the totals row adds up, and
  // what decides whether the refusal column is on the table at all. Both are
  // questions about the WHOLE register, so neither may be answered from the
  // page the block happens to be showing.
  const scoped = React.useMemo(() => requestTableRows(requests, scope), [requests, scope])
  const totals = React.useMemo(() => requestAmountTotals(scoped), [scoped])

  const columns = React.useMemo<ColumnDef<RequestBoardItem>[]>(() => {
    // The DEFINITIONS, by id. Which of them are on this reader's table, in
    // which order, and what each is allowed to cost is the PLAN's answer
    // (`requestTableColumnPlan`) — one place where the desktop width budget of
    // #388 defect B can be read and checked.
    const byId: Record<RequestTableColumnId, ColumnDef<RequestBoardItem>> = {
      occurredOn: {
        id: 'occurredOn',
        accessorKey: 'occurredOn',
        header: ({ column }) => (
          <>
            Деньги ушли
            <Sorter column={column} label="Сортировать по дате движения денег" />
          </>
        ),
        // «Итого» labels the footer row; the sum itself stands under «Сумма».
        footer: () => <span className="font-medium">Итого</span>,
        cell: ({ row }) =>
          row.original.occurredOn === null ? (
            <span className="text-muted-foreground">{REQUEST_TABLE_NO_MOVEMENT_LABEL}</span>
          ) : (
            <span className="tabular-nums">{formatDate(row.original.occurredOn)}</span>
          ),
      },
      createdByName: {
        id: 'createdByName',
        accessorKey: 'createdByName',
        header: ({ column }) => (
          <>
            Кто подал
            <Sorter column={column} label="Сортировать по подавшему" />
          </>
        ),
        cell: ({ row }) => row.original.createdByName ?? '—',
      },
      amount: {
        id: 'amount',
        accessorKey: 'amount',
        header: ({ column }) => (
          <>
            Сумма
            <Sorter column={column} label="Сортировать по сумме" />
          </>
        ),
        footer: () => (
          <div className="space-y-0.5 text-right font-medium tabular-nums">
            {totals.length === 0
              ? '—'
              : totals.map((total) => (
                  <div key={total.currency}>
                    {formatRequestMoney(
                      total.amount,
                      total.currency,
                      currencyPrecision(references.currencies, total.currency),
                    )}
                  </div>
                ))}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {formatRequestMoney(
              row.original.amount,
              row.original.currency,
              currencyPrecision(references.currencies, row.original.currency),
            )}
          </div>
        ),
      },
      purpose: {
        id: 'purpose',
        header: ({ column }) => (
          <>
            Назначение
            <Sorter column={column} label="Сортировать по назначению" />
          </>
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block truncate font-medium" title={requestPurposeLabel(row.original)}>
              {requestPurposeLabel(row.original)}
            </span>
            {row.original.note === null ? null : (
              <span className="block truncate text-xs text-muted-foreground">
                {row.original.note}
              </span>
            )}
          </div>
        ),
      },
      status: {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => (
          <>
            Статус
            <Sorter column={column} label="Сортировать по статусу" />
          </>
        ),
        // THE REFUSAL REASON LIVES HERE, not in a column of its own (#388
        // defect B): it explains this badge and nothing else, and a seventh
        // column pushed the row's «Открыть» off a 1440 px screen. The full
        // text is always one «Открыть» away, in the details sheet.
        cell: ({ row }) => (
          <div className="min-w-0 space-y-1">
            <Badge variant={REQUEST_STATUS_BADGE_VARIANT[row.original.status]}>
              {REQUEST_STATUS_LABELS[row.original.status]}
            </Badge>
            {row.original.refusalReason === null ? null : (
              <span
                className="block truncate text-xs text-muted-foreground"
                title={row.original.refusalReason}
              >
                {row.original.refusalReason}
              </span>
            )}
          </div>
        ),
      },
      actions: {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="sr-only">Действия</span>,
        cell: ({ row }) => {
          const request = row.original
          return (
            <div className="flex justify-end gap-2">
              {requestRowActs(request, canApprove).map((act) => (
                <Button
                  key={act}
                  variant={act === 'approve' ? 'default' : 'outline'}
                  size="sm"
                  aria-label={`${ACT_LABELS[act]} заявку №${request.id}`}
                  onClick={() => onAct(request, act)}
                >
                  {ACT_LABELS[act]}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Заявка №${request.id}`}
                onClick={() => onOpen(request)}
              >
                Открыть
              </Button>
            </div>
          )
        },
      },
    }

    return requestTableColumnPlan({ scope, canApprove }).map((column) => ({
      ...byId[column.id],
      size: column.size,
    }))
  }, [canApprove, onAct, onOpen, references.currencies, scope, totals])

  const table = useTable<RequestBoardItem, HttpError>({
    columns,
    refineCoreProps: {
      resource: REQUESTS_RESOURCE,
      pagination: { pageSize: PAGE_SIZE },
      // PERMANENT, not `setFilters` — and re-seeded by the remount above, which
      // is what makes a change of scope reach the provider at all.
      filters: {
        permanent: scope === 'mine' ? [{ field: 'own', operator: 'eq', value: true }] : [],
      },
    },
  })

  return (
    <div className="space-y-3">
      {/* The block owns the scroll container; what it cannot own is that an
          overlay scrollbar says nothing while it is idle. The remaining columns
          are a swipe away on a phone, so the surface says it in words below
          `sm` — the same fix the previous round shipped, kept because the
          reader's problem did not change with the markup. */}
      <p className="text-sm text-muted-foreground sm:hidden">
        Таблица прокручивается вбок: сумма, статус и решение — правее.
      </p>
      <DataTable
        table={table}
        emptyTitle={scope === 'mine' ? 'Вы ещё не подавали заявок' : 'Заявок пока нет'}
        emptyDescription={
          scope === 'mine'
            ? 'Всё, что вы подадите, появится здесь — включая черновики и отозванное.'
            : 'Первая заявка появится здесь, как только кто-нибудь её подаст.'
        }
      />
    </div>
  )
}
