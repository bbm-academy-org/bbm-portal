/**
 * Календарь будних дней для модуля «Калькулятор самооценки часов»
 * (спека 081 п.1).
 *
 * Будни — Пн–Пт реального календаря; праздники НЕ вычитаются, производственные
 * календари не используются (команда живёт в разных странах — решение
 * владельца). Никаких усреднений «÷160» / «×4 недели».
 *
 * Вся арифметика — над ISO-строкой `YYYY-MM-DD` через days-from-civil
 * (алгоритм Говарда Хиннанта), БЕЗ `Date`-парсинга и таймзон: одна и та же
 * строка обязана давать один и тот же день недели на проде (UTC) и на машине
 * владельца (MSK). `new Date('2026-07-01')` трактуется как UTC-полночь и в
 * отрицательных смещениях «уезжает» на предыдущий день — здесь такой поверхности
 * просто нет.
 */

/** Разобранная ISO-дата. */
export interface IsoDateParts {
  year: number
  month: number
  day: number
}

/** Пересечение периода с одним календарным месяцем (п.2 — помесячный расчёт). */
export interface MonthSegment {
  year: number
  /** 1–12. */
  month: number
  /** Первый день пересечения (ISO). */
  from: string
  /** Последний день пересечения (ISO). */
  to: string
  /** Будни ПОЛНОГО календарного месяца — знаменатель месячной ставки. */
  weekdaysInMonth: number
  /** Будни пересечения периода с месяцем — доля нормы. */
  weekdaysInSegment: number
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]

/** Високосный год по григорианскому правилу. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Число дней в календарном месяце (месяц 1–12). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** Разбирает `YYYY-MM-DD`; `null`, если строка не является существующей датой. */
export function parseIsoDate(value: unknown): IsoDateParts | null {
  if (typeof value !== 'string') return null
  const match = ISO_DATE_RE.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

/** True, если строка — существующая дата в формате `YYYY-MM-DD`. */
export function isValidIsoDate(value: unknown): boolean {
  return parseIsoDate(value) !== null
}

/** Собирает ISO-строку из компонентов (нули слева). */
export function toIsoDate({ year, month, day }: IsoDateParts): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Число дней от 1970-01-01 (days_from_civil). Работает и для дат до эпохи;
 * целочисленная арифметика, без `Date`.
 */
export function dayNumber(parts: IsoDateParts): number {
  const { month, day } = parts
  const y = parts.year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400 // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1 // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy // [0, 146096]
  return era * 146097 + doe - 719468
}

/** День недели ISO-даты: 0 — воскресенье, 1 — понедельник … 6 — суббота. */
export function isoDayOfWeek(value: string): number {
  const parts = parseIsoDate(value)
  if (!parts) throw new Error(`Некорректная ISO-дата: ${value}`)
  // 1970-01-01 — четверг, отсюда сдвиг +4.
  return (((dayNumber(parts) + 4) % 7) + 7) % 7
}

/** True, если дата — будний день (Пн–Пт). */
export function isWeekday(value: string): boolean {
  const dow = isoDayOfWeek(value)
  return dow >= 1 && dow <= 5
}

/**
 * Календарные дни в диапазоне ВКЛЮЧИТЕЛЬНО. Перевёрнутый диапазон — 0
 * (валидация `date_from ≤ date_to` живёт в админке, п.24).
 */
export function countCalendarDays(from: string, to: string): number {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  if (!a || !b) return 0
  const days = dayNumber(b) - dayNumber(a) + 1
  return days > 0 ? days : 0
}

/**
 * Будни (Пн–Пт) в диапазоне ВКЛЮЧИТЕЛЬНО, замкнутой формулой: полные недели
 * дают ровно 5 будней, остаток добирается от дня недели первой даты.
 */
export function countWeekdays(from: string, to: string): number {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  if (!a || !b) return 0
  const start = dayNumber(a)
  const end = dayNumber(b)
  const total = end - start + 1
  if (total <= 0) return 0
  let count = Math.floor(total / 7) * 5
  const rest = total % 7
  const firstDow = (((start + 4) % 7) + 7) % 7
  for (let i = 0; i < rest; i += 1) {
    const dow = (firstDow + i) % 7
    if (dow >= 1 && dow <= 5) count += 1
  }
  return count
}

/**
 * Режет период на пересечения с календарными месяцами (п.2). Для каждого месяца
 * отдаёт и норму полного месяца (знаменатель ставки часа), и норму пересечения
 * (доля периода) — этого достаточно и для периода из целых месяцев, и для
 * частичного.
 */
export function monthSegments(from: string, to: string): MonthSegment[] {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  if (!a || !b) return []
  if (dayNumber(b) < dayNumber(a)) return []

  const segments: MonthSegment[] = []
  let year = a.year
  let month = a.month
  for (;;) {
    const lastDay = daysInMonth(year, month)
    const monthFrom = toIsoDate({ year, month, day: 1 })
    const monthTo = toIsoDate({ year, month, day: lastDay })
    const segFrom = year === a.year && month === a.month ? from : monthFrom
    const segTo = year === b.year && month === b.month ? to : monthTo
    segments.push({
      year,
      month,
      from: segFrom,
      to: segTo,
      weekdaysInMonth: countWeekdays(monthFrom, monthTo),
      weekdaysInSegment: countWeekdays(segFrom, segTo),
    })
    if (year === b.year && month === b.month) break
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return segments
}

/** Человеческое имя месяца: «май 2026». */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}
