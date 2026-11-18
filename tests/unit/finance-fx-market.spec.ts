// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  aggregateMarket,
  classifyIntakeItem,
  displayMarketTotals,
  groupMarket,
  MARKET_RATE_WINDOW_DAYS,
  measureChain,
  measureIntakeItem,
  overpaymentOf,
  overpaymentWording,
  pickMarketRate,
  type MarketContext,
  type MarketEntry,
} from '@/lib/finance/fx/market'
import type { FxRate } from '@/lib/finance/fx/rates'
import type { MarketChainFact, MarketIntakeFact } from '@/lib/finance/market-facts'

/**
 * The §J market valuation as pure arithmetic (spec
 * `docs/specs/339-ledger-intake.md` §J, EARS-557…562; issue #558). Every
 * number here is a bigint of minimal units; rouble figures are kopecks.
 */

const FRIDAY = '2026-11-13'
const SATURDAY = '2026-11-14'

function rate(currency: string, rateDate: string, valueRub: string, nominal = 1): FxRate {
  return { currency, rateDate, nominal, valueRub }
}

const PRECISIONS = new Map([
  ['RUB', 2],
  ['USD', 2],
  ['EUR', 2],
  ['THB', 2],
  ['USDT', 6],
])

function ctx(series: FxRate[]): MarketContext {
  return { series, precisions: PRECISIONS }
}

const USD_92 = ctx([rate('USD', FRIDAY, '92.0000'), rate('EUR', FRIDAY, '100.0000')])

