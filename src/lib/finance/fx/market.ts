/**
 * «Курс против рынка» — the §J market valuation as pure arithmetic (spec
 * `docs/specs/339-ledger-intake.md` §J, EARS-557…562 and the EARS-566 %
 * rule; issue #558).
 *
 * **Рынок** is what the payment would have cost at the Bank of Russia rate of
 * its date; **Факт** is what the ledger says the account actually lost;
 * **Переплата** is Факт − Рынок, in roubles and as Факт / Рынок − 1. Both sides
 * are valued in roubles first, as exact fractions of bigints (`ExactAmount`, in
 * kopecks), so a sum of many items adds exact values and rounds ONCE, at the
 * end (EARS-559/562). No JS `number` touches an amount.
 *
 * Every result here is a reading — shown, never stored (EARS-553). The rates
 * come in as a series (`MarketContext`); `./market-valuation.ts` loads it.
 */
import type { MarketChainFact, MarketIntakeFact } from '../market-facts'

import {
  addDays,
  convertAtRubRates,
  pickRateOn,
  RUB_RATE,
  roundExact,
  type ExactAmount,
  type FxRate,
} from './rates'

/** EARS-558: a rate older than this many days before the payment date is no rate. */
export const MARKET_RATE_WINDOW_DAYS = 14

/**
 * The USD-pegged stablecoins CBR does not quote, valued at the USD rate
 * (EARS-551/558): USDT by decision 41, USDC by the lead's decision on #559
 * (2026-11-18) — the same peg, so the same rule, here and in the queue display
 * that imports it.
 */
const USD_PEGGED = new Set(['USDT', 'USDC'])

/** The CBR currency that quotes `currency` (EARS-558): a USD-pegged coin asks for USD. */
export function marketQuoteCurrency(currency: string): string {
  return USD_PEGGED.has(currency) ? 'USD' : currency
}

/**
 * The CBR quote that values `currency` on `date`: the stored one on that date
 * or the nearest previous one, at most 14 days older, never a later one
 * (EARS-558). RUB is the identity quote.
 */
export function pickMarketRate(
  series: readonly FxRate[],
  currency: string,
  date: string,
): FxRate | null {
  const quote = pickRateOn(series, marketQuoteCurrency(currency), date)
  if (quote === null) return null
  return quote.rateDate < addDays(date, -MARKET_RATE_WINDOW_DAYS) ? null : quote
}

/** The rates and currency precisions a valuation reads. */
export type MarketContext = {
  /** Every CBR quote that may be needed — `pickMarketRate` chooses among them. */
  series: readonly FxRate[]
  /** `core.finance_currency.precision` by code. */
  precisions: ReadonlyMap<string, number>
}

/** The overpayment of one item or of a sum, each figure rounded once from the exact value. */
export type Overpayment = {
  /** Факт in kopecks. */
  factRub: bigint
  /** Рынок in kopecks. */
  marketRub: bigint
  /** Факт − Рынок in kopecks, signed: positive is worse than the market. */
  amount: bigint
  /** (Факт / Рынок − 1) in tenths of a percent, signed; `null` when Рынок is zero. */
  percentTenths: bigint | null
  /** «хуже рынка на X,X%» / «лучше рынка на X,X%» / «как на рынке» (EARS-559). */
  wording: string
}

export type MarketValuation =
  | {
      status: 'measured'
      factRub: ExactAmount
      marketRub: ExactAmount
      /** The quotes used: `market` values the document (or target) side, `fact` the paid side. */
      rates: { market: FxRate; fact: FxRate }
      overpayment: Overpayment
    }
  /** EARS-558: CBR has no quote for `currency` within the window on `date`. */
  | { status: 'no_rate'; currency: string; date: string }
  /** EARS-560: the money moved, but what it cost is not in the ledger yet. */
  | { status: 'not_posted'; statedPaidAmount: bigint | null }

type EntryBase = {
  /** The payment date (EARS-557/561); for «факт не внесён» — occurred_on, else submission (EARS-560). */
  date: string
  /** `YYYY-MM` of `date`. */
  month: string
  /** «Кому платим» (EARS-538) for a payment; `null` for a chain. */
  payee: string | null
  /** A payment's paying account (or «свои средства») and currency pair; a chain's currency path. */
  route: string
  valuation: MarketValuation
}

