/**
 * Display helpers of the budget dashboard (spec 584, #586): how a figure the
 * module computed is written on screen. Nothing here computes a figure
 * (EARS-702) — it formats minor units, names withheld currencies and turns a
 * figure into a chart coordinate.
 */
import type { BudgetFigure } from '@/lib/finance'

const SIGN: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' }

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** «1 234 567 ₽», with kopecks only when `cents` is asked and they are not zero. */
export function formatMoney(
  amount: bigint,
  currency: string,
  precision: number,
  options: { cents?: boolean } = {},
): string {
  const negative = amount < 0n
  const digits = (negative ? -amount : amount).toString().padStart(precision + 1, '0')
  const integer = precision === 0 ? digits : digits.slice(0, -precision)
  const fraction = precision === 0 ? '' : digits.slice(-precision)
  const showFraction = options.cents === true && precision > 0 && /[1-9]/.test(fraction)
  const sign = SIGN[currency] ?? currency
  return `${negative ? '−' : ''}${groupDigits(integer)}${showFraction ? `,${fraction}` : ''} ${sign}`
}

export type FigureText = { text: string; withheld: boolean }

/** EARS-720 — a withheld figure shows no number and names its currencies. */
export function figureText(
  figure: BudgetFigure | null,
  currency: string,
  precision: number,
  options: { cents?: boolean } = {},
): FigureText {
  if (figure === null) return { text: '—', withheld: true }
  if (figure.status === 'withheld') {
    if (figure.noRateOn !== undefined && figure.noRateOn.length > 0) {
      const [first, ...rest] = figure.noRateOn
      const more = rest.length === 0 ? '' : ` и ещё ${rest.length} ${datesWord(rest.length)}`
      return { text: `нет курса ЦБ на ${longDate(first!)}${more}`, withheld: true }
    }
    return { text: `не посчитано: ${figure.currencies.join(', ')}`, withheld: true }
  }
  return { text: formatMoney(figure.amount, currency, precision, options), withheld: false }
}

function datesWord(n: number): string {
  const tens = n % 100
  const ones = n % 10
  if (tens >= 11 && tens <= 14) return 'дат'
  if (ones === 1) return 'дата'
  if (ones >= 2 && ones <= 4) return 'даты'
  return 'дат'
}

/** EARS-722 item 4 — a relation's difference as shown, with its sign. */
export function differenceText(amount: bigint, currency: string, precision: number): string {
  const text = formatMoney(amount, currency, precision, { cents: true })
  return amount > 0n ? `+${text}` : text
}

/** A figure as a number of whole currency units for chart geometry; null while withheld. */
export function figureValue(figure: BudgetFigure, precision: number): number | null {
  if (figure.status !== 'known') return null
  return Number(figure.amount) / 10 ** precision
}

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]
const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

/** `2026-03` → «мар». */
export function monthShort(month: string): string {
  return MONTHS_SHORT[Number(month.slice(5, 7)) - 1] ?? month
}

/** `2026-03-01` → «1 марта 2026». */
export function longDate(iso: string): string {
  const month = MONTHS_GENITIVE[Number(iso.slice(5, 7)) - 1] ?? ''
  return `${Number(iso.slice(8, 10))} ${month} ${iso.slice(0, 4)}`
}

/** Axis ticks: «1,2 млн», «350 тыс.», «0». */
export function compactNumber(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)} млн`
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)} тыс.`
  return `${sign}${trim(abs)}`
}

function trim(value: number): string {
  return (Math.round(value * 10) / 10).toString().replace('.', ',')
}

/** «Nice» axis ticks covering `[min, max]`, zero included when the range spans it. */
export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1
  const raw = span / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Math.round(t / step) * step)
  return ticks
}

/**
 * EARS-724 — the limit as typed («1 000 000», «1000000,50») into minor units of
 * a currency with `precision` decimals; null when it is not a positive decimal
 * no finer than that precision.
 */
export function parseLimitAmount(text: string, precision: number): bigint | null {
  const compact = text.replace(/[\s\u00a0]/g, '').replace(',', '.')
  const match = /^(\d+)(?:\.(\d+))?$/.exec(compact)
  if (match === null) return null
  const fraction = match[2] ?? ''
  if (fraction.length > precision) return null
  const minor = BigInt(match[1]! + fraction.padEnd(precision, '0'))
  return minor > 0n ? minor : null
}

/** Minor units back into the form's text, for the edit form's prefill. */
export function limitText(amount: bigint, precision: number): string {
  const digits = amount.toString().padStart(precision + 1, '0')
  if (precision === 0) return digits
  const fraction = digits.slice(-precision)
  return /[1-9]/.test(fraction)
    ? `${digits.slice(0, -precision)},${fraction}`
    : digits.slice(0, -precision)
}

/**
 * The page's own query (EARS-721): period and reporting currency travel in the
 * URL, each omitted at the value the page reads when it is absent — «С начала
 * бюджета» and RUB (`parseBudgetDisplayCurrency`; when RUB is unavailable its
 * segment is inert, so every linked currency other than RUB is written out).
 */
export function budgetHref(period: string, currency: string): string {
  const params = new URLSearchParams()
  if (period !== 'all') params.set('period', period)
  if (currency !== 'RUB') params.set('currency', currency)
  const query = params.toString()
  return query === '' ? '?' : `?${query}`
}

/** «₽ RUB» — the reporting-currency segment, after `design-source/finance/BudgetDashboard.html`. */
export function segmentLabel(currency: string): string {
  const sign = SIGN[currency]
  return sign === undefined ? currency : `${sign} ${currency}`
}
