import type { MarketReportStats } from '@/lib/finance/fx/market-report'

import type { DisplayCurrencyCode } from '../../requests/request-board-contract'
import { formatDisplayMoney } from '../../requests/request-queue-model'

/**
 * The words and numbers of «Курс против рынка» (spec 339 §J, EARS-564…566;
 * issue #559), as pure functions the screen and its test share. The money
 * format is the requests queue's (#550) — one rule for an amount on every
 * finance screen, so the same sum reads the same here and there.
 */

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

/** `2026-11` → «Ноябрь 2026». */
export function monthLabel(month: string): string {
  const name = MONTHS[Number(month.slice(5, 7)) - 1]
  return name === undefined ? month : `${name} ${month.slice(0, 4)}`
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/**
 * EARS-559: Переплата is the amount WITH its sign — the words carry the
 * direction, the sign keeps the column honest.
 */
export function formatOverpayment(minor: string, currency: DisplayCurrencyCode): string {
  const value = BigInt(minor)
  return `${value > 0n ? '+' : ''}${formatDisplayMoney(value, currency)}`
}

export function formatMoney(minor: string, currency: DisplayCurrencyCode): string {
  return formatDisplayMoney(BigInt(minor), currency)
}

/**
 * The period's headline (EARS-559/564): a positive or zero sum is «Переплата»
 * with its sign; a negative one reads «Экономия» with the amount unsigned —
 * the badge beside it still says «лучше рынка на X,X%» (review of #563).
 */
export function headline(
  minor: string,
  currency: DisplayCurrencyCode,
): { label: 'Переплата' | 'Экономия'; amount: string } {
  const value = BigInt(minor)
  return value < 0n
    ? { label: 'Экономия', amount: formatDisplayMoney(-value, currency) }
    : { label: 'Переплата', amount: formatOverpayment(minor, currency) }
}

/**
 * Whether a total or a row has a sum to show in this display currency: some
 * item measured and converted. Otherwise every sum reads «—», never a 0 that
 * reads as a result (EARS-560's «never a silent zero»).
 */
export function hasSum(
  stats: Pick<MarketReportStats, 'measured'>,
  figures: { noDisplayRate: number },
): boolean {
  return stats.measured.payments + stats.measured.chains - figures.noDisplayRate > 0
}

/** «Гончаров А. В.» keeps its initials together: a name breaks only between words. */
export function keepInitialsTogether(name: string): string {
  return name.replace(/(\p{L}\.) (?=\p{L}\.)/gu, '$1\u00a0')
}

/** «3 платежа · 1 конвертация» — what a total is made of (EARS-564). */
export function measuredLabel(measured: MarketReportStats['measured']): string {
  const parts: string[] = []
  if (measured.payments > 0) {
    parts.push(`${measured.payments} ${plural(measured.payments, 'платёж', 'платежа', 'платежей')}`)
  }
  if (measured.chains > 0) {
    parts.push(
      `${measured.chains} ${plural(measured.chains, 'конвертация', 'конвертации', 'конвертаций')}`,
    )
  }
  return parts.length === 0 ? 'ничего не измерено' : parts.join(' · ')
}

/**
 * EARS-560/564/566: what is counted and NOT summed — «без курса: N»,
 * «факт не внесён: N», the items the display currency has no rate for, and a
 * chain the ledger shape does not let us read. Nothing when there is nothing.
 */
export function leftOutNotes(
  stats: MarketReportStats,
  noDisplayRate: number,
  currency: DisplayCurrencyCode,
  excludedChains = 0,
): string[] {
  const notes: string[] = []
  const noRate = stats.noRate.payments + stats.noRate.chains
  if (noRate > 0) notes.push(`без курса: ${noRate}`)
  if (stats.notPosted > 0) notes.push(`факт не внесён: ${stats.notPosted}`)
  if (noDisplayRate > 0 && currency !== 'RUB') {
    notes.push(`без курса в ${currency}: ${noDisplayRate}`)
  }
  if (excludedChains > 0) notes.push(`не учтено конвертаций: ${excludedChains}`)
  return notes
}

/** Which kit badge a direction reads in: worse than the market is the warning. */
export function wordingVariant(percentTenths: string | null): 'destructive' | 'secondary' {
  return percentTenths !== null && BigInt(percentTenths) > 0n ? 'destructive' : 'secondary'
}

/** EARS-565: a payment links to its request on the requests screen. */
export function requestHref(itemId: number): string {
  return `/p/finance/requests?request=${itemId}`
}

/** The report's own address for a period choice. */
export function periodHref(period: string): string {
  return `/p/finance/reports/market-rate?period=${encodeURIComponent(period)}`
}
