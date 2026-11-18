// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  measureChain,
  measureChains,
  measureIntakeItem,
  type MarketContext,
  type MarketEntry,
} from '@/lib/finance/fx/market'
import {
  splitByLargestRemainder,
  buildMarketReport,
  DEFAULT_MARKET_REPORT_PERIOD,
  marketReportPeriod,
  parseMarketReportPeriod,
  type MarketReport,
  type MarketReportRow,
} from '@/lib/finance/fx/market-report'
import type { FxRate } from '@/lib/finance/fx/rates'
import type { MarketChainFact, MarketIntakeFact } from '@/lib/finance/market-facts'

/**
 * The «Курс против рынка» report (spec `docs/specs/339-ledger-intake.md` §J,
 * EARS-564…566; issue #559) as pure shaping over the §J entries of #558.
 * Every figure is a bigint of minimal units, carried as a string.
 */

const CURRENCIES = ['RUB', 'USD', 'EUR'] as const

function rate(currency: string, rateDate: string, valueRub: string): FxRate {
  return { currency, rateDate, nominal: 1, valueRub }
}

const PRECISIONS = new Map([
  ['RUB', 2],
  ['USD', 2],
  ['EUR', 2],
  ['USDT', 6],
  ['USDC', 2],
])

function ctx(series: FxRate[]): MarketContext {
  return { series, precisions: PRECISIONS }
}

function fact(overrides: Partial<MarketIntakeFact> = {}): MarketIntakeFact {
  return {
    itemId: 1,
    kind: 'expense',
    status: 'posted',
    alreadyPaid: true,
    personalFunds: false,
    occurredOn: '2026-11-13',
    submittedOn: '2026-11-10',
    amount: 10_000n,
    currency: 'USD',
    paidAmount: 920_000n,
    paidCurrency: 'RUB',
    feeAmount: null,
    feeCurrency: null,
    accountName: 'Карта RUB',
    accountCurrency: 'RUB',
    operationId: 10,
    operationReversed: false,
    counterpartyName: 'Anthropic',
    memberName: 'Антон',
    ...overrides,
  }
}

function chainFact(overrides: Partial<MarketChainFact> = {}): MarketChainFact {
  return {
    operationId: 77,
    occurredOn: '2026-11-13',
    steps: [
      { fromCurrency: 'RUB', toCurrency: 'USDT' },
      { fromCurrency: 'USDT', toCurrency: 'USD' },
    ],
    moneyLegs: [
      {
        accountId: 1,
        accountName: 'Карта RUB',
        amount: -10_000_000n,
        currency: 'RUB',
        onStep: false,
      },
      { accountId: 2, accountName: 'Счёт USD', amount: 105_000n, currency: 'USD', onStep: false },
    ],
    ...overrides,
  }
}

function sumColumn(
  rows: readonly MarketReportRow[],
  currency: string,
  column: 'fact' | 'market' | 'overpayment',
) {
  return rows.reduce((sum, row) => sum + BigInt(row.figures[currency][column]), 0n)
}

function expectTablesSumToTotal(report: MarketReport) {
  for (const currency of CURRENCIES) {
    for (const column of ['fact', 'market', 'overpayment'] as const) {
      const total = BigInt(report.total.figures[currency][column])
      expect(sumColumn(report.months, currency, column), `months ${currency} ${column}`).toBe(total)
      expect(sumColumn(report.payees, currency, column), `payees ${currency} ${column}`).toBe(total)
    }
  }
}

// The scenario-14 set at 92,00 ₽/USD and 100,00 ₽/EUR: +184 ₽, −184 ₽, a USDT
// invoice paid in roubles, a RUB → USDT → USD chain, a «факт не внесён» and a
// «без курса» request.
const NOV = ctx([rate('USD', '2026-11-13', '92.0000'), rate('EUR', '2026-11-13', '100.0000')])

