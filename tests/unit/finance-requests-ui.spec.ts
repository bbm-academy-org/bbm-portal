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
  // What the screen ASKED the hook for — the read's own retry policy is part
  // of the contract since #473 item 2, and it is invisible in the rendered
  // output.
  customProps: null as Record<string, unknown> | null,
  tableProps: null as Record<string, unknown> | null,
}))

vi.mock('@refinedev/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@refinedev/core')>()
  return {
    ...actual,
    useCustom: (props: Record<string, unknown>) => {
      refine.customProps = props
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
      data,
      state,
      onSortingChange,
    }: {
      columns: never[]
      refineCoreProps?: Record<string, never>
      // The payment queue (#550) hands each group's rows and its shared sort
      // state to the block itself; a register that does not is read below.
      data?: TData[]
      state?: { sorting?: { id: string; desc: boolean }[] }
      onSortingChange?: never
    }) => {
      const props = (refineCoreProps ?? {}) as Record<string, never>
      refine.tableProps = props
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
        data: data ?? (rows as TData[]),
        columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        manualSorting: true,
        manualFiltering: true,
        state: data === undefined ? { sorting } : { sorting: state?.sorting ?? [] },
        onSortingChange: data === undefined ? (setSorting as never) : onSortingChange,
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
import { withQueueFields } from '../helpers/finance-request-fixture'

function item(overrides: Partial<RequestBoardItem> = {}): RequestBoardItem {
  return withQueueFields({
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
  })
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
    fx: { latestRateDate: '2026-11-18', today: '2026-11-18' },
    ...overrides,
  }
}

