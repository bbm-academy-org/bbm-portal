/**
 * The finance fact core's PURE invariants (spec `docs/specs/338-ledger-core.md`).
 *
 * These are the refusals that need no database to be true: an operation that
 * does not balance, a posting in the wrong currency, a product where the
 * purpose's binding forbids one, a result posting with no project, a caller
 * without `platform-admin`. Keeping them in pure functions is what lets the
 * module refuse with a readable message BEFORE it opens a transaction — the
 * constraint-error shape EARS-326 rules out.
 *
 * The database-level half (immutability triggers, the `core.member` FK, reversal
 * and conversion mechanics) lives in `tests/int/platform/finance-*.int.spec.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  assertBalancedPerCurrency,
  assertFinanceWriteAccess,
  assertPostingCurrencyMatchesAccount,
  assertProductBinding,
  assertProjectOnResultPostings,
  convertMinorUnits,
  FinanceAccessRefusal,
  FinanceRefusal,
  resolvePostingCategory,
  type AccountFacts,
  type PostingDraft,
} from '@/lib/finance'

/** The chart of accounts these cases post against. */
const ACCOUNTS: ReadonlyMap<number, AccountFacts> = new Map<number, AccountFacts>([
  [1, { id: 1, currency: 'RUB', kind: 'bank', isSystem: false, retiredAt: null }],
  [2, { id: 2, currency: 'RUB', kind: 'expense', isSystem: true, retiredAt: null }],
  [3, { id: 3, currency: 'THB', kind: 'card', isSystem: false, retiredAt: null }],
  [4, { id: 4, currency: 'THB', kind: 'income', isSystem: true, retiredAt: null }],
  [5, { id: 5, currency: 'RUB', kind: 'conversion', isSystem: true, retiredAt: null }],
])

function posting(
  over: Partial<PostingDraft> & Pick<PostingDraft, 'accountId' | 'amount'>,
): PostingDraft {
  const account = ACCOUNTS.get(over.accountId)
  return { currency: account?.currency ?? 'RUB', ...over }
}

describe('the fact core refuses an unbalanced operation (EARS-311)', () => {
  it('EARS-311: accepts postings that sum to zero in every currency', () => {
    const postings = [
      posting({ accountId: 2, amount: 10_000n, projectId: 7 }),
      posting({ accountId: 1, amount: -10_000n }),
      posting({ accountId: 4, amount: -5_000n, projectId: 7 }),
      posting({ accountId: 3, amount: 5_000n }),
    ]
    expect(() => assertBalancedPerCurrency(postings)).not.toThrow()
  })

  it('EARS-311: refuses an operation whose postings do not sum to zero, naming the currency and the residual', () => {
    const postings = [
      posting({ accountId: 2, amount: 10_000n, projectId: 7 }),
      posting({ accountId: 1, amount: -9_999n }),
    ]
    expect(() => assertBalancedPerCurrency(postings)).toThrow(FinanceRefusal)
    expect(() => assertBalancedPerCurrency(postings)).toThrow(/RUB/)
    expect(() => assertBalancedPerCurrency(postings)).toThrow(/1\b/)
  })

  it('EARS-311: balance is checked PER currency — two currencies that cancel each other do not balance', () => {
    const postings = [
      posting({ accountId: 1, amount: -1_000n }),
      posting({ accountId: 3, amount: 1_000n }),
    ]
    expect(() => assertBalancedPerCurrency(postings)).toThrow(FinanceRefusal)
  })

  it('EARS-311: refuses an operation with no postings at all — a zero-posting operation is not a fact', () => {
    expect(() => assertBalancedPerCurrency([])).toThrow(FinanceRefusal)
  })
})

describe("a posting's currency is its account's (EARS-312)", () => {
  it("EARS-312: refuses a posting whose currency differs from its account's, naming both", () => {
    const postings = [posting({ accountId: 1, amount: 1_000n, currency: 'THB' })]
    expect(() => assertPostingCurrencyMatchesAccount(postings, ACCOUNTS)).toThrow(FinanceRefusal)
    expect(() => assertPostingCurrencyMatchesAccount(postings, ACCOUNTS)).toThrow(/THB/)
    expect(() => assertPostingCurrencyMatchesAccount(postings, ACCOUNTS)).toThrow(/RUB/)
  })

  it('EARS-312: accepts a posting whose currency matches its account', () => {
    const postings = [posting({ accountId: 3, amount: 1_000n })]
    expect(() => assertPostingCurrencyMatchesAccount(postings, ACCOUNTS)).not.toThrow()
  })

  it('EARS-312: refuses a posting naming an account that does not exist, rather than passing it through', () => {
    const postings = [posting({ accountId: 99, amount: 1_000n, currency: 'RUB' })]
    expect(() => assertPostingCurrencyMatchesAccount(postings, ACCOUNTS)).toThrow(FinanceRefusal)
  })
})

describe('every income/expense posting names a project (EARS-321)', () => {
  it('EARS-321: refuses an expense-account posting with no project', () => {
    const postings = [
      posting({ accountId: 2, amount: 10_000n, projectId: null }),
      posting({ accountId: 1, amount: -10_000n }),
    ]
    expect(() => assertProjectOnResultPostings(postings, ACCOUNTS)).toThrow(FinanceRefusal)
  })

  it('EARS-321: refuses an income-account posting with no project', () => {
    const postings = [
      posting({ accountId: 4, amount: -5_000n }),
      posting({ accountId: 3, amount: 5_000n }),
    ]
    expect(() => assertProjectOnResultPostings(postings, ACCOUNTS)).toThrow(FinanceRefusal)
  })

  it('EARS-321: accepts money-account postings with no project — the dimension rides the result leg', () => {
    const postings = [
      posting({ accountId: 2, amount: 10_000n, projectId: 7 }),
      posting({ accountId: 1, amount: -10_000n }),
    ]
    expect(() => assertProjectOnResultPostings(postings, ACCOUNTS)).not.toThrow()
  })

  it('EARS-321: the conversion account is not a result account and needs no project', () => {
    const postings = [
      posting({ accountId: 5, amount: 1_000n }),
      posting({ accountId: 1, amount: -1_000n }),
    ]
    expect(() => assertProjectOnResultPostings(postings, ACCOUNTS)).not.toThrow()
  })
})