export type MarketPaymentEntry = EntryBase & {
  subject: 'payment'
  itemId: number
  personalFunds: boolean
  document: { amount: bigint; currency: string }
  /** What the account lost (EARS-557); `null` while not posted. */
  fact: {
    amount: bigint
    currency: string
    fee: { amount: bigint; currency: string } | null
    /** The paying account; `null` — the member's own card (`personal_funds`). */
    account: string | null
  } | null
}

export type MarketChainEntry = EntryBase & {
  subject: 'chain'
  operationId: number
  /** What left the source account, its fees included (EARS-561). */
  source: { amount: bigint; currency: string; fee: bigint; account: string }
  /** What arrived on the target account, net of its fees. */
  target: { amount: bigint; currency: string; fee: bigint; account: string }
}

export type MarketEntry = MarketPaymentEntry | MarketChainEntry

const PENDING_STATUSES = new Set(['submitted', 'approved'])

/**
 * Which §J population an intake item belongs to: a foreign-currency
 * `payment` (EARS-557), a `not_posted` «факт не внесён» request (EARS-560), or
 * neither (`null`).
 */
export function classifyIntakeItem(fact: MarketIntakeFact): 'payment' | 'not_posted' | null {
  if (fact.kind !== 'expense') return null
  if (fact.status === 'posted') {
    if (fact.operationReversed) return null
    if (fact.paidCurrency === null || fact.paidAmount === null) return null
    return fact.paidCurrency === fact.currency ? null : 'payment'
  }
  if (!fact.alreadyPaid || !PENDING_STATUSES.has(fact.status)) return null
  const debit = fact.accountCurrency ?? fact.paidCurrency
  if (debit === null) return fact.currency === 'RUB' ? null : 'not_posted'
  return debit === fact.currency ? null : 'not_posted'
}

// ── exact fractions ──────────────────────────────────────────────────────────

const ZERO: ExactAmount = { numerator: 0n, denominator: 1n }

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) [x, y] = [y, x % y]
  return x === 0n ? 1n : x
}

function reduce({ numerator, denominator }: ExactAmount): ExactAmount {
  const sign = denominator < 0n ? -1n : 1n
  const g = gcd(numerator, denominator)
  return { numerator: (sign * numerator) / g, denominator: (sign * denominator) / g }
}

/** Exact sum of two fractions, reduced — what every aggregate adds with. */
export function addExact(a: ExactAmount, b: ExactAmount): ExactAmount {
  return reduce({
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  })
}

function sub(a: ExactAmount, b: ExactAmount): ExactAmount {
  return addExact(a, { numerator: -b.numerator, denominator: b.denominator })
}

function precisionOf(ctx: MarketContext, currency: string): number {
  const precision = ctx.precisions.get(currency)
  if (precision === undefined) {
    throw new Error(`market valuation: currency ${currency} is not registered in the ledger`)
  }
  return precision
}

/** `amount` minimal units of `currency` in kopecks at `quote`, exact. */
function rubValue(
  ctx: MarketContext,
  amount: bigint,
  currency: string,
  quote: FxRate,
): ExactAmount {
  if (currency === 'RUB') return { numerator: amount, denominator: 1n }
  return reduce(
    convertAtRubRates(amount, quote, RUB_RATE, precisionOf(ctx, currency), precisionOf(ctx, 'RUB'))
      .exact,
  )
}

// ── the overpayment ──────────────────────────────────────────────────────────

/** EARS-559's wording for a % already rounded to tenths. */
export function overpaymentWording(percentTenths: bigint): string {
  if (percentTenths === 0n) return 'как на рынке'
  const abs = percentTenths < 0n ? -percentTenths : percentTenths
  const text = `${abs / 10n},${abs % 10n}%`
  return percentTenths > 0n ? `хуже рынка на ${text}` : `лучше рынка на ${text}`
}

/** Переплата of exact Факт and Рынок (kopecks): every figure rounded once (EARS-559). */
export function overpaymentOf(factRub: ExactAmount, marketRub: ExactAmount): Overpayment {
  const difference = sub(factRub, marketRub)
  const market = reduce(marketRub)
  const percentTenths =
    market.numerator === 0n
      ? null
      : roundExact({
          numerator: difference.numerator * market.denominator * 1000n,
          denominator: difference.denominator * market.numerator,
        })
  return {
    factRub: roundExact(factRub),
    marketRub: roundExact(marketRub),
    amount: roundExact(difference),
    percentTenths,
    wording: percentTenths === null ? '—' : overpaymentWording(percentTenths),
  }
}

