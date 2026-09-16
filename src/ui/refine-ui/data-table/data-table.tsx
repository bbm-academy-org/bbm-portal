'use client'

import type { HttpError, BaseRecord } from '@refinedev/core'
import type { UseTableReturnType } from '@refinedev/react-table'
import type { Column } from '@tanstack/react-table'
import { flexRender } from '@tanstack/react-table'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ui/table'
import { DataTablePagination } from '@/ui/refine-ui/data-table/data-table-pagination'
import { cn } from '@/ui/utils'

type DataTableProps<TData extends BaseRecord> = {
  table: UseTableReturnType<TData, HttpError>
  /** The empty state's headline. Defaults to the kit's ru-RU wording. */
  emptyTitle?: string
  /** The empty state's second line — say what to do next, not only that it is empty. */
  emptyDescription?: string
}

export function DataTable<TData extends BaseRecord>({
  table,
  emptyTitle = 'Записей пока нет',
  emptyDescription = 'Здесь появятся строки, как только они будут созданы.',
}: DataTableProps<TData>) {
  const {
    reactTable: { getHeaderGroups, getFooterGroups, getRowModel, getAllColumns },
    refineCore: { tableQuery, currentPage, setCurrentPage, pageCount, pageSize, setPageSize },
  } = table

  const columns = getAllColumns()
  const leafColumns = table.reactTable.getAllLeafColumns()
  const isLoading = tableQuery.isLoading
  /**
   * THE TOTALS ROW IS THE BLOCK'S, NOT THE SCREEN'S — a divergence from
   * upstream `ui.refine.dev`, added on #388 (owner go, Антон, 2026-09-15).
   *
   * A register that adds its rows up used to have to hand-build a `<TableFooter>`
   * beside the block, which is the whitelist violation `pnpm lint:whitelist-blocks`
   * exists to catch (`docs/design/ui-whitelist.md` → «List»). TanStack already
   * models the footer — `columnDef.footer` and `getFooterGroups()` — so the block
   * renders it through the kit's own `TableFooter`, and a screen declares its
   * total as one more field of its `ColumnDef`. A table whose columns declare no
   * footer gets no `<tfoot>` at all.
   *
   * It survives an EMPTY register on purpose: «итого 0» is an answer, and a
   * footer that disappeared with the last row would read as a missing total.
   */
  const hasFooter = leafColumns.some((column) => column.columnDef.footer !== undefined)

  const tableContainerRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const [isOverflowing, setIsOverflowing] = useState({
    horizontal: false,
    vertical: false,
  })
  /**
   * How wide the SCROLL CONTAINER is, which is not how wide the table is once
   * the table overflows. The empty state needs the container's width to sit
   * inside the reader's viewport rather than the table's — see
   * `DataTableNoData`. 0 means «not measured yet», and the empty state falls
   * back to the full width until it is.
   */
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const checkOverflow = () => {
      if (tableRef.current && tableContainerRef.current) {
        const table = tableRef.current
        const container = tableContainerRef.current

        const horizontalOverflow = table.offsetWidth > container.clientWidth
        const verticalOverflow = table.offsetHeight > container.clientHeight

        setIsOverflowing({
          horizontal: horizontalOverflow,
          vertical: verticalOverflow,
        })
        setContainerWidth(container.clientWidth)
      }
    }

    checkOverflow()

    // Check on window resize
    window.addEventListener('resize', checkOverflow)

    // Check when table data changes
    const timeoutId = setTimeout(checkOverflow, 100)

    return () => {
      window.removeEventListener('resize', checkOverflow)
      clearTimeout(timeoutId)
    }
  }, [tableQuery.data?.data, pageSize])

  return (
    <div className={cn('flex', 'flex-col', 'flex-1', 'gap-4')}>
      <div ref={tableContainerRef} className={cn('rounded-md', 'border')}>
        <Table ref={tableRef} style={{ tableLayout: 'fixed', width: '100%' }}>
          <TableHeader>
            {getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isPlaceholder = header.isPlaceholder

                  return (
                    <TableHead
                      key={header.id}
                      style={{
                        ...getCommonStyles({
                          column: header.column,
                          isOverflowing: isOverflowing,
                        }),
                      }}
                    >
                      {isPlaceholder ? null : (
                        <div className={cn('flex', 'items-center', 'gap-1')}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </div>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="relative">
            {isLoading ? (
              <>
                {Array.from({ length: pageSize < 1 ? 1 : pageSize }).map((_, rowIndex) => (
                  <TableRow key={`skeleton-row-${rowIndex}`} aria-hidden="true">
                    {leafColumns.map((column) => (
                      <TableCell
                        key={`skeleton-cell-${rowIndex}-${column.id}`}
                        style={{
                          ...getCommonStyles({
                            column,
                            isOverflowing: isOverflowing,
                          }),
                        }}
                        className={cn('truncate')}
                      >
                        <div className="h-8" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className={cn('absolute', 'inset-0', 'pointer-events-none')}
                  >
                    <Loader2
                      className={cn(
                        'absolute',
                        'top-1/2',
                        'left-1/2',
                        'animate-spin',
                        'text-primary',
                        'h-8',
                        'w-8',
                        '-translate-x-1/2',
                        '-translate-y-1/2',
                      )}
                    />
                  </TableCell>
                </TableRow>
              </>
            ) : getRowModel().rows?.length ? (
              getRowModel().rows.map((row) => {
                return (
                  <TableRow
                    key={row.original?.id ?? row.id}
                    data-state={row.getIsSelected() && 'selected'}
                  >
                    {row.getVisibleCells().map((cell) => {
                      return (
                        <TableCell
                          key={cell.id}
                          style={{
                            ...getCommonStyles({
                              column: cell.column,
                              isOverflowing: isOverflowing,
                            }),
                          }}
                        >
                          <div className="truncate">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })
            ) : (
              <DataTableNoData
                isOverflowing={isOverflowing}
                containerWidth={containerWidth}
                columnsLength={columns.length}
                emptyTitle={emptyTitle}
                emptyDescription={emptyDescription}
              />
            )}
          </TableBody>
          {hasFooter && !isLoading ? (
            <TableFooter>
              {getFooterGroups().map((footerGroup) => (
                <TableRow key={footerGroup.id}>
                  {footerGroup.headers.map((footer) => (
                    <TableCell
                      key={footer.id}
                      style={{
                        ...getCommonStyles({
                          column: footer.column,
                          isOverflowing: isOverflowing,
                        }),
                      }}
                    >
                      {footer.isPlaceholder
                        ? null
                        : flexRender(footer.column.columnDef.footer, footer.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableFooter>
          ) : null}
        </Table>
      </div>
      {!isLoading && getRowModel().rows?.length > 0 && (
        <DataTablePagination
          currentPage={currentPage}
          pageCount={pageCount}
          setCurrentPage={setCurrentPage}
          pageSize={pageSize}
          setPageSize={setPageSize}
          total={tableQuery.data?.total}
        />
      )}
    </div>
  )
}

/**
 * THE EMPTY STATE — a divergence from upstream `ui.refine.dev`, fixed here on
 * #388 (defect D of the 2026-09-16 eyes-on matrix) because a shortcoming of a
 * block belongs in the block.
 *
 * Upstream shrinks the message to `width: fit-content` and shifts it by
 * `translateX(-50%)` as soon as the table overflows its container. On a 390 px
 * reader that is a line as wide as its own text, half of it hanging off each
 * edge of a 341-px container, and it does not wrap — the register read «ы
 * подадите, появится здесь — включая черновики и от». Two things were wrong:
 * the width (it must be the CONTAINER's, not the content's) and the wrapping
 * (the kit's `TableCell` is `whitespace-nowrap`, and the children inherit it).
 *
 * So: `position: sticky; left: 0` with the measured CONTAINER width pins the
 * message to the scroller's own viewport — the same effect the translate was
 * reaching for — while both lines are given `whitespace-normal` and can wrap
 * inside it. Before the first measurement the width is simply 100%.
 *
 * And the cell's height is a class, not a hard-coded `490px`: nearly half a
 * phone screen of void under two lines of text, in every combination.
 */
function DataTableNoData({
  isOverflowing,
  containerWidth,
  columnsLength,
  emptyTitle,
  emptyDescription,
}: {
  isOverflowing: { horizontal: boolean; vertical: boolean }
  containerWidth: number
  columnsLength: number
  emptyTitle: string
  emptyDescription: string
}) {
  const pinned = isOverflowing.horizontal && containerWidth > 0
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columnsLength} className={cn('relative', 'text-center', 'h-56')}>
        <div
          className={cn(
            'absolute',
            'inset-y-0',
            'left-0',
            'flex',
            'flex-col',
            'items-center',
            'justify-center',
            'gap-2',
            'px-6',
            'bg-background',
          )}
          style={{
            position: isOverflowing.horizontal ? 'sticky' : 'absolute',
            zIndex: isOverflowing.horizontal ? 2 : 1,
            width: pinned ? `${containerWidth}px` : '100%',
          }}
        >
          <div className={cn('text-lg', 'font-semibold', 'text-foreground', 'whitespace-normal')}>
            {emptyTitle}
          </div>
          <div className={cn('text-sm', 'text-muted-foreground', 'whitespace-normal')}>
            {emptyDescription}
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function getCommonStyles<TData>({
  column,
  isOverflowing,
}: {
  column: Column<TData>
  isOverflowing: {
    horizontal: boolean
    vertical: boolean
  }
}): React.CSSProperties {
  const isPinned = column.getIsPinned()
  const isLastLeftPinnedColumn = isPinned === 'left' && column.getIsLastColumn('left')
  const isFirstRightPinnedColumn = isPinned === 'right' && column.getIsFirstColumn('right')

  return {
    boxShadow:
      isOverflowing.horizontal && isLastLeftPinnedColumn
        ? '-4px 0 4px -4px var(--border) inset'
        : isOverflowing.horizontal && isFirstRightPinnedColumn
          ? '4px 0 4px -4px var(--border) inset'
          : undefined,
    left:
      isOverflowing.horizontal && isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
    right:
      isOverflowing.horizontal && isPinned === 'right'
        ? `${column.getAfter('right')}px`
        : undefined,
    opacity: 1,
    position: isOverflowing.horizontal && isPinned ? 'sticky' : 'relative',
    background: isOverflowing.horizontal && isPinned ? 'var(--background)' : '',
    borderTopRightRadius:
      isOverflowing.horizontal && isPinned === 'right' ? 'var(--radius)' : undefined,
    borderBottomRightRadius:
      isOverflowing.horizontal && isPinned === 'right' ? 'var(--radius)' : undefined,
    borderTopLeftRadius:
      isOverflowing.horizontal && isPinned === 'left' ? 'var(--radius)' : undefined,
    borderBottomLeftRadius:
      isOverflowing.horizontal && isPinned === 'left' ? 'var(--radius)' : undefined,
    width: column.getSize(),
    zIndex: isOverflowing.horizontal && isPinned ? 1 : 0,
  }
}

DataTable.displayName = 'DataTable'
