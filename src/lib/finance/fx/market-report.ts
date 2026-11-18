/**
 * «Курс против рынка» as a report (spec `docs/specs/339-ledger-intake.md` §J,
 * EARS-564…566; issue #559) — the pure shaping of the §J entries into the
 * period total, the month table and the payee / route table, in each display
 * currency.
 *
 * WHY THE TABLES ARE ALLOCATED, NOT ROUNDED ROW BY ROW. Every row of a table is
 * an exact fraction; rounding each row on its own lets a column miss the period
 * total by a kopeck or a cent (lead review of #561). EARS-565 says each table
 * sums to the period total, so the total of a column is rounded ONCE from the
 * exact sum (EARS-559/562) and the rows share it by the largest-remainder
 * method: every row is its exact value rounded down, and the units left over go
 * to the rows with the largest remainders. The two columns allocated are
 * **Рынок** and **Переплата** (the exact, signed Факт − Рынок); **Факт** is
 * then Рынок + Переплата of the figures shown, in the total, in every row and
 * in every item. Allocating Факт and Рынок on their own let a row whose exact
 * Переплата is 0 show ±1 unit beside «как на рынке», and one payment read two
 * different sums in the two tables (review of #563); allocating the difference
 * itself keeps an exact zero a zero. The price: Факт may differ from
 * `round(Σ Факт)` by one unit. The % never comes from these figures: it is the
 * weighted % of the exact rouble values (EARS-562/566).
 *
 * Bigints cross into the browser as strings; nothing here is stored (EARS-553).
 */
import {
  addExact,
  aggregateMarket,
  displayEntryExact,
  groupMarket,
  type MarketContext,
  type MarketEntry,
  type MarketTotals,
} from './market'
import { roundExact, type ExactAmount } from './rates'
import type { MarketPeriod } from './market-valuation'

// ── the period (EARS-564) ────────────────────────────────────────────────────

export const MARKET_REPORT_PERIODS = [
  { value: 'month', label: 'Этот месяц' },
  { value: 'quarter', label: 'Этот квартал' },
  { value: 'year', label: 'Этот год' },
  { value: '12m', label: 'Последние 12 месяцев' },
  { value: 'all', label: 'Всё время' },
] as const

export type MarketReportPeriodKey = (typeof MARKET_REPORT_PERIODS)[number]['value']

/** EARS-564: the last 12 months is the default. */
export const DEFAULT_MARKET_REPORT_PERIOD: MarketReportPeriodKey = '12m'

/** A query value the selector does not offer is not a choice the viewer made. */
export function parseMarketReportPeriod(value: string | null | undefined): MarketReportPeriodKey {
  return (
    MARKET_REPORT_PERIODS.find((period) => period.value === value)?.value ??
    DEFAULT_MARKET_REPORT_PERIOD
  )
}

function firstOfMonth(year: number, monthIndex: number): string {
  const date = new Date(Date.UTC(year, monthIndex, 1))
  return date.toISOString().slice(0, 10)
}

/**
 * The payment dates a period covers, ending today (Moscow) — so a payment
 * dated in the future is outside every period but «Всё время». «Последние 12
 * месяцев» is the current month and the eleven before it, whole: no month row
 * is a sliver of a month. The month table lists only the months that have
 * entries.
 */
export function marketReportPeriod(key: MarketReportPeriodKey, today: string): MarketPeriod {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  switch (key) {
    case 'month':
      return { from: firstOfMonth(year, month), to: today }
    case 'quarter':
      return { from: firstOfMonth(year, month - (month % 3)), to: today }
    case 'year':
      return { from: firstOfMonth(year, 0), to: today }
    case '12m':
      return { from: firstOfMonth(year, month - 11), to: today }
    case 'all':
      return {}
  }
}

// ── the allocation ───────────────────────────────────────────────────────────

/**
 * Integers that sum to `roundExact(Σ values)`, each its value rounded down or
 * up by one unit — down for all, then one more unit to each of the rows with
 * the largest remainders (ties to the earlier row), until the sum is reached.
 */