function measuredValuation(
  ctx: MarketContext,
  date: string,
  market: { amount: bigint; currency: string },
  fact: readonly { amount: bigint; currency: string }[],
): MarketValuation {
  const marketRate = pickMarketRate(ctx.series, market.currency, date)
  if (marketRate === null) return { status: 'no_rate', currency: market.currency, date }
  let factRub = ZERO
  let factRate: FxRate | null = null
  for (const part of fact) {
    const quote = pickMarketRate(ctx.series, part.currency, date)
    if (quote === null) return { status: 'no_rate', currency: part.currency, date }
    factRate ??= quote
    factRub = addExact(factRub, rubValue(ctx, part.amount, part.currency, quote))
  }
  const marketRub = rubValue(ctx, market.amount, market.currency, marketRate)
  return {
    status: 'measured',
    factRub,
    marketRub,
    rates: { market: marketRate, fact: factRate ?? marketRate },
    overpayment: overpaymentOf(factRub, marketRub),
  }
}

/** «Кому платим» (EARS-538): the member for personal funds, else counterparty, else member. */
function payeeOf(fact: MarketIntakeFact): string {
  if (fact.personalFunds && fact.memberName !== null) return fact.memberName
  return fact.counterpartyName ?? fact.memberName ?? '—'
}

/**
 * A payment's route (EARS-565): the paying account or «свои средства», and the
 * pair. While the debit currency is not known yet (an already-paid request not
 * posted), the route names its source and the document currency only — never a
 * «?» standing in for the missing side (review of #563).
 */
function paymentRoute(fact: MarketIntakeFact): string {
  const via = fact.personalFunds ? 'свои средства' : (fact.accountName ?? 'счёт не указан')
  const debit = fact.accountCurrency ?? fact.paidCurrency
  return debit === null ? `${via} → ${fact.currency}` : `${via} · ${debit} → ${fact.currency}`
}

/** One intake item valued — or `null` when it is not in the §J set. */
export function measureIntakeItem(
  fact: MarketIntakeFact,
  ctx: MarketContext,
): MarketPaymentEntry | null {
  const kind = classifyIntakeItem(fact)
  if (kind === null) return null
  const document = { amount: fact.amount, currency: fact.currency }
  const base = {
    subject: 'payment' as const,
    itemId: fact.itemId,
    personalFunds: fact.personalFunds,
    payee: payeeOf(fact),
    route: paymentRoute(fact),
    document,
  }
  if (kind === 'not_posted') {
    const date = fact.occurredOn ?? fact.submittedOn
    return {
      ...base,
      date,
      month: date.slice(0, 7),
      fact: null,
      valuation: { status: 'not_posted', statedPaidAmount: fact.paidAmount },
    }
  }
  // A posted item always has its money date (EARS-533).
  const date = fact.occurredOn as string
  const paidCurrency = fact.paidCurrency as string
  const paid = { amount: fact.paidAmount as bigint, currency: paidCurrency }
  // The shipped fee rule keeps the fee in the paying currency; a fee recorded
  // without a currency is in it too.
  const fee =
    fact.feeAmount === null || fact.feeAmount === 0n
      ? null
      : { amount: fact.feeAmount, currency: fact.feeCurrency ?? paidCurrency }
  return {
    ...base,
    date,
    month: date.slice(0, 7),
    fact: {
      ...paid,
      fee,
      account: fact.personalFunds ? null : fact.accountName,
    },
    valuation: measuredValuation(ctx, date, document, fee === null ? [paid] : [paid, fee]),
  }
}

/** A chain whose money legs do not have the two ends EARS-561 reads. */
export class MalformedChainError extends Error {
  constructor(readonly operationId: number) {
    super(`market valuation: operation ${operationId} has no two chain ends`)
    this.name = 'MalformedChainError'
  }
}

/**
 * Every chain valued, a malformed one left out and NAMED rather than taking
 * the whole report down with it (lead review of #561, for #559): the report
 * counts the excluded operations instead of summing them.
 */
export function measureChains(
  facts: readonly MarketChainFact[],
  ctx: MarketContext,
): { entries: MarketChainEntry[]; excluded: number[] } {
  const entries: MarketChainEntry[] = []
  const excluded: number[] = []
  for (const fact of facts) {
    try {
      entries.push(measureChain(fact, ctx))
    } catch (error) {
      if (!(error instanceof MalformedChainError)) throw error
      excluded.push(error.operationId)
    }
  }
  return { entries, excluded }
}