function scenario(): MarketEntry[] {
  return [
    measureIntakeItem(
      fact({ itemId: 1, paidAmount: 933_400n, feeAmount: 5_000n, feeCurrency: 'RUB' }),
      NOV,
    )!,
    measureIntakeItem(
      fact({
        itemId: 2,
        personalFunds: true,
        accountName: null,
        accountCurrency: null,
        memberName: 'Мария',
        paidAmount: 901_600n,
      }),
      NOV,
    )!,
    measureIntakeItem(
      fact({
        itemId: 3,
        currency: 'USDT',
        amount: 50_000_000n,
        paidAmount: 470_000n,
        counterpartyName: 'GPU Cloud',
      }),
      NOV,
    )!,
    measureChain(chainFact(), NOV),
    measureIntakeItem(
      fact({
        itemId: 4,
        status: 'submitted',
        paidAmount: null,
        paidCurrency: null,
        accountName: null,
        accountCurrency: null,
      }),
      NOV,
    )!,
    // 2026-10-01 precedes every stored rate, and a later rate is never used (EARS-558).
    measureIntakeItem(fact({ itemId: 5, occurredOn: '2026-10-01' }), NOV)!,
  ]
}

describe('the period (EARS-564)', () => {
  it('EARS-564: the last 12 months is the default, and an unknown query value falls back to it', () => {
    expect(DEFAULT_MARKET_REPORT_PERIOD).toBe('12m')
    expect(parseMarketReportPeriod(undefined)).toBe('12m')
    expect(parseMarketReportPeriod('fortnight')).toBe('12m')
    expect(parseMarketReportPeriod('quarter')).toBe('quarter')
  })

  it('EARS-564: month, quarter, year and the last 12 months end today; all time is unbounded', () => {
    const today = '2026-11-18'
    expect(marketReportPeriod('month', today)).toEqual({ from: '2026-11-01', to: today })
    expect(marketReportPeriod('quarter', today)).toEqual({ from: '2026-10-01', to: today })
    expect(marketReportPeriod('year', today)).toEqual({ from: '2026-01-01', to: today })
    // The current month and the eleven before it, whole: twelve month rows.
    expect(marketReportPeriod('12m', today)).toEqual({ from: '2025-12-01', to: today })
    expect(marketReportPeriod('12m', '2026-01-05')).toEqual({
      from: '2025-02-01',
      to: '2026-01-05',
    })
    expect(marketReportPeriod('all', today)).toEqual({})
  })
})

describe('the period total (EARS-564)', () => {
  it('EARS-564: Σ Переплата in ₽ with its weighted % and wording, Σ Факт, Σ Рынок, the measured counts and «без курса» / «факт не внесён» counted, not summed', () => {
    const report = buildMarketReport(scenario(), NOV, CURRENCIES, {}, 0)
    // Факт: 9 384 + 9 016 + 4 700 + 100 000 = 123 100 ₽; Рынок: 9 200 + 9 200 + 4 600 + 96 600 = 119 600 ₽.
    expect(report.total.figures.RUB).toEqual({
      fact: '12310000',
      market: '11960000',
      overpayment: '350000',
      noDisplayRate: 0,
    })
    // 123 100 / 119 600 − 1 = 2,93 % → 2,9 — the weighted %, not the mean of the rows'.
    expect(report.total.percentTenths).toBe('29')
    expect(report.total.wording).toBe('хуже рынка на 2,9%')
    expect(report.total.measured).toEqual({ payments: 3, chains: 1 })
    expect(report.total.noRate).toEqual({ payments: 1, chains: 0 })
    expect(report.total.notPosted).toBe(1)
    expect(report.total.excludedChains).toBe(0)
  })

  it('EARS-564: an empty period has zero sums, no % and the «—» wording', () => {
    const report = buildMarketReport([], NOV, CURRENCIES, { from: '2026-11-01', to: '2026-11-18' })
    expect(report.total.figures.RUB).toEqual({
      fact: '0',
      market: '0',
      overpayment: '0',
      noDisplayRate: 0,
    })
    expect(report.total.percentTenths).toBe(null)
    expect(report.total.wording).toBe('—')
    expect(report.months).toEqual([])
    expect(report.payees).toEqual([])
  })
})