export function splitByLargestRemainder(values: readonly ExactAmount[]): bigint[] {
  const normalized = values.map(({ numerator, denominator }) =>
    denominator < 0n
      ? { numerator: -numerator, denominator: -denominator }
      : { numerator, denominator },
  )
  const floors = normalized.map(({ numerator, denominator }) => {
    const quotient = numerator / denominator
    // BigInt division truncates toward zero; a negative remainder needs one less.
    return numerator % denominator !== 0n && numerator < 0n ? quotient - 1n : quotient
  })
  const total = roundExact(normalized.reduce((sum, value) => addExact(sum, value), ZERO))
  let missing = total - floors.reduce((sum, floor) => sum + floor, 0n)
  const order = normalized
    .map((value, index) => ({
      index,
      remainder: {
        numerator: value.numerator - floors[index] * value.denominator,
        denominator: value.denominator,
      },
    }))
    .sort((a, b) => {
      const left = a.remainder.numerator * b.remainder.denominator
      const right = b.remainder.numerator * a.remainder.denominator
      return left === right ? a.index - b.index : left > right ? -1 : 1
    })
  const out = [...floors]
  for (const { index } of order) {
    if (missing <= 0n) break
    out[index] += 1n
    missing -= 1n
  }
  return out
}

const ZERO: ExactAmount = { numerator: 0n, denominator: 1n }

// ── the report ───────────────────────────────────────────────────────────────

/** Minimal units of one display currency, as strings; Факт = Рынок + Переплата. */
export type MarketReportFigures = {
  fact: string
  market: string
  overpayment: string
  /** Measured items this currency has no rate for on their date — «без курса: N» (EARS-566). */
  noDisplayRate: number
}

/** What every total, row and item says regardless of the display currency. */
export type MarketReportStats = {
  /** The weighted % of the rouble figures, in tenths (EARS-562); `null` when nothing is measured. */
  percentTenths: string | null
  /** «хуже рынка на X,X%» / «лучше рынка на X,X%» / «как на рынке», or «—». */
  wording: string
  measured: { payments: number; chains: number }
  /** «без курса: N» (EARS-560/564), by kind. */
  noRate: { payments: number; chains: number }
  /** «факт не внесён: N» (EARS-560/564). */
  notPosted: number
}

export type MarketReportItem = MarketReportStats & {
  key: string
  subject: 'payment' | 'chain'
  /** The intake item (a payment, linked to its request) or the operation (a chain). */
  id: number
  date: string
  payee: string | null
  route: string
  status: 'measured' | 'no_rate' | 'not_posted'
  /** The document amount of a payment; what left the source account for a chain. */
  amount: { amount: string; currency: string }
  /** What arrived on the target account (a chain only). */
  arrived: { amount: string; currency: string } | null
  /** Per display currency; `null` where the item is not measured or has no display rate. */
  figures: Record<string, { fact: string; market: string; overpayment: string } | null>
}

export type MarketReportRow = MarketReportStats & {
  key: string
  /** A month as `YYYY-MM`; a payee; or a chain's route. */
  label: string
  /** The payment route under a payee; `null` for a month or a chain row. */
  route: string | null
  kind: 'month' | 'payment' | 'chain'
  figures: Record<string, MarketReportFigures>
  items: MarketReportItem[]
}

export type MarketReport = {
  period: MarketPeriod
  total: MarketReportStats & {
    figures: Record<string, MarketReportFigures>
    /** Chains that could not be read as two ends — left out, counted (#559). */
    excludedChains: number
  }
  months: MarketReportRow[]
  payees: MarketReportRow[]
}

function stats(totals: MarketTotals): MarketReportStats {
  return {
    percentTenths: totals.overpayment?.percentTenths?.toString() ?? null,
    wording: totals.overpayment?.wording ?? '—',
    measured: totals.measured,
    noRate: totals.noRate,
    notPosted: totals.notPosted,
  }
}

type ExactFigures = { market: ExactAmount; overpayment: ExactAmount; noDisplayRate: number }

function exactFigures(
  entries: readonly MarketEntry[],
  currency: string,
  ctx: MarketContext,
): ExactFigures {
  let market = ZERO
  let overpayment = ZERO
  let noDisplayRate = 0
  for (const entry of entries) {
    if (entry.valuation.status !== 'measured') continue
    const converted = displayEntryExact(entry, currency, ctx)
    if (converted === null) {
      noDisplayRate += 1
      continue
    }
    market = addExact(market, converted.market)
    overpayment = addExact(overpayment, difference(converted.fact, converted.market))
  }
  return { market, overpayment, noDisplayRate }
}

