import { describe, expect, it } from 'vitest'

import { deriveExpenseRequestStage, type ExpenseRequestStageInput } from '@/lib/finance'

/**
 * The queue stage of spec 339 EARS-535 — a reading of the intake spine, never a
 * stored status. Every stage the clause names is covered here, including the
 * two that are not one-status-to-one-group: an unposted `already_paid` request
 * paid from a company account (→ «К оплате») and a posted `personal_funds`
 * request whose refund has not been booked yet (→ «Вернуть сотруднику»).
 */
function item(overrides: Partial<ExpenseRequestStageInput> = {}): ExpenseRequestStageInput {
  return {
    status: 'submitted',
    alreadyPaid: false,
    personalFunds: false,
    settled: false,
    ...overrides,
  }
}

describe('the request queue stage (EARS-535)', () => {
  it('EARS-535: a submitted pre-spend request waits for a decision', () => {
    expect(deriveExpenseRequestStage(item())).toBe('decide')
  })

  it('EARS-535: an approved, unposted pre-spend request is to be paid', () => {
    expect(deriveExpenseRequestStage(item({ status: 'approved' }))).toBe('pay')
  })

  it('EARS-535: an already_paid request from a company account is to be paid while unposted, submitted or approved', () => {
    for (const status of ['submitted', 'approved'] as const) {
      expect(deriveExpenseRequestStage(item({ status, alreadyPaid: true }))).toBe('pay')
    }
  })

  it('EARS-535: a personal-funds request is to be reimbursed while unposted, and while posted but unsettled', () => {
    for (const status of ['submitted', 'approved', 'posted'] as const) {
      expect(
        deriveExpenseRequestStage(item({ status, alreadyPaid: true, personalFunds: true })),
      ).toBe('reimburse')
    }
  })

  it('EARS-535: a settled personal-funds request is paid; a posted company request is paid', () => {
    expect(
      deriveExpenseRequestStage(
        item({ status: 'posted', alreadyPaid: true, personalFunds: true, settled: true }),
      ),
    ).toBe('paid')
    expect(deriveExpenseRequestStage(item({ status: 'posted' }))).toBe('paid')
    expect(deriveExpenseRequestStage(item({ status: 'posted', alreadyPaid: true }))).toBe('paid')
  })

  it('EARS-535: draft, refused and cancelled are their own stages', () => {
    expect(deriveExpenseRequestStage(item({ status: 'draft' }))).toBe('draft')
    expect(deriveExpenseRequestStage(item({ status: 'refused' }))).toBe('refused')
    expect(deriveExpenseRequestStage(item({ status: 'cancelled' }))).toBe('cancelled')
    expect(
      deriveExpenseRequestStage(
        item({ status: 'cancelled', alreadyPaid: true, personalFunds: true }),
      ),
    ).toBe('cancelled')
  })
})