describe('the breakdowns (EARS-565)', () => {
  it('EARS-565: payments break down by payee and route, the chain by its route «RUB → USDT → USD», and each row opens its items', () => {
    const report = buildMarketReport(scenario(), NOV, CURRENCIES, {})
    const chain = report.payees.find((row) => row.kind === 'chain')
    expect(chain).toMatchObject({ label: 'RUB → USDT → USD', route: null, percentTenths: '35' })
    expect(chain?.items).toHaveLength(1)
    expect(chain?.items[0]).toMatchObject({
      subject: 'chain',
      id: 77,
      date: '2026-11-13',
      amount: { amount: '10000000', currency: 'RUB' },
      arrived: { amount: '105000', currency: 'USD' },
      figures: { RUB: { fact: '10000000', market: '9660000', overpayment: '340000' } },
    })
    const maria = report.payees.find((row) => row.label === 'Мария')
    expect(maria).toMatchObject({
      kind: 'payment',
      route: 'свои средства · RUB → USD',
      wording: 'лучше рынка на 2,0%',
    })
    const anthropic = report.payees.filter((row) => row.label === 'Anthropic')
    // The +184 ₽ payment, the «факт не внесён» and the «без курса» one share a payee but not a route.
    expect(anthropic.flatMap((row) => row.items.map((item) => [item.id, item.status]))).toEqual(
      expect.arrayContaining([
        [1, 'measured'],
        [4, 'not_posted'],
        [5, 'no_rate'],
      ]),
    )
    const first = anthropic.flatMap((row) => row.items).find((item) => item.id === 1)
    expect(first).toMatchObject({
      subject: 'payment',
      amount: { amount: '10000', currency: 'USD' },
      figures: { RUB: { fact: '938400', market: '920000', overpayment: '18400' } },
      wording: 'хуже рынка на 2,0%',
    })
    // «Без курса» and «факт не внесён» carry no figures in any currency.
    const unmeasured = report.payees
      .flatMap((row) => row.items)
      .filter((item) => item.status !== 'measured')
    for (const item of unmeasured) expect(Object.values(item.figures)).toEqual([null, null, null])
  })

  it('EARS-565: the month table and the payee / route table each sum to the period total, in every display currency', () => {
    expectTablesSumToTotal(buildMarketReport(scenario(), NOV, CURRENCIES, {}))
  })

  it('EARS-565: rows rounded one by one would miss the total by a kopeck — the largest-remainder allocation does not', () => {
    // Three USD 1,00 payments at 92,3333 ₽: Рынок 92,3333 ₽ each, 276,9999 ₽ in all.
    // Rounded per row that is 3 × 92,33 = 276,99 ₽ against a total of 277,00 ₽.
    const months = ['2026-09-10', '2026-10-10', '2026-11-10']
    const series = months.flatMap((date) => [
      rate('USD', date, '92.3333'),
      rate('EUR', date, '99.9999'),
    ])
    const context = ctx(series)
    const entries = months.map((date, index) =>
      measureIntakeItem(
        fact({
          itemId: index + 1,
          occurredOn: date,
          amount: 100n,
          paidAmount: 9_300n,
          counterpartyName: `P${index}`,
        }),
        context,
      )!,
    )
    const report = buildMarketReport(entries, context, CURRENCIES, {})
    expect(report.total.figures.RUB.market).toBe('27700')
    expect(report.months.map((row) => row.figures.RUB.market).sort()).toEqual([
      '9233',
      '9233',
      '9234',
    ])
    expectTablesSumToTotal(report)
    // Every row's Переплата is its own Факт − Рынок of the figures shown.
    for (const row of [...report.months, ...report.payees]) {
      for (const currency of CURRENCIES) {
        const f = row.figures[currency]
        expect(BigInt(f.overpayment)).toBe(BigInt(f.fact) - BigInt(f.market))
      }
    }
  })

  it('EARS-565: the allocation sums to the rounded exact total and moves no value by more than one unit', () => {
    const values = [
      { numerator: 10n, denominator: 3n }, // 3,33…
      { numerator: 10n, denominator: 3n },
      { numerator: 10n, denominator: 3n },
      { numerator: -7n, denominator: 2n }, // −3,5
      { numerator: 0n, denominator: 1n },
    ]
    const out = splitByLargestRemainder(values)
    // Σ = 10 − 3,5 = 6,5 → 7 (half away from zero).
    expect(out.reduce((a, b) => a + b, 0n)).toBe(7n)
    expect(out).toEqual([4n, 3n, 3n, -3n, 0n])
    expect(splitByLargestRemainder([])).toEqual([])
  })
})