function difference(a: ExactAmount, b: ExactAmount): ExactAmount {
  return addExact(a, { numerator: -b.numerator, denominator: b.denominator })
}

/** Рынок and Переплата as shown; Факт is their sum, so the three always agree. */
function figures(market: bigint, overpayment: bigint, noDisplayRate: number): MarketReportFigures {
  return {
    fact: (market + overpayment).toString(),
    market: market.toString(),
    overpayment: overpayment.toString(),
    noDisplayRate,
  }
}

function reportItem(
  entry: MarketEntry,
  currencies: readonly string[],
  ctx: MarketContext,
): MarketReportItem {
  const totals = aggregateMarket([entry])
  const itemFigures: MarketReportItem['figures'] = {}
  for (const currency of currencies) {
    const converted = displayEntryExact(entry, currency, ctx)
    if (converted === null) {
      itemFigures[currency] = null
      continue
    }
    const market = roundExact(converted.market)
    const overpayment = roundExact(difference(converted.fact, converted.market))
    itemFigures[currency] = {
      fact: (market + overpayment).toString(),
      market: market.toString(),
      overpayment: overpayment.toString(),
    }
  }
  const base = {
    ...stats(totals),
    date: entry.date,
    payee: entry.payee,
    route: entry.route,
    status: entry.valuation.status,
    figures: itemFigures,
  }
  if (entry.subject === 'payment') {
    return {
      ...base,
      key: `payment-${entry.itemId}`,
      subject: 'payment',
      id: entry.itemId,
      amount: { amount: entry.document.amount.toString(), currency: entry.document.currency },
      arrived: null,
    }
  }
  return {
    ...base,
    key: `chain-${entry.operationId}`,
    subject: 'chain',
    id: entry.operationId,
    amount: { amount: entry.source.amount.toString(), currency: entry.source.currency },
    arrived: { amount: entry.target.amount.toString(), currency: entry.target.currency },
  }
}

/** One table, its money columns allocated to the period total per currency. */
function table(
  entries: readonly MarketEntry[],
  by: 'month' | 'payee_route',
  currencies: readonly string[],
  ctx: MarketContext,
): MarketReportRow[] {
  const groups = groupMarket(entries, by)
  const rows: MarketReportRow[] = groups.map((group) => ({
    ...stats(group.totals),
    key: group.key,
    label: group.label,
    route: by === 'month' || group.payee === null ? null : group.route,
    kind: by === 'month' ? 'month' : group.payee === null ? 'chain' : 'payment',
    figures: {},
    items: group.entries.map((entry) => reportItem(entry, currencies, ctx)),
  }))
  for (const currency of currencies) {
    const exact = groups.map((group) => exactFigures(group.entries, currency, ctx))
    const markets = splitByLargestRemainder(exact.map((row) => row.market))
    const overpayments = splitByLargestRemainder(exact.map((row) => row.overpayment))
    rows.forEach((row, index) => {
      row.figures[currency] = figures(
        markets[index],
        overpayments[index],
        exact[index].noDisplayRate,
      )
    })
  }
  return rows
}

/**
 * The report of one period: the total (EARS-564), the month and payee / route
 * tables (EARS-565), each money figure in every `currencies` display currency
 * (EARS-566). `excludedChains` is what `loadMarketValuation` could not value.
 */
export function buildMarketReport(
  entries: readonly MarketEntry[],
  ctx: MarketContext,
  currencies: readonly string[],
  period: MarketPeriod,
  excludedChains = 0,
): MarketReport {
  const totalFigures: Record<string, MarketReportFigures> = {}
  for (const currency of currencies) {
    const exact = exactFigures(entries, currency, ctx)
    totalFigures[currency] = figures(
      roundExact(exact.market),
      roundExact(exact.overpayment),
      exact.noDisplayRate,
    )
  }
  return {
    period,
    total: { ...stats(aggregateMarket(entries)), figures: totalFigures, excludedChains },
    months: table(entries, 'month', currencies, ctx),
    payees: table(entries, 'payee_route', currencies, ctx),
  }
}
