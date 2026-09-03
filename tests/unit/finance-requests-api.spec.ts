// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

const state = vi.hoisted(() => ({
  session: null as unknown,
  listExpenseRequests: vi.fn(),
  listFinanceDocuments: vi.fn(),
  listAccounts: vi.fn(),
  listCounterparties: vi.fn(),
  listCurrencies: vi.fn(),
  listProducts: vi.fn(),
  listProjects: vi.fn(),
  listPurposes: vi.fn(),
  listCategories: vi.fn(),
  listPurposeProposals: vi.fn(),
  liabilityBalances: vi.fn(),
  findMemberByEmail: vi.fn(),
  getMembersByIds: vi.fn(),
  listRegister: vi.fn(),
  registerEntriesByIds: vi.fn(),
  createCounterparty: vi.fn(),
  createExpenseRequest: vi.fn(),
  createPurposeProposal: vi.fn(),
  editExpenseRequest: vi.fn(),
  getExpenseRequest: vi.fn(),
  submitExpenseRequest: vi.fn(),
  cancelExpenseRequest: vi.fn(),
  approveExpenseRequest: vi.fn(),
  confirmExpenseRequest: vi.fn(),
  refuseExpenseRequest: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: async () => state.session }))
vi.mock('@/lib/member', () => ({
  findMemberByEmail: state.findMemberByEmail,
  getMembersByIds: state.getMembersByIds,
}))
vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return { ...actual, ...state }
})

const BASE = 'http://portal.test/p/finance/api/requests'

const request = {
  id: 41,
  source: 'request',
  sourceRef: null,
  kind: 'expense',
  status: 'approved',
  occurredOn: '2026-06-30',
  accountId: 7,
  counterAccountId: null,
  amount: 45_000_00n,
  currency: 'RUB',
  paidAmount: null,
  paidCurrency: null,
  feeAmount: null,
  feeCurrency: null,
  purposeId: 11,
  projectId: 12,
  productId: 13,
  counterpartyId: 14,
  memberId: null,
  note: 'Историческая аренда студии, документ ожидается',
  alreadyPaid: false,
  personalFunds: false,
  createdBy: 15,
  decidedBy: 16,
  decidedAt: new Date('2026-07-01T12:00:00Z'),
  refusalReason: null,
  postedBy: null,
  postedAt: null,
  operationId: null,
}

beforeEach(() => {
  state.session = {
    user: {
      email: 'owner@bbm.academy',
      roles: [PLATFORM_USER_ROLE, 'finance-approve'],
    },
  }
  for (const value of Object.values(state)) {
    if (typeof value === 'function') (value as ReturnType<typeof vi.fn>).mockReset()
  }
  state.listExpenseRequests.mockResolvedValue([request])
  state.listFinanceDocuments.mockResolvedValue([])
  state.listAccounts.mockResolvedValue([
    {
      id: 7,
      name: 'Основной банк',
      kind: 'bank',
      currency: 'RUB',
      isSystem: false,
      retiredAt: null,
    },
  ])
  state.listCounterparties.mockResolvedValue([
    { id: 14, name: 'ООО «Студия-7»', createdBy: 15, createdAt: new Date() },
  ])
  state.listCurrencies.mockResolvedValue([
    { code: 'RUB', name: 'Российский рубль', precision: 2, retiredAt: null },
  ])
  state.listProjects.mockResolvedValue([
    { id: 12, name: 'Doctor School', isFund: false, retiredAt: null },
  ])
  state.listProducts.mockResolvedValue([
    {
      id: 13,
      projectId: 12,
      name: 'Урок №14',
      salePrice: null,
      salePriceCurrency: null,
      retiredAt: null,
    },
  ])
  state.listPurposes.mockResolvedValue([
    {
      id: 11,
      name: 'Аренда студии',
      categoryId: 3,
      productBinding: 'required',
      retiredAt: null,
    },
  ])
  state.listCategories.mockResolvedValue([{ id: 3, name: 'Операционные расходы', retiredAt: null }])
  state.listPurposeProposals.mockResolvedValue([])
  state.getExpenseRequest.mockResolvedValue(request)
  state.findMemberByEmail.mockResolvedValue({ id: 15 })
  state.getMembersByIds.mockResolvedValue([
    { id: 15, name: 'Мария Иванова' },
    { id: 16, name: 'Антон Сидоров' },
  ])
  state.listRegister.mockResolvedValue([])
  state.registerEntriesByIds.mockResolvedValue([])
  state.liabilityBalances.mockResolvedValue([
    {
      accountId: 99,
      memberId: 15,
      memberName: 'Мария Иванова',
      currency: 'RUB',
      balance: -720_00n,
    },
  ])
})

