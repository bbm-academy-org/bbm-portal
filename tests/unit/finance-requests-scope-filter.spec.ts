// Specifies the ONE thing the wave-3 register is for: that the scope the reader
// picks reaches the DATA PROVIDER (#388, defect A of the 2026-09-16 eyes-on
// matrix). Everything else about the table is covered by
// `finance-requests-ui.spec.ts`, which mocks `@refinedev/react-table` at the
// hook — and a mock of that hook is exactly where this defect hides, because the
// bug lives INSIDE the real `useTable`: Refine seeds its filter state once, at
// mount, out of `filters.permanent`, and `unionFilters` then keeps the seeded
// `own eq true` forever. So this file runs the REAL hook inside a REAL `<Refine>`
// and records what the provider is asked for.
import { Refine, type CrudFilter, type DataProvider } from '@refinedev/core'
import { cleanup, render, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { REQUESTS_RESOURCE } from '@/app/(platform)/p/finance/requests/constants'
import type {
  RequestBoardItem,
  RequestBoardReferences,
} from '@/app/(platform)/p/finance/requests/request-board-contract'
import { RequestsTable } from '@/app/(platform)/p/finance/requests/RequestsTable'
import type { RequestTableScope } from '@/app/(platform)/p/finance/requests/request-table-model'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

const references: RequestBoardReferences = {
  accounts: [],
  counterparties: [],
  currencies: [{ code: 'RUB', name: 'Российский рубль', precision: 2 }],
  products: [],
  projects: [],
  purposes: [],
}

function item(overrides: Partial<RequestBoardItem> = {}): RequestBoardItem {
  return {
    id: 1,
    own: true,
    status: 'submitted',
    occurredOn: '2026-08-22',
    createdAt: '2026-08-20T09:30:00.000Z',
    sourceRef: null,
    sourceUrl: null,
    sourceLabel: null,
    amount: '4500000',
    currency: 'RUB',
    paidAmount: null,
    paidCurrency: null,
    note: null,
    alreadyPaid: false,
    personalFunds: false,
    createdByName: 'М. Иванова',
    refusalReason: null,
    operationId: null,
    purpose: { id: 21, name: 'Продакшн', categoryId: 5, categoryName: 'Производство' },
    project: { id: 3, name: 'Doctor.School' },
    product: null,
    account: null,
    counterparty: null,
    documents: [],
    ...overrides,
  }
}

const REQUESTS = [item({ id: 1, own: true }), item({ id: 2, own: false })]

function carriesOwnFilter(filters: CrudFilter[]): boolean {
  return filters.some(
    (filter) => 'field' in filter && filter.field === 'own' && filter.value === true,
  )
}

function harness() {
  const seen: CrudFilter[][] = []
  const dataProvider = {
    getApiUrl: () => '',
    getList: async ({ filters }) => {
      seen.push([...(filters ?? [])])
      return { data: REQUESTS as never, total: REQUESTS.length }
    },
    getOne: async () => ({ data: {} as never }),
    create: async () => ({ data: {} as never }),
    update: async () => ({ data: {} as never }),
    deleteOne: async () => ({ data: {} as never }),
  } satisfies DataProvider

  function Screen({ scope }: { scope: RequestTableScope }) {
    return React.createElement(
      Refine,
      { dataProvider, options: { disableTelemetry: true } },
      React.createElement(RequestsTable, {
        requests: REQUESTS,
        references,
        canApprove: true,
        scope,
        onOpen: vi.fn(),
        onAct: vi.fn(),
      }),
    )
  }

  return { seen, Screen }
}

afterEach(() => cleanup())

describe('the scope the reader picks reaches getList (#388 defect A)', () => {
  it('asks for the reader’s own filings while the scope is «Мои»', async () => {
    const { seen, Screen } = harness()
    render(React.createElement(Screen, { scope: 'mine' }))
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(carriesOwnFilter(seen.at(-1)!)).toBe(true)
  })

  it('DROPS that filter once the reader switches to «Все»', async () => {
    const { seen, Screen } = harness()
    const { rerender } = render(React.createElement(Screen, { scope: 'mine' }))
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const beforeSwitch = seen.length

    rerender(React.createElement(Screen, { scope: 'all' }))

    // A new scope is a new register: the provider must be ASKED again, and
    // asked without the narrowing the reader just cleared. A register that
    // answers «Заявок пока нет» over a footer summing the whole queue is
    // exactly what a stale permanent filter looks like on screen.
    await waitFor(() => expect(seen.length).toBeGreaterThan(beforeSwitch))
    expect(carriesOwnFilter(seen.at(-1)!)).toBe(false)
  })

  it('narrows again when the reader goes back to «Мои»', async () => {
    const { seen, Screen } = harness()
    const { rerender } = render(React.createElement(Screen, { scope: 'mine' }))
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    rerender(React.createElement(Screen, { scope: 'all' }))
    await waitFor(() => expect(carriesOwnFilter(seen.at(-1)!)).toBe(false))
    const beforeReturn = seen.length

    rerender(React.createElement(Screen, { scope: 'mine' }))
    await waitFor(() => expect(seen.length).toBeGreaterThan(beforeReturn))
    expect(carriesOwnFilter(seen.at(-1)!)).toBe(true)
  })
})