/**
 * One conversion chain valued (EARS-561). The two ends are the money-account
 * postings with no step link; a step-linked money-account posting is a fee,
 * charged to the source when it sits on the source account (Факт includes
 * it), else to the target (Рынок is net of it).
 */
export function measureChain(fact: MarketChainFact, ctx: MarketContext): MarketChainEntry {
  const ends = fact.moneyLegs.filter((leg) => !leg.onStep)
  const sourceEnd = ends.find((leg) => leg.amount < 0n)
  const targetEnd = ends.find((leg) => leg.amount > 0n)
  if (sourceEnd === undefined || targetEnd === undefined) {
    throw new MalformedChainError(fact.operationId)
  }
  let sourceFee = 0n
  let targetFee = 0n
  for (const leg of fact.moneyLegs) {
    if (!leg.onStep) continue
    const fee = leg.amount < 0n ? -leg.amount : leg.amount
    if (leg.accountId === sourceEnd.accountId && leg.currency === sourceEnd.currency) {
      sourceFee += fee
    } else {
      targetFee += fee
    }
  }
  const source = {
    amount: -sourceEnd.amount + sourceFee,
    currency: sourceEnd.currency,
    fee: sourceFee,
    account: sourceEnd.accountName,
  }
  const target = {
    amount: targetEnd.amount - targetFee,
    currency: targetEnd.currency,
    fee: targetFee,
    account: targetEnd.accountName,
  }
  const path = fact.steps.length === 0 ? [] : [fact.steps[0].fromCurrency]
  for (const step of fact.steps) path.push(step.toCurrency)
  return {
    subject: 'chain',
    operationId: fact.operationId,
    date: fact.occurredOn,
    month: fact.occurredOn.slice(0, 7),
    payee: null,
    route: path.join(' → '),
    source,
    target,
    valuation: measuredValuation(
      ctx,
      fact.occurredOn,
      { amount: target.amount, currency: target.currency },
      [{ amount: source.amount, currency: source.currency }],
    ),
  }
}

// ── aggregates ───────────────────────────────────────────────────────────────

export type MarketTotals = {
  /** Σ Факт of the measured items, kopecks, rounded once. */
  factRub: bigint
  /** Σ Рынок of the measured items, kopecks, rounded once. */
  marketRub: bigint
  /** The weighted Переплата (EARS-562); `null` when nothing is measured. */
  overpayment: Overpayment | null
  measured: { payments: number; chains: number }
  /** «без курса: N» (EARS-560), by kind. */
  noRate: { payments: number; chains: number }
  /** «факт не внесён: N» (EARS-560). */
  notPosted: number
}

/**
 * Σ Переплата = Σ Факт − Σ Рынок and its % = Σ Факт / Σ Рынок − 1 over the
 * measured entries only; «без курса» and «факт не внесён» are counted, never
 * summed (EARS-560/562).
 */
export function aggregateMarket(entries: readonly MarketEntry[]): MarketTotals {
  let fact = ZERO
  let market = ZERO
  const measured = { payments: 0, chains: 0 }
  const noRate = { payments: 0, chains: 0 }
  let notPosted = 0
  for (const entry of entries) {
    const kind = entry.subject === 'payment' ? 'payments' : 'chains'
    const v = entry.valuation
    if (v.status === 'measured') {
      fact = addExact(fact, v.factRub)
      market = addExact(market, v.marketRub)
      measured[kind] += 1
    } else if (v.status === 'no_rate') {
      noRate[kind] += 1
    } else {
      notPosted += 1
    }
  }
  const any = measured.payments + measured.chains > 0
  return {
    factRub: roundExact(fact),
    marketRub: roundExact(market),
    overpayment: any ? overpaymentOf(fact, market) : null,
    measured,
    noRate,
    notPosted,
  }
}

export type MarketGroup = {
  key: string
  /** The month (`YYYY-MM`) for `month`; the payee for a `payee_route` payment row. */
  label: string
  payee: string | null
  route: string | null
  entries: MarketEntry[]
  totals: MarketTotals
}

/**
 * The report's breakdowns (EARS-562/565): by `month`, newest first; or by
 * `payee_route` — payment rows by payee and route, chain rows by route — the
 * largest rouble Переплата first and the rows with nothing measured last, so
 * «на чём переплатили» is the top of the table (review of #563). Each row is
 * weighted on its own entries, so a table sums to the period total.
 */
