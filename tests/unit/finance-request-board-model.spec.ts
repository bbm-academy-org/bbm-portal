import { describe, expect, it } from 'vitest'

import type { RequestBoardItem } from '@/app/(platform)/p/finance/requests/request-board-contract'
import {
  boardColumnCounts,
  canDragRequest,
  currencyPrecision,
  FINANCE_REQUEST_BOARD_STATUSES,
  groupRequestsByStatus,
  ownRequests,
  planRequestDrop,
  requestCardFlags,
  REQUEST_BOARD_COLUMNS,
} from '@/app/(platform)/p/finance/requests/request-board-model'

describe('request-board status machine (spec 339 EARS-510/511/512/524)', () => {
  it('EARS-510/511/512: maps every legal drag to the act that must still be confirmed', () => {
    expect(planRequestDrop('submitted', 'approved')).toEqual({ type: 'act', act: 'approve' })
    expect(planRequestDrop('submitted', 'refused')).toEqual({ type: 'act', act: 'refuse' })
    expect(planRequestDrop('approved', 'posted')).toEqual({ type: 'act', act: 'confirm' })
    expect(planRequestDrop('approved', 'refused')).toEqual({ type: 'act', act: 'refuse' })
  })

  it('EARS-524: refuses illegal and terminal drags on the client without pretending the status changed', () => {
    for (const status of FINANCE_REQUEST_BOARD_STATUSES) {
      expect(planRequestDrop('posted', status)).toMatchObject({ type: 'refused' })
      expect(planRequestDrop('refused', status)).toMatchObject({ type: 'refused' })
    }
    expect(planRequestDrop('submitted', 'posted')).toMatchObject({ type: 'refused' })
    expect(planRequestDrop('approved', 'submitted')).toMatchObject({ type: 'refused' })
  })
})

function item(overrides: Partial<RequestBoardItem> = {}): RequestBoardItem {
  return {
    id: 1,
    own: false,
    status: 'submitted',
    occurredOn: '2026-08-22',
    amount: '4500000',
    currency: 'RUB',
    paidAmount: null,
    paidCurrency: null,
    note: 'Аренда студии',
    alreadyPaid: false,
    personalFunds: false,
    refusalReason: null,
    operationId: null,
    purpose: null,
    project: { id: 3, name: 'Doctor.School' },
    product: null,
    account: null,
    counterparty: null,
    documents: [],
    ...overrides,
  }
}

describe('request board composition (spec 339 EARS-509/512/524, Stage-A pick D)', () => {
  it('EARS-509: gives the board exactly the four columns of the status machine', () => {
    expect(REQUEST_BOARD_COLUMNS.map((column) => column.status)).toEqual([
      'submitted',
      'approved',
      'posted',
      'refused',
    ])
  })

  it('EARS-509: files every request under its own status and keeps drafts off the board', () => {
    const grouped = groupRequestsByStatus([
      item({ id: 1, status: 'submitted' }),
      item({ id: 2, status: 'approved' }),
      item({ id: 3, status: 'posted' }),
      item({ id: 4, status: 'refused' }),
      item({ id: 5, status: 'draft', own: true }),
      item({ id: 6, status: 'cancelled', own: true }),
    ])
    expect(grouped.submitted.map((request) => request.id)).toEqual([1])
    expect(grouped.approved.map((request) => request.id)).toEqual([2])
    expect(grouped.posted.map((request) => request.id)).toEqual([3])
    expect(grouped.refused.map((request) => request.id)).toEqual([4])
    expect(boardColumnCounts(grouped)).toEqual({ submitted: 1, approved: 1, posted: 1, refused: 1 })
  })

  it('EARS-509: keeps the newest money movement at the top of a column', () => {
    const grouped = groupRequestsByStatus([
      item({ id: 1, occurredOn: '2026-08-01' }),
      item({ id: 2, occurredOn: '2026-08-30' }),
      item({ id: 3, occurredOn: '2026-08-15' }),
    ])
    expect(grouped.submitted.map((request) => request.id)).toEqual([2, 3, 1])
  })

  it('EARS-502/524: lets only an approver drag, and never a terminal card', () => {
    expect(canDragRequest(item({ status: 'submitted' }), true)).toBe(true)
    expect(canDragRequest(item({ status: 'approved' }), true)).toBe(true)
    expect(canDragRequest(item({ status: 'posted' }), true)).toBe(false)
    expect(canDragRequest(item({ status: 'refused' }), true)).toBe(false)
    expect(canDragRequest(item({ status: 'submitted' }), false)).toBe(false)
  })

  it('EARS-508/511: marks on the card what the reader must know before opening it', () => {
    expect(
      requestCardFlags(item({ alreadyPaid: true, personalFunds: true })).map((f) => f.id),
    ).toEqual(['already-paid', 'personal-funds'])
    expect(
      requestCardFlags(item({ status: 'approved', documents: [] })).map((flag) => flag.id),
    ).toContain('no-document')
    expect(
      requestCardFlags(
        item({
          status: 'approved',
          documents: [
            {
              id: 1,
              filename: 'inv.pdf',
              mime: 'application/pdf',
              size: 10,
              kind: 'ru_invoice',
              uploadedAt: '2026-08-22T00:00:00.000Z',
            },
          ],
        }),
      ).map((flag) => flag.id),
    ).not.toContain('no-document')
  })

  it('EARS-502: keeps «Мои заявки» to the reader own requests, drafts included', () => {
    expect(
      ownRequests([
        item({ id: 1, own: true, status: 'draft' }),
        item({ id: 2, own: false }),
        item({ id: 3, own: true, status: 'posted' }),
      ]).map((request) => request.id),
    ).toEqual([1, 3])
  })

  it('EARS-508: formats money at the precision the currency reference declares', () => {
    const currencies = [
      { code: 'RUB', name: 'Рубль', precision: 2 },
      { code: 'JPY', name: 'Иена', precision: 0 },
    ]
    expect(currencyPrecision(currencies, 'RUB')).toBe(2)
    expect(currencyPrecision(currencies, 'JPY')).toBe(0)
    expect(currencyPrecision(currencies, 'XXX')).toBe(2)
  })
})
