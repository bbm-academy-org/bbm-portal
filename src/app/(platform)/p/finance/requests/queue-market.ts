import {
  displayMarketTotals,
  type MarketContext,
  type MarketEntry,
  type MarketPaymentEntry,
} from '@/lib/finance'

import {
  DISPLAY_CURRENCY_CODES,
  type DisplayCurrencyCode,
  type MarketDisplayFigures,
  type RequestMarketBlock,
} from './request-board-contract'

/**
 * One request's §J «Курс против рынка» block (spec 339 EARS-563, #551) as
 * the details sheet receives it — the #558 read model's entry, serialized.
 *
 * Nothing is valued here: Рынок, Факт, Переплата and the wording are the read
 * model's (`measureIntakeItem`), and the display-currency figures are its
 * `displayMarketTotals` over this one entry (EARS-566 — each rouble figure at
 * the CBR rate of the payment date, the % untouched). The file lives in the
 * requests queue directory, the consumer EARS-553's allowlist names, and its
 * results are shown, never stored.
 */
export function requestMarketBlock(
  entry: MarketPaymentEntry,
  context: MarketContext,
): RequestMarketBlock {
  const valuation = entry.valuation
  if (valuation.status === 'no_rate') {
    return { kind: 'no_rate', currency: valuation.currency, date: valuation.date }
  }
  if (valuation.status === 'not_posted') {
    return {
      kind: 'not_posted',
      statedPaidAmount: valuation.statedPaidAmount?.toString() ?? null,
    }
  }
  // A measured payment is a posted one, whose Факт the read model always names.
  const paid = entry.fact!
  const fee = paid.fee
  const display = Object.fromEntries(
    DISPLAY_CURRENCY_CODES.map((code): [DisplayCurrencyCode, MarketDisplayFigures | null] => {
      const totals = displayMarketTotals([entry], code, context)
      return [
        code,
        totals.noDisplayRate > 0
          ? null
          : {
              fact: totals.fact.toString(),
              market: totals.market.toString(),
              overpayment: totals.overpayment.toString(),
            },
      ]
    }),
  ) as Record<DisplayCurrencyCode, MarketDisplayFigures | null>
  const { currency, rateDate, nominal, valueRub } = valuation.rates.market
  return {
    kind: 'measured',
    date: entry.date,
    rate: { currency, rateDate, nominal, valueRub },
    fact: {
      // The fee is in the paying currency (the shipped fee rule), so Факт is one sum.
      amount: (paid.amount + (fee === null ? 0n : fee.amount)).toString(),
      currency: paid.currency,
      fee: fee === null ? null : { amount: fee.amount.toString(), currency: fee.currency },
      account: paid.account,
    },
    percentTenths: valuation.overpayment.percentTenths?.toString() ?? null,
    wording: valuation.overpayment.wording,
    display,
  }
}

/** Every request's block, by request id — from one read of the §J entries. */
export function requestMarketBlocks(
  entries: readonly MarketEntry[],
  context: MarketContext,
): Map<number, RequestMarketBlock> {
  const blocks = new Map<number, RequestMarketBlock>()
  for (const entry of entries) {
    if (entry.subject === 'payment') blocks.set(entry.itemId, requestMarketBlock(entry, context))
  }
  return blocks
}
