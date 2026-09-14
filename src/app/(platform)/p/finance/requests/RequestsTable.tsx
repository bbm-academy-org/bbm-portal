'use client'

import React from 'react'

import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

import { formatDate, REQUEST_STATUS_LABELS } from './constants'
import type { RequestBoardItem, RequestBoardReferences } from './request-board-contract'
import {
  currencyPrecision,
  formatRequestMoney,
  type FinanceRequestBoardAct,
} from './request-board-model'
import { requestRowActs, tableShowsRefusalReason } from './request-table-model'

const ACT_LABELS: Record<FinanceRequestBoardAct, string> = {
  approve: 'Одобрить',
  refuse: 'Отклонить…',
  confirm: 'Провести',
}

/**
 * THE DEFAULT VIEW OF `/p/finance/requests` — owner decision 35 (Антон,
 * 2026-09-14, #115), PRD 339 US-2/US-3.
 *
 * COMPOSITION (the agent's call; the visual source is the adopted standard
 * system, `design-source/README.md`'s `system:` row at `fidelity: visual`).
 * ONE object dominates: the list of requests, full width, nothing beside it.
 * Where the kanban answers «what is waiting for MY decision», the table answers
 * «what happened to this request» — a question every member has and only a
 * chronological list answers, which is why it is the view the route opens on
 * and the board is now the approver's alternative.
 *
 * THE COLUMNS ARE THE OWNER'S SIX, in reading order: when, who, how much, what
 * for, where it stands, and — when there is one to read — why it was refused.
 * «Назначение» carries the free-text note under the purpose because that is
 * what a member recognises their own request by; the purpose alone reads as a
 * category, not as «my microphone».
 *
 * REUSE. The kit's `@/ui/table` primitives, not the Refine `data-table` block
 * of `docs/design/ui-whitelist.md` — that block is driven by `useTable` over a
 * paged RESOURCE, and this surface reads ONE snapshot through `useCustom`
 * because a board that fetched five collections would render five different
 * moments of the same ledger (`request-board-provider.ts` refuses `getList` on
 * purpose). Adopting the block would mean bending the endpoint into a resource
 * it is not, for a pager over rows that already all arrived.
 *
 * NOTHING HERE IS A BOUNDARY. Reading is open to every platform member
 * (EARS-530), and every act is re-refused by the module itself (EARS-501).
 */
export function RequestsTable({
  rows,
  references,
  canApprove,
  onOpen,
  onAct,
}: {
  rows: readonly RequestBoardItem[]
  references: RequestBoardReferences
  canApprove: boolean
  onOpen: (request: RequestBoardItem) => void
  onAct: (request: RequestBoardItem, act: FinanceRequestBoardAct) => void
}) {
  const withReason = tableShowsRefusalReason(rows)

  return (
    <div className="space-y-3">
      {/* The remaining columns are a swipe away on a phone: the kit's container
          scrolls, but an overlay scrollbar says nothing while it is idle, so
          the surface says it in words below `sm`. */}
      <p className="text-sm text-muted-foreground sm:hidden">
        Таблица прокручивается вбок: сумма, статус и решение — правее.
      </p>
      <Table className="min-w-[46rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead>Кто подал</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead>Назначение</TableHead>
            <TableHead>Статус</TableHead>
            {withReason ? <TableHead>Причина отказа</TableHead> : null}
            {canApprove ? (
              <TableHead>
                <span className="sr-only">Решение</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((request) => {
            const acts = requestRowActs(request, canApprove)
            return (
              <TableRow
                key={request.id}
                // The whole row is the pointer target — a table whose rows open
                // something and look inert is the row-action defect of #433 in
                // another shape. The keyboard reaches the same act through the
                // named control in «Назначение», which is why that one is a
                // real button and not a styled span.
                onClick={() => onOpen(request)}
                className="cursor-pointer"
              >
                <TableCell className="tabular-nums">
                  {request.occurredOn === null ? (
                    <span className="text-muted-foreground">не двигались</span>
                  ) : (
                    formatDate(request.occurredOn)
                  )}
                </TableCell>
                <TableCell className="max-w-[18ch] whitespace-normal">
                  {request.createdByName ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRequestMoney(
                    request.amount,
                    request.currency,
                    currencyPrecision(references.currencies, request.currency),
                  )}
                </TableCell>
                <TableCell className="max-w-[28ch] whitespace-normal">
                  <Button
                    variant="link"
                    aria-label={`Заявка №${request.id}`}
                    className="h-auto justify-start p-0 text-left font-normal whitespace-normal"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(request)
                    }}
                  >
                    {request.purpose?.name ?? 'Назначение предложено'}
                  </Button>
                  {request.note === null ? null : (
                    <span className="block text-xs text-muted-foreground">{request.note}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{REQUEST_STATUS_LABELS[request.status]}</Badge>
                </TableCell>
                {withReason ? (
                  <TableCell className="max-w-[24ch] whitespace-normal">
                    {request.refusalReason ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                ) : null}
                {canApprove ? (
                  <TableCell className="text-right">
                    {acts.length === 0 ? null : (
                      <div className="flex justify-end gap-2">
                        {acts.map((act) => (
                          <Button
                            key={act}
                            variant={act === 'approve' ? 'default' : 'outline'}
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              onAct(request, act)
                            }}
                          >
                            {ACT_LABELS[act]}
                          </Button>
                        ))}
                      </div>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