describe('/p/finance/api/requests read model', () => {
  it('EARS-509/527: exposes the four-status board, classification fields and liabilities through the public module API', async () => {
    const route = await import('@/app/(platform)/p/finance/api/requests/route')
    const response = await route.GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(state.listExpenseRequests).toHaveBeenCalledWith({
      email: 'owner@bbm.academy',
      roles: [PLATFORM_USER_ROLE, 'finance-approve'],
    })
    expect(await response.json()).toMatchObject({
      permissions: { canApprove: true, canEnter: false },
      requests: [
        {
          id: 41,
          own: true,
          status: 'approved',
          amount: '4500000',
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
      liabilities: [{ memberName: 'Мария Иванова', currency: 'RUB', balance: '-72000' }],
    })
  })

  it('EARS-502: refuses a handler request before touching finance when the platform claim is absent', async () => {
    state.session = { user: { email: 'outsider@bbm.academy', roles: [] } }
    const route = await import('@/app/(platform)/p/finance/api/requests/route')

    const response = await route.GET()

    expect(response.status).toBe(403)
    expect(state.listExpenseRequests).not.toHaveBeenCalled()
  })

  it('scenario 2: resolves human actors and the linked operation through an ID-scoped public module API', async () => {
    state.listExpenseRequests.mockResolvedValue([
      { ...request, status: 'posted', postedBy: 16, operationId: 71 },
    ])
    state.registerEntriesByIds.mockResolvedValue([
      {
        operationId: 71,
        occurredOn: '2026-06-30',
        source: 'request',
        sourceRef: null,
        purposeId: 11,
        purposeName: 'Аренда студии',
        backdated: false,
        reverses: null,
        reversedBy: null,
        postings: [
          {
            id: 1,
            accountId: 7,
            accountName: 'Основной банк',
            amount: -45_000_00n,
            currency: 'RUB',
            projectId: 12,
            categoryId: 3,
            productId: 13,
            memberId: null,
          },
        ],
      },
    ])
    const route = await import('@/app/(platform)/p/finance/api/requests/route')

    const response = await route.GET()

    expect(state.getMembersByIds).toHaveBeenCalledWith([15, 16])
    expect(state.registerEntriesByIds).toHaveBeenCalledWith([71])
    expect(state.listRegister).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      requests: [
        {
          createdByName: 'Мария Иванова',
          decidedByName: 'Антон Сидоров',
          postedByName: 'Антон Сидоров',
          operation: {
            id: 71,
            occurredOn: '2026-06-30',
            postings: [{ accountName: 'Основной банк', amount: '-4500000', currency: 'RUB' }],
          },
        },
      ],
    })
  })

  it('scenario 2: keeps operation affordances for more than 200 posted requests', async () => {
    const postedRequests = Array.from({ length: 201 }, (_, index) => ({
      ...request,
      id: 1_000 + index,
      status: 'posted',
      postedBy: 16,
      operationId: index + 1,
    }))
    state.listExpenseRequests.mockResolvedValue(postedRequests)
    state.registerEntriesByIds.mockResolvedValue([
      {
        operationId: 1,
        occurredOn: '2026-01-01',
        source: 'request',
        sourceRef: null,
        purposeId: 11,
        purposeName: 'Аренда студии',
        backdated: false,
        reverses: null,
        reversedBy: null,
        postings: [
          {
            id: 1,
            accountId: 7,
            accountName: 'Основной банк',
            amount: -45_000_00n,
            currency: 'RUB',
            projectId: 12,
            categoryId: 3,
            productId: 13,
            memberId: null,
          },
        ],
      },
    ])
    const route = await import('@/app/(platform)/p/finance/api/requests/route')

    const response = await route.GET()
    const body = (await response.json()) as {
      requests: Array<{ operationId: number; operation: unknown }>
    }

    expect(state.registerEntriesByIds).toHaveBeenCalledWith(
      Array.from({ length: 201 }, (_, index) => index + 1),
    )
    expect(body.requests.find((item) => item.operationId === 1)?.operation).toMatchObject({ id: 1 })
  })
})

