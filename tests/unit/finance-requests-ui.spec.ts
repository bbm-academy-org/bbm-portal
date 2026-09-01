import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RequestForm,
  RequestDetails,
  RequestsBoard,
  resumePendingUpload,
  runRequestCreation,
  type RequestsSnapshot,
} from '@/app/(platform)/p/finance/requests/RequestsBoard'

afterEach(cleanup)

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

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
      own: true,
      status: 'approved',
      occurredOn: '2026-06-30',
      amount: '4500000',
      currency: 'RUB',
      paidAmount: null,
      paidCurrency: null,
      note: 'Историческая аренда студии, документ ожидается',
      alreadyPaid: false,
      personalFunds: false,
      createdBy: 15,
      createdByName: 'Мария Иванова',
      decidedBy: 16,
      decidedByName: 'Антон Сидоров',
      postedByName: null,
      refusalReason: null,
      operationId: null,
      operation: null,
      purpose: {
        id: 11,
        name: 'Аренда студии',
        categoryId: 3,
        categoryName: 'Операционные расходы',
      },
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
    expect(details.textContent).toContain('Операционные расходы')
    expect(details.textContent).toContain('Счёт оплаты')
    expect(details.textContent).toContain('Контрагент')
    expect(details.textContent).toContain('Историческая аренда студии')
    expect(
      within(details)
        .getByRole('button', { name: /подтвердить и провести/i })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('EARS-527: shows member-filtered liabilities beside, not inside, the status board', () => {
    render(React.createElement(RequestsBoard, { initialSnapshot: snapshot }))

    const liabilitiesTab = screen.getByRole('tab', { name: 'Обязательства' })
    fireEvent.mouseDown(liabilitiesTab)
    fireEvent.click(liabilitiesTab)

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

  it('EARS-502/524 scenario 3: an entry editor can change approved money data and sees the re-approval bounce', async () => {
    const changed = {
      ...snapshot,
      permissions: { canApprove: true, canEnter: true },
      requests: [{ ...snapshot.requests[0], status: 'submitted' as const, amount: '4600000' }],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 41, status: 'submitted', bounced: true }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(changed), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      React.createElement(RequestsBoard, {
        initialSnapshot: { ...snapshot, permissions: { canApprove: true, canEnter: true } },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /аренда студии/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать заявку' }))
    fireEvent.change(screen.getByLabelText('Сумма документа'), { target: { value: '46000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/p/finance/api/requests/41',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
    expect(await screen.findByText(/вернулась на одобрение/i)).toBeTruthy()
  })

  it('scenario 2: shows human actors and opens the linked operation inside the details sheet', () => {
    render(
      React.createElement(RequestsBoard, {
        initialSnapshot: {
          ...snapshot,
          requests: [
            {
              ...snapshot.requests[0],
              status: 'posted',
              operationId: 71,
              postedByName: 'Антон Сидоров',
              operation: {
                id: 71,
                occurredOn: '2026-06-30',
                postings: [{ accountName: 'Основной банк', amount: '-4500000', currency: 'RUB' }],
              },
            },
          ],
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /аренда студии/i }))
    const details = screen.getByRole('dialog', { name: /заявка №41/i })
    expect(details.textContent).toContain('Автор: Мария Иванова')
    expect(details.textContent).toContain('Решение: Антон Сидоров')
    fireEvent.click(within(details).getByRole('button', { name: 'Открыть операцию №71' }))
    expect(within(details).getByRole('region', { name: 'Операция №71' }).textContent).toContain(
      'Основной банк',
    )
  })

  it('EARS-509/523: reads a PDF inline in the sheet while keeping the explicit open action as a download', () => {
    render(
      React.createElement(RequestDetails, {
        item: {
          ...snapshot.requests[0],
          documents: [
            {
              id: 17,
              filename: 'invoice.pdf',
              mime: 'application/pdf',
              size: 20,
              kind: 'foreign_invoice',
              uploadedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        },
        snapshot,
        open: true,
        promptedAct: null,
        pending: false,
        failure: null,
        onOpenChange: vi.fn(),
        onAct: vi.fn(),
        onEdit: vi.fn(),
        onAttach: vi.fn(),
      }),
    )

    expect(screen.getByTitle('Документ invoice.pdf').getAttribute('src')).toBe(
      '/p/finance/api/documents/17?disposition=inline',
    )
    expect(screen.getByRole('link', { name: 'Открыть' }).getAttribute('href')).toBe(
      '/p/finance/api/documents/17',
    )
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

    expect((await screen.findByRole('alert')).textContent).toMatch(
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
        'other',
      ),
    )
  })

  it('EARS-508: clears a stale product when project or purpose binding makes it invalid', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const references = {
      ...snapshot.references,
      projects: [...snapshot.references.projects, { id: 22, name: 'BBM Fund' }],
      products: [
        ...snapshot.references.products,
        { id: 23, name: 'Фондовый продукт', projectId: 22 },
      ],
      purposes: [
        ...snapshot.references.purposes,
        {
          id: 24,
          name: 'Банковская комиссия',
          categoryId: 3,
          productBinding: 'forbidden' as const,
        },
      ],
    }
    render(React.createElement(RequestForm, { references, pending: false, onCreate }))

    fireEvent.change(screen.getByLabelText('Сумма документа'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Дата движения денег'), {
      target: { value: '2026-09-01' },
    })
    fireEvent.change(screen.getByLabelText('Назначение'), { target: { value: '24' } })
    fireEvent.change(screen.getByLabelText('Проект'), { target: { value: '22' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку' }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ purposeId: 24, projectId: 22, productId: null }),
        null,
        'other',
      ),
    )
  })

  it('EARS-508: refuses submit when a required binding has no product in the selected project', async () => {
    const onCreate = vi.fn()
    render(
      React.createElement(RequestForm, {
        references: {
          ...snapshot.references,
          projects: [...snapshot.references.projects, { id: 22, name: 'BBM Fund' }],
        },
        pending: false,
        onCreate,
      }),
    )

    fireEvent.change(screen.getByLabelText('Сумма документа'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Дата движения денег'), {
      target: { value: '2026-09-01' },
    })
    fireEvent.change(screen.getByLabelText('Проект'), { target: { value: '22' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать заявку' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/выберите продукт/i)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('EARS-515: attachment upload asks for the document kind instead of forcing other', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined)
    render(
      React.createElement(RequestDetails, {
        item: snapshot.requests[0],
        snapshot,
        open: true,
        promptedAct: null,
        pending: false,
        failure: null,
        onOpenChange: vi.fn(),
        onAct: vi.fn(),
        onEdit: vi.fn(),
        onAttach,
      }),
    )
    fireEvent.change(screen.getByLabelText('Вид прикрепляемого документа'), {
      target: { value: 'bank_screenshot' },
    })
    const input = screen.getByLabelText('Файл документа')
    const file = new File(['bytes'], 'receipt.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(onAttach).toHaveBeenCalledWith(file, 'bank_screenshot'))
  })

  it('EARS-514 recovery: reports the saved draft and resumes the pending upload without creating a duplicate', async () => {
    const body = {
      occurredOn: '2026-09-01',
      accountId: 7,
      amount: '10000',
      currency: 'RUB',
      purposeId: 11,
      projectId: 12,
      productId: 13,
      counterpartyId: 14,
      alreadyPaid: false,
      personalFunds: false,
    }
    const file = new File(['same bytes'], 'receipt.png', { type: 'image/png' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ request: { id: 77 }, proposal: null }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 88,
            uploadStatus: 'pending',
            recovery: { method: 'PUT', href: '/p/finance/api/documents/88' },
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 88 }), { status: 200 }))

    const outcome = await runRequestCreation(body, file, 'bank_screenshot', fetchMock)

    expect(outcome).toMatchObject({
      status: 'saved-draft',
      requestId: 77,
      stage: 'upload',
      recovery: { href: '/p/finance/api/documents/88', file },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    if (
      outcome.status !== 'saved-draft' ||
      outcome.stage !== 'upload' ||
      outcome.recovery === null
    ) {
      throw new Error('Expected a resumable saved draft.')
    }
    await resumePendingUpload(outcome.recovery, fetchMock)
    expect(fetchMock).toHaveBeenLastCalledWith('/p/finance/api/documents/88', {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: file,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('EARS-526 recovery: reports the saved draft id and retries only its missing proposal', async () => {
    const body = {
      occurredOn: '2026-09-01',
      accountId: 7,
      amount: '10000',
      currency: 'RUB',
      purposeId: null,
      purposeProposal: 'Новая статья для площадки',
      projectId: 12,
      productId: null,
      counterpartyId: 14,
      alreadyPaid: false,
      personalFunds: false,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'saved-draft',
            request: { id: 77, status: 'draft', purposeId: null },
            proposal: null,
            message: 'Черновик сохранён, но предложение назначения не создано.',
            recovery: {
              method: 'PATCH',
              href: '/p/finance/api/requests/77',
              purposeProposal: 'Новая статья для площадки',
            },
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ requestId: 77, proposal: { id: 10 } }), { status: 200 }),
      )

    const outcome = await runRequestCreation(body, null, 'other', fetchMock)

    expect(outcome).toMatchObject({
      status: 'saved-draft',
      requestId: 77,
      stage: 'proposal',
      recovery: {
        href: '/p/finance/api/requests/77',
        purposeProposal: 'Новая статья для площадки',
      },
    })
    expect(outcome.message).toContain('№77')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const requestsModule = await import('@/app/(platform)/p/finance/requests/RequestsBoard')
    const resumePurposeProposal = (
      requestsModule as unknown as {
        resumePurposeProposal: (
          recovery: { href: string; purposeProposal: string; requestId: number },
          fetcher: typeof fetchMock,
        ) => Promise<void>
      }
    ).resumePurposeProposal
    if (outcome.status !== 'saved-draft' || outcome.stage !== 'proposal') {
      throw new Error('Expected proposal recovery for a saved draft.')
    }
    await resumePurposeProposal(outcome.recovery, fetchMock)

    expect(fetchMock).toHaveBeenLastCalledWith('/p/finance/api/requests/77', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purposeProposal: 'Новая статья для площадки' }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