describe('the purpose declares the product binding, the operator supplies the value (EARS-320, EARS-331)', () => {
  it('EARS-320: `required` refuses an operation with no product', () => {
    expect(() => assertProductBinding('required', null, 'Продакшн урока')).toThrow(FinanceRefusal)
    expect(() => assertProductBinding('required', null, 'Продакшн урока')).toThrow(/Продакшн урока/)
  })

  it('EARS-320: `forbidden` refuses an operation that names a product', () => {
    expect(() => assertProductBinding('forbidden', 12, 'Аренда офиса')).toThrow(FinanceRefusal)
  })

  it('EARS-320: `optional` accepts both a product and its absence', () => {
    expect(() => assertProductBinding('optional', 12, 'Хостинг')).not.toThrow()
    expect(() => assertProductBinding('optional', null, 'Хостинг')).not.toThrow()
  })

  it('EARS-320: `required` accepts an operation that names a product', () => {
    expect(() => assertProductBinding('required', 12, 'Продакшн урока')).not.toThrow()
  })

  it('EARS-331: the binding is master data — a caller cannot pass one, the refusal names the purpose edit', () => {
    // The binding argument is the PURPOSE's stored value; there is no code path
    // that takes one from the operation input. Asserted here at the level the
    // helper can see: an operation-time binding is never consulted, so a
    // `forbidden` purpose refuses a product no matter what the caller wanted.
    expect(() => assertProductBinding('forbidden', 12, 'Аренда офиса')).toThrow(/product_binding/)
  })
})

describe('a purpose and its category never disagree on a posting (EARS-327)', () => {
  it('EARS-327: takes the category from the purpose when the caller names none', () => {
    expect(resolvePostingCategory(4, undefined, 'Хостинг')).toBe(4)
    expect(resolvePostingCategory(4, null, 'Хостинг')).toBe(4)
  })

  it("EARS-327: accepts a caller category identical to the purpose's", () => {
    expect(resolvePostingCategory(4, 4, 'Хостинг')).toBe(4)
  })

  it("EARS-327: refuses a caller category that differs from the purpose's", () => {
    expect(() => resolvePostingCategory(4, 9, 'Хостинг')).toThrow(FinanceRefusal)
    expect(() => resolvePostingCategory(4, 9, 'Хостинг')).toThrow(/Хостинг/)
  })

  it('EARS-327: a purpose with no category link leaves the caller free', () => {
    expect(resolvePostingCategory(null, 9, 'Хостинг')).toBe(9)
    expect(resolvePostingCategory(null, null, 'Хостинг')).toBeNull()
  })
})

describe('every finance write demands `platform-admin` (EARS-330)', () => {
  it('EARS-330: refuses an actor carrying no roles at all', () => {
    expect(() => assertFinanceWriteAccess({ email: 'a@bbm.academy', roles: [] })).toThrow(
      FinanceAccessRefusal,
    )
  })

  it('EARS-330: refuses an actor carrying only `platform-user` — read access is deliberately wider', () => {
    expect(() =>
      assertFinanceWriteAccess({ email: 'a@bbm.academy', roles: ['platform-user'] }),
    ).toThrow(FinanceAccessRefusal)
  })

  it('EARS-330: accepts an actor carrying `platform-admin`', () => {
    expect(() =>
      assertFinanceWriteAccess({ email: 'a@bbm.academy', roles: ['platform-admin'] }),
    ).not.toThrow()
  })

  it('EARS-330: refuses an actor with no email — an attributable write has a person behind it (spec 201)', () => {
    expect(() => assertFinanceWriteAccess({ email: '', roles: ['platform-admin'] })).toThrow(
      FinanceAccessRefusal,
    )
  })
})

describe('minimal-unit conversion arithmetic (EARS-310, EARS-318)', () => {
  it('EARS-310: converts between currencies of equal precision', () => {
    // 1000.00 RUB at 0.35 THB per RUB → 350.00 THB
    expect(convertMinorUnits(100_000n, '0.35', 2, 2)).toBe(35_000n)
  })

  it('EARS-310: carries the two precisions — 1 USDT (6 dp) at 34.5 THB (2 dp)', () => {
    expect(convertMinorUnits(1_000_000n, '34.5', 6, 2)).toBe(3_450n)
  })

  it('EARS-310: rounds half away from zero rather than truncating toward it', () => {
    expect(convertMinorUnits(1n, '0.5', 0, 0)).toBe(1n)
    expect(convertMinorUnits(-1n, '0.5', 0, 0)).toBe(-1n)
  })

  it('EARS-318: refuses a rate that is not a positive decimal literal', () => {
    expect(() => convertMinorUnits(100n, '0', 2, 2)).toThrow(FinanceRefusal)
    expect(() => convertMinorUnits(100n, '-1.5', 2, 2)).toThrow(FinanceRefusal)
    expect(() => convertMinorUnits(100n, '1,5', 2, 2)).toThrow(FinanceRefusal)
  })
})
