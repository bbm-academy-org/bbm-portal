// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  intakeAccountPlacementRefusal,
  isReimbursementTransfer,
  type IntakeAccountFacts,
  type IntakeAccountPlacementState,
} from '@/lib/finance/intake/account-placement'

/**
 * Where an intake item may name a system account (spec 339 EARS-528).
 *
 * The rule is pure on purpose: filing, editing and posting all ask it of the
 * same merged row, and a rule with three copies is a rule that drifts. The
 * integration tier (`tests/int/platform/finance-reimbursement.int.spec.ts`)
 * proves those three callers actually ask it.
 */
const card: IntakeAccountFacts = {
  id: 1,
  name: 'Карта RUB',
  kind: 'card',
  currency: 'RUB',
  isSystem: false,
}
const liabilityRub: IntakeAccountFacts = {
  id: 2,
  name: 'liability:RUB',
  kind: 'liability',
  currency: 'RUB',
  isSystem: true,
}
const expenseRub: IntakeAccountFacts = {
  id: 3,
  name: 'expense:RUB',
  kind: 'expense',
  currency: 'RUB',
  isSystem: true,
}
const savings: IntakeAccountFacts = {
  id: 4,
  name: 'Накопительный RUB',
  kind: 'bank',
  currency: 'RUB',
  isSystem: false,
}

function reimbursement(
  overrides: Partial<IntakeAccountPlacementState> = {},
): IntakeAccountPlacementState {
  return {
    kind: 'transfer',
    currency: 'RUB',
    memberId: 7,
    paidAmount: null,
    paidCurrency: null,
    personalFunds: false,
    ...overrides,
  }
}

describe('a system account appears in intake only as a reimbursement target (EARS-528)', () => {
  it('EARS-528: accepts a transfer from a money account to the liability account that names the member', () => {
    expect(
      intakeAccountPlacementRefusal(reimbursement(), {
        account: card,
        counterAccount: liabilityRub,
      }),
    ).toBeNull()
    expect(isReimbursementTransfer(reimbursement(), liabilityRub)).toBe(true)
  })

  it('EARS-528: refuses a reimbursement that names no member, and says whose debt is missing', () => {
    const refusal = intakeAccountPlacementRefusal(reimbursement({ memberId: null }), {
      account: card,
      counterAccount: liabilityRub,
    })
    expect(refusal).toContain('EARS-528')
    expect(refusal).toContain('участника')
  })

  it('EARS-528: refuses a reimbursement in a currency other than the debt it settles', () => {
    expect(
      intakeAccountPlacementRefusal(reimbursement({ currency: 'THB' }), {
        account: card,
        counterAccount: liabilityRub,
      }),
    ).toContain('RUB')
    expect(
      intakeAccountPlacementRefusal(reimbursement({ paidAmount: 100n, paidCurrency: 'THB' }), {
        account: card,
        counterAccount: liabilityRub,
      }),
    ).toContain('EARS-528')
  })

  it('EARS-528: refuses a reimbursement marked as paid from personal funds', () => {
    expect(
      intakeAccountPlacementRefusal(reimbursement({ personalFunds: true }), {
        account: null,
        counterAccount: liabilityRub,
      }),
    ).toContain('EARS-528')
  })

  it('EARS-528: refuses the liability account in the money-account place', () => {
    expect(
      intakeAccountPlacementRefusal(reimbursement(), {
        account: liabilityRub,
        counterAccount: card,
      }),
    ).toContain('EARS-528')
  })

  it('EARS-528: refuses a system account other than liability as the counter account', () => {
    expect(
      intakeAccountPlacementRefusal(reimbursement(), {
        account: card,
        counterAccount: expenseRub,
      }),
    ).toContain('EARS-528')
  })

  it('EARS-528: refuses the liability account as counter account of any kind but transfer', () => {
    for (const kind of ['expense', 'income', 'conversion'] as const) {
      expect(
        intakeAccountPlacementRefusal(reimbursement({ kind }), {
          account: card,
          counterAccount: liabilityRub,
        }),
      ).toContain('EARS-528')
    }
  })

  it('EARS-528: leaves items that name no system account to the rest of the shape rules', () => {
    expect(
      intakeAccountPlacementRefusal(reimbursement({ memberId: null }), {
        account: card,
        counterAccount: savings,
      }),
    ).toBeNull()
    expect(
      intakeAccountPlacementRefusal(reimbursement({ kind: 'expense', memberId: null }), {
        account: null,
        counterAccount: null,
      }),
    ).toBeNull()
    expect(isReimbursementTransfer(reimbursement(), savings)).toBe(false)
    expect(isReimbursementTransfer(reimbursement(), null)).toBe(false)
  })
})
