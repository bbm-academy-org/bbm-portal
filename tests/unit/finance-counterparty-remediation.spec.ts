// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FinanceRefusal } from '@/lib/finance/core/errors'

const state = vi.hoisted(() => ({
  intakeGate: vi.fn(),
  memberGate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/member', () => ({
  findMemberByEmail: async () => ({ id: 7 }),
}))
vi.mock('@/lib/finance/core/actor', () => ({
  assertFinanceIntakeAccess: state.intakeGate,
  assertFinancePlatformMember: state.memberGate,
  assertFinanceReferenceAccess: vi.fn(),
  financeAuditContext: () => ({ actorEmail: 'member@bbm.academy', source: 'portal' }),
}))
vi.mock('@/lib/platform/db/transaction', () => ({
  platformTransaction: state.transaction,
}))

const ACTOR = { email: 'member@bbm.academy', roles: ['platform-user'] }

beforeEach(() => {
  state.intakeGate.mockReset()
  state.memberGate.mockReset()
  state.transaction.mockReset().mockResolvedValue({
    id: 1,
    name: 'Anthropic',
    createdBy: 7,
    createdAt: new Date('2026-08-31T00:00:00Z'),
  })
})

describe('counterparty creation remediation (#416)', () => {
  it('uses the explicit platform-member gate instead of forging ownRequest', async () => {
    const { createCounterparty } = await import('@/lib/finance/counterparties')

    await createCounterparty(ACTOR, { name: 'Anthropic' })

    expect(state.memberGate).toHaveBeenCalledWith(ACTOR)
    expect(state.intakeGate).not.toHaveBeenCalled()
  })

  it('maps a nested PostgreSQL 23505 create race into the finance refusal taxonomy', async () => {
    const { createCounterparty } = await import('@/lib/finance/counterparties')
    state.transaction.mockRejectedValue(
      Object.assign(new Error('transaction failed'), {
        cause: Object.assign(new Error('duplicate'), { code: '23505' }),
      }),
    )

    await expect(createCounterparty(ACTOR, { name: 'Anthropic' })).rejects.toSatisfy(
      (error: unknown) => error instanceof FinanceRefusal && /Anthropic/.test(error.message),
    )
  })
})
