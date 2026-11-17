/**
 * Pure arithmetic over Bank of Russia rates (spec
 * `docs/specs/339-ledger-intake.md` §I, EARS-550/552; issue #548).
 *
 * A rate is «`valueRub` roubles per `nominal` units», with `valueRub` exact
 * decimal text. Every cross goes through RUB (EARS-550): an amount in A becomes
 * roubles at A's quote and then B at B's quote, as ONE exact fraction of
 * bigints, rounded once — and the unrounded fraction is returned beside the
 * rounded amount, so a caller summing several conversions rounds the SUM, not
 * each term (EARS-549). No JS `number` touches an amount; `nominal` is a small
 * integer and is lifted to bigint before it multiplies anything.
 */

/** One stored quote: on `rateDate`, `nominal` units of `currency` cost `valueRub` ₽. */
export type FxRate = { currency: string; rateDate: string; nominal: number; valueRub: string }

/** What a conversion needs of a quote; a full `FxRate` is one. */
export type RubQuote = Pick<FxRate, 'nominal' | 'valueRub'> & Partial<FxRate>

/** The rouble priced in roubles — RUB needs no CBR quote; it is the cross currency. */
export const RUB_RATE = { currency: 'RUB', nominal: 1, valueRub: '1' } as const

/** An exact amount in the target's minimal units: `numerator / denominator`. */
export type ExactAmount = { numerator: bigint; denominator: bigint }

/** A display conversion: the amount rounded once, and the exact value it came from. */
export type ConvertedAmount = { amount: bigint; exact: ExactAmount }

const DECIMAL = /^[0-9]+(\.[0-9]+)?$/

/** `"82.1516"` → `{ value: 821516n, scale: 4 }`. */
function parseDecimal(text: string): { value: bigint; scale: number } {
  if (!DECIMAL.test(text)) throw new Error(`fx: «${text}» is not a decimal rate`)
  const [whole, fraction = ''] = text.split('.')
  const value = BigInt(whole + fraction)
  if (value === 0n) throw new Error(`fx: a zero rate «${text}» converts nothing`)
  return { value, scale: fraction.length }
}

/** Divide rounding half away from zero — the rounding the ledger side uses (`core/money.ts`). */
export function roundExact({ numerator, denominator }: ExactAmount): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const quotient = (2n * n + d) / (2n * d)
  return negative ? -quotient : quotient
}

/**
 * Convert `amount` (minimal units of `from`) into `to`'s minimal units through
 * RUB at the two quotes given.
 *
 *   amountTo = amount × (vF / 10^sF / nF) / (vT / 10^sT / nT) × 10^(pT − pF)
 */
export function convertAtRubRates(
  amount: bigint,
  from: RubQuote,
  to: RubQuote,
  precisionFrom: number,
  precisionTo: number,
): ConvertedAmount {
  const f = parseDecimal(from.valueRub)
  const t = parseDecimal(to.valueRub)
  const numerator =
    amount * f.value * 10n ** BigInt(t.scale) * BigInt(to.nominal) * 10n ** BigInt(precisionTo)
  const denominator =
    t.value * 10n ** BigInt(f.scale) * BigInt(from.nominal) * 10n ** BigInt(precisionFrom)
  const exact = { numerator, denominator }
  return { amount: roundExact(exact), exact }
}

/**
 * The latest quote of `currency` whose effective date is on or before `date`
 * (EARS-552) — or `null` when CBR does not quote it or the date precedes the
 * series. RUB answers with the identity quote on any date.
 */
export function pickRateOn(
  series: readonly FxRate[],
  currency: string,
  date: string,
): FxRate | null {
  if (currency === 'RUB') return { ...RUB_RATE, rateDate: date }
  let best: FxRate | null = null
  for (const rate of series) {
    if (rate.currency !== currency || rate.rateDate > date) continue
    if (best === null || rate.rateDate > best.rateDate) best = rate
  }
  return best
}

const MOSCOW_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's calendar date in Moscow, `YYYY-MM-DD` — the date CBR's day turns on. */
export function moscowToday(now: Date = new Date()): string {
  return MOSCOW_DATE.format(now)
}

/** `date` + `days` calendar days, ISO in and out (UTC arithmetic on a date-only value). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
