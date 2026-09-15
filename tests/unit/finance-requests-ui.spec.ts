// Specifies the /p/finance/requests board surface (Stage-A pick D, #339/#388):
// src/app/(platform)/p/finance/requests/RequestsBoardScreen.tsx and the sheets
// it opens. The board reads ONE snapshot and writes through the module's own
// act endpoints, so the Refine hooks are mocked at their boundary the way
// `member-admin-ui.spec.ts` mocks the cabinet's.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

// The mock reproduces the REAL contract of `useCustom` in
// `@refinedev/core@5.0.12` (`dist/index.cjs`), not a convenient shape:
//
//   return { query: queryResponse, result: { data: queryResponse.data?.data || EMPTY_OBJECT } }
//
// `query` is react-query's own QueryObserverResult over `CustomResponse<T>` —
// `{ data: payload }`, and `undefined` in every state before the query
// resolves — while `result.data` falls back to a FROZEN, TRUTHY `{}`. A screen
// that reads `result.data` therefore never sees `null`, and its loading and
// error branches are dead code. `refine.custom.data` below is the PAYLOAD the
// data provider resolved with (`null` = not resolved), and the mock derives
// both shapes from it exactly as the hook does.
const refine = vi.hoisted(() => ({
  EMPTY_OBJECT: Object.freeze({}),
  custom: {
    data: null as unknown,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  mutate: vi.fn(),
  isPending: false,
  invalidate: vi.fn(),
}))

vi.mock('@refinedev/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@refinedev/core')>()
  return {
    ...actual,
    useCustom: () => {
      const response = refine.custom.data === null ? undefined : { data: refine.custom.data }
      return {
        query: {
          data: response,
          isLoading: refine.custom.isLoading,
          isSuccess: response !== undefined && refine.custom.error === null,
          isError: refine.custom.error !== null,
          error: refine.custom.error,
          refetch: refine.custom.refetch,
        },
        result: { data: response?.data ?? refine.EMPTY_OBJECT },
      }
    },
    useCustomMutation: () => ({
      mutate: refine.mutate,
      mutation: { isPending: refine.isPending },
    }),
    useInvalidate: () => refine.invalidate,
  }
})

// The REGISTER half of the same snapshot (#388 wave 3). `@refinedev/react-table`
// is mocked where `member-admin-ui.spec.ts` mocks it — at the hook — so the
// whitelist's List block, its pager, its sorter and its totals row all render
// for REAL on top of a real TanStack table, driven by the very selection
// function the data provider answers `getList` with.
vi.mock('@refinedev/react-table', async () => {
  const React_ = (await import('react')).default
  const { getCoreRowModel, useReactTable } = await import('@tanstack/react-table')
  const { selectRequestPage } =
    await import('@/app/(platform)/p/finance/requests/request-table-model')

  return {
    useTable: <TData>({
      columns,
      refineCoreProps,
    }: {
      columns: never[]
      refineCoreProps?: Record<string, never>
    }) => {
      const props = (refineCoreProps ?? {}) as Record<string, never>
      const resource = props.resource as unknown as string | undefined
      const pageSizeProp =
        (props.pagination as unknown as { pageSize?: number } | undefined)?.pageSize ?? 25
      const permanent = ((props.filters as unknown as { permanent?: unknown[] } | undefined)
        ?.permanent ?? []) as { field?: string; value?: unknown }[]

      const [currentPage, setCurrentPage] = React_.useState(1)
      const [pageSize, setPageSize] = React_.useState(pageSizeProp)
      const [sorting, setSorting] = React_.useState<{ id: string; desc: boolean }[]>([])

      const snapshot = refine.custom.data as RequestsSnapshot | null
      const own = permanent.some((filter) => filter.field === 'own' && filter.value === true)
      const sorters = sorting.map((entry) => ({
        field: entry.id,
        order: entry.desc ? ('desc' as const) : ('asc' as const),
      }))

      let rows: unknown[] = []
      let total = 0
      if (snapshot !== null) {
        if (resource === 'finance-liabilities') {
          rows = snapshot.liabilities.map((liability) => ({
            ...liability,
            id: `${liability.memberId}-${liability.currency}`,
          }))
          total = rows.length
        } else {
          const page = selectRequestPage(snapshot.requests, {
            own,
            sorters,
            currentPage,
            pageSize,
          })
          rows = page.rows
          total = page.total
        }
      }

      const reactTable = useReactTable<TData>({
        data: rows as TData[],
        columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        manualSorting: true,
        manualFiltering: true,
        state: { sorting },
        onSortingChange: setSorting as never,
      })

      return {
        reactTable,
        refineCore: {
          tableQuery: {
            isLoading: refine.custom.isLoading,
            error: refine.custom.error,
            data: snapshot === null ? undefined : { data: rows, total },
            refetch: refine.custom.refetch,
          },
          currentPage,
          setCurrentPage,
          pageCount: Math.max(1, Math.ceil(total / (pageSize || 1))),
          pageSize,
          setPageSize,
          sorters,
          setSorters: () => {},
          filters: permanent,
          setFilters: () => {},
        },
      }
    },
  }
})

import type {
  RequestBoardItem,
  RequestsSnapshot,
} from '@/app/(platform)/p/finance/requests/request-board-contract'
import { RequestsBoardScreen } from '@/app/(platform)/p/finance/requests/RequestsBoardScreen'

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
    createdByName: 'М. Иванова',
    refusalReason: null,
    operationId: null,
    purpose: { id: 21, name: 'Продакшн', categoryId: 5, categoryName: 'Производство' },
    project: { id: 3, name: 'Doctor.School' },
    product: null,
    account: { id: 1, name: 'Банк RUB', currency: 'RUB' },
    counterparty: { id: 7, name: 'ООО «Студия-7»' },
    documents: [],
    ...overrides,
  }
}

function snapshot(overrides: Partial<RequestsSnapshot> = {}): RequestsSnapshot {
  return {
    permissions: { canApprove: true, canEnter: true },
    references: {
      accounts: [{ id: 1, name: 'Банк RUB', currency: 'RUB' }],
      counterparties: [{ id: 7, name: 'ООО «Студия-7»' }],
      currencies: [{ code: 'RUB', name: 'Российский рубль', precision: 2 }],
      products: [{ id: 11, name: 'Урок №14', projectId: 3 }],
      projects: [{ id: 3, name: 'Doctor.School' }],
      purposes: [{ id: 21, name: 'Продакшн', categoryId: 5, productBinding: 'optional' }],
    },
    requests: [item()],
    liabilities: [],
    ...overrides,
  }
}

/** The screen as a reader first meets it since decision 35: the TABLE view. */
function renderScreen() {
  return render(React.createElement(RequestsBoardScreen))
}

/** The table's own region — every row assertion is scoped to it. */
function requestsTable() {
  return screen.getByRole('region', { name: 'Список заявок' })
}

function pick(role: 'tab', name: string | RegExp) {
  // Radix activates a tab on mousedown, not on a bare click.
  const control = screen.getByRole(role, { name })
  fireEvent.mouseDown(control)
  fireEvent.click(control)
  return control
}

/**
 * The KANBAN, which since decision 35 (Антон, 2026-09-14) is a view an approver
 * switches TO rather than the one the route opens on. Every board assertion in
 * this file goes through here; a state that never reaches a toggle (the
 * skeleton, the two refusal Alerts) simply has none to press.
 */
