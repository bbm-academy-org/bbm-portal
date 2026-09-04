import { describe, expect, it } from 'vitest'

import type { RequestBoardItem } from '@/app/(platform)/p/finance/requests/request-board-contract'
import {
  boardColumnCounts,
  canAttachDocument,
  canDragRequest,
  documentUploadRefusal,
  DOCUMENT_UPLOAD_MAX_BYTES,
  currencyPrecision,
  filedRequestNotification,
  FINANCE_REQUEST_BOARD_STATUSES,
  groupRequestsByStatus,
  ownRequests,
  planRequestDrop,
  postingActNeedsMoneyFacts,
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

describe('attaching the confirming document (spec 339 EARS-502/511/514)', () => {
  it('EARS-502/511: lets the submitter or an entry-role holder attach, and nobody else', () => {
    const approved = item({ status: 'approved', own: false })
    expect(canAttachDocument(approved, false)).toBe(false)
    expect(canAttachDocument(approved, true)).toBe(true)
    expect(canAttachDocument(item({ status: 'approved', own: true }), false)).toBe(true)
    expect(canAttachDocument(item({ status: 'submitted', own: true }), false)).toBe(true)
    expect(canAttachDocument(item({ status: 'draft', own: true }), false)).toBe(true)
  })

  it('EARS-505/512: closes the attach control on a request nothing can be added to', () => {
    for (const status of ['posted', 'refused', 'cancelled'] as const) {
      expect(canAttachDocument(item({ status, own: true }), true)).toBe(false)
    }
  })

  it('EARS-514: refuses an oversize or wrong-typed file before it costs a request', () => {
    const pdf = { name: 'чек.pdf', size: 1024, type: 'application/pdf' }
    expect(documentUploadRefusal(pdf)).toBeNull()
    expect(documentUploadRefusal({ ...pdf, type: 'image/jpeg', name: 'чек.jpg' })).toBeNull()
    expect(documentUploadRefusal({ ...pdf, type: 'text/javascript', name: 'x.js' })).toMatch(
      /PDF или изображение/i,
    )
    expect(documentUploadRefusal({ ...pdf, size: DOCUMENT_UPLOAD_MAX_BYTES + 1 })).toMatch(/25 МБ/)
  })
})

describe('what the member is told after filing (spec 339 EARS-508/509/526)', () => {
  // The create endpoint answers with the status the item REALLY has, and the
  // notification is derived from that answer rather than asserted ahead of it:
  // a request filed with a purpose is submitted in the same act and is in
  // «Ждут», a request that only PROPOSES its purpose stays a draft
  // (EARS-526) and is nowhere on the board.
  it('EARS-509: a submitted request is reported as standing in the «Ждут» column', () => {
    const notification = filedRequestNotification({ data: { request: { status: 'submitted' } } })
    expect(notification.message).toContain('подана')
    expect(notification.description).toContain('Ждут')
  })

  it('EARS-526: a draft is reported as a draft and names where it can be found', () => {
    const notification = filedRequestNotification({ data: { request: { status: 'draft' } } })
    expect(notification.description).not.toContain('Ждут')
    expect(notification.message).toContain('черновик')
    expect(notification.description).toContain('Мои заявки')
  })

  it('EARS-509: an unreadable answer claims no column at all', () => {
    for (const payload of [undefined, null, {}, { data: {} }]) {
      expect(filedRequestNotification(payload).description).not.toContain('Ждут')
    }
  })
})

/**
 * EARS-533 — which act has to ask for the money facts before it posts.
 *
 * Derived from spec 339's acceptance scenario 3: the pre-spend request is filed
 * with no account and no date, approval posts nothing, and the confirmation is
 * the act that asks «откуда и когда» before the operation exists.
 */
describe('the money facts the posting act asks for (spec 339 EARS-533)', () => {
  const document = {
    id: 1,
    filename: 'receipt.pdf',
    mime: 'application/pdf',
    size: 10,
    kind: 'fiscal_receipt' as const,
    uploadedAt: '2026-09-03T10:00:00.000Z',
  }
  const preSpend = item({ status: 'approved', occurredOn: null, account: null })

  it('EARS-533: the confirmation of a pre-spend request asks for them', () => {
    expect(postingActNeedsMoneyFacts({ ...preSpend, documents: [document] }, 'confirm')).toBe(true)
  })

  it('EARS-506/511/533: an approval that only AUTHORISES asks for nothing — it posts nothing', () => {
    expect(postingActNeedsMoneyFacts({ ...preSpend, status: 'submitted' }, 'approve')).toBe(false)
    expect(postingActNeedsMoneyFacts(preSpend, 'refuse')).toBe(false)
  })

  it('EARS-510/533: an approval that posts in one act does ask for them', () => {
    expect(
      postingActNeedsMoneyFacts(
        { ...preSpend, status: 'submitted', documents: [document] },
        'approve',
      ),
    ).toBe(true)
  })

  it('EARS-511/533: an «уже потрачено» request is posted from what it already said', () => {
    const spent = item({
      status: 'approved',
      alreadyPaid: true,
      occurredOn: '2026-08-22',
      account: { id: 1, name: 'Банк RUB', currency: 'RUB' },
      documents: [document],
    })
    expect(postingActNeedsMoneyFacts(spent, 'confirm')).toBe(false)
  })

  it('EARS-513/533: own funds name no company account, and that is not a missing one', () => {
    const own = item({
      status: 'approved',
      alreadyPaid: true,
      personalFunds: true,
      occurredOn: '2026-08-22',
      account: null,
      documents: [document],
    })
    expect(postingActNeedsMoneyFacts(own, 'confirm')).toBe(false)
  })

  it('EARS-533: an undated intent sorts above the dated cards of its column, not below them', () => {
    const groups = groupRequestsByStatus([
      item({ id: 1, occurredOn: '2026-08-22' }),
      item({ id: 2, occurredOn: null }),
      item({ id: 3, occurredOn: '2026-09-01' }),
    ])
    expect(groups.submitted.map((request) => request.id)).toEqual([2, 3, 1])
  })
})
