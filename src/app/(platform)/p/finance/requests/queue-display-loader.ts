import {
  latestRateDate,
  moscowToday,
  operationDisplayFacts,
  rateOn,
  rateSeries,
  type DisplayRatePostingFacts,
  type FinanceExpenseRequestView,
  type FxRate,
  type OperationDisplayFacts,
} from '@/lib/finance'
import { pickRateOn } from '@/lib/finance/fx/rates'

import {
  DISPLAY_CURRENCY_CODES,
  type DisplayCurrencyCode,
  type QueueDisplayAmount,
  type RequestsSnapshot,
} from './request-board-contract'
import { queueDisplayAmounts, queueQuoteNeeds, type QueueDisplayContext } from './queue-display'

/**
 * The SERVER half of the queue's display currency (spec 339 §I, EARS-549…552;
 * issue #550): one read of the CBR store and one of the ledger's posting facts
 * per board, then the pure conversion of `queue-display.ts` for every request.
 *
 * It lives in the requests queue directory because that is the consumer
 * EARS-553's isolation test allows; the requests API route only calls it.
 *
 * ISO 4217 gives the three display currencies two decimals. A stand whose
 * reference has not registered one of them (a dev DB with no EUR) still shows
 * € — a target precision is not a guess the way a SOURCE precision would be.
 */
const DISPLAY_PRECISION_FALLBACK = 2

/** The earliest date whose quote may sit before the dates asked (weekends, holidays). */
function minus31(date: string): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - 31)
  return day.toISOString().slice(0, 10)
}

function postingFacts(
  request: FinanceExpenseRequestView,
  facts: ReadonlyMap<number, OperationDisplayFacts>,
): DisplayRatePostingFacts | null {
  if (request.status !== 'posted' || request.operationId === null) return null
  const operation = facts.get(request.operationId)
  if (operation === undefined) return null
  return {
    operationOccurredOn: operation.occurredOn,
    postedAt: request.postedAt?.toISOString() ?? null,
    accountAmounts: operation.moneyAmounts,
    conversionSteps: operation.conversionSteps,
  }
}

export type QueueDisplay = {
  byRequest: Map<number, Record<DisplayCurrencyCode, QueueDisplayAmount>>
  fx: RequestsSnapshot['fx']
}

export async function loadQueueDisplay(
  requests: readonly FinanceExpenseRequestView[],
  currencies: readonly { code: string; precision: number }[],
): Promise<QueueDisplay> {
  const today = moscowToday()
  const facts = await operationDisplayFacts(
    requests.flatMap((request) =>
      request.status === 'posted' && request.operationId !== null ? [request.operationId] : [],
    ),
  )
  const rows = requests.map((request) => ({
    id: request.id,
    request: {
      amount: request.amount,
      currency: request.currency,
      status: request.status,
      alreadyPaid: request.alreadyPaid,
      occurredOn: request.occurredOn,
    },
    // A posted request whose operation row is missing must still not be valued
    // «today» (EARS-550: moved money is valued on the day it moved), so it gets
    // its own `occurred_on` and no ledger legs — the CBR rate of that date.
    posting:
      postingFacts(request, facts) ??
      (request.status === 'posted'
        ? {
            operationOccurredOn: request.occurredOn ?? today,
            postedAt: null,
            accountAmounts: [],
            conversionSteps: [],
          }
        : null),
  }))

  const needs = queueQuoteNeeds(rows, today)
  const dates = needs.map((need) => need.date).sort()
  const [series, latest] = await Promise.all([
    needs.length === 0
      ? Promise.resolve([] as FxRate[])
      : rateSeries(
          [...new Set(needs.map((need) => need.currency))],
          minus31(dates[0]!),
          dates[dates.length - 1]!,
        ),
    latestRateDate(),
  ])
  // A quote older than the 31-day window is still a quote (EARS-552 has no
  // window for the display rule): ask the store for exactly the misses.
  const quotes = new Map<string, FxRate | null>()
  await Promise.all(
    needs.map(async ({ currency, date }) => {
      const found = pickRateOn(series, currency, date) ?? (await rateOn(currency, date))
      quotes.set(`${currency}@${date}`, found)
    }),
  )

  const precisions = new Map(currencies.map((currency) => [currency.code, currency.precision]))
  for (const code of DISPLAY_CURRENCY_CODES) {
    if (!precisions.has(code)) precisions.set(code, DISPLAY_PRECISION_FALLBACK)
  }
  const context: QueueDisplayContext = {
    today,
    precisions,
    quote: (currency, date) =>
      currency === 'RUB'
        ? { currency: 'RUB', rateDate: date, nominal: 1, valueRub: '1' }
        : (quotes.get(`${currency}@${date}`) ?? null),
  }

  return {
    byRequest: new Map(
      rows.map((row) => [row.id, queueDisplayAmounts(row.request, row.posting, context)]),
    ),
    fx: { latestRateDate: latest, today },
  }
}
