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

const refine = vi.hoisted(() => ({
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
    useCustom: () => ({
      query: {
        isLoading: refine.custom.isLoading,
        error: refine.custom.error,
        refetch: refine.custom.refetch,
      },
      result: { data: refine.custom.data },
    }),
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

  it('EARS-509: renders the loading, empty and unreadable-board states', async () => {
    refine.custom.isLoading = true
    refine.custom.data = null
    const loading = renderBoard()
    expect(screen.getByLabelText('Загружаем заявки')).toBeTruthy()
    loading.unmount()

    refine.custom.isLoading = false
    refine.custom.data = snapshot({ requests: [] })
    const empty = renderBoard()
    expect(screen.getByText(/Заявок пока нет/)).toBeTruthy()
    empty.unmount()

    refine.custom.data = null
    refine.custom.error = { statusCode: 500, message: 'Доска недоступна.' }
    renderBoard()
    expect(screen.getByRole('alert').textContent).toContain('Доска недоступна.')
  })

  it('EARS-502: refuses the board to a session the module does not admit', async () => {
    refine.custom.data = null
    refine.custom.error = { statusCode: 403, message: 'Нужна роль platform-user.' }
    renderBoard()
    expect(screen.getByRole('alert').textContent).toContain('Нужна роль platform-user.')
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
})
