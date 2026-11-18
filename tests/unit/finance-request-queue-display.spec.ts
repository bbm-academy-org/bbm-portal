import { describe, expect, it } from 'vitest'

import {
  queueDisplayAmounts,
  queueQuoteNeeds,
  type QueueDisplayContext,
  type QueueDisplayRequest,
} from '@/app/(platform)/p/finance/requests/queue-display'
import type { DisplayRatePostingFacts } from '@/lib/finance/fx/display-rate'
import { pickRateOn, type FxRate } from '@/lib/finance/fx/rates'

/**
 * A request's amount in each of the three display currencies (spec 339 §I,
 * EARS-549/550/551; issue #550) — the rule of `displayRateBasis` (#548) applied
 * over a stored CBR series, as pure data the requests API serializes.
 */

const SERIES: FxRate[] = [
  { currency: 'USD', rateDate: '2026-11-18', nominal: 1, valueRub: '80' },
  { currency: 'EUR', rateDate: '2026-11-18', nominal: 1, valueRub: '90' },
  { currency: 'USD', rateDate: '2026-10-01', nominal: 1, valueRub: '100' },
  { currency: 'EUR', rateDate: '2026-10-01', nominal: 1, valueRub: '110' },
]

const context: QueueDisplayContext = {
  today: '2026-11-18',
  precisions: new Map([
    ['RUB', 2],
    ['USD', 2],
    ['EUR', 2],
    ['USDT', 2],
    ['USDC', 2],
    ['DAI', 2],
  ]),
  quote: (currency, date) => pickRateOn(SERIES, currency, date),
}

function request(overrides: Partial<QueueDisplayRequest> = {}): QueueDisplayRequest {
  return {
    amount: 10_000n,
    currency: 'USD',
    status: 'submitted',
    alreadyPaid: false,
    occurredOn: null,
    ...overrides,
  }
}

describe('the queue display amounts (EARS-549/550/551)', () => {
  it('EARS-549: a request in the display currency is its own amount', () => {
    const shown = queueDisplayAmounts(request({ currency: 'RUB', amount: 123_45n }), null, context)
    expect(shown.RUB).toMatchObject({ kind: 'converted', amount: '12345', basis: 'same_currency' })
  })

  it('EARS-550: an unpaid request is converted at today’s CBR rate, through RUB', () => {
    const shown = queueDisplayAmounts(request(), null, context)
    // 100 USD × 80 ₽ = 8 000 ₽; in EUR: 8 000 / 90 = 88.888… → 88.89.
    expect(shown.RUB).toMatchObject({
      kind: 'converted',
      amount: '800000',
      basis: 'cbr',
      rateDate: '2026-11-18',
      reason: 'unpaid',
    })
    expect(shown.EUR).toMatchObject({ kind: 'converted', amount: '8889' })
  })

  it('EARS-550: an already-paid unposted request is valued on the day money moved', () => {
    const shown = queueDisplayAmounts(
      request({ alreadyPaid: true, occurredOn: '2026-10-05' }),
      null,
      context,
    )
    expect(shown.RUB).toMatchObject({
      amount: '1000000',
      rateDate: '2026-10-01',
      reason: 'occurred_on',
    })
  })

  it('EARS-550: a posted request reads what the ledger holds in the display currency first', () => {
    const posting: DisplayRatePostingFacts = {
      operationOccurredOn: '2026-10-05',
      postedAt: null,
      accountAmounts: [{ currency: 'RUB', amount: -950_000n }],
      conversionSteps: [],
    }
    const shown = queueDisplayAmounts(request({ status: 'posted' }), posting, context)
    expect(shown.RUB).toMatchObject({ kind: 'converted', amount: '950000', basis: 'ledger_amount' })
    // No EUR leg in the ledger: the CBR rate of the operation's own date.
    expect(shown.EUR).toMatchObject({ basis: 'cbr', rateDate: '2026-10-01' })
  })

  it('EARS-550: a posted request with a recorded step uses the step’s amounts', () => {
    const posting: DisplayRatePostingFacts = {
      operationOccurredOn: '2026-10-05',
      postedAt: null,
      accountAmounts: [],
      conversionSteps: [
        { fromCurrency: 'USD', toCurrency: 'EUR', fromAmount: 10_000n, toAmount: 9_000n },
      ],
    }
    const shown = queueDisplayAmounts(request({ status: 'posted' }), posting, context)
    expect(shown.EUR).toMatchObject({ amount: '9000', basis: 'ledger_step' })
  })

  it('EARS-551: a USDT request converts at the CBR rate of USD', () => {
    const shown = queueDisplayAmounts(request({ currency: 'USDT' }), null, context)
    expect(shown.RUB).toMatchObject({ kind: 'converted', amount: '800000', basis: 'cbr' })
    expect(shown.USD).toMatchObject({ kind: 'converted', amount: '10000' })
  })

  it('EARS-551: a currency CBR does not quote has no rate — never a zero, never a guess', () => {
    // DAI: a coin no peg rule maps to a CBR currency (USDT and USDC are asked as USD, #559).
    const shown = queueDisplayAmounts(request({ currency: 'DAI' }), null, context)
    expect(shown.RUB).toEqual({ kind: 'no_rate', currency: 'DAI', date: '2026-11-18' })
    expect(shown.USD).toEqual({ kind: 'no_rate', currency: 'DAI', date: '2026-11-18' })
  })

  it('EARS-551: a USDC request is converted at the USD rate, the same peg rule as USDT and §J (#559)', () => {
    const usdc = queueDisplayAmounts(request({ currency: 'USDC' }), null, context)
    const usd = queueDisplayAmounts(request({ currency: 'USD' }), null, context)
    expect(usdc.RUB).toMatchObject({
      kind: 'converted',
      amount: (usd.RUB as { amount: string }).amount,
    })
  })

  it('EARS-551: a date before the stored series has no rate', () => {
    const shown = queueDisplayAmounts(
      request({ alreadyPaid: true, occurredOn: '2026-01-10' }),
      null,
      context,
    )
    expect(shown.RUB).toEqual({ kind: 'no_rate', currency: 'USD', date: '2026-01-10' })
  })

  it('EARS-550: names every CBR quote the conversions will look up, once', () => {
    const needs = queueQuoteNeeds(
      [
        { request: request(), posting: null },
        { request: request({ currency: 'USDT' }), posting: null },
        {
          request: request({ currency: 'RUB', alreadyPaid: true, occurredOn: '2026-10-05' }),
          posting: null,
        },
      ],
      '2026-11-18',
    )
    expect(needs).toEqual(
      expect.arrayContaining([
        { currency: 'USD', date: '2026-11-18' },
        { currency: 'EUR', date: '2026-11-18' },
        { currency: 'USD', date: '2026-10-05' },
        { currency: 'EUR', date: '2026-10-05' },
      ]),
    )
    expect(needs.some((need) => need.currency === 'USDT' || need.currency === 'RUB')).toBe(false)
    expect(new Set(needs.map((n) => `${n.currency}@${n.date}`)).size).toBe(needs.length)
  })
})
