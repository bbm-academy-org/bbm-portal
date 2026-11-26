/**
 * The budget dashboard's reporting currency (spec 584 §G, issue #586): the
 * actual-rate conversion of flow figures along an item's own chain (EARS-728),
 * the dated Bank of Russia fallback (EARS-729), the latest-rate conversion of
 * stock figures and the ratios kept in `B` (EARS-722), the switch's candidates
 * (EARS-721) and the stale-rate condition of the header notice (EARS-703, whose
 * header clauses stay on the #586 list). Synthetic ledgers only.
 */
import { describe, expect, it } from 'vitest'

import {
  buildBudgetDashboard,
  type BudgetDashboard,
  type BudgetDisplayInput,
} from '@/lib/finance/budget/dashboard'
import {
  budgetDisplayCandidates,
  convertOwnAmount,
  operationSteps,
  parseBudgetDisplayCurrency,
  rateStaleSince,
  type CbrFallback,
  type DisplayStep,
} from '@/lib/finance/budget/display-currency'
import {
  replayBudget,
  type BudgetFigure,
  type BudgetOperationFact,
  type BudgetPostingFact,
} from '@/lib/finance/budget/replay'

const FUND = 1
const MEMBER = 7
const PRECISIONS = new Map([
  ['RUB', 2],
  ['USD', 2],
  ['EUR', 2],
  ['THB', 2],
  ['USDT', 6],
])
const noFallback: CbrFallback = () => null

describe('EARS-728: the actual amount along the item own chain', () => {
  // A USD invoice paid from the baht account: a USD expense and one THB → USD step.
  const steps: DisplayStep[] = [
    { stepNo: 1, fromCurrency: 'THB', toCurrency: 'USD', fromAmount: 3_500_00n, toAmount: 100_00n },
  ]
  const base = {
    valueB: { status: 'known', amount: 9_000_00n } as BudgetFigure,
    occurredOn: '2026-03-03',
    steps,
    precisions: PRECISIONS,
    fallback: noFallback,
  }

  it('is the own amount where D is the item own currency', () => {
    expect(convertOwnAmount({ ...base, currency: 'USD', amount: 100_00n, display: 'USD' })).toEqual(
      { status: 'actual', amount: 100_00n },
    )
  })

  it('walks a step in either direction at its recorded ratio', () => {
    expect(convertOwnAmount({ ...base, currency: 'USD', amount: 100_00n, display: 'THB' })).toEqual(
      { status: 'actual', amount: 3_500_00n },
    )
    // the baht fee, at the step's own baht-to-dollar ratio
    expect(convertOwnAmount({ ...base, currency: 'THB', amount: 35_00n, display: 'USD' })).toEqual({
      status: 'actual',
      amount: 1_00n,
    })
  })

  it('takes the shortest path, and the lexicographically lowest step_no sequence among equals', () => {
    const chain: DisplayStep[] = [
      { stepNo: 1, fromCurrency: 'RUB', toCurrency: 'EUR', fromAmount: 100_00n, toAmount: 1_00n },
      { stepNo: 2, fromCurrency: 'EUR', toCurrency: 'THB', fromAmount: 1_00n, toAmount: 40_00n },
      { stepNo: 3, fromCurrency: 'RUB', toCurrency: 'THB', fromAmount: 100_00n, toAmount: 30_00n },
      { stepNo: 4, fromCurrency: 'RUB', toCurrency: 'THB', fromAmount: 100_00n, toAmount: 50_00n },
    ]
    expect(
      convertOwnAmount({
        ...base,
        steps: chain,
        currency: 'RUB',
        amount: 1_000_00n,
        display: 'THB',
      }),
    ).toEqual({ status: 'actual', amount: 300_00n })
  })

  it('reads USDT on the chain as the same number of dollars', () => {
    const chain: DisplayStep[] = [
      {
        stepNo: 1,
        fromCurrency: 'RUB',
        toCurrency: 'USDT',
        fromAmount: 9_000_00n,
        toAmount: 100_000000n,
      },
      {
        stepNo: 2,
        fromCurrency: 'USDT',
        toCurrency: 'THB',
        fromAmount: 100_000000n,
        toAmount: 3_400_00n,
      },
    ]
    expect(
      convertOwnAmount({
        ...base,
        steps: chain,
        currency: 'THB',
        amount: 3_400_00n,
        display: 'USD',
      }),
    ).toEqual({ status: 'actual', amount: 100_00n })
  })

  it('derives a step from its conversion postings', () => {
    const posting = (currency: string, amount: bigint, conversionStepNo: number | null) =>
      ({
        postingId: 1,
        accountId: 1,
        accountKind: 'conversion',
        isSystem: true,
        currency,
        amount,
        projectId: null,
        memberId: null,
        conversionStepNo,
      }) satisfies BudgetPostingFact
    const operation = {
      operationId: 1,
      occurredOn: '2026-03-03',
      reverses: null,
      intakeItemId: null,
      settlesItemId: null,
      steps: [{ stepNo: 1, fromCurrency: 'RUB', toCurrency: 'USD' }],
      postings: [
        posting('RUB', 9_500_00n, 1),
        posting('USD', -100_00n, 1),
        posting('RUB', 5n, null),
      ],
    } satisfies BudgetOperationFact
    expect(operationSteps(operation)).toEqual([
      {
        stepNo: 1,
        fromCurrency: 'RUB',
        toCurrency: 'USD',
        fromAmount: 9_500_00n,
        toAmount: 100_00n,
      },
    ])
  })
})

