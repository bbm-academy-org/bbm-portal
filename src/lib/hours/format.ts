/**
 * Форматирование чисел модуля часов. Отдельный модуль, потому что округление
 * ставок допустимо ТОЛЬКО при отображении (спека 081 п.6) — в расчётах ставки
 * остаются float'ами, и смешивать эти две вещи в одном месте нельзя.
 *
 * Разряды разделяются неразрывным пробелом (как в прототипе владельца), чтобы
 * «173 913 ₽» никогда не разрывалось переносом строки.
 */

import type { AssessmentMethod } from './types'

const NBSP = ' '

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Подписи способов оценки — вкладки калькулятора (спека 081 п.20). Живут в
 * домене, а не во вью: их читают и сводка, и карточка сохранения, и они же
 * расшифровывают поле `method` выгруженного JSON для рассылки (п.26).
 */
export const METHOD_LABELS: Record<AssessmentMethod, string> = {
  period: 'по часам за период',
  week: 'по средней неделе',
  day: 'по рабочему дню',
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

/**
 * Русское словоизменение по числу: `one` — 1, 21, 101; `few` — 2–4, 22–24;
 * `many` — 0, 5–20, 11–14 в любой сотне.
 *
 * Общая функция, а не четвёртая копия правила: тот же алгоритм нужен и числу
 * будней, и числу часов, и числу пересчитанных оценок в предупреждениях домена
 * (`document.ts`). Копия этого правила в доменном модуле мутаций уже стоила
 * ошибки «заявлено в 1 оценка» — ревью PR #86.
 *
 * Падеж выбирает ВЫЗЫВАЮЩИЙ, передавая три готовые формы: «1 оценка» и «в 1
 * оценке» — разные позиции, и одна функция «на все случаи» здесь невозможна.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.round(count))
  const lastTwo = n % 100
  const last = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

/**
 * «23 будних дня» / «21 будний день» / «25 будних дней» — число будней владелец
 * читает на каждой странице, и «23 будних дней» там смотрелось бы опечаткой.
 */
export function formatWeekdayCount(value: number): string {
  const n = Math.abs(Math.round(value))
  return `${n} ${plural(n, 'будний день', 'будних дня', 'будних дней')}`
}

/** «24 часа» / «160 часов» / «1 час» — потолок часов и его нарушения (п.21). */
export function formatHoursCount(value: number): string {
  const n = Math.abs(Math.round(value))
  return `${n} ${plural(n, 'час', 'часа', 'часов')}`
}

/**
 * ISO-дата в привычный вид: «2026-07-01» → «01.07.2026». Как и календарь,
 * работает над строкой: `new Date` сдвинул бы дату в отрицательных смещениях.
 */
export function formatIsoDate(value: unknown): string {
  if (typeof value !== 'string') return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—'
}

/**
 * Момент сохранения: «2026-08-01T09:00:00.000Z» → «01.08.2026 09:00 UTC».
 * Зона названа явно — иначе непонятно, чьё это время (прод в UTC, владелец в MSK).
 */
export function formatSavedAt(value: unknown): string {
  if (typeof value !== 'string') return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return formatIsoDate(value)
  return `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]} UTC`
}