describe('/p/finance/api/requests writes', () => {
  it('EARS-508/532: creates an inline counterparty before the draft request', async () => {
    state.createCounterparty.mockResolvedValue({ id: 24, name: 'Новый поставщик' })
    state.createExpenseRequest.mockResolvedValue({ ...request, id: 51, status: 'draft' })
    const route = await import('@/app/(platform)/p/finance/api/requests/route')

    const response = await route.POST(
      new Request(BASE, {
        method: 'POST',
        body: JSON.stringify({
          occurredOn: '2026-09-01',
          accountId: 7,
          amount: '4500000',
          currency: 'RUB',
          purposeId: 11,
          projectId: 12,
          productId: 13,
          counterpartyName: 'Новый поставщик',
          alreadyPaid: false,
          personalFunds: false,
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(state.createCounterparty).toHaveBeenCalledWith(expect.any(Object), {
      name: 'Новый поставщик',
    })
    expect(state.createExpenseRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ counterpartyId: 24, amount: 4_500_000n, purposeId: 11 }),
    )
  })

  it('EARS-508/532: reuses the normalized counterparty when create is retried after the request write fails', async () => {
    state.listCounterparties
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 24, name: 'НОВЫЙ ПОСТАВЩИК', createdBy: 15, createdAt: new Date() },
      ])
    state.createCounterparty.mockResolvedValue({ id: 24, name: 'Новый поставщик' })
    state.createExpenseRequest
      .mockRejectedValueOnce(
        Object.assign(new Error('Заявку не удалось сохранить.'), { name: 'FinanceRefusal' }),
      )
      .mockResolvedValueOnce({ ...request, id: 51, status: 'draft' })
    const route = await import('@/app/(platform)/p/finance/api/requests/route')
    const body = JSON.stringify({
      occurredOn: '2026-09-01',
      accountId: 7,
      amount: '4500000',
      currency: 'RUB',
      purposeId: 11,
      projectId: 12,
      productId: 13,
      counterpartyName: '  Новый поставщик  ',
      alreadyPaid: false,
      personalFunds: false,
    })

    const failed = await route.POST(new Request(BASE, { method: 'POST', body }))
    const retried = await route.POST(new Request(BASE, { method: 'POST', body }))

    expect(failed.status).toBe(422)
    expect(retried.status).toBe(201)
    expect(state.createCounterparty).toHaveBeenCalledTimes(1)
    expect(state.createExpenseRequest).toHaveBeenCalledTimes(2)
    expect(state.createExpenseRequest).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ counterpartyId: 24 }),
    )
  })

  it('EARS-532: re-reads and reuses a counterparty created by a concurrent request', async () => {
    state.listCounterparties
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 24, name: 'НОВЫЙ ПОСТАВЩИК', createdBy: 15, createdAt: new Date() },
      ])
    state.createCounterparty.mockRejectedValue(
      Object.assign(new Error('Контрагент уже создаётся.'), { name: 'FinanceRefusal' }),
    )
    state.createExpenseRequest.mockResolvedValue({ ...request, id: 51, status: 'draft' })
    const route = await import('@/app/(platform)/p/finance/api/requests/route')

    const response = await route.POST(
      new Request(BASE, {
        method: 'POST',
        body: JSON.stringify({
          occurredOn: '2026-09-01',
          accountId: 7,
          amount: '4500000',
          currency: 'RUB',
          purposeId: 11,
          projectId: 12,
          productId: 13,
          counterpartyName: 'Новый поставщик',
          alreadyPaid: false,
          personalFunds: false,
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(state.createCounterparty).toHaveBeenCalledTimes(1)
    expect(state.listCounterparties).toHaveBeenCalledTimes(2)
    expect(state.createExpenseRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ counterpartyId: 24 }),
    )
  })

  it('EARS-526: keeps a missing-purpose request as a draft and binds its proposal', async () => {
    state.createExpenseRequest.mockResolvedValue({
      ...request,
      id: 52,
      status: 'draft',
      purposeId: null,
    })
    state.createPurposeProposal.mockResolvedValue({ id: 9, intakeItemId: 52, status: 'pending' })
    const route = await import('@/app/(platform)/p/finance/api/requests/route')

    const response = await route.POST(
      new Request(BASE, {
        method: 'POST',
        body: JSON.stringify({
          occurredOn: '2026-09-01',
          accountId: 7,
          amount: '120000',
          currency: 'RUB',
          purposeProposal: 'Новая статья для площадки',
          projectId: 12,
          productId: null,
          counterpartyId: 14,
          alreadyPaid: false,
          personalFunds: false,
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(state.createExpenseRequest).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ purposeId: null }),
    )
    expect(state.createPurposeProposal).toHaveBeenCalledWith(expect.any(Object), {
      intakeItemId: 52,
      text: 'Новая статья для площадки',
    })
    expect(await response.json()).toMatchObject({ request: { id: 52 }, proposal: { id: 9 } })
  })

  it('EARS-508/526: rejects a request that supplies both a purpose and a proposal', async () => {
    state.createExpenseRequest.mockResolvedValue({ ...request, id: 53, status: 'draft' })
    const route = await import('@/app/(platform)/p/finance/api/requests/route')

    const response = await route.POST(
      new Request(BASE, {
        method: 'POST',
        body: JSON.stringify({
          occurredOn: '2026-09-01',
          accountId: 7,
          amount: '120000',
          currency: 'RUB',
          purposeId: 11,
          purposeProposal: 'A second, contradictory purpose',
          projectId: 12,
          productId: 13,
          counterpartyId: 14,
          alreadyPaid: false,
          personalFunds: false,
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(state.createExpenseRequest).not.toHaveBeenCalled()
    expect(state.createPurposeProposal).not.toHaveBeenCalled()
  })

  it('EARS-526: exposes the durable draft and a proposal-only recovery when proposal creation fails', async () => {
    state.createExpenseRequest.mockResolvedValue({
      ...request,
      id: 54,
      status: 'draft',
      purposeId: null,
    })
    state.createPurposeProposal.mockRejectedValue(new Error('temporary proposal failure'))
    const route = await import('@/app/(platform)/p/finance/api/requests/route')

    const response = await route.POST(
      new Request(BASE, {
        method: 'POST',
        body: JSON.stringify({
          occurredOn: '2026-09-01',
          accountId: 7,
          amount: '120000',
          currency: 'RUB',
          purposeProposal: 'Новая статья для площадки',
          projectId: 12,
          productId: null,
          counterpartyId: 14,
          alreadyPaid: false,
          personalFunds: false,
        }),
      }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'saved-draft',
      request: { id: 54, status: 'draft', purposeId: null },
      proposal: null,
      message: 'Черновик сохранён, но предложение назначения не создано.',
      recovery: {
        method: 'PATCH',
        href: '/p/finance/api/requests/54',
        purposeProposal: 'Новая статья для площадки',
      },
    })
  })

  it('EARS-526: PATCH recovery adds only the missing proposal to the existing draft', async () => {
    state.createPurposeProposal.mockResolvedValue({ id: 10, intakeItemId: 54, status: 'pending' })
    const route = await import('@/app/(platform)/p/finance/api/requests/[id]/route')

    const response = await route.PATCH(
      new Request(`${BASE}/54`, {
        method: 'PATCH',
        body: JSON.stringify({ purposeProposal: 'Новая статья для площадки' }),
      }),
      { params: Promise.resolve({ id: '54' }) },
    )

    expect(response.status).toBe(200)
    expect(state.createPurposeProposal).toHaveBeenCalledWith(expect.any(Object), {
      intakeItemId: 54,
      text: 'Новая статья для площадки',
    })
    expect(state.createExpenseRequest).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ requestId: 54, proposal: { id: 10 } })
  })

  it('EARS-510/511/512: exposes approve, refuse and one-act confirmation without a generic status setter', async () => {
    state.approveExpenseRequest.mockResolvedValue({ ...request, status: 'approved' })
    state.confirmExpenseRequest.mockResolvedValue({ ...request, status: 'posted' })
    state.refuseExpenseRequest.mockResolvedValue({ ...request, status: 'refused' })
    const route = await import('@/app/(platform)/p/finance/api/requests/[id]/actions/route')

    const approve = await route.POST(
      new Request(`${BASE}/41/actions`, {
        method: 'POST',
        body: JSON.stringify({ act: 'approve' }),
      }),
      { params: Promise.resolve({ id: '41' }) },
    )
    const confirm = await route.POST(
      new Request(`${BASE}/41/actions`, {
        method: 'POST',
        body: JSON.stringify({ act: 'confirm', occurredOn: '2026-09-01' }),
      }),
      { params: Promise.resolve({ id: '41' }) },
    )
    const refuse = await route.POST(
      new Request(`${BASE}/41/actions`, {
        method: 'POST',
        body: JSON.stringify({ act: 'refuse', reason: 'Уже оплачено другим способом' }),
      }),
      { params: Promise.resolve({ id: '41' }) },
    )

    expect([approve.status, confirm.status, refuse.status]).toEqual([200, 200, 200])
    expect(state.approveExpenseRequest).toHaveBeenCalledWith(expect.any(Object), 41)
    expect(state.confirmExpenseRequest).toHaveBeenCalledWith(expect.any(Object), 41, {
      occurredOn: '2026-09-01',
    })
    expect(state.refuseExpenseRequest).toHaveBeenCalledWith(
      expect.any(Object),
      41,
      'Уже оплачено другим способом',
    )
  })

  it('EARS-502/524: scenario 3 — PATCH edits through the request facade and returns the approved bounce', async () => {
    state.editExpenseRequest.mockResolvedValue({
      ...request,
      status: 'submitted',
      amount: 46_000_00n,
      decidedBy: null,
      decidedAt: null,
    })
    const route = await import('@/app/(platform)/p/finance/api/requests/[id]/route')

    const response = await route.PATCH(
      new Request(`${BASE}/41`, {
        method: 'PATCH',
        body: JSON.stringify({
          occurredOn: '2026-09-02',
          accountId: 7,
          amount: '4600000',
          currency: 'RUB',
          paidAmount: null,
          paidCurrency: null,
          purposeId: 11,
          projectId: 12,
          productId: 13,
          counterpartyId: 14,
          note: 'Изменённая сумма',
          alreadyPaid: false,
          personalFunds: false,
        }),
      }),
      { params: Promise.resolve({ id: '41' }) },
    )

    expect(response.status).toBe(200)
    expect(state.editExpenseRequest).toHaveBeenCalledWith(
      expect.any(Object),
      41,
      expect.objectContaining({ amount: 4_600_000n, productId: 13 }),
    )
    expect(await response.json()).toMatchObject({ id: 41, status: 'submitted', bounced: true })
  })

  it('EARS-524/532: reuses the normalized counterparty when edit is retried after the request write fails', async () => {
    state.listCounterparties
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 25, name: 'ПОСТАВЩИК ДЛЯ ПРАВКИ', createdBy: 15, createdAt: new Date() },
      ])
    state.createCounterparty.mockResolvedValue({ id: 25, name: 'Поставщик для правки' })
    state.editExpenseRequest
      .mockRejectedValueOnce(
        Object.assign(new Error('Изменения не сохранены.'), { name: 'FinanceRefusal' }),
      )
      .mockResolvedValueOnce({ ...request, status: 'submitted', counterpartyId: 25 })
    const route = await import('@/app/(platform)/p/finance/api/requests/[id]/route')
    const body = JSON.stringify({
      occurredOn: '2026-09-02',
      accountId: 7,
      amount: '4600000',
      currency: 'RUB',
      paidAmount: null,
      paidCurrency: null,
      purposeId: 11,
      projectId: 12,
      productId: 13,
      counterpartyName: '  Поставщик для правки  ',
      note: 'Изменённая сумма',
      alreadyPaid: false,
      personalFunds: false,
    })
    const params = { params: Promise.resolve({ id: '41' }) }

    const failed = await route.PATCH(new Request(`${BASE}/41`, { method: 'PATCH', body }), params)
    const retried = await route.PATCH(new Request(`${BASE}/41`, { method: 'PATCH', body }), {
      params: Promise.resolve({ id: '41' }),
    })

    expect(failed.status).toBe(422)
    expect(retried.status).toBe(200)
    expect(state.createCounterparty).toHaveBeenCalledTimes(1)
    expect(state.editExpenseRequest).toHaveBeenCalledTimes(2)
    expect(state.editExpenseRequest).toHaveBeenLastCalledWith(
      expect.any(Object),
      41,
      expect.objectContaining({ counterpartyId: 25 }),
    )
  })
})
