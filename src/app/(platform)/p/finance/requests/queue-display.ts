import type { FinanceIntakeStatus } from '@/lib/finance'
import { displayRateBasis, type DisplayRatePostingFacts } from '@/lib/finance/fx/display-rate'
import { marketQuoteCurrency } from '@/lib/finance/fx/market'
import { convertAtRubRates, roundExact, type FxRate } from '@/lib/finance/fx/rates'

import {
  DISPLAY_CURRENCY_CODES,
  type DisplayCurrencyCode,
  type QueueDisplayAmount,
} from './request-board-contract'

/**
 * A request's amount in each display currency of the queue — spec 339 §I,
 * EARS-549/550/551, issue #550 — as pure data.
 *
 * WHICH rate applies is #548's `displayRateBasis` (EARS-550), unchanged; this
 * file only CARRIES OUT what it answers over a stored CBR series and the
 * ledger's posting facts, and says «нет курса» where the series has no quote
 * (EARS-551). USDT is quoted as USD (decision 41, the §J rule
 * `marketQuoteCurrency`), so one USDT request reads the same here and in §J.
 *
 * Every result is a reading for the screen — shown, never stored (EARS-553);
 * this file lives in the requests queue directory, the consumer EARS-553's
 * allowlist names.
 */

/** The slice of a request the conversion reads. */
export type QueueDisplayRequest = {
  amount: bigint
  currency: string
  status: FinanceIntakeStatus
  alreadyPaid: boolean
  occurredOn: string | null
}

export type QueueDisplayContext = {
  /** Today in Moscow — the date an unpaid request is valued on. */
  today: string
  /** `core.finance_currency.precision` by code (the display three always present). */
  precisions: ReadonlyMap<string, number>
  /** The latest stored CBR quote of `currency` on or before `date`, or null (EARS-552). */
  quote: (currency: string, date: string) => FxRate | null
}

type Converted = Extract<QueueDisplayAmount, { kind: 'converted' }>

function converted(
  numerator: bigint,
  denominator: bigint,
  basis: Converted['basis'],
  rate: { date: string; reason: Converted['reason'] } | null = null,
): QueueDisplayAmount {
  return {
    kind: 'converted',
    amount: roundExact({ numerator, denominator }).toString(),
    numerator: numerator.toString(),
    denominator: denominator.toString(),
    basis,
    rateDate: rate?.date ?? null,
    reason: rate?.reason ?? null,
  }
}

/** The request in ONE display currency. */
function displayIn(
  request: QueueDisplayRequest,
  posting: DisplayRatePostingFacts | null,
  target: DisplayCurrencyCode,
  context: QueueDisplayContext,
): QueueDisplayAmount {
  const basis = displayRateBasis({ ...request, posting }, target, context.today)
  switch (basis.kind) {
    case 'same_currency':
      return converted(request.amount, 1n, 'same_currency')
    case 'ledger_amount':
      return converted(basis.amount, 1n, 'ledger_amount')
    case 'ledger_step':
      return converted(request.amount * basis.numerator, basis.denominator, 'ledger_step')
    case 'cbr': {
      const noRate = { kind: 'no_rate', currency: request.currency, date: basis.date } as const
      const fromPrecision = context.precisions.get(request.currency)
      const toPrecision = context.precisions.get(target)
      if (fromPrecision === undefined || toPrecision === undefined) return noRate
      const from = context.quote(marketQuoteCurrency(request.currency), basis.date)
      if (from === null) return noRate
      const to = context.quote(target, basis.date)
      if (to === null) return { kind: 'no_rate', currency: target, date: basis.date }
      // A USDT amount converted as USD, at its OWN precision (decision 41).
      const { exact } = convertAtRubRates(request.amount, from, to, fromPrecision, toPrecision)
      // The quote the screen names is the foreign side's — RUB has none.
      const named = request.currency === 'RUB' ? to : from
      return converted(exact.numerator, exact.denominator, 'cbr', {
        date: named.rateDate ?? basis.date,
        reason: basis.reason,
      })
    }
  }
}

/** The request in each of the three display currencies (EARS-549). */
export function queueDisplayAmounts(
  request: QueueDisplayRequest,
  posting: DisplayRatePostingFacts | null,
  context: QueueDisplayContext,
): Record<DisplayCurrencyCode, QueueDisplayAmount> {
  return Object.fromEntries(
    DISPLAY_CURRENCY_CODES.map((code) => [code, displayIn(request, posting, code, context)]),
  ) as Record<DisplayCurrencyCode, QueueDisplayAmount>
}

/**
 * Every CBR quote (currency × date) the conversions of these requests will look
 * up, once each — so the loader reads the store in one go instead of once per
 * row and currency. RUB needs no quote; USDT is asked as USD.
 */
export function queueQuoteNeeds(
  rows: readonly { request: QueueDisplayRequest; posting: DisplayRatePostingFacts | null }[],
  today: string,
): { currency: string; date: string }[] {
  const needs = new Map<string, { currency: string; date: string }>()
  const need = (currency: string, date: string) => {
    if (currency === 'RUB') return
    needs.set(`${currency}@${date}`, { currency, date })
  }
  for (const { request, posting } of rows) {
    for (const target of DISPLAY_CURRENCY_CODES) {
      const basis = displayRateBasis({ ...request, posting }, target, today)
      if (basis.kind !== 'cbr') continue
      need(marketQuoteCurrency(request.currency), basis.date)
      need(target, basis.date)
    }
  }
  return [...needs.values()]
}
