// Specifies the requests board's data provider
// (src/app/(platform)/p/finance/requests/request-board-provider.ts). The board
// writes JSON to the act endpoints and MULTIPART to the document endpoint
// (spec 339 EARS-514) through the same provider, so that both report through
// the one notification channel Refine gives `useCustomMutation`.
import { describe, expect, it, vi } from 'vitest'

import { createRequestBoardDataProvider } from '@/app/(platform)/p/finance/requests/request-board-provider'

function okFetch(body = '{}') {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status: 200 }))
}

describe('request board data provider (spec 339 §C)', () => {
  it('EARS-510: sends an act as JSON with the JSON content type', async () => {
    const fetchImpl = okFetch()
    const provider = createRequestBoardDataProvider(fetchImpl as unknown as typeof fetch)

    await provider.custom!({
      url: '/p/finance/api/requests/1/actions',
      method: 'post',
      payload: { act: 'approve' },
    })

    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(init.body).toBe('{"act":"approve"}')
  })

  it('EARS-514: sends a document upload as the multipart body itself, boundary untouched', async () => {
    const fetchImpl = okFetch('{"id":9}')
    const provider = createRequestBoardDataProvider(fetchImpl as unknown as typeof fetch)

    const form = new FormData()
    form.append('file', new File(['%PDF-1.4'], 'чек.pdf', { type: 'application/pdf' }))
    form.append('kind', 'fiscal_receipt')
    form.append('intakeItemId', '2')

    const answer = await provider.custom!({
      url: '/p/finance/api/documents',
      method: 'post',
      payload: form as unknown as Record<string, unknown>,
    })

    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.body).toBe(form)
    // Setting it ourselves would strip the boundary the browser writes.
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined()
    expect(answer.data).toEqual({ id: 9 })
  })

  it('EARS-514: carries the server refusal text through as the provider error', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('Файл больше предела (EARS-514).', { status: 413 }),
    )
    const provider = createRequestBoardDataProvider(fetchImpl as unknown as typeof fetch)

    await expect(
      provider.custom!({
        url: '/p/finance/api/documents',
        method: 'post',
        payload: new FormData(),
      }),
    ).rejects.toMatchObject({ statusCode: 413, message: 'Файл больше предела (EARS-514).' })
  })

  // A request is written through its ACTS, never through a CRUD verb — and an
  // accidental `useOne` / `useCreate` must fail loudly at the call rather than
  // answer with an empty record. `getList` is no longer among them: since the
  // owner's 2026-09-15 acceptance the register is read through the whitelist's
  // List block, which asks the provider for one page.
  it('refuses every WRITE verb with 501 instead of answering an empty record', () => {
    const provider = createRequestBoardDataProvider(okFetch() as unknown as typeof fetch)

    for (const method of ['getOne', 'create', 'update', 'deleteOne'] as const) {
      expect(() => (provider[method] as () => unknown)()).toThrowError(
        expect.objectContaining({ statusCode: 501 }),
      )
    }
  })
})

const SNAPSHOT = {
  permissions: { canApprove: true, canEnter: true },
  references: {
    accounts: [],
    counterparties: [],
    currencies: [{ code: 'RUB', name: 'Российский рубль', precision: 2 }],
    products: [],
    projects: [],
    purposes: [],
  },
  requests: [
    {
      id: 1,
      own: true,
      status: 'submitted',
      occurredOn: '2026-08-01',
      amount: '100',
      currency: 'RUB',
    },
    {
      id: 2,
      own: false,
      status: 'refused',
      occurredOn: '2026-08-20',
      amount: '200',
      currency: 'RUB',
    },
    {
      id: 3,
      own: true,
      status: 'posted',
      occurredOn: '2026-08-10',
      amount: '300',
      currency: 'RUB',
    },
  ],
  liabilities: [{ memberId: 4, memberName: 'М. Иванова', currency: 'RUB', balance: '500' }],
}

function snapshotFetch() {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(SNAPSHOT), { status: 200 }),
  )
}

/** A snapshot whose liabilities are the register under test. */
function liabilitiesFetch(liabilities: (typeof SNAPSHOT)['liabilities']) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ ...SNAPSHOT, liabilities }), { status: 200 }),
  )
}

