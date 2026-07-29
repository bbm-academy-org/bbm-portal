/**
 * Форматирование чисел модуля часов. Отдельный модуль, потому что округление
 * ставок допустимо ТОЛЬКО при отображении (спека 081 п.6) — в расчётах ставки
 * остаются float'ами, и смешивать эти две вещи в одном месте нельзя.
 *
 * Разряды разделяются неразрывным пробелом (как в прототипе владельца), чтобы
 * «173 913 ₽» никогда не разрывалось переносом строки.
 */

const NBSP = ' '

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Целое с разрядами: 173913 → «173 913». */
export function formatInt(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** Деньги: «173 913 ₽». */
export function formatRub(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return `${formatInt(value)}${NBSP}₽`
}

/** Часы с одним знаком после запятой: «163,3». */
export function formatHours(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return (Math.round(value * 10) / 10).toString().replace('.', ',')
}

/** Множитель недель периода — тот же один знак: «4,6». */
export function formatWeeks(value: number | null | undefined): string {
  return formatHours(value)
}

/** Целые проценты сплита: «30%». */
export function formatPercent(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return `${Math.round(value)}%`
}
