import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RequestForm,
  RequestsBoard,
  type RequestsSnapshot,
} from '@/app/(platform)/p/finance/requests/RequestsBoard'

afterEach(cleanup)

const snapshot: RequestsSnapshot = {
  permissions: { canApprove: true, canEnter: false },
  references: {
    accounts: [{ id: 7, name: 'Основной банк', currency: 'RUB' }],
    counterparties: [{ id: 14, name: 'ООО «Студия-7»' }],
    currencies: [{ code: 'RUB', name: 'Российский рубль', precision: 2 }],
    products: [{ id: 13, name: 'Урок №14', projectId: 12 }],
    projects: [{ id: 12, name: 'Doctor School' }],
    purposes: [{ id: 11, name: 'Аренда студии', categoryId: 3, productBinding: 'required' }],
  },
  requests: [
    {
      id: 41,
      status: 'approved',
      occurredOn: '2026-06-30',
      amount: '4500000',
      currency: 'RUB',
      paidAmount: null,
      paidCurrency: null,
      note: 'Историческая аренда студии, документ ожидается',
      alreadyPaid: false,
      personalFunds: false,
      refusalReason: null,
      operationId: null,
      purpose: { id: 11, name: 'Аренда студии', categoryId: 3 },
      project: { id: 12, name: 'Doctor School' },
      product: { id: 13, name: 'Урок №14' },
      account: { id: 7, name: 'Основной банк', currency: 'RUB' },
      counterparty: { id: 14, name: 'ООО «Студия-7»' },
      documents: [],
    },
  ],
  liabilities: [{ memberId: 15, memberName: 'Мария Иванова', currency: 'RUB', balance: '-72000' }],
}

describe('/p/finance/requests board', () => {
  it('EARS-509: renders all four machine columns and exposes classification on the real approved-unposted card', () => {
    render(React.createElement(RequestsBoard, { initialSnapshot: snapshot }))

    for (const name of ['Ждут', 'Одобрены — ждут документа', 'Проведены', 'Отклонены']) {
      expect(screen.getByRole('region', { name })).toBeTruthy()
    }
    const approved = screen.getByRole('region', { name: 'Одобрены — ждут документа' })
    const card = within(approved).getByRole('button', { name: /аренда студии/i })
    expect(card.textContent).toMatch(/45 000,00.*RUB/)
    expect(card.textContent).toContain('ООО «Студия-7»')
    expect(card.textContent).toContain('Doctor School')
    expect(card.textContent).toContain('Урок №14')
    expect(card.textContent).toContain('Основной банк')

    fireEvent.click(card)
    const details = screen.getByRole('dialog', { name: /заявка №41/i })
    expect(details.textContent).toContain('Назначение')
    expect(details.textContent).toContain('Статья #3')
    expect(details.textContent).toContain('Счёт оплаты')
    expect(details.textContent).toContain('Контрагент')
    expect(details.textContent).toContain('Историческая аренда студии')
    expect(within(details).getByRole('button', { name: /подтвердить и провести/i })).toBeDisabled()
  })

  it('EARS-527: shows member-filtered liabilities beside, not inside, the status board', () => {
    render(React.createElement(RequestsBoard, { initialSnapshot: snapshot }))

    fireEvent.click(screen.getByRole('tab', { name: 'Обязательства' }))

    expect(screen.getByRole('tabpanel', { name: 'Обязательства' }).textContent).toContain(
      'Мария Иванова',
    )
    expect(screen.getByRole('tabpanel', { name: 'Обязательства' }).textContent).toContain(
      '720,00 RUB',
    )
  })

  it('EARS-502: a role-less member gets an explicit read-only board and keeps own request acts', () => {
    render(
      React.createElement(RequestsBoard, {
        initialSnapshot: {
          ...snapshot,
          permissions: { canApprove: false, canEnter: false },
        },
      }),
    )

    expect(screen.getByRole('status').textContent).toMatch(/только свои заявки|только чтение/i)
    expect(screen.queryByText(/перетащите/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /аренда студии/i }))
    expect(screen.queryByRole('button', { name: 'Одобрить' })).toBeNull()
    expect(screen.getByRole('button', { name: /приложить документ/i })).toBeTruthy()
  })

  it('renders the explicit empty state instead of four blank boxes', () => {
    render(
      React.createElement(RequestsBoard, {
        initialSnapshot: { ...snapshot, requests: [] },
      }),
    )

    expect(screen.getByText(/заявок пока нет/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /создать первую заявку/i })).toBeTruthy()
  })
})

describe('new expense request sheet (spec 339 EARS-508/526/532)', () => {
  it('validates personal funds and reveals cross-currency facts without submitting incomplete data', async () => {
    const onCreate = vi.fn()
    render(
      React.createElement(RequestForm, {
        references: snapshot.references,
        pending: false,
        onCreate,
      }),
    )

    fireEvent.click(screen.getByLabelText('Оплачено своими средствами'))
    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /сначала отметьте «деньги уже потрачены»/i,
    )
    expect(onCreate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Деньги уже потрачены'))
    fireEvent.change(screen.getByLabelText('Валюта документа'), { target: { value: 'USD' } })
    expect(screen.getByLabelText('Фактически списано')).toBeTruthy()
    expect(screen.getByLabelText('Валюта списания')).toBeTruthy()
  })

  it('EARS-526/532: offers exactly one inline path for a missing purpose and a new counterparty', async () => {
    const onCreate = vi.fn()
    render(
      React.createElement(RequestForm, {
        references: snapshot.references,
        pending: false,
        onCreate,
      }),
    )

    fireEvent.click(screen.getByLabelText('Нужного назначения нет'))
    fireEvent.click(screen.getByLabelText('Добавить нового контрагента'))

    expect(screen.getByLabelText('Предложение назначения')).toBeTruthy()
    expect(screen.getByText(/черновик будет ждать решения администратора/i)).toBeTruthy()
    expect(screen.getByLabelText('Название нового контрагента')).toBeTruthy()
  })

  it('submits the EARS-508 document-side facts as minimal-unit strings', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      React.createElement(RequestForm, {
        references: snapshot.references,
        pending: false,
        onCreate,
      }),
    )

    fireEvent.change(screen.getByLabelText('Сумма документа'), { target: { value: '45000' } })
    fireEvent.change(screen.getByLabelText('Дата движения денег'), {
      target: { value: '2026-09-01' },
    })
    fireEvent.change(screen.getByLabelText('Назначение'), { target: { value: '11' } })
    fireEvent.change(screen.getByLabelText('Проект'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Продукт'), { target: { value: '13' } })
    fireEvent.change(screen.getByLabelText('Счёт оплаты'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Контрагент'), { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку' }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '4500000', currency: 'RUB', purposeId: 11 }),
        null,
      ),
    )
  })
})
