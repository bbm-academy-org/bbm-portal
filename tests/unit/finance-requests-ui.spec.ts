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

function renderBoard() {
  return render(React.createElement(RequestsBoardScreen))
}

function openCard(id: number) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Заявка №${id}`) }))
}

beforeEach(() => {
  refine.custom.data = snapshot()
  refine.custom.isLoading = false
  refine.custom.error = null
  refine.custom.refetch = vi.fn()
  refine.mutate = vi.fn()
  refine.isPending = false
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

  it('EARS-501/502: gives a role-less reader a read-only board and its own requests', async () => {
    refine.custom.data = snapshot({
      permissions: { canApprove: false, canEnter: false },
      requests: [item({ id: 1, own: true })],
    })
    renderBoard()

    expect(screen.getByRole('button', { name: /Заявка №1/ }).getAttribute('draggable')).toBe(
      'false',
    )
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
    expect(within(liabilities).getByText('720,00 RUB')).toBeTruthy()
  })

  it('EARS-508: names every missing field under itself instead of filing an empty request', async () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Новая заявка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const form = screen.getByRole('dialog')

    fireEvent.click(within(form).getByRole('button', { name: 'Подать заявку' }))
    await waitFor(() =>
      expect(within(form).getAllByText(/Укажите|Выберите/).length).toBeGreaterThan(0),
    )
    expect(refine.mutate).not.toHaveBeenCalled()
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
    fireEvent.click(within(form).getByLabelText('Проект'))
    fireEvent.click(await screen.findByRole('option', { name: 'Фонд BBM' }))

    await waitFor(() => expect(within(form).getByText('Продукт')).toBeTruthy())
    // The empty control and the description both name it; the point is that the
    // field is on the form at all.
    expect(within(form).getAllByText(/нет продуктов/i).length).toBeGreaterThan(0)

    fireEvent.click(within(form).getByRole('button', { name: 'Подать заявку' }))
    await waitFor(() =>
      expect(within(form).getAllByText(/нет продуктов/i).length).toBeGreaterThan(0),
    )
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
    openCard(2)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).queryByLabelText('Подтверждающий документ')).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Приложить документ' })).toBeNull()
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

    const posting = await screen.findByRole('dialog', { name: /Провести заявку №5/ })
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
    const posting = await screen.findByRole('dialog', { name: /Провести заявку №6/ })

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

    expect(screen.queryByRole('dialog', { name: /Провести заявку/ })).toBeNull()
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
  it('the posting dialog carries the primary CTA and a secondary «Отмена», like the sheet footer', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 10, status: 'approved', occurredOn: null, account: null, documents: [receipt] }),
      ],
    })
    renderBoard()
    openCard(10)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Провести' }))

    const posting = await screen.findByRole('dialog', { name: /Провести заявку №10/ })
    const cta = within(posting).getByRole('button', { name: 'Провести' })
    expect(cta.getAttribute('data-variant')).toBe('default')
    expect(cta.getAttribute('type')).toBe('submit')
    expect(
      within(posting).getByRole('button', { name: 'Отмена' }).getAttribute('data-variant'),
    ).toBe('outline')
    // The kit's own interaction treatment, not a hand-rolled one: the frames of
    // step 31 show no change under the forced pseudo-states because the capture
    // forced them on the SHEET's «Приложить документ» behind the dialog (the
    // diff between 29 and each 31 frame sits at x≈1080–1256, y≈730–773), not
    // because the CTA lacks the states.
    expect(cta.className).toContain('hover:bg-primary/80')
    expect(cta.className).toContain('focus-visible:ring-ring/50')
    expect(cta.className).toContain('active:not-aria-[haspopup]:translate-y-px')
  })

  // DEFECT 2 (NOT a defect either): the dialog DOES take focus off the sheet
  // when it opens, so `:focus-visible` on its CTA is reachable by keyboard.
  it('opening the posting dialog moves focus INTO it, off the sheet behind', async () => {
    refine.custom.data = snapshot({
      requests: [
        item({ id: 11, status: 'approved', occurredOn: null, account: null, documents: [receipt] }),
      ],
    })
    renderBoard()
    openCard(11)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Провести' }))

    const posting = await screen.findByRole('dialog', { name: /Провести заявку №11/ })
    await waitFor(() => expect(posting.contains(document.activeElement)).toBe(true))
  })
})