describe('the display currency (EARS-566)', () => {
  it('EARS-566: ₽ → $ re-presents every amount at the CBR rate of each item’s date, and leaves every percentage unchanged', () => {
    const report = buildMarketReport(scenario(), NOV, CURRENCIES, {})
    // 123 100 ₽ / 92 = 1 338,04 $; 119 600 ₽ / 92 = 1 300,00 $.
    expect(report.total.figures.USD).toMatchObject({
      fact: '133804',
      market: '130000',
      overpayment: '3804',
    })
    expect(report.total.figures.EUR).toMatchObject({
      fact: '123100',
      market: '119600',
      overpayment: '3500',
    })
    // The % is one field per total / row / item — no display currency enters it.
    expect(report.total.percentTenths).toBe('29')
    expectTablesSumToTotal(report)
  })

  it('EARS-566: an item the display currency has no rate for leaves that currency’s sums and is counted, while the % still counts it', () => {
    // EUR is quoted on 2026-11-13 only; a payment on 2026-12-01 is 18 days past it.
    const context = ctx([
      rate('USD', '2026-11-13', '92.0000'),
      rate('USD', '2026-12-01', '92.0000'),
      rate('EUR', '2026-11-13', '100.0000'),
    ])
    const entries = [
      measureIntakeItem(fact({ itemId: 1, paidAmount: 938_400n }), context)!,
      measureIntakeItem(
        fact({ itemId: 2, occurredOn: '2026-12-01', paidAmount: 938_400n }),
        context,
      )!,
    ]
    const report = buildMarketReport(entries, context, CURRENCIES, {})
    // Only the November item converts: 9 384 ₽ / 100 = 93,84 €.
    expect(report.total.figures.EUR).toEqual({
      fact: '9384',
      market: '9200',
      overpayment: '184',
      noDisplayRate: 1,
    })
    expect(report.total.figures.RUB.noDisplayRate).toBe(0)
    expect(report.total.percentTenths).toBe('20')
    const december = report.months.find((row) => row.label === '2026-12')!
    expect(december.figures.EUR).toMatchObject({ fact: '0', noDisplayRate: 1 })
    expect(december.items[0].figures.EUR).toBe(null)
    expectTablesSumToTotal(report)
  })
})

describe('robustness (EARS-561)', () => {
  it('EARS-561: a chain whose legs have no two ends is left out and counted, and the other chains are still valued', () => {
    const broken = chainFact({
      operationId: 99,
      moneyLegs: [
        {
          accountId: 1,
          accountName: 'Карта RUB',
          amount: -10_000n,
          currency: 'RUB',
          onStep: false,
        },
      ],
    })
    const { entries, excluded } = measureChains([chainFact(), broken], NOV)
    expect(entries.map((entry) => entry.operationId)).toEqual([77])
    expect(excluded).toEqual([99])
    const report = buildMarketReport(entries, NOV, CURRENCIES, {}, excluded.length)
    expect(report.total.excludedChains).toBe(1)
    expect(report.total.measured).toEqual({ payments: 0, chains: 1 })
  })
})
