/**
 * The contribution intake item (spec 339 §K EARS-567): what a `kind =
 * contribution` row may and may not carry, as the pure rule filing and
 * posting both run.
 */
import { describe, expect, it } from 'vitest'

import { contributionItemRefusal } from '@/lib/finance/intake/contribution'

const valid = {
  source: 'manual',
  kind: 'contribution',
  accountId: 3,
  counterAccountId: null,
  paidAmount: null,
  paidCurrency: null,
  feeAmount: null,
  purposeId: null,
  productId: null,
  personalFunds: false,
  memberId: 9,
  counterpartyId: null,
  settlesItemId: null,
}

describe('the contribution intake item (EARS-567)', () => {
  it('EARS-567: a manual or backfill contribution onto a company account, naming its contributor, is accepted', () => {
    expect(contributionItemRefusal(valid)).toBeNull()
    expect(contributionItemRefusal({ ...valid, source: 'backfill' })).toBeNull()
    expect(contributionItemRefusal({ ...valid, memberId: null, counterpartyId: 4 })).toBeNull()
  })

  it('EARS-567: a row of another kind is not judged here', () => {
    expect(contributionItemRefusal({ ...valid, kind: 'expense', purposeId: 1 })).toBeNull()
  })

  it('EARS-567: never through the request form or a bank import', () => {
    expect(contributionItemRefusal({ ...valid, source: 'request' })).toMatch(/EARS-567/)
    expect(contributionItemRefusal({ ...valid, source: 'bank_import' })).toMatch(/EARS-567/)
  })

  it('EARS-567: never personal funds, never without a company account, never naming a counter account', () => {
    expect(contributionItemRefusal({ ...valid, personalFunds: true, accountId: null })).toMatch(
      /EARS-567/,
    )
    expect(contributionItemRefusal({ ...valid, accountId: null })).toMatch(/EARS-567/)
    expect(contributionItemRefusal({ ...valid, counterAccountId: 12 })).toMatch(/EARS-567/)
  })

  it('EARS-567: no paid pair, no fee, no purpose, no product, no settled item', () => {
    for (const patch of [
      { paidAmount: 5n, paidCurrency: 'USD' },
      { feeAmount: 1n },
      { purposeId: 1 },
      { productId: 2 },
      { settlesItemId: 3 },
    ]) {
      expect(contributionItemRefusal({ ...valid, ...patch })).toMatch(/EARS-567/)
    }
  })

  it('EARS-567: the contributor — a member or a counterparty — is required', () => {
    expect(contributionItemRefusal({ ...valid, memberId: null })).toMatch(/EARS-567/)
  })
})
