// Specifies the TOTALS ROW of the whitelist's List block —
// `src/ui/refine-ui/data-table/data-table.tsx` (`docs/design/ui-whitelist.md`
// → «List»). Owner go, Антон, 2026-09-15 (#388): the footer is the shadcn
// `TableFooter` already in `src/ui/table.tsx`, wired through TanStack's own
// `getFooterGroups()` INSIDE the block — a block edit, so no screen ever writes
// footer markup of its own. The block renders the row only when a column
// declares a `footer`.
import { cleanup, render, screen } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataTable } from '@/ui/refine-ui/data-table/data-table'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

type Row = { id: number; name: string; amount: number }

const ROWS: Row[] = [
  { id: 1, name: 'Первая', amount: 100 },
  { id: 2, name: 'Вторая', amount: 250 },
]

/**
 * The block takes `UseTableReturnType` — a real TanStack table beside the
 * refine-core half the pager reads. Building it here rather than mocking the
 * block's input keeps the assertion on the BLOCK's markup.
 */
function Harness({ columns, rows = ROWS }: { columns: ColumnDef<Row>[]; rows?: Row[] }) {
  const reactTable = useReactTable<Row>({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: 1,
  })
  const table = {
    reactTable,
    refineCore: {
      tableQuery: { data: { data: rows, total: rows.length }, isLoading: false },
      currentPage: 1,
      setCurrentPage: vi.fn(),
      pageCount: 1,
      pageSize: 10,
      setPageSize: vi.fn(),
    },
  }
  return React.createElement(DataTable, { table: table as never })
}

afterEach(() => cleanup())

describe('the List block’s totals row (#388)', () => {
  it('renders no footer at all when no column declares one', () => {
    render(
      React.createElement(Harness, {
        columns: [
          { id: 'name', accessorKey: 'name', header: 'Имя' },
          { id: 'amount', accessorKey: 'amount', header: 'Сумма' },
        ],
      }),
    )
    expect(document.querySelector('tfoot')).toBeNull()
  })

  it('renders the footer through the shadcn TableFooter once a column declares one', () => {
    render(
      React.createElement(Harness, {
        columns: [
          { id: 'name', accessorKey: 'name', header: 'Имя', footer: 'Итого' },
          { id: 'amount', accessorKey: 'amount', header: 'Сумма', footer: '350' },
        ],
      }),
    )
    const footer = document.querySelector('tfoot')
    expect(footer).not.toBeNull()
    expect(footer?.getAttribute('data-slot')).toBe('table-footer')
    expect(footer?.textContent).toContain('Итого')
    expect(footer?.textContent).toContain('350')
  })

  it('lets a column render its footer as a node, with the column’s own context', () => {
    render(
      React.createElement(Harness, {
        columns: [
          { id: 'name', accessorKey: 'name', header: 'Имя' },
          {
            id: 'amount',
            accessorKey: 'amount',
            header: 'Сумма',
            footer: ({ table }) =>
              React.createElement('span', null, `строк: ${table.getRowModel().rows.length}`),
          },
        ],
      }),
    )
    expect(screen.getByText('строк: 2')).toBeTruthy()
  })

  it('keeps the footer on an EMPTY register — a total of nothing is still an answer', () => {
    render(
      React.createElement(Harness, {
        rows: [],
        columns: [
          { id: 'name', accessorKey: 'name', header: 'Имя', footer: 'Итого' },
          { id: 'amount', accessorKey: 'amount', header: 'Сумма', footer: '0' },
        ],
      }),
    )
    expect(document.querySelector('tfoot')?.textContent).toContain('Итого')
  })
})