/** The screen as a reader first meets it since decision 35: the TABLE view. */
function renderScreen() {
  return render(React.createElement(RequestsBoardScreen))
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
  refine.customProps = null
  refine.tableProps = null
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

  // Both registers read the same ledger, and a posting act moves BOTH: the
  // request leaves the queue and the debt it created is settled. «Обязательства»
  // is its own Refine resource with its own list cache since #388, so an act
  // that invalidates only the requests resource leaves the debt rows stale —
  // today they happen to refetch because Radix `Tabs` unmounts inactive
  // content, which is an accident of the container, not a stated refresh.
  it('asks BOTH registers to re-read themselves after an act (#388 round 7)', async () => {
    renderBoard()
    openCard(1)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Одобрить' }))

    await act(async () => {
      refine.mutate.mock.calls[0][1].onSuccess()
    })

    const invalidated = refine.invalidate.mock.calls.map((call) => call[0].resource)
    expect(invalidated).toContain('finance-requests')
    expect(invalidated).toContain('finance-liabilities')
  })

  it('EARS-512: insists on a reason before a refusal leaves the screen', async () => {
    renderBoard()
    openCard(1)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отклонить' }))

    const section = await screen.findByRole('region', { name: 'Отклонить заявку' })
    const reason = within(section).getByLabelText('Причина')
    fireEvent.click(within(section).getByRole('button', { name: 'Отклонить' }))
    await waitFor(() => expect(within(section).getByText('Укажите причину.')).toBeTruthy())
    expect(refine.mutate).not.toHaveBeenCalled()

    fireEvent.change(reason, { target: { value: 'есть на складе' } })
    fireEvent.click(within(section).getByRole('button', { name: 'Отклонить' }))
    await waitFor(() => expect(refine.mutate).toHaveBeenCalled())
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
    expect(within(sheet).getByRole('button', { name: 'Отменить заявку' })).toBeTruthy()
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

  /**
   * DEFECT G (#388, owner on the live stand 2026-09-16). Choosing a file used
   * to change nothing the reader could read as «attached»: the block still said
   * «Документ не приложен.», the gate Alert stayed, and the only committing
   * control was an `outline` button INSIDE the dashed block — which reads as
   * secondary next to the footer's acts. The owner picked a PNG, read the sheet
   * as done, saw no «Провести», and reported the screen as unable to post.
   *
   * The fix is not a louder button: CHOOSING IS ATTACHING. There is no second
   * control at all, so there is no half-chosen state left to misread.
   */
  it('#388 defect G: choosing the file attaches it — there is no second control to press', async () => {
    const sheet = await openAttachable(2)
    expect(within(sheet).queryByRole('button', { name: 'Приложить документ' })).toBeNull()

    fireEvent.change(within(sheet).getByLabelText('Подтверждающий документ'), {
      target: { files: [pdf()] },
    })

    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    const sent = refine.mutate.mock.calls[0][0].values as FormData
    expect((sent.get('file') as File).name).toBe('чек.pdf')
    expect(sent.get('kind')).toBe('fiscal_receipt')

    // While the bytes are in flight the block names the file it is carrying,
    // and the picker cannot be fired a second time.
    expect(within(sheet).getByText(/Загружаем «чек\.pdf»/)).toBeTruthy()
    expect(
      (within(sheet).getByLabelText('Подтверждающий документ') as HTMLInputElement).disabled,
    ).toBe(true)
  })

  /**
   * The kind is answered BEFORE the file, because the file's own `change` is
   * the commit: a select standing after the trigger would be a question asked
   * too late. The field says so in words too.
   */
  it('#388 defect G: the kind is asked first and the file field says the choice is the act', async () => {
    const sheet = await openAttachable(2)
    const labels = within(sheet)
      .getAllByText(/^(Вид документа|Подтверждающий документ)$/)
      .map((node) => node.textContent)
    expect(labels).toEqual(['Вид документа', 'Подтверждающий документ'])
    expect(within(sheet).getByText('Файл прикладывается сразу после выбора.')).toBeTruthy()
  })

  it('EARS-506/511: attaches a confirming document from the sheet and re-reads the board', async () => {
    const sheet = await openAttachable(2)

    fireEvent.change(within(sheet).getByLabelText('Подтверждающий документ'), {
      target: { files: [pdf()] },
    })

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

    // Uploading: the block says so and the picker cannot be fired twice.
    expect(
      (within(sheet).getByLabelText('Подтверждающий документ') as HTMLInputElement).disabled,
    ).toBe(true)

    await act(async () => {
      refine.mutate.mock.calls[0][1].onSuccess()
    })
    expect(refine.custom.refetch).toHaveBeenCalled()
  })

  it('EARS-514: refuses an oversize or wrong-typed file on selection and sends nothing', async () => {
    const sheet = await openAttachable(2)
    const input = within(sheet).getByLabelText('Подтверждающий документ')

    const script = new File(['alert(1)'], 'вирус.js', { type: 'text/javascript' })
    fireEvent.change(input, { target: { files: [script] } })
    await waitFor(() => expect(within(sheet).getByText(/PDF или изображение/i)).toBeTruthy())
    expect(refine.mutate).not.toHaveBeenCalled()
    // The refusal leaves the picker live — the reader picks again, nothing else.
    expect((input as HTMLInputElement).disabled).toBe(false)

    const huge = pdf('огромный.pdf')
    Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [huge] } })
    await waitFor(() => expect(within(sheet).getByText(/25 МБ/)).toBeTruthy())
    expect(refine.mutate).not.toHaveBeenCalled()
  })

  it('EARS-514: reports a refused upload under the field it belongs to', async () => {
    const sheet = await openAttachable(2)
    fireEvent.change(within(sheet).getByLabelText('Подтверждающий документ'), {
      target: { files: [pdf()] },
    })
    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))

    await act(async () => {
      refine.mutate.mock.calls[0][1].onError({ message: 'Файл больше предела в 26214400 байт.' })
    })
    expect(
      within(sheet)
        .getAllByRole('alert')
        .map((node) => node.textContent)
        .join(' '),
    ).toContain('Файл больше предела')
    // The failed attempt is repeatable: the picker comes back live.
    expect(
      (within(sheet).getByLabelText('Подтверждающий документ') as HTMLInputElement).disabled,
    ).toBe(false)
  })

  it('EARS-502/511: offers no attach control to a reader who neither filed the request nor enters money', async () => {
    refine.custom.data = snapshot({
      permissions: { canApprove: false, canEnter: false },
      requests: [item({ id: 2, status: 'approved', own: false, documents: [] })],
    })
    renderBoard()
    // Somebody else's request, read from the queue this reader has instead of
    // the board — «В работе» shows every member's requests (EARS-536).
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

  it('EARS-533: the card names the emptiness instead of printing it as a value', async () => {
    refine.custom.data = snapshot({
      requests: [item({ id: 4, status: 'submitted', occurredOn: null, account: null })],
    })
    renderBoard()
    expect(screen.getAllByText(/деньги ещё не двигались/i).length).toBeGreaterThan(0)
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

/**
 * THE SIX NON-BLOCKING DEFECTS OF THE #388 ACCEPTANCE RUNS (#473).
 *
 * Each one is a sentence the surface says wrong, not a behaviour it lacks, so
 * each test below asserts what the ISSUE says the reader must get — never what
 * the code happens to do today.
 */
describe('/p/finance/requests — the #473 acceptance defects', () => {
  // ITEM 2. A failing read painted the textless grey frame for ~9 s: the read
  // is retried three times with react-query's exponential backoff (1 s + 2 s +
  // 4 s) before the query leaves `pending`, and nothing on the frame says what
  // is being waited for. A reader cannot tell a slow read from a dead one.
  it('item 2: the grey frame SAYS what is loading, in words on the screen', () => {
    refine.custom.isLoading = true
    refine.custom.data = null
    renderBoard()

    const frame = screen.getByLabelText('Загружаем заявки')
    expect(frame.textContent).toMatch(/Загружаем заявки/)
  })

  it('item 2: the board read gives up inside the 2 s budget instead of backing off for ~9 s', async () => {
    const { BOARD_READ_ERROR_BUDGET_MS, boardReadWorstCaseErrorMs } =
      await import('@/app/(platform)/p/finance/requests/request-board-model')
    refine.custom.isLoading = true
    refine.custom.data = null
    renderBoard()

    const options = refine.customProps?.queryOptions as
      { retry?: number; retryDelay?: number } | undefined
    expect(options).toBeTruthy()
    expect(
      boardReadWorstCaseErrorMs(options?.retry ?? 3, options?.retryDelay ?? 1000),
    ).toBeLessThanOrEqual(BOARD_READ_ERROR_BUDGET_MS)
    expect(BOARD_READ_ERROR_BUDGET_MS).toBe(2000)
  })

  // ITEM 5. The approved-without-document state (step 06). Its real next step
  // — attaching the receipt — was a picker in a dashed block mid-sheet, while
  // the only footer control, and therefore the strongest thing on the screen,
  // was the destructive «Отклонить…». A state whose dominant control is the
  // one nobody should press by default is composed backwards.
  function attachSection(sheet: HTMLElement): HTMLElement {
    return within(sheet).getByRole('region', { name: 'Приложить документ' })
  }

  // ITEM 6. Attaching left the picker live and said nothing about what is
  // already there, so a second click attached a second copy of the same file —
  // request #69 on the #388 stand carries two `receipt-388.pdf`. A second
  // document is legitimate; a SILENT second copy is not.
  const attached = {
    id: 9,
    filename: 'чек.pdf',
    mime: 'application/pdf',
    size: 17,
    kind: 'fiscal_receipt' as const,
    uploadedAt: '2026-09-03T10:00:00.000Z',
  }

  async function openWithDocument(id = 60) {
    refine.custom.data = snapshot({
      requests: [item({ id, status: 'approved', own: true, documents: [attached] })],
    })
    renderBoard()
    openCard(id)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    return screen.getByRole('dialog')
  }

  it('item 6: once a document is attached the picker is put away, and the sheet says so', async () => {
    const sheet = await openWithDocument(60)

    expect(within(sheet).queryByLabelText('Подтверждающий документ')).toBeNull()
    expect(within(sheet).getByText(/уже приложен/i)).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: /Приложить ещё документ/ })).toBeTruthy()
  })

  it('item 6: adding a SECOND document is a deliberate answer, and then it attaches', async () => {
    const sheet = await openWithDocument(61)
    fireEvent.click(within(sheet).getByRole('button', { name: /Приложить ещё документ/ }))

    const picker = await within(sheet).findByLabelText('Подтверждающий документ')
    fireEvent.change(picker, {
      target: { files: [new File(['%PDF-1.4 second'], 'второй.pdf', { type: 'application/pdf' })] },
    })

    await waitFor(() => expect(refine.mutate).toHaveBeenCalledTimes(1))
    const body = refine.mutate.mock.calls[0][0].values as FormData
    expect((body.get('file') as File).name).toBe('второй.pdf')
  })

  // ITEM 3. The register clips its free-text columns on purpose — «the full
  // text is always one «Открыть» away, in the details sheet» (`RequestsTable`).
  // That promise is what item 3 found broken: a long counterparty, a long
  // purpose and a long note reached the sheet and were cut there too, so the
  // words were nowhere on the surface at all. Every VALUE in the sheet wraps;
  // nothing between it and the dialog clips it.
  const LONG_COUNTERPARTY =
    'ООО «Производственно-театральное объединение имени Всеволода Эмильевича Мейерхольда»'
  const LONG_PURPOSE = 'Операционные расходы на производство и постпродакшн учебных материалов'
  const LONG_NOTE =
    'Аренда студии с оборудованием, светом, звукорежиссёром и монтажом на четыре съёмочных дня'

  function longRequest() {
    return item({
      id: 42,
      status: 'submitted',
      note: LONG_NOTE,
      counterparty: { id: 7, name: LONG_COUNTERPARTY },
      purpose: { id: 21, name: LONG_PURPOSE, categoryId: 5, categoryName: 'Производство' },
    })
  }

  /** Does anything between `node` and the sheet cut the text off? */
  function clippedInsideSheet(node: HTMLElement): boolean {
    let current: HTMLElement | null = node
    while (current !== null && current.getAttribute('role') !== 'dialog') {
      if (/(^|\s)(truncate|line-clamp-\d+|text-ellipsis)(\s|$)/.test(current.className)) return true
      current = current.parentElement
    }
    return false
  }

  it('item 3: a long counterparty and a long purpose are readable in full in the sheet', async () => {
    refine.custom.data = snapshot({ requests: [longRequest()] })
    renderBoard()
    openCard(42)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    for (const value of [LONG_COUNTERPARTY, LONG_PURPOSE]) {
      const node = screen.getByText(value)
      expect(clippedInsideSheet(node)).toBe(false)
      expect(node.className).toMatch(/break-words|break-all|wrap-anywhere/)
    }
  })

  it('item 3: the sheet title carries the whole note instead of running off the edge', async () => {
    refine.custom.data = snapshot({ requests: [longRequest()] })
    renderBoard()
    openCard(42)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    const title = within(screen.getByRole('dialog')).getByText(new RegExp(LONG_NOTE.slice(0, 30)))
    expect(title.textContent).toContain(LONG_NOTE)
    expect(clippedInsideSheet(title)).toBe(false)
    expect(title.className).toMatch(/break-words|break-all|wrap-anywhere/)
  })

  it('item 3: a long document filename wraps in the reading pane', async () => {
    const filename = 'счёт-фактура-от-ООО-Производственно-театральное-объединение-2026-09-16.pdf'
    refine.custom.data = snapshot({
      requests: [
        item({
          id: 43,
          status: 'approved',
          documents: [
            {
              id: 9,
              filename,
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
    openCard(43)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    // The name is printed twice — the document's own line, and the download
    // link the reading pane falls back to; both are values, both must wrap.
    const lines = within(screen.getByRole('dialog')).getAllByText(new RegExp(filename.slice(0, 20)))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(clippedInsideSheet(line)).toBe(false)
      expect(line.className).toMatch(/break-words|break-all|wrap-anywhere/)
    }
  })
})
