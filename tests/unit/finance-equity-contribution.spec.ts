/**
 * The contribution shape and the `equity` guard (spec 338 §D EARS-335…337,
 * §D fixture 11), as the pure invariant the ledger runs before any write.
 */
import { describe, expect, it } from 'vitest'

import { FinanceRefusal } from '@/lib/finance/core/errors'
import {
  assertEquityContributionShape,
  type AccountFacts,
  type PostingDraft,
} from '@/lib/finance/core/invariants'
import { isCurrentMoneyAccount, selectCurrentMoneyAccounts } from '@/lib/finance/current-money'
import {
  FINANCE_MONEY_ACCOUNT_KINDS,
  FINANCE_SYSTEM_ACCOUNT_KINDS,
} from '@/lib/platform/db/schema/finance/finance-account'

const FUND = 1
const P = 2

const facts = (id: number, kind: AccountFacts['kind'], currency = 'RUB'): AccountFacts => ({
  id,
  kind,
  currency,
  isSystem: (FINANCE_SYSTEM_ACCOUNT_KINDS as readonly string[]).includes(kind),
  retiredAt: null,
})
const accounts = new Map<number, AccountFacts>([
  [1, facts(1, 'bank')],
  [2, facts(2, 'card')],
  [3, facts(3, 'equity')],
  [4, facts(4, 'expense')],
  [5, facts(5, 'conversion')],
  [6, facts(6, 'income')],
])

const contribution = (): PostingDraft[] => [
  { accountId: 1, amount: 100_000n, currency: 'RUB' },
  { accountId: 3, amount: -100_000n, currency: 'RUB', projectId: FUND, memberId: 9 },
]

function refuse(postings: PostingDraft[], purposeId: number | null = null): void {
  expect(() =>
    assertEquityContributionShape(postings, accounts, { purposeId, fundProjectId: FUND }),
  ).toThrow(FinanceRefusal)
}

describe('the contribution operation (EARS-336/337)', () => {
  it('EARS-336: a money debit and an equity credit on the fund, same currency and amount, is accepted', () => {
    expect(() =>
      assertEquityContributionShape(contribution(), accounts, {
        purposeId: null,
        fundProjectId: FUND,
      }),
    ).not.toThrow()
  })

  it('EARS-336: an operation with no equity posting is not a contribution and is not judged here', () => {
    expect(() =>
      assertEquityContributionShape(
        [
          { accountId: 1, amount: -5n, currency: 'RUB' },
          { accountId: 4, amount: 5n, currency: 'RUB', projectId: P },
        ],
        accounts,
        { purposeId: 7, fundProjectId: FUND },
      ),
    ).not.toThrow()
  })

  it('EARS-337: fixture 11 — an equity posting with a purpose is refused', () => {
    refuse(contribution(), 7)
  })

  it('EARS-337: fixture 11 — an equity posting with a conversion step is refused', () => {
    const postings = contribution()
    postings[1] = { ...postings[1], conversionStepNo: 1 }
    refuse(postings)
  })

  it('EARS-337: fixture 11 — a second money leg is refused', () => {
    refuse([
      { accountId: 1, amount: 60_000n, currency: 'RUB' },
      { accountId: 2, amount: 40_000n, currency: 'RUB' },
      { accountId: 3, amount: -100_000n, currency: 'RUB', projectId: FUND },
    ])
  })

  it('EARS-337: fixture 11 — a mismatched amount is refused', () => {
    refuse([
      { accountId: 1, amount: 90_000n, currency: 'RUB' },
      { accountId: 3, amount: -100_000n, currency: 'RUB', projectId: FUND },
    ])
  })

  it('EARS-337: fixture 11 — a non-fund project on the equity posting is refused', () => {
    const postings = contribution()
    postings[1] = { ...postings[1], projectId: P }
    refuse(postings)
  })

  it('EARS-337: fixture 11 — a reversal-shaped operation (equity debit) that reverses no contribution is refused', () => {
    refuse([
      { accountId: 1, amount: -100_000n, currency: 'RUB' },
      { accountId: 3, amount: 100_000n, currency: 'RUB', projectId: FUND },
    ])
  })

  it('EARS-337: an equity credit balanced against income or expense instead of money is refused', () => {
    refuse([
      { accountId: 6, amount: 100_000n, currency: 'RUB', projectId: FUND },
      { accountId: 3, amount: -100_000n, currency: 'RUB', projectId: FUND },
    ])
  })

  it('EARS-337: a product on a contribution is refused', () => {
    const postings = contribution()
    postings[0] = { ...postings[0], productId: 3 }
    refuse(postings)
  })
})

describe('the equity account kind (EARS-335)', () => {
  it('EARS-335: equity is a sixth system kind, never a money kind', () => {
    expect(FINANCE_SYSTEM_ACCOUNT_KINDS).toContain('equity')
    expect(FINANCE_SYSTEM_ACCOUNT_KINDS).toHaveLength(6)
    expect(FINANCE_MONEY_ACCOUNT_KINDS as readonly string[]).not.toContain('equity')
  })

  it('EARS-335: fixture 11 — an equity account is neither a cash tile nor part of the EARS-325 total', () => {
    expect(isCurrentMoneyAccount({ kind: 'equity', isSystem: true })).toBe(false)
    const tiles = selectCurrentMoneyAccounts([
      {
        accountId: 1,
        name: 'bank',
        kind: 'bank',
        currency: 'RUB',
        isSystem: false,
        retiredAt: null,
        balance: 100_000n,
      },
      {
        accountId: 3,
        name: 'equity:RUB',
        kind: 'equity',
        currency: 'RUB',
        isSystem: true,
        retiredAt: null,
        balance: -100_000n,
      },
    ])
    expect(tiles.map((tile) => tile.accountId)).toEqual([1])
  })
})