export function groupMarket(
  entries: readonly MarketEntry[],
  by: 'month' | 'payee_route',
): MarketGroup[] {
  const groups = new Map<string, Omit<MarketGroup, 'totals'>>()
  for (const entry of entries) {
    const key =
      by === 'month'
        ? entry.month
        : entry.subject === 'payment'
          ? `0|${entry.payee}|${entry.route}`
          : `1|${entry.route}`
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        key: by === 'month' ? key : key.slice(2),
        label: by === 'month' ? entry.month : (entry.payee ?? entry.route),
        payee: by === 'month' ? null : entry.payee,
        route: by === 'month' ? null : entry.route,
        entries: [],
      }
      groups.set(key, group)
    }
    group.entries.push(entry)
  }
  const byKey = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => ({ ...group, totals: aggregateMarket(group.entries) }))
  if (by === 'month') return byKey.reverse()
  // A stable sort: equal Переплата keeps the key order above.
  return byKey.sort((a, b) => {
    const left = a.totals.overpayment?.amount
    const right = b.totals.overpayment?.amount
    if (left === undefined || right === undefined) {
      return left === right ? 0 : left === undefined ? 1 : -1
    }
    return left === right ? 0 : left > right ? -1 : 1
  })
}

// ── the display currency ─────────────────────────────────────────────────────

export type DisplayMarketTotals = {
  currency: string
  /** Σ Факт in the display currency's minimal units, rounded once. */
  fact: bigint
  market: bigint
  overpayment: bigint
  /** The weighted % of the ROUBLE figures of every measured item (EARS-562/566). */
  percentTenths: bigint | null
  wording: string
  /** Measured items the display currency has no rate for on their date — «без курса: N». */
  noDisplayRate: number
}

/**
 * One measured entry's exact rouble Факт and Рынок in `displayCurrency`, at the
 * CBR rate of the entry's own payment date (EARS-566) — or `null` when that
 * currency has no rate there, or the ledger does not register it (no known
 * precision: like one CBR does not quote, it converts nothing — the
 * `convertForDisplay` rule).
 */
export function displayEntryExact(
  entry: MarketEntry,
  displayCurrency: string,
  ctx: MarketContext,
): { fact: ExactAmount; market: ExactAmount } | null {
  const v = entry.valuation
  if (v.status !== 'measured') return null
  const precision = ctx.precisions.get(displayCurrency)
  if (precision === undefined) return null
  const quote =
    displayCurrency === 'RUB'
      ? { ...RUB_RATE, rateDate: entry.date }
      : pickMarketRate(ctx.series, displayCurrency, entry.date)
  if (quote === null) return null
  const rubPrecision = precisionOf(ctx, 'RUB')
  const toDisplay = (value: ExactAmount): ExactAmount => {
    const converted = convertAtRubRates(value.numerator, RUB_RATE, quote, rubPrecision, precision)
    return reduce({
      numerator: converted.exact.numerator,
      denominator: converted.exact.denominator * value.denominator,
    })
  }
  return { fact: toDisplay(v.factRub), market: toDisplay(v.marketRub) }
}

/**
 * The measured entries' sums in a display currency (EARS-566): each item's
 * rouble figures are converted at the CBR rate of ITS payment date (EARS-558's
 * rule) before any sum, and an item without such a rate leaves the displayed
 * sums and is counted. The % is the rouble one, so no display currency and no
 * missing display rate moves it.
 */
export function displayMarketTotals(
  entries: readonly MarketEntry[],
  displayCurrency: string,
  ctx: MarketContext,
): DisplayMarketTotals {
  const rub = aggregateMarket(entries)
  let fact = ZERO
  let market = ZERO
  let noDisplayRate = 0
  for (const entry of entries) {
    if (entry.valuation.status !== 'measured') continue
    const converted = displayEntryExact(entry, displayCurrency, ctx)
    if (converted === null) {
      noDisplayRate += 1
      continue
    }
    fact = addExact(fact, converted.fact)
    market = addExact(market, converted.market)
  }
  return {
    currency: displayCurrency,
    fact: roundExact(fact),
    market: roundExact(market),
    overpayment: roundExact(sub(fact, market)),
    percentTenths: rub.overpayment?.percentTenths ?? null,
    wording: rub.overpayment?.wording ?? '—',
    noDisplayRate,
  }
}