describe('EARS-729: the dated Bank of Russia fallback', () => {
  const base = {
    currency: 'RUB',
    amount: 9_000_00n,
    valueB: { status: 'known', amount: 9_000_00n } as BudgetFigure,
    occurredOn: '2026-03-03',
    steps: [],
    precisions: PRECISIONS,
  }

  it('converts the B value at the rate of the operation date, and dates it', () => {
    expect(
      convertOwnAmount({
        ...base,
        display: 'EUR',
        fallback: (amount, date) => ({ amount: amount / 100n, rateDate: date }),
      }),
    ).toEqual({ status: 'cbr', amount: 90_00n, rateDate: '2026-03-03' })
  })

  it('has no amount where no rate qualifies — never 1:1, never zero', () => {
    expect(convertOwnAmount({ ...base, display: 'EUR', fallback: noFallback })).toEqual({
      status: 'noRate',
      date: '2026-03-03',
    })
  })
})

describe('EARS-721: the switch, and the stale-rate condition the header notice uses', () => {
  it('offers ₽ $ € and B, falls back to RUB, else B, and disables what cannot convert', () => {
    const candidates = budgetDisplayCandidates('THB', (code) => code !== 'EUR')
    expect(candidates).toEqual([
      { code: 'RUB', disabled: false },
      { code: 'USD', disabled: false },
      { code: 'EUR', disabled: true },
      { code: 'THB', disabled: false },
    ])
    expect(parseBudgetDisplayCurrency('USD', candidates, 'THB')).toBe('USD')
    expect(parseBudgetDisplayCurrency('EUR', candidates, 'THB')).toBe('RUB')
    expect(parseBudgetDisplayCurrency('XYZ', candidates, 'THB')).toBe('RUB')
    expect(parseBudgetDisplayCurrency(null, candidates, 'THB')).toBe('RUB')
    const noRub = budgetDisplayCandidates('THB', (code) => code === 'THB')
    expect(parseBudgetDisplayCurrency(undefined, noRub, 'THB')).toBe('THB')
  })

  it('says the rates are stale when the newest is more than three days old', () => {
    expect(rateStaleSince('2026-06-12', '2026-06-15')).toBeNull()
    expect(rateStaleSince('2026-06-11', '2026-06-15')).toBe('2026-06-11')
    expect(rateStaleSince(null, '2026-06-15')).toBeNull()
  })
})

// ── the dashboard in D ───────────────────────────────────────────────────────

type Account = { id: number; kind: string; currency: string }
const accounts = new Map<string, Account>()
let nextId = 1
function account(kind: string, currency: string): Account {
  const key = `${kind}:${currency}`
  let found = accounts.get(key)
  if (found === undefined) {
    found = { id: nextId++, kind, currency }
    accounts.set(key, found)
  }
  return found
}
let nextOperation = 1
let nextPosting = 1
function op(
  occurredOn: string,
  legs: [Account, bigint, Partial<BudgetPostingFact>?][],
  options: { intakeItemId?: number; settlesItemId?: number } = {},
): BudgetOperationFact {
  return {
    operationId: nextOperation++,
    occurredOn,
    reverses: null,
    intakeItemId: options.intakeItemId ?? null,
    settlesItemId: options.settlesItemId ?? null,
    steps: [],
    postings: legs.map(([acc, amount, extra]) => ({
      postingId: nextPosting++,
      accountId: acc.id,
      accountKind: acc.kind,
      isSystem: acc.kind !== 'bank',
      currency: acc.currency,
      amount,
      projectId: FUND,
      memberId: null,
      categoryId: null,
      conversionStepNo: null,
      ...extra,
    })),
  }
}
const bank = () => account('bank', 'RUB')
const contribute = (date: string, amount: bigint) =>
  op(date, [
    [bank(), amount],
    [account('equity', 'RUB'), -amount, { memberId: MEMBER }],
  ])
