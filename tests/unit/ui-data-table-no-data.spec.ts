// Specifies the EMPTY STATE of the whitelist's List block —
// `src/ui/refine-ui/data-table/data-table.tsx` (`docs/design/ui-whitelist.md`
// → «List»), #388 defect D of the 2026-09-16 eyes-on matrix.
//
// Read live at 390 px: upstream's `DataTableNoData` switches to
// `width: fit-content` + `transform: translateX(-50%)` as soon as the table
// overflows its container, and the description then does not wrap — it ran off
// BOTH edges of the 341-px container («ы подадите, появится здесь — включая
// черновики и от»). The same cell carries a hard-coded `height: '490px'`, a
// void of nearly half a phone screen in every combination. A shortcoming of a
// block is fixed in the block, so both are fixed here rather than worked around
// by the screen.
//
// WHAT IS HONESTLY TESTABLE: jsdom computes no layout, so no test can see the
// clipping. What it CAN read is the treatment that causes it — the inline
// `width`/`transform` upstream writes, and the `whitespace-nowrap` the kit's
// `TableCell` passes down to its children — plus the hard-coded height. Those
// are asserted on the rendered style and class list.
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

const COLUMNS: ColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Имя' },
  { id: 'other', accessorKey: 'name', header: 'Ещё' },
]

const EMPTY_TITLE = 'Вы ещё не подавали заявок'
const EMPTY_DESCRIPTION = 'Всё, что вы подадите, появится здесь — включая черновики и отозванное.'

function Harness() {
  const reactTable = useReactTable<Row>({
    data: [],
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: 1,
  })
  const table = {
    reactTable,
    refineCore: {
      tableQuery: { data: { data: [], total: 0 }, isLoading: false },
      currentPage: 1,
      setCurrentPage: vi.fn(),
      pageCount: 1,
      pageSize: 10,
      setPageSize: vi.fn(),
    },
  }
  return React.createElement(DataTable, {
    table: table as never,
    emptyTitle: EMPTY_TITLE,
    emptyDescription: EMPTY_DESCRIPTION,
  })
}

afterEach(() => cleanup())

describe('the List block empty state (#388 defect D)', () => {
  it('still says both things a reader needs — what is empty, and what fills it', () => {
    render(React.createElement(Harness))
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy()
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeTruthy()
  })

  it('lets both lines WRAP instead of inheriting the cell nowrap', () => {
    render(React.createElement(Harness))
    expect(screen.getByText(EMPTY_DESCRIPTION).className).toContain('whitespace-normal')
    expect(screen.getByText(EMPTY_TITLE).className).toContain('whitespace-normal')
  })

  it('never shrinks the message to its own content and shifts it by half of that', () => {
    render(React.createElement(Harness))
    const panel = screen.getByText(EMPTY_TITLE).parentElement as HTMLElement
    expect(panel.style.width).not.toBe('fit-content')
    expect(panel.style.transform).toBe('')
  })

  it('gives the empty cell a proportionate height, not a hard-coded 490 px void', () => {
    render(React.createElement(Harness))
    const cell = document.querySelector('tbody td') as HTMLElement
    expect(cell.style.height).not.toBe('490px')
  })
})
