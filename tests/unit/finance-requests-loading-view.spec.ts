// Specifies WHICH VIEW the requests route paints while it loads (#388, defect C
// of the 2026-09-16 eyes-on matrix). Measured live with the read held open: the
// route drew four kanban column skeletons in `lg:grid-cols-4` at BOTH
// breakpoints and then swapped the whole layout for a table — at 390 px that is
// four stacked 256-px blocks, over 1000 px of grey, for a view the reader was
// never going to be shown. The default view has been the TABLE since decision 35
// (Антон, 2026-09-14).
//
// WHAT IS HONESTLY TESTABLE: the shape of the skeleton's own markup. jsdom lays
// nothing out, so «>1000 px of grey» cannot be measured; the four-column grid
// that produces it can be, and it is the exact class the live pass read.
import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refine = vi.hoisted(() => ({
  isLoading: true,
  data: null as unknown,
}))

vi.mock('@refinedev/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@refinedev/core')>()
  return {
    ...actual,
    useCustom: () => ({
      query: {
        data: refine.data === null ? undefined : { data: refine.data },
        isLoading: refine.isLoading,
        isSuccess: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      },
      result: { data: {} },
    }),
    useCustomMutation: () => ({ mutate: vi.fn(), mutation: { isPending: false } }),
    useInvalidate: () => vi.fn(),
  }
})

import RequestsLoading from '@/app/(platform)/p/finance/requests/loading'
import { RequestsBoardScreen } from '@/app/(platform)/p/finance/requests/RequestsBoardScreen'
import { RequestsSkeleton } from '@/app/(platform)/p/finance/requests/RequestsSkeleton'
import {
  requestsLoadingView,
  REQUESTS_VIEW_STORAGE_KEY,
} from '@/app/(platform)/p/finance/requests/request-table-model'

/** The four-column kanban grid, exactly as the live pass read it in the DOM. */
function boardColumns(root: ParentNode): Element[] {
  return [...root.querySelectorAll('.lg\\:grid-cols-4')]
}

beforeEach(() => {
  window.localStorage.clear()
  refine.isLoading = true
  refine.data = null
})

afterEach(() => cleanup())

describe('which view the loading state draws (#388 defect C)', () => {
  it('draws table chrome, and no kanban column, for the default view', () => {
    const { container } = render(React.createElement(RequestsSkeleton, { view: 'table' }))
    expect(boardColumns(container)).toHaveLength(0)
    // The chrome the table actually has: one bordered, rounded register box.
    expect(container.querySelector('.rounded-md.border')).not.toBeNull()
  })

  it('draws the four kanban columns only for the kanban view', () => {
    const { container } = render(React.createElement(RequestsSkeleton, { view: 'board' }))
    expect(boardColumns(container)).toHaveLength(1)
  })

  it('names the view the ROUTE may assume: the table, because it has no browser to ask', () => {
    const { container } = render(React.createElement(RequestsLoading))
    expect(boardColumns(container)).toHaveLength(0)
    expect(container.querySelector('.rounded-md.border')).not.toBeNull()
  })

  it('reads the stored view for the screen own skeleton, and defaults to the table', () => {
    expect(requestsLoadingView(null)).toBe('table')
    expect(requestsLoadingView('table')).toBe('table')
    expect(requestsLoadingView('nonsense')).toBe('table')
    expect(requestsLoadingView('board')).toBe('board')
  })

  it('shows the reader table chrome while the snapshot is still in flight', () => {
    const { container } = render(React.createElement(RequestsBoardScreen))
    expect(container.querySelector('[aria-label="Загружаем заявки"]')).not.toBeNull()
    expect(boardColumns(container)).toHaveLength(0)
  })

  it('restores the kanban skeleton for a browser that last chose the board', () => {
    window.localStorage.setItem(REQUESTS_VIEW_STORAGE_KEY, 'board')
    const { container } = render(React.createElement(RequestsBoardScreen))
    expect(boardColumns(container)).toHaveLength(1)
  })
})
