// Specifies the WIDTH BUDGET of the wave-3 register (#388, defect B of the
// 2026-09-16 eyes-on matrix): at 1440×900 the table measured 1214 px inside a
// 1110 px container, so «Отклонить…» was cut mid-word and the row's named
// «Открыть» — the only control wave 3 leaves for opening a request — was laid
// out at x 1291–1369 and never painted.
//
// WHAT IS HONESTLY TESTABLE. jsdom lays nothing out: every width is 0 there, so
// no test can measure an overflow. What CAN be asserted is the budget the
// screen declares — the block writes `column.getSize()` straight into each
// cell's inline `width`, so the sum of the declared sizes IS the table's width
// under `table-layout: fixed`. This file therefore asserts the plan (pure) and
// that the rendered block carries exactly that plan (jsdom, inline styles).
import { Refine, type DataProvider } from '@refinedev/core'
import { cleanup, render, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  RequestBoardItem,
  RequestBoardReferences,
} from '@/app/(platform)/p/finance/requests/request-board-contract'
import { RequestsTable } from '@/app/(platform)/p/finance/requests/RequestsTable'
import {
  REQUEST_TABLE_CELL_PADDING,
  REQUEST_TABLE_NO_MOVEMENT_LABEL_WIDTH,
  REQUEST_TABLE_WIDTH_BUDGET,
  requestTableColumnPlan,
  type RequestTableScope,
} from '@/app/(platform)/p/finance/requests/request-table-model'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

const COMBINATIONS: { scope: RequestTableScope; canApprove: boolean }[] = [
  { scope: 'mine', canApprove: false },
  { scope: 'mine', canApprove: true },
  { scope: 'all', canApprove: false },
  { scope: 'all', canApprove: true },
]

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
    status: 'refused',
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
    refusalReason: 'Нет бюджета на этот квартал',
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

function renderTable({ scope, canApprove }: { scope: RequestTableScope; canApprove: boolean }) {
  const dataProvider = {
    getApiUrl: () => '',
    getList: async () => ({ data: REQUESTS as never, total: REQUESTS.length }),
    getOne: async () => ({ data: {} as never }),
    create: async () => ({ data: {} as never }),
    update: async () => ({ data: {} as never }),
    deleteOne: async () => ({ data: {} as never }),
  } satisfies DataProvider

  return render(
    React.createElement(
      Refine,
      { dataProvider, options: { disableTelemetry: true } },
      React.createElement(RequestsTable, {
        requests: REQUESTS,
        references,
        canApprove,
        scope,
        onOpen: vi.fn(),
        onAct: vi.fn(),
      }),
    ),
  )
}

afterEach(() => cleanup())

describe('the register’s desktop width budget (#388 defect B)', () => {
  it('fits a 1440 px reader’s container in EVERY scope × role combination', () => {
    for (const combination of COMBINATIONS) {
      const plan = requestTableColumnPlan(combination)
      const total = plan.reduce((sum, column) => sum + column.size, 0)
      expect(
        total,
        `${combination.scope} / canApprove=${combination.canApprove} declares ${total}px`,
      ).toBeLessThanOrEqual(REQUEST_TABLE_WIDTH_BUDGET)
    }
  })

  it('keeps the acts column last and present everywhere — «Открыть» is the only way in', () => {
    for (const combination of COMBINATIONS) {
      const plan = requestTableColumnPlan(combination)
      expect(plan.at(-1)?.id).toBe('actions')
      expect(plan.every((column) => column.size > 0)).toBe(true)
    }
  })

  it('drops «Кто подал» under «Мои», where every row names the same person', () => {
    const mine = requestTableColumnPlan({ scope: 'mine', canApprove: true }).map((c) => c.id)
    const all = requestTableColumnPlan({ scope: 'all', canApprove: true }).map((c) => c.id)
    expect(mine).not.toContain('createdByName')
    expect(all).toContain('createdByName')
  })

  it('gives the approver’s three controls more room than a reader’s one', () => {
    const approver = requestTableColumnPlan({ scope: 'all', canApprove: true })
    const reader = requestTableColumnPlan({ scope: 'all', canApprove: false })
    const acts = (plan: { id: string; size: number }[]) =>
      plan.find((column) => column.id === 'actions')!.size
    expect(acts(approver)).toBeGreaterThan(acts(reader))
  })

  it('affords «ещё не двигались» whole, in every scope — a state may not be clipped', () => {
    // Since #517 the column is «Подана» and the placeholder is its SECOND line,
    // rendered at `text-xs` — narrower than the 114 px measured at `text-sm`.
    // The assertion keeps the larger number rather than a re-measured smaller
    // one: it is the conservative bound, and a column that affords the wider
    // label affords the narrower one by construction.
    // Defect E of the re-driven matrix (2026-09-16). Under «Все» at 1440 the
    // placeholder needed 114 px and the cell offered 102, so it read «ещё не
    // двига…» — and the block's `div.truncate` carries no `title`, so the words
    // were nowhere on screen. It is the same rule this PR already paid for in
    // `3a08136`: the placeholder IS the state (EARS-533 names emptiness rather
    // than printing «—»), and a state may not be clipped.
    //
    // ASSERTED ON THE PLAN NUMBERS, not on the absence of `truncate`: the
    // truncation lives in the BLOCK's own cell wrapper, which every column of
    // every register shares, and exempting one column of one screen from it
    // would be a block edit made for a single placeholder. The width is the
    // honest lever, and the date column's longest content is a FIXED string —
    // unlike the free-text column, which can never be sized to its content.
    for (const combination of COMBINATIONS) {
      const date = requestTableColumnPlan(combination).find((c) => c.id === 'filed')!
      expect(
        date.size - REQUEST_TABLE_CELL_PADDING,
        `${combination.scope} / canApprove=${combination.canApprove} offers ${
          date.size - REQUEST_TABLE_CELL_PADDING
        }px to a ${REQUEST_TABLE_NO_MOVEMENT_LABEL_WIDTH}px label`,
      ).toBeGreaterThanOrEqual(REQUEST_TABLE_NO_MOVEMENT_LABEL_WIDTH)
    }
  })

  it('has no refusal column at all — the reason belongs to the status it explains', () => {
    for (const combination of COMBINATIONS) {
      expect(requestTableColumnPlan(combination).map((c) => c.id)).not.toContain('refusalReason')
    }
  })
})

describe('the rendered register carries exactly the declared budget (#388 defect B)', () => {
  it.each(COMBINATIONS)('renders the plan of %o and nothing wider', async (combination) => {
    renderTable(combination)
    await waitFor(() => expect(document.querySelectorAll('thead th').length).toBeGreaterThan(0))

    const widths = [...document.querySelectorAll('thead th')].map((cell) =>
      Number.parseFloat((cell as HTMLElement).style.width),
    )
    expect(widths.every((width) => Number.isFinite(width) && width > 0)).toBe(true)
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(
      REQUEST_TABLE_WIDTH_BUDGET,
    )
  })
})
