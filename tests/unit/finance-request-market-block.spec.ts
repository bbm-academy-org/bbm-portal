// Specifies the SERVER half of the details sheet's «Курс против рынка» block
// (spec 339 §J, EARS-563, issue #551): the #558 read model's entry for one
// request, carried to the browser as plain strings in each display currency.
// The figures are the read model's own — this file asserts that nothing is
// recomputed on the way, only converted per EARS-566 and serialized.
import { describe, expect, it } from 'vitest'

import { requestMarketBlock } from '@/app/(platform)/p/finance/requests/queue-market'
import { measureIntakeItem, type MarketContext, type MarketIntakeFact } from '@/lib/finance'

const PAID_ON = '2026-11-13'

const CONTEXT: MarketContext = {
  series: [
    { currency: 'USD', rateDate: PAID_ON, nominal: 1, valueRub: '92.0000' },
    { currency: 'EUR', rateDate: '2026-10-01', nominal: 1, valueRub: '100.0000' },
  ],
  precisions: new Map([
    ['RUB', 2],
    ['USD', 2],
    ['EUR', 2],
  ]),
}

function fact(overrides: Partial<MarketIntakeFact> = {}): MarketIntakeFact {
  return {
    itemId: 7,
    kind: 'expense',
    status: 'posted',
    alreadyPaid: true,
    personalFunds: false,
    occurredOn: PAID_ON,
    submittedOn: '2026-11-10',
    amount: 100_00n, // 100.00 USD
    currency: 'USD',
    paidAmount: 9_334_00n,
    paidCurrency: 'RUB',
    feeAmount: 50_00n,
    feeCurrency: 'RUB',
    accountName: 'Счёт 1',
    accountCurrency: 'RUB',
    operationId: 70,
    operationReversed: false,
    counterpartyName: 'Figma',
    memberName: null,
    ...overrides,
  }
}

function entryOf(overrides: Partial<MarketIntakeFact> = {}) {
  const entry = measureIntakeItem(fact(overrides), CONTEXT)
  if (entry === null) throw new Error('the fixture is not in the §J set')
  return entry
}

describe('the details sheet «Курс против рынка» block — server half (EARS-563)', () => {
  it('EARS-563: a USD payment from the RUB account for 9 384 ₽ incl. 50 ₽ fee at 92,00 is Рынок 9 200 ₽, Факт 9 384 ₽, Переплата +184 ₽ «хуже рынка на 2,0%»', () => {
    const block = requestMarketBlock(entryOf(), CONTEXT)

    expect(block).toEqual({
      kind: 'measured',
      date: PAID_ON,
      rate: { currency: 'USD', rateDate: PAID_ON, nominal: 1, valueRub: '92.0000' },
      fact: {
        amount: '938400',
        currency: 'RUB',
        fee: { amount: '5000', currency: 'RUB' },
        account: 'Счёт 1',
      },
      percentTenths: '20',
      wording: 'хуже рынка на 2,0%',
      display: {
        RUB: { fact: '938400', market: '920000', overpayment: '18400' },
        USD: { fact: '10200', market: '10000', overpayment: '200' },
        // The EUR quote is older than EARS-558's 14-day window: no display figure,
        // never a stale conversion.
        EUR: null,
      },
    })
  })

  it('EARS-563: a personal-funds refund of 9 016 ₽ reads «лучше рынка на 2,0%» and names no company account', () => {
    const block = requestMarketBlock(
      entryOf({
        personalFunds: true,
        paidAmount: 9_016_00n,
        feeAmount: null,
        feeCurrency: null,
        accountName: null,
        accountCurrency: null,
        memberName: 'Мария',
      }),
      CONTEXT,
    )

    expect(block).toMatchObject({
      kind: 'measured',
      fact: { amount: '901600', fee: null, account: null },
      percentTenths: '-20',
      wording: 'лучше рынка на 2,0%',
      display: { RUB: { overpayment: '-18400' } },
    })
  })

  it('EARS-563: the percentage is the rouble one in every display currency — only the amounts change', () => {
    const block = requestMarketBlock(entryOf(), CONTEXT)
    if (block.kind !== 'measured') throw new Error('measured expected')
    expect(block.display.RUB).not.toEqual(block.display.USD)
    expect(block.percentTenths).toBe('20')
  })

  it('EARS-563: a payment with no CBR rate within 14 days of its date is «без курса», with that date', () => {
    const block = requestMarketBlock(entryOf({ occurredOn: '2026-12-20' }), CONTEXT)
    expect(block).toEqual({ kind: 'no_rate', currency: 'USD', date: '2026-12-20' })
  })

  it('EARS-563/560: an already-paid request not yet posted carries «факт не внесён» and what it states', () => {
    const stated = requestMarketBlock(
      entryOf({
        status: 'submitted',
        personalFunds: true,
        operationId: null,
        accountName: null,
        accountCurrency: null,
        paidAmount: 4_200_00n,
      }),
      CONTEXT,
    )
    expect(stated).toEqual({ kind: 'not_posted', statedPaidAmount: '420000' })

    const silent = requestMarketBlock(
      entryOf({
        status: 'approved',
        operationId: null,
        paidAmount: null,
        paidCurrency: null,
        feeAmount: null,
        feeCurrency: null,
      }),
      CONTEXT,
    )
    expect(silent).toEqual({ kind: 'not_posted', statedPaidAmount: null })
  })
})
