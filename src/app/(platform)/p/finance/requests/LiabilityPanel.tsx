'use client'

import type { HttpError } from '@refinedev/core'
import { useTable } from '@refinedev/react-table'
import type { Column, ColumnDef } from '@tanstack/react-table'
import React from 'react'

import { DataTable } from '@/ui/refine-ui/data-table/data-table'
import { DataTableSorter } from '@/ui/refine-ui/data-table/data-table-sorter'

import { LIABILITIES_RESOURCE } from './constants'
import type { RequestBoardReferences, RequestsSnapshot } from './request-board-contract'
import { currencyPrecision, formatRequestMoney } from './request-board-model'
import { requestAmountTotals } from './request-table-model'

type LiabilityRow = RequestsSnapshot['liabilities'][number] & { id: string }

/**
 * «Обязательства» (EARS-527) — what BBM currently owes its members.
 *
 * IT IS A VIEW BESIDE THE BOARD, NOT A FIFTH COLUMN, and the wireframe says why
 * in one line: this is a state of the accounts, not a stage of a request. A
 * member is owed money because of requests that are already `posted` — putting
 * the debt on the board would mix a balance into a queue.
 *
 * REUSE (#388 wave 3). A register of records is the whitelist's List block
 * (`docs/design/ui-whitelist.md` → «List»), so this panel no longer hand-builds
 * a `<Table>` out of `@/ui` primitives either: it declares two columns and the
 * block does the rest — head, rows, skeleton, empty state, pager, and the
 * totals row that answers the one question a debt register exists for, «сколько
 * всего мы должны».
 */
export function LiabilityPanel({
  liabilities,
  references,
}: {
  liabilities: RequestsSnapshot['liabilities']
  references: RequestBoardReferences
}) {
  const totals = React.useMemo(
    () =>
      requestAmountTotals(
        liabilities.map((liability) => ({
          amount: liability.balance,
          currency: liability.currency,
        })),
      ),
    [liabilities],
  )

  const columns = React.useMemo<ColumnDef<LiabilityRow>[]>(
    () => [
      {
        id: 'memberName',
        accessorKey: 'memberName',
        header: ({ column }: { column: Column<LiabilityRow> }) => (
          <>
            Участник
            <DataTableSorter
              column={column}
              title="Сортировать по участнику"
              aria-label="Сортировать по участнику"
            />
          </>
        ),
        footer: () => <span className="font-medium">Итого</span>,
        cell: ({ row }) => <span className="font-medium">{row.original.memberName}</span>,
      },
      {
        id: 'balance',
        accessorKey: 'balance',
        size: 200,
        header: () => <div className="w-full text-right">Долг</div>,
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
              row.original.balance,
              row.original.currency,
              currencyPrecision(references.currencies, row.original.currency),
            )}
          </div>
        ),
      },
    ],
    [references.currencies, totals],
  )

  const table = useTable<LiabilityRow, HttpError>({
    columns,
    refineCoreProps: { resource: LIABILITIES_RESOURCE, pagination: { pageSize: 25 } },
  })

  return (
    <section aria-label="Обязательства" className="space-y-3">
      <div>
        <h2 className="font-heading text-lg font-semibold tracking-tight">Кому BBM должен</h2>
        <p className="text-sm text-muted-foreground">
          Непогашенные траты участников со своих средств, по валютам.
        </p>
      </div>
      <DataTable
        table={table}
        emptyTitle="Долгов перед участниками нет"
        emptyDescription="Все траты со своих средств уже возмещены."
      />
    </section>
  )
}
