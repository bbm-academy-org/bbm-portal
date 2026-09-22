// Specifies the pure half of the wave-3 rebuild of `/p/finance/requests`
// (issue #388, owner acceptance comment of 2026-09-15): the status colour map
// that makes a status readable without reading, the per-currency totals the
// table's footer row renders, and the selection — filter, sort, page — the
// board's data provider answers `getList` with so the surface can be driven by
// the whitelist's List block (`docs/design/ui-whitelist.md`).
import { describe, expect, it } from 'vitest'

import { REQUEST_STATUS_BADGE_VARIANT } from '@/app/(platform)/p/finance/requests/constants'
import type { RequestBoardItem } from '@/app/(platform)/p/finance/requests/request-board-contract'
import {
  requestAmountTotals,
  selectRequestPage,
} from '@/app/(platform)/p/finance/requests/request-table-model'

function item(overrides: Partial<RequestBoardItem> = {}): RequestBoardItem {
  return {
    id: 1,
    own: false,
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
    account: { id: 1, name: 'Банк RUB', currency: 'RUB' },
    counterparty: null,
    documents: [],
    ...overrides,
  }
}

describe('the status colour map (#388, owner acceptance 2026-09-15)', () => {
  const STOCK = ['default', 'secondary', 'destructive', 'outline'] as const

  it('gives every status one of the FOUR stock badge variants and invents none', () => {
    const variants = Object.values(REQUEST_STATUS_BADGE_VARIANT)
    expect(variants.length).toBeGreaterThan(0)
    for (const variant of variants) expect(STOCK).toContain(variant)
  })

  it('covers every status the intake machine can be in', () => {
    expect(Object.keys(REQUEST_STATUS_BADGE_VARIANT).sort()).toEqual(
      ['approved', 'cancelled', 'draft', 'posted', 'refused', 'submitted'].sort(),
    )
  })

  it('separates the four things a reader needs to tell apart at a glance', () => {
    // A decision is owed · authorised and waiting · refused · settled or inert.
    expect(REQUEST_STATUS_BADGE_VARIANT.submitted).toBe('default')
    expect(REQUEST_STATUS_BADGE_VARIANT.approved).toBe('secondary')
    expect(REQUEST_STATUS_BADGE_VARIANT.refused).toBe('destructive')
    expect(REQUEST_STATUS_BADGE_VARIANT.posted).toBe('outline')
    expect(REQUEST_STATUS_BADGE_VARIANT.draft).toBe('outline')
    expect(REQUEST_STATUS_BADGE_VARIANT.cancelled).toBe('outline')
    expect(new Set(Object.values(REQUEST_STATUS_BADGE_VARIANT)).size).toBe(4)
  })
})

describe('the totals row of the requests table (#388)', () => {
  it('sums the money per currency — a mixed-currency register has no single total', () => {
    expect(
      requestAmountTotals([
        item({ id: 1, amount: '1000', currency: 'RUB' }),
        item({ id: 2, amount: '250', currency: 'USD' }),
        item({ id: 3, amount: '2000', currency: 'RUB' }),
      ]),
    ).toEqual([
      { currency: 'RUB', amount: '3000' },
      { currency: 'USD', amount: '250' },
    ])
  })

  it('answers with nothing at all when there is nothing to add up', () => {
    expect(requestAmountTotals([])).toEqual([])
  })

  it('keeps the currencies in the order the register first meets them', () => {
    expect(
      requestAmountTotals([
        item({ id: 1, amount: '1', currency: 'EUR' }),
        item({ id: 2, amount: '1', currency: 'RUB' }),
      ]).map((total) => total.currency),
    ).toEqual(['EUR', 'RUB'])
  })
})

describe('selectRequestPage — what the board provider answers getList with (#388)', () => {
  const rows = [
    item({ id: 1, own: true, occurredOn: '2026-08-01', amount: '100' }),
    item({ id: 2, own: false, occurredOn: '2026-08-20', amount: '200' }),
    item({ id: 3, own: true, occurredOn: null, amount: '300' }),
    item({ id: 4, own: false, occurredOn: '2026-08-10', amount: '400' }),
  ]

  it('orders as the board does by default: an intent with no date first, then newest money', () => {
    expect(selectRequestPage(rows, {}).rows.map((row) => row.id)).toEqual([3, 2, 4, 1])
  })

  it('narrows to the reader’s own filings when «мои» is the chosen scope', () => {
    const page = selectRequestPage(rows, { own: true })
    expect(page.rows.map((row) => row.id)).toEqual([3, 1])
    expect(page.total).toBe(2)
  })

  it('reports the total of the FILTERED register, not of the page', () => {
    const page = selectRequestPage(rows, { currentPage: 1, pageSize: 2 })
    expect(page.rows.map((row) => row.id)).toEqual([3, 2])
    expect(page.total).toBe(4)
  })

  it('answers the second page with what the first one left', () => {
    expect(
      selectRequestPage(rows, { currentPage: 2, pageSize: 2 }).rows.map((row) => row.id),
    ).toEqual([4, 1])
  })

  it('sorts by the column the reader asked for, ascending and descending', () => {
    expect(
      selectRequestPage(rows, { sorters: [{ field: 'amount', order: 'asc' }] }).rows.map(
        (row) => row.id,
      ),
    ).toEqual([1, 2, 3, 4])
    expect(
      selectRequestPage(rows, { sorters: [{ field: 'amount', order: 'desc' }] }).rows.map(
        (row) => row.id,
      ),
    ).toEqual([4, 3, 2, 1])
  })

  it('sorts by a named text column through its displayed value', () => {
    const named = [
      item({ id: 1, createdByName: 'Яковлев' }),
      item({ id: 2, createdByName: 'Абрамов' }),
    ]
    expect(
      selectRequestPage(named, { sorters: [{ field: 'createdByName', order: 'asc' }] }).rows.map(
        (row) => row.id,
      ),
    ).toEqual([2, 1])
  })

  it('carries the totals of the whole filtered register, not of the visible page', () => {
    const page = selectRequestPage(rows, { currentPage: 1, pageSize: 1 })
    expect(page.rows).toHaveLength(1)
    expect(page.totals).toEqual([{ currency: 'RUB', amount: '1000' }])
  })

  it('leaves an unknown sort field alone rather than shuffling the register', () => {
    expect(
      selectRequestPage(rows, { sorters: [{ field: 'nonsense', order: 'asc' }] }).rows.map(
        (row) => row.id,
      ),
    ).toEqual([3, 2, 4, 1])
  })
})