// The register half of the same provider (#388 wave 3). The block asks for ONE
// page; the provider reads the board snapshot and answers with the page, the
// size of the whole filtered register and its per-currency totals.
describe('request board data provider — the register the List block reads (#388)', () => {
  it('answers getList with the page, the filtered total and the totals row', async () => {
    const provider = createRequestBoardDataProvider(snapshotFetch() as unknown as typeof fetch)

    const answer = (await provider.getList({
      resource: 'finance-requests',
      pagination: { currentPage: 1, pageSize: 2, mode: 'server' },
    })) as unknown as { data: { id: number }[]; total: number; totals: unknown }

    expect(answer.data.map((row) => row.id)).toEqual([2, 3])
    expect(answer.total).toBe(3)
    expect(answer.totals).toEqual([{ currency: 'RUB', amount: '600' }])
  })

  it('narrows the register to the reader’s own filings when «мои» is the scope', async () => {
    const provider = createRequestBoardDataProvider(snapshotFetch() as unknown as typeof fetch)

    const answer = (await provider.getList({
      resource: 'finance-requests',
      filters: [{ field: 'own', operator: 'eq', value: true }],
    })) as unknown as { data: { id: number }[]; total: number }

    expect(answer.data.map((row) => row.id)).toEqual([3, 1])
    expect(answer.total).toBe(2)
  })

  it('carries the whole snapshot alongside the page, so the screen reads one moment', async () => {
    const provider = createRequestBoardDataProvider(snapshotFetch() as unknown as typeof fetch)

    const answer = (await provider.getList({ resource: 'finance-requests' })) as unknown as {
      snapshot: { permissions: { canApprove: boolean } }
    }

    expect(answer.snapshot.permissions.canApprove).toBe(true)
  })

  it('answers the liabilities register with a row per member and currency', async () => {
    const provider = createRequestBoardDataProvider(snapshotFetch() as unknown as typeof fetch)

    const answer = (await provider.getList({ resource: 'finance-liabilities' })) as unknown as {
      data: { id: string; memberName: string }[]
      total: number
    }

    expect(answer.total).toBe(1)
    expect(answer.data[0]).toMatchObject({ id: '4-RUB', memberName: 'М. Иванова' })
  })

  it('refuses a resource this board does not serve rather than answering an empty list', async () => {
    const provider = createRequestBoardDataProvider(snapshotFetch() as unknown as typeof fetch)

    await expect(provider.getList({ resource: 'invoices' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('carries the server refusal of the snapshot read through as the provider error', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('Заявки недоступны.', { status: 403 }),
    )
    const provider = createRequestBoardDataProvider(fetchImpl as unknown as typeof fetch)

    await expect(provider.getList({ resource: 'finance-requests' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Заявки недоступны.',
    })
  })
  // The liabilities register is a register too (#388 round-7 blocker): the panel
  // renders a `DataTableSorter` on «Участник» and asks for `pageSize: 25`, and
  // `@refinedev/react-table` drives both SERVER-side (`manualSorting` /
  // `manualPagination`). A provider that ignores `sorters` gives the reader a
  // sort arrow that reorders nothing, and one that answers the whole register as
  // `data` while counting pages off the same number offers pages that do not
  // exist.
  it('orders the liabilities register by the column the panel offers a sorter on', async () => {
    const provider = createRequestBoardDataProvider(
      liabilitiesFetch([
        { memberId: 4, memberName: 'М. Иванова', currency: 'RUB', balance: '500' },
        { memberId: 5, memberName: 'А. Абрамов', currency: 'RUB', balance: '700' },
        { memberId: 6, memberName: 'Я. Яковлев', currency: 'RUB', balance: '100' },
      ]) as unknown as typeof fetch,
    )

    const answer = (await provider.getList({
      resource: 'finance-liabilities',
      sorters: [{ field: 'memberName', order: 'asc' }],
    })) as unknown as { data: { memberName: string }[]; total: number }

    expect(answer.data.map((row) => row.memberName)).toEqual([
      'А. Абрамов',
      'М. Иванова',
      'Я. Яковлев',
    ])
    expect(answer.total).toBe(3)
  })

  it('answers the liabilities page asked for, counted off the whole register', async () => {
    const provider = createRequestBoardDataProvider(
      liabilitiesFetch([
        { memberId: 4, memberName: 'М. Иванова', currency: 'RUB', balance: '500' },
        { memberId: 5, memberName: 'А. Абрамов', currency: 'RUB', balance: '700' },
        { memberId: 6, memberName: 'Я. Яковлев', currency: 'RUB', balance: '100' },
      ]) as unknown as typeof fetch,
    )

    const answer = (await provider.getList({
      resource: 'finance-liabilities',
      pagination: { currentPage: 2, pageSize: 2, mode: 'server' },
    })) as unknown as { data: { id: string }[]; total: number }

    // Page 2 of a three-row register is one row — and `total` stays the size of
    // the whole register, which is what the pager counts pages of.
    expect(answer.data.map((row) => row.id)).toEqual(['6-RUB'])
    expect(answer.total).toBe(3)
  })
})
