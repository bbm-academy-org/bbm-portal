/**
 * Форматирование чисел модуля финмодели.
 *
 * Две функции повторяют `src/lib/hours/format.ts` намеренно, а не импортируются
 * оттуда: модульные границы (ADR-002, `.dependency-cruiser.cjs`) запрещают
 * модулю тянуть внутренности соседнего модуля, а ради двух строк заводить
 * общий `src/lib/platform` слой дороже, чем держать копию. Если копий станет
 * три — это сигнал, что общий слой пора завести.
 *
 * Округление допустимо ТОЛЬКО при отображении: в расчётах (`formula.ts`) доли
 * остаются числами с плавающей точкой, и смешивать эти две вещи нельзя.
 */

// Записан escape-последовательностью, а не символом: неразрывный пробел
// визуально неотличим от обычного, и «поправленная» копипастой строка сломала
// бы вёрстку молча.
const NBSP = '\u00A0'

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Целое с разрядами: 9500000 → «9 500 000». Разряды неразрывные. */
export function formatInt(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** Деньги: «9 500 000 ₽». Знак рубля тоже отделён неразрывным пробелом. */
export function formatRub(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return `${formatInt(value)}${NBSP}₽`
}

/** Целые проценты: «5%». */
export function formatPercent(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return `${Math.round(value)}%`
}

/** Доля распределения в привычной модели записи: 4 → «4x». */
export function formatShare(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return `${Math.round(value)}x`
}
