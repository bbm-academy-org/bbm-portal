// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  findMember: vi.fn(),
  row: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/member', () => ({ findMemberByEmail: state.findMember }))
vi.mock('@/lib/platform/db/client', () => ({
  getPlatformDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => (state.row === null ? [] : [state.row]),
      }),
    }),
  }),
}))

beforeEach(() => {
  state.findMember.mockReset().mockResolvedValue(null)
  state.row = {
    id: 31,
    source: 'request',
    sourceRef: null,
    kind: 'expense',
    status: 'submitted',
    occurredOn: '2026-08-31',
    accountId: 1,
    counterAccountId: null,
    amount: 100n,
    currency: 'RUB',
    paidAmount: null,
    paidCurrency: null,
    feeAmount: null,
    feeCurrency: null,
    purposeId: 1,
    projectId: 1,
    productId: null,
    counterpartyId: null,
    memberId: null,
    note: null,
    alreadyPaid: false,
    personalFunds: false,
    createdBy: 9,
    decidedBy: null,
    decidedAt: null,
    refusalReason: null,
    postedBy: null,
    postedAt: null,
    operationId: null,
  }
})

describe('single intake item visibility remediation (#416)', () => {
  it('returns an item to a flow-role holder without requiring a core.member row first', async () => {
    const { getIntakeItem } = await import('@/lib/finance/intake/items')

    await expect(
      getIntakeItem({ email: 'approver@bbm.academy', roles: ['finance-approve'] }, 31),
    ).resolves.toMatchObject({ id: 31 })
    expect(state.findMember).not.toHaveBeenCalled()
  })
})