const spend = (date: string, amount: bigint) =>
  op(date, [
    [bank(), -amount],
    [account('expense', 'RUB'), amount],
  ])
const personalRub = (date: string, amount: bigint, itemId: number) =>
  op(
    date,
    [
      [account('liability', 'RUB'), -amount, { memberId: MEMBER }],
      [account('expense', 'RUB'), amount],
    ],
    { intakeItemId: itemId },
  )
const repayRub = (date: string, amount: bigint, itemId: number, settles: number | undefined) =>
  op(
    date,
    [
      [account('liability', 'RUB'), amount, { memberId: MEMBER }],
      [bank(), -amount],
    ],
    { intakeItemId: itemId, settlesItemId: settles },
  )

const earn = (date: string, amount: bigint) =>
  op(date, [
    [bank(), amount],
    [account('income', 'RUB'), -amount],
  ])

const TODAY = '2026-06-15'
const ledger = () => [
  contribute('2026-01-10', 500_000_00n),
  spend('2026-02-05', 100_000_00n),
  spend('2026-03-05', 100_000_00n),
  spend('2026-04-05', 100_000_00n),
  spend('2026-05-05', 100_000_00n),
]

/** 1 $ = 100 ₽ on every operation date; 1 $ = 80 ₽ today. */
function display(
  currency: string,
  overrides: Partial<BudgetDisplayInput> = {},
): BudgetDisplayInput {
  return {
    currency,
    operationSteps: new Map(),
    precisions: PRECISIONS,
    fallback: (amount, date) => ({ amount: (amount + 50n) / 100n, rateDate: date }),
    latest: { rateDate: '2026-06-13', convert: (amount) => (amount * 10n + 400n) / 800n },
    newestRateOn: '2026-06-13',
    ...overrides,
  }
}

function view(operations: BudgetOperationFact[], d?: BudgetDisplayInput): BudgetDashboard {
  const reading = replayBudget({
    budget: { currency: 'RUB', limitAmount: 1_000_000_00n, startsOn: '2026-01-10' },
    operations,
    provisionalValue: (_currency, _date, quantity) => quantity * 90n,
  })
  return buildBudgetDashboard({
    reading,
    today: TODAY,
    period: 'all',
    operations: new Map(),
    names: { projects: new Map([[FUND, 'BBM']]), categories: new Map(), counterparties: new Map() },
    display: d,
  })
}
const known = (figure: BudgetFigure | null): bigint => {
  if (figure?.status !== 'known') throw new Error('withheld')
  return figure.amount
}