function fact(overrides: Partial<MarketIntakeFact> = {}): MarketIntakeFact {
  return {
    itemId: 1,
    kind: 'expense',
    status: 'posted',
    alreadyPaid: true,
    personalFunds: false,
    occurredOn: FRIDAY,
    submittedOn: '2026-11-10',
    amount: 10_000n, // 100.00 USD
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

function measured(entry: MarketEntry | null) {
  expect(entry).not.toBeNull()
  const valuation = entry!.valuation
  if (valuation.status !== 'measured') throw new Error(`expected measured, got ${valuation.status}`)
  return valuation
}

describe('the measured set (EARS-557)', () => {
  it('EARS-557: a posted USD expense paid from a RUB account has Факт = paid_amount + fee_amount and its payment date is occurred_on', () => {
    const item = fact({ paidAmount: 920_000n, feeAmount: 5_000n, feeCurrency: 'RUB' })
    expect(classifyIntakeItem(item)).toBe('payment')
    const entry = measureIntakeItem(item, USD_92)
    expect(entry?.subject).toBe('payment')
    expect(entry?.date).toBe(FRIDAY)
    const v = measured(entry)
    expect(v.overpayment.factRub).toBe(925_000n)
    expect(v.overpayment.marketRub).toBe(920_000n)
    expect(entry?.subject === 'payment' && entry.fact).toMatchObject({
      amount: 920_000n,
      currency: 'RUB',
      fee: { amount: 5_000n, currency: 'RUB' },
      account: 'Карта RUB',
    })
  })

  it('EARS-557: a same-currency item, a reversed item and a non-expense are not in the set', () => {
    expect(
      classifyIntakeItem(fact({ paidAmount: null, paidCurrency: null, currency: 'RUB' })),
    ).toBe(null)
    expect(classifyIntakeItem(fact({ paidCurrency: 'USD', paidAmount: 10_000n }))).toBe(null)
    expect(classifyIntakeItem(fact({ operationReversed: true }))).toBe(null)
    expect(classifyIntakeItem(fact({ kind: 'income' }))).toBe(null)
    expect(measureIntakeItem(fact({ operationReversed: true }), USD_92)).toBe(null)
  })

  it("EARS-557: a personal_funds item is measured on the member's card side, payee the member, route «свои средства»", () => {
    const item = fact({
      personalFunds: true,
      accountName: null,
      accountCurrency: null,
      counterpartyName: 'Anthropic',
      memberName: 'Мария',
    })
    expect(classifyIntakeItem(item)).toBe('payment')
    const entry = measureIntakeItem(item, USD_92)
    expect(entry?.payee).toBe('Мария')
    expect(entry?.route).toBe('свои средства · RUB → USD')
    expect(measured(entry).overpayment.amount).toBe(0n)
  })

  it('EARS-557: the payee is the counterparty, else the member, else «—»', () => {
    expect(measureIntakeItem(fact(), USD_92)?.payee).toBe('Anthropic')
    expect(measureIntakeItem(fact({ counterpartyName: null }), USD_92)?.payee).toBe('Антон')
    expect(
      measureIntakeItem(fact({ counterpartyName: null, memberName: null }), USD_92)?.payee,
    ).toBe('—')
    expect(measureIntakeItem(fact(), USD_92)?.route).toBe('Карта RUB · RUB → USD')
  })
})

describe('the market rate (EARS-558)', () => {
  it("EARS-558: a Saturday payment takes Friday's CBR rate, and a later-dated rate is never used", () => {
    const series = [rate('USD', FRIDAY, '92.0000'), rate('USD', '2026-11-17', '95.0000')]
    expect(pickMarketRate(series, 'USD', SATURDAY)?.rateDate).toBe(FRIDAY)
    const v = measured(measureIntakeItem(fact({ occurredOn: SATURDAY }), ctx(series)))
    expect(v.rates.market.rateDate).toBe(FRIDAY)
    expect(v.overpayment.marketRub).toBe(920_000n)
  })

  it('EARS-558: a rate at most 14 days old is used; 15 days after the newest stored rate is «без курса»', () => {
    expect(MARKET_RATE_WINDOW_DAYS).toBe(14)
    const series = [rate('USD', '2026-11-01', '92.0000')]
    expect(pickMarketRate(series, 'USD', '2026-11-15')?.rateDate).toBe('2026-11-01')
    expect(pickMarketRate(series, 'USD', '2026-11-16')).toBe(null)
    const entry = measureIntakeItem(fact({ occurredOn: '2026-11-16' }), ctx(series))
    expect(entry?.valuation).toEqual({ status: 'no_rate', currency: 'USD', date: '2026-11-16' })
  })

  it('EARS-558: a USDT document is valued at the USD rate', () => {
    expect(pickMarketRate(USD_92.series, 'USDT', FRIDAY)).toMatchObject({
      currency: 'USD',
      valueRub: '92.0000',
    })
    const v = measured(
      measureIntakeItem(fact({ amount: 100_000_000n, currency: 'USDT' }), USD_92), // 100 USDT
    )
    expect(v.overpayment.marketRub).toBe(920_000n)
  })

  it('EARS-558: a THB document paid from a USD account is valued through RUB on both sides', () => {
    const series = [rate('USD', FRIDAY, '92.0000'), rate('THB', FRIDAY, '26.5000', 10)]
    const item = fact({
      amount: 350_000n, // 3 500.00 THB → 9 275.00 ₽
      currency: 'THB',
      paidAmount: 10_000n, // 100.00 USD → 9 200.00 ₽
      paidCurrency: 'USD',
      accountName: 'Счёт USD',
      accountCurrency: 'USD',
    })
    const v = measured(measureIntakeItem(item, ctx(series)))
    expect(v.overpayment.marketRub).toBe(927_500n)
    expect(v.overpayment.factRub).toBe(920_000n)
    expect(v.overpayment.amount).toBe(-7_500n)
  })

  it('EARS-558: a side whose currency CBR does not quote is «без курса», never 1:1', () => {
    const entry = measureIntakeItem(fact({ currency: 'THB' }), USD_92)
    expect(entry?.valuation).toEqual({ status: 'no_rate', currency: 'THB', date: FRIDAY })
  })
})

describe('the overpayment (EARS-559)', () => {
  it('EARS-559: USD 100 at 92,00 ₽ with Факт 9 384 ₽ is +184 ₽, «хуже рынка на 2,0%»; Факт 9 016 ₽ is −184 ₽, «лучше рынка на 2,0%»', () => {
    const worse = measured(measureIntakeItem(fact({ paidAmount: 938_400n }), USD_92))
    expect(worse.overpayment).toMatchObject({
      amount: 18_400n,
      percentTenths: 20n,
      wording: 'хуже рынка на 2,0%',
    })
    const better = measured(measureIntakeItem(fact({ paidAmount: 901_600n }), USD_92))
    expect(better.overpayment).toMatchObject({
      amount: -18_400n,
      percentTenths: -20n,
      wording: 'лучше рынка на 2,0%',
    })
  })

  it('EARS-559: a percentage that rounds to 0,0 reads «как на рынке»', () => {
    const v = measured(measureIntakeItem(fact({ paidAmount: 920_300n }), USD_92))
    expect(v.overpayment.amount).toBe(300n)
    expect(v.overpayment.percentTenths).toBe(0n)
    expect(v.overpayment.wording).toBe('как на рынке')
    expect(overpaymentWording(0n)).toBe('как на рынке')
    expect(overpaymentWording(-91n)).toBe('лучше рынка на 9,1%')
    expect(overpaymentWording(1_234n)).toBe('хуже рынка на 123,4%')
  })

  it('EARS-559: exact decimal arithmetic on bigint units, rounded once — kopecks for the amount, one decimal for the %', () => {
    // 10.01 USD × 92.1234 = 922.155234 ₽ → 922.16 ₽, and the % is taken from the
    // exact value, not from the rounded kopecks.
    const series = [rate('USD', FRIDAY, '92.1234')]
    const v = measured(
      measureIntakeItem(fact({ amount: 1_001n, paidAmount: 92_216n }), ctx(series)),
    )
    expect(v.overpayment.marketRub).toBe(92_216n)
    expect(v.overpayment.amount).toBe(0n)
    expect(typeof v.overpayment.amount).toBe('bigint')
    expect(typeof v.overpayment.percentTenths).toBe('bigint')
    // Exact half rounds away from zero: 1.05 % → 1,1 %; −1.05 % → −1,1 %.
    const market = { numerator: 100_000n, denominator: 1n }
    expect(overpaymentOf({ numerator: 101_050n, denominator: 1n }, market).percentTenths).toBe(11n)
    expect(overpaymentOf({ numerator: 98_950n, denominator: 1n }, market).percentTenths).toBe(-11n)
  })
})

describe('«факт не внесён» and «без курса» (EARS-560)', () => {
  const pending = (overrides: Partial<MarketIntakeFact>) =>
    fact({
      status: 'submitted',
      operationId: null,
      paidAmount: null,
      paidCurrency: null,
      accountName: null,
      accountCurrency: null,
      ...overrides,
    })

  it('EARS-560: an already-paid unposted request whose debit currency differs or is unknown on a non-RUB document is «факт не внесён»', () => {
    // Debit currency from the named account.
    expect(classifyIntakeItem(pending({ accountName: 'Карта RUB', accountCurrency: 'RUB' }))).toBe(
      'not_posted',
    )
    // From the stated paid_currency when no account is named — even with an amount stated.
    expect(classifyIntakeItem(pending({ paidCurrency: 'RUB', paidAmount: 930_000n }))).toBe(
      'not_posted',
    )
    // Unknown on a non-RUB document.
    expect(classifyIntakeItem(pending({ status: 'approved' }))).toBe('not_posted')
    // Not in the set: unknown on a RUB document, same currency, not already paid, draft, refused.
    expect(classifyIntakeItem(pending({ currency: 'RUB', amount: 100_000n }))).toBe(null)
    expect(classifyIntakeItem(pending({ accountName: 'Счёт USD', accountCurrency: 'USD' }))).toBe(
      null,
    )
    expect(classifyIntakeItem(pending({ alreadyPaid: false }))).toBe(null)
    expect(classifyIntakeItem(pending({ status: 'draft' }))).toBe(null)
    expect(classifyIntakeItem(pending({ status: 'refused' }))).toBe(null)
  })

  it('EARS-560: it is counted in a period by occurred_on, else by its submission date', () => {
    const withDate = measureIntakeItem(pending({ occurredOn: '2026-10-05' }), USD_92)
    expect(withDate?.date).toBe('2026-10-05')
    expect(withDate?.valuation).toEqual({ status: 'not_posted', statedPaidAmount: null })
    const withoutDate = measureIntakeItem(pending({ occurredOn: null }), USD_92)
    expect(withoutDate?.date).toBe('2026-11-10')
    expect(withoutDate?.month).toBe('2026-11')
  })

  it('EARS-560: an aggregate over 3 measured items + 1 «без курса» + 1 «факт не внесён» sums the 3 only and counts the two separately', () => {
    const entries = [
      measureIntakeItem(fact({ itemId: 1, paidAmount: 938_400n }), USD_92),
      measureIntakeItem(fact({ itemId: 2, paidAmount: 920_000n }), USD_92),
      measureIntakeItem(
        fact({ itemId: 3, paidAmount: 901_600n, feeAmount: 1_000n, feeCurrency: 'RUB' }),
        USD_92,
      ),
      measureIntakeItem(fact({ itemId: 4, currency: 'THB' }), USD_92), // «без курса»
      measureIntakeItem(pending({ itemId: 5, amount: 99_999_999n }), USD_92), // «факт не внесён»
    ].filter((e): e is MarketEntry => e !== null)
    expect(entries).toHaveLength(5)
    const totals = aggregateMarket(entries)
    expect(totals.factRub).toBe(938_400n + 920_000n + 901_600n + 1_000n)
    expect(totals.marketRub).toBe(3n * 920_000n)
    expect(totals.overpayment?.amount).toBe(1_000n)
    expect(totals.measured).toEqual({ payments: 3, chains: 0 })
    expect(totals.noRate).toEqual({ payments: 1, chains: 0 })
    expect(totals.notPosted).toBe(1)
  })
})

describe('conversion chains (EARS-561)', () => {
  function chain(overrides: Partial<MarketChainFact> = {}): MarketChainFact {
    return {
      operationId: 77,
      occurredOn: FRIDAY,
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

  it('EARS-561: RUB → USDT → USD of 100 000 ₽ arriving as 1 050 USD at 92,00 is Рынок 96 600 ₽, Переплата +3 400 ₽, «хуже рынка на 3,5%»', () => {
    const entry = measureChain(chain(), USD_92)
    expect(entry.subject).toBe('chain')
    expect(entry.route).toBe('RUB → USDT → USD')
    expect(entry.payee).toBe(null)
    const v = measured(entry)
    expect(v.overpayment).toMatchObject({
      factRub: 10_000_000n,
      marketRub: 9_660_000n,
      amount: 340_000n,
      percentTenths: 35n,
      wording: 'хуже рынка на 3,5%',
    })
  })

  it('EARS-561: a fee on the source account is part of Факт; a fee on the target account comes off Рынок', () => {
    const entry = measureChain(
      chain({
        moneyLegs: [
          {
            accountId: 1,
            accountName: 'Карта RUB',
            amount: -10_000_000n,
            currency: 'RUB',
            onStep: false,
          },
          {
            accountId: 2,
            accountName: 'Счёт USD',
            amount: 105_000n,
            currency: 'USD',
            onStep: false,
          },
          {
            accountId: 1,
            accountName: 'Карта RUB',
            amount: -10_000n,
            currency: 'RUB',
            onStep: true,
          },
          { accountId: 2, accountName: 'Счёт USD', amount: -1_000n, currency: 'USD', onStep: true },
        ],
      }),
      USD_92,
    )
    const v = measured(entry)
    expect(v.overpayment.factRub).toBe(10_010_000n)
    expect(v.overpayment.marketRub).toBe(9_568_000n) // 1 040 USD × 92
    expect(entry.source).toMatchObject({ amount: 10_010_000n, currency: 'RUB', fee: 10_000n })
    expect(entry.target).toMatchObject({ amount: 104_000n, currency: 'USD', fee: 1_000n })
  })

  it('EARS-561: a chain with no rate within the window on its date is «без курса»', () => {
    const entry = measureChain(chain({ occurredOn: '2026-12-31' }), USD_92)
    expect(entry.valuation).toEqual({ status: 'no_rate', currency: 'USD', date: '2026-12-31' })
  })
})

describe('amount-weighted aggregates (EARS-562)', () => {
  // At 100 ₽/USD: Факт 10 100 / Рынок 10 000 and Факт 1 000 / Рынок 1 100.
  const AT_100 = ctx([
    rate('USD', '2026-10-01', '100.0000'),
    rate('USD', '2026-10-15', '100.0000'),
    rate('USD', '2026-11-01', '100.0000'),
  ])
  const a = fact({
    itemId: 1,
    occurredOn: '2026-10-02',
    amount: 10_000n,
    paidAmount: 1_010_000n,
    counterpartyName: 'Anthropic',
  })
  const b = fact({
    itemId: 2,
    occurredOn: '2026-11-02',
    amount: 1_100n,
    paidAmount: 100_000n,
    counterpartyName: 'Hetzner',
  })

  it('EARS-562: Факт 10 100 / Рынок 10 000 and Факт 1 000 / Рынок 1 100 aggregate to Σ Переплата 0 ₽ and 0,0 % — not the mean of +1,0 % and −9,1 %', () => {
    const entries = [measureIntakeItem(a, AT_100)!, measureIntakeItem(b, AT_100)!]
    expect(measured(entries[0]).overpayment.percentTenths).toBe(10n)
    expect(measured(entries[1]).overpayment.percentTenths).toBe(-91n)
    const totals = aggregateMarket(entries)
    expect(totals.overpayment).toMatchObject({
      amount: 0n,
      percentTenths: 0n,
      wording: 'как на рынке',
    })
  })

  it('EARS-562: the month and payee / route groupings follow the same weighted rule and sum to the period total', () => {
    const c = fact({
      itemId: 3,
      occurredOn: '2026-10-20',
      amount: 1_100n,
      paidAmount: 100_000n,
      counterpartyName: 'Anthropic',
    })
    const entries = [a, b, c].map((f) => measureIntakeItem(f, AT_100)!)
    const byMonth = groupMarket(entries, 'month')
    expect(byMonth.map((g) => g.key)).toEqual(['2026-10', '2026-11'])
    // October: Факт 10 100 + 1 000 = 11 100, Рынок 10 000 + 1 100 = 11 100 → 0,0 %.
    expect(byMonth[0].totals.overpayment).toMatchObject({ amount: 0n, percentTenths: 0n })
    expect(byMonth[1].totals.overpayment).toMatchObject({ amount: -10_000n, percentTenths: -91n })

    const byPayee = groupMarket(entries, 'payee_route')
    const anthropic = byPayee.find((g) => g.payee === 'Anthropic')!
    expect(anthropic.route).toBe('Карта RUB · RUB → USD')
    expect(anthropic.totals.overpayment).toMatchObject({ amount: 0n, percentTenths: 0n })
    const total = aggregateMarket(entries)
    for (const grouping of [byMonth, byPayee]) {
      expect(grouping.reduce((s, g) => s + g.totals.factRub, 0n)).toBe(total.factRub)
      expect(grouping.reduce((s, g) => s + g.totals.marketRub, 0n)).toBe(total.marketRub)
    }
  })

  it('EARS-562: a chain groups by its route, a payment by its payee and route', () => {
    const chainEntry = measureChain(
      {
        operationId: 9,
        occurredOn: '2026-10-02',
        steps: [{ fromCurrency: 'RUB', toCurrency: 'USD' }],
        moneyLegs: [
          {
            accountId: 1,
            accountName: 'Карта RUB',
            amount: -1_000_000n,
            currency: 'RUB',
            onStep: false,
          },
          {
            accountId: 2,
            accountName: 'Счёт USD',
            amount: 10_000n,
            currency: 'USD',
            onStep: false,
          },
        ],
      },
      AT_100,
    )
    const groups = groupMarket([chainEntry, measureIntakeItem(a, AT_100)!], 'payee_route')
    expect(groups.map((g) => [g.payee, g.route])).toEqual([
      ['Anthropic', 'Карта RUB · RUB → USD'],
      [null, 'RUB → USD'],
    ])
  })

  it('EARS-562: the weighted % is taken from the rouble figures, so a display currency — and an item it cannot convert — never changes it', () => {
    // USD is quoted on both dates; EUR only in October, so in EUR the
    // November item has no display rate while its rouble figures stay measured.
    const series = [
      rate('USD', '2026-10-01', '100.0000'),
      rate('USD', '2026-11-01', '100.0000'),
      rate('EUR', '2026-10-01', '125.0000'),
    ]
    const entries = [measureIntakeItem(a, ctx(series))!, measureIntakeItem(b, ctx(series))!]
    const rub = aggregateMarket(entries)

    const usd = displayMarketTotals(entries, 'USD', ctx(series))
    expect(usd).toMatchObject({
      currency: 'USD',
      fact: 11_100n, // 11 100 ₽ / 100 = 111.00 USD
      market: 11_100n,
      overpayment: 0n,
      noDisplayRate: 0,
    })
    expect(usd.percentTenths).toBe(rub.overpayment!.percentTenths)

    // EUR has no rate on 2026-11-02 within the window: b leaves the displayed
    // sums, is counted, and the % still equals the rouble one.
    const eur = displayMarketTotals(entries, 'EUR', ctx(series))
    expect(eur).toMatchObject({
      currency: 'EUR',
      fact: 8_080n, // 10 100 ₽ / 125
      market: 8_000n,
      overpayment: 80n,
      noDisplayRate: 1,
    })
    expect(eur.percentTenths).toBe(rub.overpayment!.percentTenths)
    expect(eur.wording).toBe('как на рынке')

    const inRub = displayMarketTotals(entries, 'RUB', ctx(series))
    expect(inRub).toMatchObject({ fact: rub.factRub, market: rub.marketRub, noDisplayRate: 0 })
  })
})
