/**
 * The §J market valuation's query layer (spec `docs/specs/339-ledger-intake.md`
 * §J, EARS-557…562; issue #558) — what the details-sheet block (#551) and the
 * «Курс против рынка» report (#559) call.
 *
 * It reads the ledger through its read functions (`../market-facts`), reads
 * the CBR series once for every date involved, and hands both to the pure
 * valuation in `./market.ts`. Nothing is written and nothing is cached: every
 * number is computed at read time (EARS-553).
 */
import { inArray } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'
import { financeCurrency } from '@/lib/platform/db/schema/finance/finance-currency'

import {
  marketChainFacts,
  marketIntakeFacts,
  type MarketChainFact,
  type MarketIntakeFact,
} from '../market-facts'
import {
  marketQuoteCurrency,
  MARKET_RATE_WINDOW_DAYS,
  measureChain,
  measureIntakeItem,
  pickMarketRate,
  type MarketContext,
  type MarketEntry,
  type MarketPaymentEntry,
} from './market'
import { addDays, type FxRate } from './rates'
import { rateOn, rateSeries } from './store'

/** A period of payment dates, inclusive at both ends; an open end is unbounded. */
export type MarketPeriod = { from?: string; to?: string }

/** The CBR quote valuing `currency` on `date` under EARS-558's rule, or `null`. */
export async function marketRateOn(currency: string, date: string): Promise<FxRate | null> {
  const quote = await rateOn(marketQuoteCurrency(currency), date)
  return quote === null ? null : pickMarketRate([quote], currency, date)
}

/**
 * The rates and precisions for valuing `dates` in `currencies` — the extra
 * `displayCurrencies` are loaded too, so the report's display conversion
 * (EARS-566) reads the same context.
 */
export async function loadMarketContext(
  currencies: Iterable<string>,
  dates: readonly string[],
): Promise<MarketContext> {
  const codes = [...new Set(currencies)]
  const precisions = new Map<string, number>()
  if (codes.length > 0) {
    const rows = await getPlatformDb()
      .select({ code: financeCurrency.code, precision: financeCurrency.precision })
      .from(financeCurrency)
      .where(inArray(financeCurrency.code, [...new Set([...codes, 'RUB'])]))
    for (const row of rows) precisions.set(row.code, row.precision)
  }
  if (!precisions.has('RUB')) precisions.set('RUB', 2)
  if (dates.length === 0) return { series: [], precisions }
  const sorted = [...dates].sort()
  const series = await rateSeries(
    [...new Set(codes.map(marketQuoteCurrency))],
    addDays(sorted[0], -MARKET_RATE_WINDOW_DAYS),
    sorted[sorted.length - 1],
  )
  return { series, precisions }
}

function currenciesOf(intake: readonly MarketIntakeFact[], chains: readonly MarketChainFact[]) {
  const out = new Set<string>()
  for (const f of intake) {
    for (const c of [f.currency, f.paidCurrency, f.feeCurrency, f.accountCurrency]) {
      if (c !== null) out.add(c)
    }
  }
  for (const f of chains) for (const leg of f.moneyLegs) out.add(leg.currency)
  return out
}

function datesOf(intake: readonly MarketIntakeFact[], chains: readonly MarketChainFact[]) {
  return [...intake.map((f) => f.occurredOn ?? f.submittedOn), ...chains.map((f) => f.occurredOn)]
}

function inPeriod(date: string, period: MarketPeriod): boolean {
  return (
    (period.from === undefined || date >= period.from) &&
    (period.to === undefined || date <= period.to)
  )
}

/**
 * Every §J entry of the period — foreign-currency payments, «факт не внесён»
 * requests and conversion chains — each valued (or marked «без курса»), in
 * date order. `extraCurrencies` (the display currencies) are added to the
 * returned context so the caller can run `displayMarketTotals` on it.
 */
export async function loadMarketValuation(
  period: MarketPeriod = {},
  extraCurrencies: readonly string[] = [],
): Promise<{ entries: MarketEntry[]; context: MarketContext }> {
  const [intake, chains] = await Promise.all([marketIntakeFacts(), marketChainFacts()])
  const context = await loadMarketContext(
    [...currenciesOf(intake, chains), ...extraCurrencies],
    datesOf(intake, chains),
  )
  const entries: MarketEntry[] = []
  for (const fact of intake) {
    const entry = measureIntakeItem(fact, context)
    if (entry !== null && inPeriod(entry.date, period)) entries.push(entry)
  }
  for (const fact of chains) {
    if (!inPeriod(fact.occurredOn, period)) continue
    entries.push(measureChain(fact, context))
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { entries, context }
}

/** The entries of `loadMarketValuation`, without the context. */
export async function loadMarketEntries(period: MarketPeriod = {}): Promise<MarketEntry[]> {
  return (await loadMarketValuation(period)).entries
}

/**
 * One request's §J entry — what the details-sheet block (EARS-563) renders —
 * or `null` when the request is not a foreign-currency payment nor «факт не
 * внесён» (a same-currency request shows no block).
 */
export async function marketEntryForItem(itemId: number): Promise<MarketPaymentEntry | null> {
  const [fact] = await marketIntakeFacts({ itemId })
  if (fact === undefined) return null
  const context = await loadMarketContext(currenciesOf([fact], []), datesOf([fact], []))
  return measureIntakeItem(fact, context)
}