describe('EARS-722: the dashboard in D', () => {
  it('converts nothing while D is B, and says so', () => {
    const rub = view(ledger(), display('RUB'))
    expect(rub.display.currency).toBe('RUB')
    expect(rub.display.converted).toBe(false)
    expect(known(rub.glass.spent)).toBe(400_000_00n)
    expect(rub.glass.spent.status === 'known' && rub.glass.spent.cbr).toBeFalsy()
  })

  it('sums converted flow items, converts stocks at the latest rate, keeps ratios in B', () => {
    const rub = view(ledger())
    const usd = view(ledger(), display('USD'))
    expect(usd.display.converted).toBe(true)
    // flows — 1 $ = 100 ₽ at each operation
    expect(known(usd.glass.spent)).toBe(4_000_00n)
    expect(known(usd.money.contributed)).toBe(5_000_00n)
    const gross = usd.months.reduce((total, month) => total + known(month.gross), 0n)
    expect(gross).toBe(4_000_00n)
    for (const grouping of Object.values(usd.breakdown)) {
      expect(known(grouping.total)).toBe(4_000_00n)
    }
    expect(known(usd.waterline.at(-1)!.net)).toBe(-4_000_00n)
    // stocks — 1 $ = 80 ₽ today; remaining computed in B first
    expect(known(usd.glass.limit)).toBe(12_500_00n)
    expect(known(usd.glass.remaining)).toBe(7_500_00n)
    expect(usd.display.stockRate).toBe('2026-06-13')
    // ratios and states stay the B ones
    expect(usd.glass.shareUsed).toBe(rub.glass.shareUsed)
    expect(usd.glass.state).toBe(rub.glass.state)
    expect(usd.runway.case).toBe(rub.runway.case)
    expect(usd.runway.months).toBe(rub.runway.months)
    // relations across the kinds
    expect(usd.display.differences.limit).toBe(1_000_00n)
    // every item went through the fallback
    expect(usd.glass.spent.status === 'known' && usd.glass.spent.cbr?.items).toBe(4)
    expect(usd.display.fallback).toEqual({ operations: 5, of: 5 })
  })

  it('withholds stocks with no latest rate, leaving flows alone', () => {
    const usd = view(ledger(), display('USD', { latest: null }))
    expect(usd.glass.remaining).toEqual({
      status: 'withheld',
      currencies: [],
      noRateOn: ['2026-06-15'],
    })
    expect(known(usd.glass.spent)).toBe(4_000_00n)
    expect(usd.display.differences.limit).toBeNull()
  })

  it('withholds the flows an item without a rate enters, leaving stocks alone', () => {
    const usd = view(
      ledger(),
      display('USD', {
        fallback: (amount, date) =>
          date === '2026-03-05' ? null : { amount: amount / 100n, rateDate: date },
      }),
    )
    expect(usd.glass.spent.status).toBe('withheld')
    expect(usd.months.find((month) => month.month === '2026-02')!.gross.status).toBe('known')
    expect(usd.months.find((month) => month.month === '2026-03')!.gross).toEqual({
      status: 'withheld',
      currencies: [],
      noRateOn: ['2026-03-05'],
    })
    expect(known(usd.glass.remaining)).toBe(7_500_00n)
  })

  it('EARS-713: shows the rate note in D whatever income is, and the income note only in B', () => {
    expect(view(ledger(), display('USD')).waterlineNote).toBe('rate')
    const earning = [...ledger(), earn('2026-05-20', 9_000_00n)]
    expect(view(earning, display('USD')).waterlineNote).toBe('rate')
    expect(view(earning, display('RUB')).waterlineNote).toBe('income')
    expect(view(ledger(), display('RUB')).waterlineNote).toBeNull()
  })

  it('EARS-720: an unknown exchange result stays withheld in D even where its steps reach D', () => {
    // Baht contributed at no recorded cost, then sold for roubles: the result is unknown.
    const thb = account('bank', 'THB')
    const sale = op('2026-02-02', [
      [thb, -10_000_00n],
      [bank(), 25_000_00n],
      [account('conversion', 'THB'), 10_000_00n, { conversionStepNo: 1 }],
      [account('conversion', 'RUB'), -25_000_00n, { conversionStepNo: 1 }],
    ])
    sale.steps = [{ stepNo: 1, fromCurrency: 'THB', toCurrency: 'RUB' }]
    const operations = [
      op('2026-02-01', [
        [thb, 10_000_00n],
        [account('equity', 'THB'), -10_000_00n, { memberId: MEMBER }],
      ]),
      sale,
    ]
    const steps = new Map([[sale.operationId, operationSteps(sale)]])
    const inThb = view(operations, display('THB', { operationSteps: steps }))
    expect(inThb.glass.spent.status).toBe('withheld')
    expect(inThb.months.find((month) => month.month === '2026-02')!.gross.status).toBe('withheld')
    const fx = inThb.breakdown.project.lines.find((line) => line.exchange)!
    expect(fx.value.status).toBe('withheld')
    expect(inThb.breakdown.project.addsUp).toBe(false)
  })

  it('converts «paid out» item by item, less the part still owed at its own operation', () => {
    const operations = [
      contribute('2026-01-10', 500_000_00n),
      personalRub('2026-02-05', 100_000_00n, 900),
      repayRub('2026-03-05', 40_000_00n, 901, 900),
    ]
    const rub = view(operations)
    expect(known(rub.money.owed)).toBe(60_000_00n)
    expect(known(rub.money.paidOut)).toBe(40_000_00n)
    const usd = view(operations, display('USD'))
    // spent 1 000 $ less the 600 $ still owed at 2026-02-05's rate
    expect(known(usd.money.paidOut)).toBe(400_00n)
    // owed is a stock: 60 000 ₽ at 80 = 750 $
    expect(known(usd.money.owed)).toBe(750_00n)
    expect(usd.display.differences.paidOut).toBe(1_000_00n - (400_00n + 750_00n))
  })
})