function renderBoard() {
  const rendered = render(React.createElement(RequestsBoardScreen))
  const toggle = screen.queryByRole('tab', { name: 'Доска' })
  if (toggle !== null) {
    fireEvent.mouseDown(toggle)
    fireEvent.click(toggle)
  }
  return rendered
}

function openCard(id: number) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Заявка №${id}`) }))
}

beforeEach(() => {
  window.localStorage.clear()
  refine.custom.data = snapshot()
  refine.custom.isLoading = false
  refine.custom.error = null
  refine.custom.refetch = vi.fn()
  refine.mutate = vi.fn()
  refine.isPending = false
  refine.invalidate = vi.fn()
})

afterEach(() => cleanup())

describe('/p/finance/requests board (spec 339 §C, Stage-A pick D)', () => {
  it('EARS-509: shows the four status columns with the requests filed under them', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 1, status: 'submitted' }),
        item({ id: 2, status: 'approved', note: 'Монтаж, октябрь' }),
        item({ id: 3, status: 'posted', note: 'Студия, урок №13' }),
        item({ id: 4, status: 'refused', note: 'Микрофон', refusalReason: 'есть на складе' }),
      ],
    })
    renderBoard()

    for (const title of ['Ждут', 'Одобрены', 'Проведены', 'Отклонены']) {
      expect(screen.getByRole('region', { name: new RegExp(title) })).toBeTruthy()
    }
    expect(
      within(screen.getByRole('region', { name: /Ждут/ })).getByText(/Аренда студии/),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('region', { name: /Отклонены/ })).getByText(/есть на складе/),
    ).toBeTruthy()
  })

  it('EARS-509: shows the skeleton while the snapshot has not resolved', async () => {
    // The unresolved state of the REAL hook: the query is loading and
    // `result.data` is the frozen `{}`, NOT `null`.
    refine.custom.isLoading = true
    refine.custom.data = null
    renderBoard()
    expect(screen.getByLabelText('Загружаем заявки')).toBeTruthy()
    expect(screen.queryByRole('region', { name: /Ждут/ })).toBeNull()
  })

  it('EARS-509: says the board is empty once an empty snapshot has resolved', async () => {
    refine.custom.data = snapshot({ requests: [] })
    renderBoard()
    expect(screen.getByText(/Заявок пока нет/)).toBeTruthy()
    expect(screen.queryByLabelText('Загружаем заявки')).toBeNull()
  })

  it('EARS-509: offers a retry when the board cannot be read at all', async () => {
    refine.custom.isLoading = false
    refine.custom.data = null
    refine.custom.error = { statusCode: 500, message: 'Доска недоступна.' }
    renderBoard()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Доска недоступна.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Попробовать снова' }))
    expect(refine.custom.refetch).toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: /Ждут/ })).toBeNull()
  })

  it('EARS-502: refuses the board to a session the module does not admit', async () => {
    refine.custom.isLoading = false
    refine.custom.data = null
    refine.custom.error = { statusCode: 403, message: 'Нужна роль platform-user.' }
    renderBoard()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Нужна роль platform-user.')
    // A refusal is not a transient failure: there is nothing to retry.
    expect(within(alert).queryByRole('button', { name: 'Попробовать снова' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Новая заявка' })).toBeNull()
  })

  it('EARS-509: opens the details sheet from a card and reads the document in place', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({
          documents: [
            {
              id: 9,
              filename: 'инвойс.pdf',
              mime: 'application/pdf',
              size: 1024,
              kind: 'ru_invoice',
              uploadedAt: '2026-08-22T10:00:00.000Z',
            },
          ],
        }),
      ],
    })
    renderBoard()
    openCard(1)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText(/ООО «Студия-7»/)).toBeTruthy()
    expect(within(sheet).getByTitle('инвойс.pdf').getAttribute('data')).toBe(
      '/p/finance/api/documents/9?disposition=inline',
    )
  })

  it('EARS-510: approves from the sheet and asks the board to re-read itself', async () => {
    renderBoard()
    openCard(1)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Одобрить' }))

    expect(refine.mutate).toHaveBeenCalledTimes(1)
    const call = refine.mutate.mock.calls[0][0]
    expect(call).toMatchObject({
      url: '/p/finance/api/requests/1/actions',
      method: 'post',
      values: { act: 'approve' },
    })
    expect(call.successNotification).toBeTruthy()
    expect(call.errorNotification).toBeTruthy()

    await act(async () => {
      refine.mutate.mock.calls[0][1].onSuccess()
    })
    expect(refine.custom.refetch).toHaveBeenCalled()
  })

  it('EARS-511: offers the one-act confirmation only on an approved request that carries a document', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 2, status: 'approved', documents: [] }),
        item({
          id: 3,
          status: 'approved',
          documents: [
            {
              id: 9,
              filename: 'акт.pdf',
              mime: 'application/pdf',
              size: 10,
              kind: 'ru_invoice',
              uploadedAt: '2026-08-22T10:00:00.000Z',
            },
          ],
        }),
      ],
    })
    renderBoard()

    openCard(2)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(
      within(screen.getByRole('dialog')).queryByRole('button', { name: 'Провести' }),
    ).toBeNull()
    expect(
      within(screen.getByRole('dialog')).getByText(/без подтверждающего документа/i),
    ).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    openCard(3)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Провести' }))
    expect(refine.mutate.mock.calls[0][0]).toMatchObject({
      url: '/p/finance/api/requests/3/actions',
      values: { act: 'confirm' },
    })
  })

  it('EARS-512: insists on a reason before a refusal leaves the screen', async () => {
    renderBoard()
    openCard(1)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отклонить…' }))

    const reason = await screen.findByLabelText('Причина отказа')
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить заявку' }))
    expect(refine.mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Укажите причину отказа.')).toBeTruthy()

    fireEvent.change(reason, { target: { value: 'есть на складе' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить заявку' }))
    expect(refine.mutate.mock.calls[0][0]).toMatchObject({
      url: '/p/finance/api/requests/1/actions',
      values: { act: 'refuse', reason: 'есть на складе' },
    })
  })

  it('EARS-524: refuses an illegal drag on the board and moves no card', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 3, status: 'posted' })] })
    renderBoard()

    const card = screen.getByRole('button', { name: /Заявка №3/ })
    expect(card.getAttribute('draggable')).toBe('false')

    const column = screen.getByRole('region', { name: /Ждут/ })
    fireEvent.drop(column, {
      dataTransfer: { getData: () => '3', dropEffect: 'move' },
    })
    expect(refine.mutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('EARS-510/524: a legal drag opens the act instead of flipping the status by itself', async () => {
    renderBoard()
    const column = screen.getByRole('region', { name: /Одобрены/ })
    fireEvent.drop(column, { dataTransfer: { getData: () => '1', dropEffect: 'move' } })

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(refine.mutate).not.toHaveBeenCalled()
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Одобрить' }),
    ).toBeTruthy()
  })

  // WHY: the owner's report on the live stand — a press-and-drag on a card
  // «only selects text». Chromium suppresses text selection INSIDE a
  // `[draggable="true"]` subtree and NOWHERE else, so the affordance was
  // self-inflicted: every card the reader cannot drag — a terminal one, and
  // for a reader without the approve role every card on the board — turned a
  // drag attempt into a selection of the card's own body, which is what a
  // broken drag looks like. A card is a CONTROL; its text is never the thing
  // being selected, draggable or not.
  it('#388: a card refuses to become a text selection, draggable or not', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 1, status: 'submitted' }), item({ id: 3, status: 'posted' })],
    })
    renderBoard()

    const live = screen.getByRole('button', { name: /Заявка №1/ })
    const terminal = screen.getByRole('button', { name: /Заявка №3/ })
    expect(live.getAttribute('draggable')).toBe('true')
    expect(terminal.getAttribute('draggable')).toBe('false')
    expect(live.className).toContain('select-none')
    expect(terminal.className).toContain('select-none')
  })

  // WHY: a native HTML5 drag paints a ghost and nothing else. With no target
  // feedback a drag that WORKS is indistinguishable from one that does not —
  // the second half of the same report. The column under the pointer says it
  // will take the card, and stops saying it the moment the drag leaves, drops
  // or is abandoned.
  it('#388: the column under a drag says it will take the card', async () => {
    renderBoard()
    const column = screen.getByRole('region', { name: /Одобрены/ })
    expect(column.getAttribute('data-drag-over')).toBeNull()

    fireEvent.dragOver(column)
    expect(column.getAttribute('data-drag-over')).toBe('true')

    fireEvent.dragLeave(column)
    expect(column.getAttribute('data-drag-over')).toBeNull()

    fireEvent.dragOver(column)
    fireEvent.drop(column, { dataTransfer: { getData: () => '1', dropEffect: 'move' } })
    await waitFor(() => expect(column.getAttribute('data-drag-over')).toBeNull())
  })

  it('EARS-501/502: gives a role-less reader a read-only surface and its own requests', async () => {
    refine.custom.data = snapshot({
      permissions: { canApprove: false, canEnter: false },
      requests: [item({ id: 1, own: true })],
    })
    // Since decision 35 such a reader has no BOARD to be read-only on — the
    // toggle is the approve role's — so `renderBoard` leaves them on the
    // table, and what is asserted is the same thing one rung up: no act.
    renderBoard()

    expect(screen.queryByRole('region', { name: /Ждут/ })).toBeNull()
    openCard(1)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).queryByRole('button', { name: 'Одобрить' })).toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Отозвать' })).toBeTruthy()
  })

  it('EARS-527: shows what BBM owes its members in its own view beside the board', async () => {
    refine.custom.data = snapshot({
      liabilities: [{ memberId: 4, memberName: 'К. Смирнов', currency: 'RUB', balance: '72000' }],
    })
    renderBoard()

    // Radix activates a tab on mousedown, not on a bare click.
    const tab = screen.getByRole('tab', { name: 'Обязательства' })
    fireEvent.mouseDown(tab)
    fireEvent.click(tab)
    const liabilities = await screen.findByRole('region', { name: 'Обязательства' })
    expect(within(liabilities).getByText('К. Смирнов')).toBeTruthy()
    // Twice since #388: once on the row, once in the block's totals footer —
    // a debt register exists to answer «сколько всего мы должны».
    expect(within(liabilities).getAllByText('720,00 RUB')).toHaveLength(2)
  })

  // Since #388 wave 3 (owner acceptance 2026-09-15) an EMPTY form does not file
  // and does not have to be pressed to find that out: the submit is disabled
  // and NAMES what is still missing. A malformed answer is the other half —
  // the button stays live, and the refusal lands under the field it belongs to.
  it('EARS-508: an empty form cannot be sent, and says which fields are still empty', async () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const form = screen.getByRole('dialog')

    const submit = within(form).getByRole('button', { name: 'Подать заявку' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(within(form).getByText(/^Заполните: /).textContent).toContain('сумма документа')
    expect(submit.getAttribute('aria-describedby')).toBe('submit-block-reason')

    fireEvent.click(submit)
    expect(refine.mutate).not.toHaveBeenCalled()
  })

  it('EARS-508: a MALFORMED answer is refused under its own field, not by a dead button', async () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const form = screen.getByRole('dialog')

    // Everything answered — but the sum is not a number.
    fireEvent.change(within(form).getByLabelText('Сумма документа'), {
      target: { value: 'дорого' },
    })
    fireEvent.change(within(form).getByLabelText('Предложение назначения'), {
      target: { value: 'аренда студии' },
    })
    fireEvent.change(within(form).getByLabelText('Новый контрагент'), {
      target: { value: 'ООО «Свет»' },
    })
    fireEvent.click(within(form).getByLabelText('Проект'))
    fireEvent.click(await screen.findByRole('option', { name: 'Doctor.School' }))

    const submit = within(form).getByRole('button', { name: 'Подать заявку' })
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false))
    fireEvent.click(submit)

    await waitFor(() =>
      expect(within(form).getByText('Укажите сумму документа числом больше нуля.')).toBeTruthy(),
    )
    expect(refine.mutate).not.toHaveBeenCalled()
  })

  // WHY: EARS-508/532 — the counterparty is «picked from the counterparty
  // reference OR created inline», one or the other. «Новый контрагент» stood
  // on the form unconditionally, so a member who picked «ООО «Студия-7»» was
  // still asked to name a new counterparty underneath it and had no way to
  // read which of the two would be filed. The purpose pair beside it has
  // always been rendered as the exclusive choice it is; this one was not.
  it('EARS-508/532: asks for a new counterparty only while none is picked from the reference', async () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const form = screen.getByRole('dialog')

    // A blank form stands on «Нет в списке — впишу нового», so the free-text
    // field is where the answer goes.
    expect(within(form).getByLabelText('Новый контрагент')).toBeTruthy()

    fireEvent.click(within(form).getByLabelText('Контрагент'))
    fireEvent.click(await screen.findByRole('option', { name: 'ООО «Студия-7»' }))
    await waitFor(() => expect(within(form).queryByLabelText('Новый контрагент')).toBeNull())

    fireEvent.click(within(form).getByLabelText('Контрагент'))
    fireEvent.click(await screen.findByRole('option', { name: 'Нет в списке — впишу нового' }))
    await waitFor(() => expect(within(form).getByLabelText('Новый контрагент')).toBeTruthy())
  })

  it('EARS-508: names the product a purpose demands and the project cannot give', async () => {
    // #388 journey, state 09: «Продажи курса» binds a product, «Фонд BBM» has
    // none — the field used to disappear while the schema still refused on it,
    // so «Подать заявку» did nothing and said nothing.
    refine.custom.data = snapshot({
      references: {
        accounts: [{ id: 1, name: 'Банк RUB', currency: 'RUB' }],
        counterparties: [{ id: 7, name: 'ООО «Студия-7»' }],
        currencies: [{ code: 'RUB', name: 'Российский рубль', precision: 2 }],
        products: [],
        projects: [{ id: 3, name: 'Фонд BBM' }],
        purposes: [{ id: 21, name: 'Продажи курса', categoryId: 5, productBinding: 'required' }],
      },
    })
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const form = screen.getByRole('dialog')

    fireEvent.click(within(form).getByLabelText('Назначение'))
    fireEvent.click(await screen.findByRole('option', { name: 'Продажи курса' }))
    // No project chosen yet: nothing is known about products, so the form says
    // nothing about them — least of all «у выбранного проекта нет продуктов».
    expect(within(form).queryByText(/нет продуктов/i)).toBeNull()

    fireEvent.click(within(form).getByLabelText('Проект'))
    fireEvent.click(await screen.findByRole('option', { name: 'Фонд BBM' }))

    await waitFor(() => expect(within(form).getByText('Продукт')).toBeTruthy())
    // The empty control and the description both name it; the point is that the
    // field is on the form at all.
    expect(within(form).getAllByText(/нет продуктов/i).length).toBeGreaterThan(0)

    // The other required answers, so the submit is live and the PRODUCT refusal
    // is what the press delivers (#388: submit is disabled only while a
    // required field is EMPTY).
    fireEvent.change(within(form).getByLabelText('Сумма документа'), {
      target: { value: '1 000,00' },
    })
    fireEvent.change(within(form).getByLabelText('Новый контрагент'), {
      target: { value: 'ООО «Свет»' },
    })

    fireEvent.click(within(form).getByRole('button', { name: 'Подать заявку' }))
    // Said ONCE, not twice: the description carries the state and the error
    // carries what to do about it — the same 20-word sentence in both slots is
    // four lines said twice at 390 px.
    await waitFor(() => expect(within(form).getAllByText(/выберите другой проект/i).length).toBe(1))
    expect(refine.mutate).not.toHaveBeenCalled()
  })

  // Attaching the confirming document — the act EARS-511 names, without which the
  // pre-spend path (spec 339 acceptance scenario 3) cannot reach `posted` from
  // this screen at all.

  function pdf(name = 'чек.pdf'): File {
    return new File(['%PDF-1.4 receipt'], name, { type: 'application/pdf' })
  }

  async function openAttachable(id = 2) {
    refine.custom.data = snapshot({
      requests: [item({ id, status: 'approved', own: true, documents: [] })],
    })
    renderBoard()
    openCard(id)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    return screen.getByRole('dialog')
  }

  it('EARS-506/511: attaches a confirming document from the sheet and re-reads the board', async () => {
    const sheet = await openAttachable(2)

    fireEvent.change(within(sheet).getByLabelText('Подтверждающий документ'), {
      target: { files: [pdf()] },
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Приложить документ' }))

    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    const call = refine.mutate.mock.calls[0][0]
    expect(call.url).toBe('/p/finance/api/documents')
    expect(call.method).toBe('post')
    const body = call.values as FormData
    expect(body).toBeInstanceOf(FormData)
    expect((body.get('file') as File).name).toBe('чек.pdf')
    expect(body.get('kind')).toBe('fiscal_receipt')
    expect(body.get('intakeItemId')).toBe('2')
    // The one feedback channel — the notification provider, not a bespoke toast.
    expect(call.successNotification).toBeTruthy()
    expect(call.errorNotification).toBeTruthy()

    // Uploading: the control says so and cannot be fired twice.
    expect(
      (within(sheet).getByRole('button', { name: 'Загружаем…' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await act(async () => {
      refine.mutate.mock.calls[0][1].onSuccess()
    })
    expect(refine.custom.refetch).toHaveBeenCalled()
  })

  it('EARS-511: the one-act confirmation appears on the still-open sheet once the document lands', async () => {
    await openAttachable(2)
    expect(screen.queryByRole('button', { name: 'Провести' })).toBeNull()

    // What the re-read brings back: the same request, now carrying its document.
    refine.custom.data = snapshot({
      requests: [
        item({
          id: 2,
          status: 'approved',
          own: true,
          documents: [
            {
              id: 9,
              filename: 'чек.pdf',
              mime: 'application/pdf',
              size: 17,
              kind: 'fiscal_receipt',
              uploadedAt: '2026-09-03T10:00:00.000Z',
            },
          ],
        }),
      ],
    })
    cleanup()
    renderBoard()
    openCard(2)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Провести' }),
    ).toBeTruthy()
  })

  it('EARS-514: refuses an oversize or wrong-typed file inline and sends nothing', async () => {
    const sheet = await openAttachable(2)
    const input = within(sheet).getByLabelText('Подтверждающий документ')

    const script = new File(['alert(1)'], 'вирус.js', { type: 'text/javascript' })
    fireEvent.change(input, { target: { files: [script] } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Приложить документ' }))
    await waitFor(() => expect(within(sheet).getByText(/PDF или изображение/i)).toBeTruthy())
    expect(refine.mutate).not.toHaveBeenCalled()

    const huge = pdf('огромный.pdf')
    Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [huge] } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Приложить документ' }))
    await waitFor(() => expect(within(sheet).getByText(/25 МБ/)).toBeTruthy())
    expect(refine.mutate).not.toHaveBeenCalled()
  })

  it('EARS-514: reports a refused upload under the field it belongs to', async () => {
    const sheet = await openAttachable(2)
    fireEvent.change(within(sheet).getByLabelText('Подтверждающий документ'), {
      target: { files: [pdf()] },
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Приложить документ' }))
    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))

    await act(async () => {
      refine.mutate.mock.calls[0][1].onError({ message: 'Файл больше предела в 26214400 байт.' })
    })
    expect(within(sheet).getByRole('alert').textContent).toContain('Файл больше предела')
    // The failed attempt is repeatable, not a dead control.
    expect(within(sheet).getByRole('button', { name: 'Приложить документ' })).toBeTruthy()
  })

  it('EARS-502/511: offers no attach control to a reader who neither filed the request nor enters money', async () => {
    refine.custom.data = snapshot({
      permissions: { canApprove: false, canEnter: false },
      requests: [item({ id: 2, status: 'approved', own: false, documents: [] })],
    })
    renderBoard()
    // Somebody else's request, so it is behind «Все» on the table this reader
    // has instead of the board (decision 35).
    pick('tab', 'Все')
    openCard(2)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).queryByLabelText('Подтверждающий документ')).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Приложить документ' })).toBeNull()
  })

  /**
   * EARS-523/534 — an EMPTY document block is not the same fact for every reader.
   *
   * Since decision 35 (#115, 2026-09-14) the «Все» scope hands this sheet
   * another member's request, and EARS-523 strips its documents on the way. For
   * that reader «Документ не приложен.» would be a statement about the
   * REQUEST that the screen has no standing to make — it cannot tell a request
   * with no receipt from one whose receipt is none of this reader's business.
   */
  it('EARS-523/534: an empty document block on someone else’s request names the narrowing, not an absence', async () => {
    refine.custom.data = snapshot({
      permissions: { canApprove: false, canEnter: false },
      requests: [item({ id: 2, status: 'approved', own: false, documents: [] })],
    })
    renderBoard()
    pick('tab', 'Все')
    openCard(2)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')
    expect(
      within(sheet).getByText('Документ виден подавшему заявку и финансовой роли.'),
    ).toBeTruthy()
    expect(within(sheet).queryByText('Документ не приложен.')).toBeNull()
  })

  it('EARS-506: an empty document block on OWN request still reports the absence', async () => {
    refine.custom.data = snapshot({
      permissions: { canApprove: false, canEnter: false },
      requests: [item({ id: 2, status: 'submitted', own: true, documents: [] })],
    })
    renderBoard()
    openCard(2)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('Документ не приложен.')).toBeTruthy()
  })
})

/**
 * EARS-508/533 — a request is an INTENT (owner ruling, Антон, 2026-09-03, #388).
 *
 * Derived from spec 339's acceptance scenario 3: the form asks a pre-spend
 * request for no account and no date, the card shows neither, and the
 * confirmation is the act that asks for them — refusing readably while either
 * is missing.
 */
describe('/p/finance/requests — the money facts belong to the posting act (EARS-508/533)', () => {
  const receipt = {
    id: 9,
    filename: 'чек.pdf',
    mime: 'application/pdf',
    size: 10,
    kind: 'fiscal_receipt' as const,
    uploadedAt: '2026-09-03T10:00:00.000Z',
  }

  it('EARS-508/533: the form asks for no paying account and no money date until «уже потрачено»', async () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const form = screen.getByRole('dialog')

    expect(within(form).queryByText('Счёт списания')).toBeNull()
    expect(within(form).queryByText('Дата движения денег')).toBeNull()
    expect(within(form).getByText(/впишет финансовая роль в момент проведения/i)).toBeTruthy()

    fireEvent.click(within(form).getByRole('checkbox', { name: /Уже потрачено/i }))
    await waitFor(() => expect(within(form).getByText('Счёт списания')).toBeTruthy())
    expect(within(form).getByText('Дата движения денег')).toBeTruthy()
  })

  it('EARS-533: the card and the sheet name the emptiness instead of printing it as a value', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 4, status: 'submitted', occurredOn: null, account: null })],
    })
    renderBoard()
    expect(screen.getAllByText(/деньги ещё не двигались/i).length).toBeGreaterThan(0)

    openCard(4)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getAllByText('вводится при проведении').length).toBe(2)
    expect(within(sheet).queryByText('22.08.2026')).toBeNull()
  })

  it('EARS-533: the confirmation asks for the account and the date, and refuses while either is missing', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 5, status: 'approved', occurredOn: null, account: null, documents: [receipt] }),
      ],
    })
    renderBoard()
    openCard(5)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Провести' }))

    const posting = await screen.findByRole('region', { name: /Провести заявку №5/ })
    fireEvent.click(within(posting).getByRole('button', { name: 'Провести' }))
    await waitFor(() =>
      expect(within(posting).getByText('Выберите счёт, с которого ушли деньги.')).toBeTruthy(),
    )
    expect(within(posting).getByText('Укажите дату, когда деньги действительно ушли.')).toBeTruthy()
    expect(refine.mutate).not.toHaveBeenCalled()
  })

  it('EARS-533: the act carries the account and the date the finance role entered', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 6, status: 'approved', occurredOn: null, account: null, documents: [receipt] }),
      ],
    })
    renderBoard()
    openCard(6)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Провести' }))
    const posting = await screen.findByRole('region', { name: /Провести заявку №6/ })

    fireEvent.click(within(posting).getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: /Банк RUB/ }))
    fireEvent.change(within(posting).getByLabelText('Дата движения денег'), {
      target: { value: '2026-09-01' },
    })
    fireEvent.click(within(posting).getByRole('button', { name: 'Провести' }))

    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    expect(refine.mutate.mock.calls[0][0]).toMatchObject({
      url: '/p/finance/api/requests/6/actions',
      values: {
        act: 'confirm',
        accountId: 1,
        occurredOn: '2026-09-01',
        paidAmount: null,
        paidCurrency: null,
      },
    })
  })

  it('EARS-506/511/533: an approval that only authorises asks for nothing and sends nothing', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 7, status: 'submitted', occurredOn: null, account: null })],
    })
    renderBoard()
    openCard(7)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' }))

    expect(screen.queryByRole('region', { name: /Провести заявку/ })).toBeNull()
    expect(refine.mutate).toHaveBeenCalledTimes(1)
    expect(refine.mutate.mock.calls[0][0].values).toEqual({ act: 'approve' })
  })
})

// The stage-5 UX sanity pass (task-cycle stage 5 item 4) over the frames in
// `docs/evidence/388/` returned three defects in the states this revision
// introduced. One of them is real and is fixed by the assertions below; the
// other two were misreadings of the frames, and the assertions that PROVE them
// misreadings live here too, so the next reader does not re-open them from the
// pictures alone.
describe('/p/finance/requests — the stage-5 UX sanity pass on the posting states', () => {
  const receipt = {
    id: 9,
    filename: 'чек.pdf',
    mime: 'application/pdf',
    size: 10,
    kind: 'fiscal_receipt' as const,
    uploadedAt: '2026-09-03T10:00:00.000Z',
  }

  function fieldGrid() {
    const label = screen.getByText('Контрагент')
    const grid = label.parentElement?.parentElement
    if (!grid) throw new Error('the field block has no grid container')
    return grid
  }

  // DEFECT 3 (real, steps 26 and 30 at 390 px). Two columns inside a 390 px
  // sheet leave ~180 px per cell, and `truncate` then eats the very words that
  // ARE the state: «вводится при пр…», «Операционные …». A state the surface
  // exists to say may not be clipped, so the grid collapses to one column
  // below `sm` and the value wraps instead of ending in an ellipsis. The
  // desktop half of the same clipping is #473 item 3, and dropping `truncate`
  // settles it in the same line of CSS.
  it('the sheet field grid is ONE column below `sm`, so a 390 px reader sees the whole state', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 8, status: 'submitted', occurredOn: null, account: null })],
    })
    renderBoard()
    openCard(8)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    const grid = fieldGrid()
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('sm:grid-cols-2')
    expect(grid.className).not.toMatch(/(^|\s)grid-cols-2(\s|$)/)
  })

  it('a field VALUE wraps rather than being clipped — «вводится при проведении» is never «вводится при пр…»', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 9, status: 'submitted', occurredOn: null, account: null })],
    })
    renderBoard()
    openCard(9)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    for (const value of screen.getAllByText('вводится при проведении')) {
      const paragraph = value.closest('p')
      expect(paragraph).not.toBeNull()
      expect(paragraph?.className).not.toContain('truncate')
    }
  })

  // DEFECT 1 (NOT a defect — a misreading of `27..29-*-desktop-dark.png`, where
  // the two footer buttons are 24 px tall in a 1440 px frame). The dialog's
  // dominant CTA is the kit's `default` variant and «Отмена» its `outline` one,
  // the same pair the sheet footer uses. Pinned as data attributes so the
  // question is answered by a test and not by squinting at a screenshot again.
  // ONE OVERLAY SHAPE since #388 (owner go, Антон, 2026-09-15): the posting act
  // is a SECTION of the details sheet, not a second overlay on top of it — so
  // it is a `region`, and its action row is the sheet footer's grammar.
  it('the posting section carries the primary CTA and a secondary «Отмена», like the sheet footer', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 10, status: 'approved', occurredOn: null, account: null, documents: [receipt] }),
      ],
    })
    renderBoard()
    openCard(10)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Провести' }))

    const posting = await screen.findByRole('region', { name: /Провести заявку №10/ })
    const cta = within(posting).getByRole('button', { name: 'Провести' })
    expect(cta.getAttribute('data-variant')).toBe('default')
    expect(cta.getAttribute('type')).toBe('submit')
    expect(
      within(posting).getByRole('button', { name: 'Отмена' }).getAttribute('data-variant'),
    ).toBe('outline')
    // The kit's own interaction treatment comes WITH `data-variant="default"`
    // above: the frames of step 31 show no change under the forced pseudo-states
    // because the capture forced them on the SHEET's «Приложить документ» behind
    // the dialog (the diff between 29 and each 31 frame sits at x≈1080–1256,
    // y≈730–773), not because the CTA lacks the states. The utilities that carry
    // them belong to `@/ui/button` and are asserted where that kit is tested —
    // pinning their strings here would break this finance test on a kit bump
    // that changed nothing about this surface (#388 review round 2).
  })

  // DEFECT 2 (NOT a defect either): the dialog DOES take focus off the sheet
  // when it opens, so `:focus-visible` on its CTA is reachable by keyboard.
  it('opening the posting section moves focus INTO it, off the record behind', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 11, status: 'approved', occurredOn: null, account: null, documents: [receipt] }),
      ],
    })
    renderBoard()
    openCard(11)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Провести' }))

    const posting = await screen.findByRole('region', { name: /Провести заявку №11/ })
    await waitFor(() => expect(posting.contains(document.activeElement)).toBe(true))
  })
})

describe('/p/finance/requests — the stage-5 UX sanity pass on the requests table', () => {
  // DEFECT (real, step 04 at 390 px). The kit's `TableCell` carries
  // `whitespace-nowrap`, which is right for a date or a sum and wrong for the
  // one FREE-TEXT column: a note of ordinary length made «Что» 543 px wide and
  // the table 968 px inside a 343 px scroll container, so Сумма, Статус and the
  // row's «Открыть» sat ~600 px off-screen with nothing saying they were there.
  // The table stays a table — the fix is that the free-text column WRAPS, the
  // table keeps a floor so the four short columns are not crushed, and a hint
  // below `sm` says the rest is a swipe to the right.
  const LONG_NOTE = 'Приёмочный прогон #388 — намерение, деньги ещё не двигались (mobile-light)'

  // The «Мои заявки» TAB is gone since decision 35 — «мои» is now the
  // preselected scope of the one table, which is what the route opens on. The
  // defect below is the table's either way, so the test follows it there.
  async function mineTab() {
    return requestsTable()
  }

  it('a long note TRUNCATES inside its own column instead of pushing the row off a 390 px screen', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 5, own: true, note: LONG_NOTE })],
    })
    renderScreen()
    const mine = await mineTab()

    // The block's `TableCell` is `whitespace-nowrap` and its table is
    // `table-layout: fixed`, so the fix is no longer «the cell wraps» but «the
    // column has a declared width and the free text clips inside it». The four
    // short columns keep theirs either way, which is what the defect was about.
    const note = within(mine).getByText(LONG_NOTE)
    expect(note.className).toContain('truncate')
    const cell = note.closest('td')
    expect(cell).not.toBeNull()
    expect(cell?.style.width).not.toBe('')
  })

  it('the table keeps the kit’s scroll container, and says below `sm` that there is more to the right', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 6, own: true, note: LONG_NOTE })],
    })
    renderScreen()
    const mine = await mineTab()

    const table = within(mine).getByRole('table')
    expect(table.style.tableLayout).toBe('fixed')
    expect(table.parentElement?.className).toContain('overflow-x-auto')

    const hint = within(mine).getByText(/прокру[тч]/i)
    expect(hint.className).toContain('sm:hidden')
  })
})

// The stage-5 UX sanity pass on the 390 px frames of the SHEET that files a
// request (PR #470 review, states 09/23/24/32/33).
//
// DEFECT (real, measured on the live stand at 390×844 before the fix): the
// «Новая заявка» sheet scrolled SIDEWAYS — `[data-slot="sheet-content"]`
// clientWidth 277, scrollWidth 299 — and the «Назначение» trigger ended at
// x=398, eight pixels past the viewport, with its chevron off-screen.
//
// The mechanism is intrinsic minimum size, not a stray width. `FormItem` is
// `grid gap-2`, so its implicit column is `auto` and the column's automatic
// minimum is the largest MIN-CONTENT contribution among its items. The kit's
// `SelectTrigger` is `whitespace-nowrap`, so its min-content is the whole
// label of the selected option — «Нет подходящего — предложу новое» measured
// 282 px against a 245 px column — and `w-full` cannot help: `width: 100%` is
// clamped UP by `min-width: auto`. The column resolved to 283.34 px and pushed
// the form out of the sheet.
//
// The fix is one class per trigger: `min-w-0` turns the automatic minimum off,
// the column takes the 245 px it has, and `SelectValue`'s existing
// `line-clamp-1` truncates the long option instead of the sheet growing.
// Re-measured on the same stand after the fix: scrollWidth 277 == clientWidth
// 277, trigger right edge 359.
describe('/p/finance/requests — a 390 px reader never scrolls the sheet sideways', () => {
  function comboboxes(scope: HTMLElement) {
    const found = within(scope).getAllByRole('combobox')
    expect(found.length).toBeGreaterThan(0)
    return found
  }

  it('every select in «Новая заявка» may shrink below the width of its longest option', async () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')

    for (const trigger of comboboxes(sheet)) {
      expect(trigger.className).toContain('w-full')
      expect(trigger.className).toContain('min-w-0')
    }
  })

  it('the selects revealed by «Уже потрачено» may shrink too', async () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /Уже потрачено/i }))
    await waitFor(() => expect(within(sheet).getByText('Счёт списания')).toBeTruthy())

    for (const trigger of comboboxes(sheet)) {
      expect(trigger.className).toContain('min-w-0')
    }
  })

  // The same measurement, one field further down. Once the sheet stopped
  // growing, the «Сумма документа» / «Валюта» pair had 245 px to share and the
  // fixed 9rem currency track left the amount 88.5 px — its label wrapped onto
  // two lines and its refusal into four. The currency cell holds three letters
  // («RUB»), so it takes 6rem below `sm` and the declared 9rem from `sm` up:
  // the amount input measures 137 px on the same 390 px stand.
  it('«Сумма документа» keeps a usable width below `sm` — the currency cell is the one that gives', async () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')

    const amount = within(sheet).getByLabelText('Сумма документа')
    const grid = amount.closest('[data-slot="form-item"]')?.parentElement
    expect(grid).not.toBeNull()
    expect(grid?.className).toContain('grid-cols-[minmax(0,1fr)_6rem]')
    expect(grid?.className).toContain('sm:grid-cols-[minmax(0,1fr)_9rem]')
  })

  // The third fixed site, cited by a test of its own: nothing opened the attach
  // form, so «Вид документа» carried the class on the strength of its two
  // siblings alone (review round 4, minor).
  it('the «Вид документа» select of the attach form may shrink too', async () => {
    renderBoard()
    openCard(1)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')

    const kind = within(sheet).getByLabelText('Вид документа')
    expect(kind.className).toContain('min-w-0')
  })

  it('the account select of the posting section may shrink below its longest account name', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({
          id: 12,
          status: 'approved',
          occurredOn: null,
          account: null,
          documents: [
            {
              id: 9,
              filename: 'чек.pdf',
              mime: 'application/pdf',
              size: 10,
              kind: 'fiscal_receipt' as const,
              uploadedAt: '2026-09-03T10:00:00.000Z',
            },
          ],
        }),
      ],
    })
    renderBoard()
    openCard(12)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Провести' }))

    const posting = await screen.findByRole('region', { name: /Провести заявку №12/ })
    for (const trigger of comboboxes(posting)) {
      expect(trigger.className).toContain('min-w-0')
    }
  })
})

/**
 * DECISION 35 (owner Антон, 2026-09-14, #115), PRD 339 US-2/US-3: the route
 * opens on a TABLE of every request for every signed-in member — date,
 * submitter, amount, purpose, status, refusal reason — with a «мои / все»
 * filter preselected on «мои». The picked kanban stays as a board TOGGLE for
 * `finance-approve`, who also gets approve / refuse as row actions.
 */
describe('/p/finance/requests — the table is the default view (decision 35)', () => {
  it('decision 35: opens on the table with «Мои» preselected, for an approver too', async () => {
    renderScreen()

    expect(requestsTable()).toBeTruthy()
    expect(screen.queryByRole('region', { name: /Ждут/ })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Мои' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Все' }).getAttribute('aria-selected')).toBe('false')
  })

  it('decision 35: the row says the date, the submitter, the amount with its currency, the purpose and the status', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 1, own: true, createdByName: 'М. Иванова' })],
    })
    renderScreen()
    const table = requestsTable()

    // «Дата» became «Деньги ушли» (owner acceptance 2026-09-15): the header
    // names what the value IS, so «ещё не двигались» answers the question that
    // was asked. Each header also carries the block's sorter, whose aria text
    // joins the accessible name — hence the prefix match.
    for (const head of ['Деньги ушли', 'Кто подал', 'Сумма', 'Назначение', 'Статус']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(`^${head}`) })).toBeTruthy()
    }
    expect(within(table).getByText('М. Иванова')).toBeTruthy()
    // On the row, and again in the block's totals footer — one request is its
    // own total.
    expect(within(table).getAllByText('45 000,00 RUB')).toHaveLength(2)
    expect(within(table).getByText('Продакшн')).toBeTruthy()
    expect(within(table).getByText('Ждёт решения')).toBeTruthy()
  })

  it('decision 35: «Мои» shows only the reader’s own filings and «Все» the whole queue', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 1, own: true, note: 'Моя заявка' }),
        item({ id: 2, own: false, note: 'Чужая заявка' }),
      ],
    })
    renderScreen()

    expect(within(requestsTable()).queryByText('Чужая заявка')).toBeNull()
    pick('tab', 'Все')
    await waitFor(() => expect(within(requestsTable()).getByText('Чужая заявка')).toBeTruthy())
    expect(within(requestsTable()).getByText('Моя заявка')).toBeTruthy()
  })

  it('decision 35: the refusal reason is a column only where there is a refusal to read', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1, own: true })] })
    renderScreen()
    expect(
      within(requestsTable()).queryByRole('columnheader', { name: 'Причина отказа' }),
    ).toBeNull()

    cleanup()
    refine.custom.data = snapshot({
      requests: [item({ id: 2, own: true, status: 'refused', refusalReason: 'есть на складе' })],
    })
    renderScreen()
    expect(
      within(requestsTable()).getByRole('columnheader', { name: 'Причина отказа' }),
    ).toBeTruthy()
    expect(within(requestsTable()).getByText('есть на складе')).toBeTruthy()
  })

  it('decision 35: a row opens the same details sheet the board’s card opens', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1, own: true })] })
    renderScreen()
    openCard(1)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(within(screen.getByRole('dialog')).getByText(/ООО «Студия-7»/)).toBeTruthy()
  })

  it('decision 35: a reader without the approve role gets no board toggle and no row act', async () => {
    refine.custom.data = snapshot({
      permissions: { canApprove: false, canEnter: false },
      requests: [item({ id: 1, own: true, status: 'submitted' })],
    })
    renderScreen()

    expect(screen.queryByRole('tab', { name: 'Доска' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Таблица' })).toBeNull()
    expect(within(requestsTable()).queryByRole('button', { name: 'Одобрить' })).toBeNull()
    expect(within(requestsTable()).queryByRole('button', { name: 'Отклонить…' })).toBeNull()
    // The one action that stays open to everyone (EARS-502).
    expect(screen.getByRole('button', { name: 'Новая заявка' })).toBeTruthy()
  })

  it('decision 35: an approver switches to the board, and the browser remembers the choice', async () => {
    renderScreen()
    expect(screen.queryByRole('region', { name: /Ждут/ })).toBeNull()

    pick('tab', 'Доска')
    await waitFor(() => expect(screen.getByRole('region', { name: /Ждут/ })).toBeTruthy())

    cleanup()
    renderScreen()
    await waitFor(() => expect(screen.getByRole('region', { name: /Ждут/ })).toBeTruthy())
  })

  it('decision 35: a stored board is not a way back into a view the role no longer grants', async () => {
    renderScreen()
    pick('tab', 'Доска')
    await waitFor(() => expect(screen.getByRole('region', { name: /Ждут/ })).toBeTruthy())

    cleanup()
    refine.custom.data = snapshot({ permissions: { canApprove: false, canEnter: false } })
    renderScreen()
    expect(requestsTable()).toBeTruthy()
    expect(screen.queryByRole('region', { name: /Ждут/ })).toBeNull()
  })

  it('decision 35: the approve row act runs the existing act contract, unchanged', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1, own: false, status: 'submitted' })] })
    renderScreen()
    pick('tab', 'Все')

    // The row act names its row: a register of ten «Одобрить» buttons tells a
    // screen reader nothing about which request it would approve.
    fireEvent.click(within(requestsTable()).getByRole('button', { name: 'Одобрить заявку №1' }))
    expect(refine.mutate.mock.calls[0][0]).toMatchObject({
      url: '/p/finance/api/requests/1/actions',
      method: 'post',
      values: { act: 'approve' },
    })
  })

  it('decision 35: the refuse row act asks for the reason instead of refusing in one click', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1, own: false, status: 'submitted' })] })
    renderScreen()
    pick('tab', 'Все')

    fireEvent.click(within(requestsTable()).getByRole('button', { name: 'Отклонить… заявку №1' }))
    const reason = await screen.findByLabelText('Причина отказа')
    expect(refine.mutate).not.toHaveBeenCalled()

    fireEvent.change(reason, { target: { value: 'есть на складе' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить заявку' }))
    expect(refine.mutate.mock.calls[0][0]).toMatchObject({
      values: { act: 'refuse', reason: 'есть на складе' },
    })
  })

  it('decision 35: a terminal row carries no act at all', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 1, own: false, status: 'posted' }),
        item({ id: 2, own: false, status: 'refused', refusalReason: 'есть на складе' }),
      ],
    })
    renderScreen()
    pick('tab', 'Все')

    expect(within(requestsTable()).queryByRole('button', { name: 'Одобрить' })).toBeNull()
    expect(within(requestsTable()).queryByRole('button', { name: 'Отклонить…' })).toBeNull()
  })
})

/**
 * DECISION 36 (owner Антон, 2026-09-14, #115), spec 339 EARS-508 revision
 * 2026-09-14: the company-account branch of the already-paid path is offered
 * only to `finance-entry` / `finance-approve`. The API refusal is the gate
 * (`finance-requests-api.spec.ts`); this is the affordance.
 */
describe('/p/finance/requests — the company-account choice is a role’s (decision 36)', () => {
  async function openAlreadyPaidForm() {
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const form = screen.getByRole('dialog')
    fireEvent.click(within(form).getByRole('checkbox', { name: /Уже потрачено/i }))
    return form
  }

  it('decision 36: a submitter with neither finance role is offered own funds and no account', async () => {
    refine.custom.data = snapshot({ permissions: { canApprove: false, canEnter: false } })
    renderScreen()
    const form = await openAlreadyPaidForm()

    await waitFor(() => expect(within(form).getByText('Дата движения денег')).toBeTruthy())
    expect(within(form).queryByText('Счёт списания')).toBeNull()
    expect(within(form).queryByRole('checkbox', { name: /своими средствами/i })).toBeNull()
    // The form does not merely omit the control — it SAYS what it filed instead.
    expect(within(form).getByText(/своими средствами/i)).toBeTruthy()
  })

  it('decision 36: the entry role keeps the company-account choice and the account picker', async () => {
    refine.custom.data = snapshot({ permissions: { canApprove: false, canEnter: true } })
    renderScreen()
    const form = await openAlreadyPaidForm()

    await waitFor(() => expect(within(form).getByText('Счёт списания')).toBeTruthy())
    expect(within(form).getByRole('checkbox', { name: /своими средствами/i })).toBeTruthy()
  })

  it('decision 36: unticking and re-ticking never brings the account picker back', async () => {
    refine.custom.data = snapshot({ permissions: { canApprove: false, canEnter: false } })
    renderScreen()
    const form = await openAlreadyPaidForm()
    await waitFor(() => expect(within(form).getByText('Дата движения денег')).toBeTruthy())

    const checkbox = within(form).getByRole('checkbox', { name: /Уже потрачено/i })
    fireEvent.click(checkbox)
    await waitFor(() => expect(within(form).queryByText('Дата движения денег')).toBeNull())
    fireEvent.click(checkbox)
    await waitFor(() => expect(within(form).getByText('Дата движения денег')).toBeTruthy())

    expect(within(form).queryByText('Счёт списания')).toBeNull()
    expect(within(form).queryByRole('checkbox', { name: /своими средствами/i })).toBeNull()
  })

  // The BODY this form files — `personal_funds` set and no account, whatever
  // the hidden fields hold — is asserted where it is decided, on the model:
  // `finance-request-form-model.spec.ts`, «the body a role-less submitter
  // files says own money». Driving eleven Radix selects to re-assert it here
  // would test react-hook-form, not the decision.
})

// The owner's rebuild list of 2026-09-15, read back off the rendered screen.
// Every item here was a DEFECT on the rejected stand of PR #470.
describe('/p/finance/requests — the board rebuilt on the whitelist List block (#388 wave 3)', () => {
  it('renders the register through the kit block, not a hand-built table', async () => {
    renderScreen()
    const table = within(requestsTable()).getByRole('table')

    // The block's own markers: a fixed layout inside its rounded, bordered
    // scroll container. `RequestsTable` itself writes no <table>.
    expect(table.style.tableLayout).toBe('fixed')
    expect(table.parentElement?.className).toContain('overflow-x-auto')
  })

  it('carries the block’s pager, which a hand-built table never had', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1, own: true })] })
    renderScreen()
    const table = requestsTable()

    expect(within(table).getByRole('button', { name: 'Следующая страница' })).toBeTruthy()
    expect(within(table).getByText('Строк на странице')).toBeTruthy()
  })

  it('offers sorting from the column headers', async () => {
    renderScreen()
    const table = requestsTable()

    for (const label of [
      'Сортировать по дате движения денег',
      'Сортировать по сумме',
      'Сортировать по статусу',
    ]) {
      expect(within(table).getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('re-orders the register when a header sorter is pressed', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 1, own: true, amount: '100', note: 'Дешёвая' }),
        item({ id: 2, own: true, amount: '900', note: 'Дорогая' }),
      ],
    })
    renderScreen()
    const table = requestsTable()

    const notesNow = () =>
      within(table)
        .getAllByText(/Дешёвая|Дорогая/)
        .map((node) => node.textContent)

    expect(notesNow()).toEqual(['Дорогая', 'Дешёвая'])
    fireEvent.click(within(table).getByRole('button', { name: 'Сортировать по сумме' }))
    await waitFor(() => expect(notesNow()).toEqual(['Дешёвая', 'Дорогая']))
  })

  it('adds the register up in the block’s totals row, per currency', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 1, own: true, amount: '100000', currency: 'RUB' }),
        item({ id: 2, own: true, amount: '250000', currency: 'RUB' }),
      ],
    })
    renderScreen()

    const footer = within(requestsTable()).getByRole('table').querySelector('tfoot')
    expect(footer).not.toBeNull()
    expect(footer?.textContent).toContain('Итого')
    expect(footer?.textContent).toContain('3 500,00 RUB')
  })

  it('gives each status its own stock badge variant, so status reads without being read', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 1, own: true, status: 'submitted' }),
        item({ id: 2, own: true, status: 'approved' }),
        item({ id: 3, own: true, status: 'refused', refusalReason: 'есть на складе' }),
        item({ id: 4, own: true, status: 'posted' }),
      ],
    })
    renderScreen()

    const variants = Array.from(
      within(requestsTable()).getByRole('table').querySelectorAll('tbody [data-slot="badge"]'),
    ).map((node) => node.getAttribute('data-variant'))

    expect(new Set(variants).size).toBe(4)
    for (const variant of variants) {
      expect(['default', 'secondary', 'destructive', 'outline']).toContain(variant)
    }
  })

  it('names the date column for what the value IS, and says so on an intent', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1, own: true, occurredOn: null })] })
    renderScreen()
    const table = requestsTable()

    expect(within(table).getByRole('columnheader', { name: /^Деньги ушли/ })).toBeTruthy()
    expect(within(table).queryByRole('columnheader', { name: /^Дата$/ })).toBeNull()
    expect(within(table).getByText('ещё не двигались')).toBeTruthy()
  })

  it('offers no hover underline on a row: opening one is a named control, not a link', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1, own: true })] })
    renderScreen()
    const open = within(requestsTable()).getByRole('button', { name: 'Заявка №1' })

    expect(open.getAttribute('data-variant')).not.toBe('link')
    expect(open.className).not.toMatch(/underline/)
    for (const row of within(requestsTable()).getByRole('table').querySelectorAll('tbody tr')) {
      expect(row.className).not.toMatch(/underline/)
      expect(row.getAttribute('onclick')).toBeNull()
    }
  })

  it('keeps the whole toolbar on ONE row', async () => {
    renderScreen()
    const scope = screen.getByRole('tablist', { name: 'Чьи заявки' })
    const view = screen.getByRole('tablist', { name: 'Вид' })

    // The nearest ancestor that holds BOTH toggles is the toolbar; it is a
    // flex ROW that never wraps, which is the whole of the owner's complaint.
    let toolbar: HTMLElement | null = scope
    while (toolbar !== null && !toolbar.contains(view)) toolbar = toolbar.parentElement
    expect(toolbar).not.toBeNull()
    expect(toolbar?.className).toContain('flex')
    expect(toolbar?.className).not.toContain('flex-wrap')
    expect(toolbar?.className).not.toContain('flex-col')
  })

  it('runs every act of this screen through ONE overlay shape — the Sheet', async () => {
    refine.custom.data = snapshot({ requests: [item({ id: 1, own: false, status: 'submitted' })] })
    renderScreen()
    pick('tab', 'Все')
    openCard(1)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отклонить…' }))
    await screen.findByRole('region', { name: 'Отклонить заявку' })

    // ONE dialog on the screen — the sheet. The refusal is a section inside it,
    // not a second overlay with a second footer grammar.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })
})
