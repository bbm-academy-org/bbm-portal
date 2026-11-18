// Specifies the UNPAGED mode of the whitelist's List block —
// `src/ui/refine-ui/data-table/data-table.tsx` (`docs/design/ui-whitelist.md`
// → «List»), added for the payment queue of #550: a queue group is the whole
// set of requests at one stage, never a page of it, so the block's pager —
// «Строк на странице», «Страница 1 из 1» — would be chrome that controls
// nothing. The block hides it when the screen says the register is unpaged.
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

type Row = { id: number; name: string }

const ROWS: Row[] = [
  { id: 1, name: 'Первая' },
  { id: 2, name: 'Вторая' },
]
const COLUMNS: ColumnDef<Row>[] = [{ id: 'name', accessorKey: 'name', header: 'Имя' }]

function Harness({ paginated }: { paginated?: boolean }) {
  const reactTable = useReactTable<Row>({
    data: ROWS,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: 1,
  })
  const table = {
    reactTable,
    refineCore: {
      tableQuery: { data: { data: ROWS, total: ROWS.length }, isLoading: false },
      currentPage: 1,
      setCurrentPage: vi.fn(),
      pageCount: 1,
      pageSize: 10,
      setPageSize: vi.fn(),
    },
  }
  return React.createElement(DataTable, {
    table: table as never,
    ...(paginated === undefined ? {} : { paginated }),
  })
}

afterEach(() => cleanup())

describe('the List block’s unpaged mode (#550)', () => {
  it('keeps the pager by default — every existing register is paged', () => {
    render(React.createElement(Harness))
    expect(screen.getByText('Строк на странице')).toBeTruthy()
  })

  it('renders the rows and no pager when the register is unpaged', () => {
    render(React.createElement(Harness, { paginated: false }))
    expect(screen.getByText('Первая')).toBeTruthy()
    expect(screen.queryByText('Строк на странице')).toBeNull()
    expect(screen.queryByText(/Страница 1 из/)).toBeNull()
  })
})
