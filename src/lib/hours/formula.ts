/**
 * Формула начисления (спека 081 пп. 2–6). Канон механики —
 * `bbm/outputs/2026-07-29-bbm-payout-mechanics.md` v5, раздел «Период —
 * диапазон дат»; он новее буквальной формулы ТЗ и явно описывает многомесячный
 * случай, поэтому реализуется он.
 *
 * Единое правило любого периода:
 *   ставка часа месяца m = месячная ÷ (будни ПОЛНОГО месяца m × 8);
 *   часы периода распределяются по месяцам пропорционально норме пересечения
 *   периода с месяцем (будни пересечения × 8);
 *   эффективная часовая периода = Σ доля-нормы_m × ставка-часа_m — от часов не
 *   зависит, показывается на странице.
 *
 * Частные случаи, проверенные тестами:
 *   - период из целых месяцев ⇒ совпадает с «месячная ÷ (будни периода × 8)»;
 *   - период короче месяца ⇒ ставка того же месяца (фуллтайм половины месяца
 *     даёт половину месячной, а не целую);
 *   - май–июнь фуллтайма ⇒ две месячные, а не одна.
 */

import { countCalendarDays, countWeekdays, monthLabel, monthSegments } from './calendar'

/** Норма будня — 8 часов (п.1). */
export const HOURS_PER_WEEKDAY = 8

/** Рабочих будней в неделе — множитель вкладки «средняя неделя» (п.20). */
export const WEEKDAYS_PER_WEEK = 5

/** Физический потолок часов в календарных сутках (п.21). */
const HOURS_PER_CALENDAR_DAY = 24

/** Помесячная разбивка периода — то, что страница показывает «честно» (п.20). */
export interface PeriodMonthBreakdown {
  year: number
  month: number
  /** «май 2026». */
  label: string
  from: string
  to: string
  /** Будни полного календарного месяца — знаменатель ставки часа месяца. */
  weekdaysInMonth: number
  /** Будни пересечения периода с месяцем. */
  weekdaysInPeriod: number
  /** Норма полного месяца в часах (будни месяца × 8). */
  monthNormHours: number
  /** Норма пересечения в часах (будни пересечения × 8). */
  normHours: number
  /** Доля нормы периода, приходящаяся на этот месяц (Σ = 1). */
  shareOfNorm: number
}

/** Календарь периода: всё, что не зависит ни от участника, ни от его часов. */
export interface PeriodCalendar {
  dateFrom: string
  dateTo: string
  /** Будни (Пн–Пт) периода. */
  weekdayCount: number
  /** Календарные дни периода (включительно). */
  calendarDays: number
  /** Норма периода в часах (будни × 8). */
  normHours: number
  /** False ⇒ ставки нет и период не должен существовать (п.24). */
  hasWeekdays: boolean
  /** Множитель вкладки «средняя неделя»: будни ÷ 5, без округления. */
  weekMultiplier: number
  /** Множитель вкладки «свой день»: будни периода. */
  dayMultiplier: number
  months: PeriodMonthBreakdown[]
}

/** Описывает календарь периода по ISO-датам (обе границы включительно). */
export function describePeriod(dateFrom: string, dateTo: string): PeriodCalendar {
  const weekdayCount = countWeekdays(dateFrom, dateTo)
  const normHours = weekdayCount * HOURS_PER_WEEKDAY
  const segments = monthSegments(dateFrom, dateTo)
  const months: PeriodMonthBreakdown[] = segments.map((segment) => {
    const monthNormHours = segment.weekdaysInMonth * HOURS_PER_WEEKDAY
    const segmentNormHours = segment.weekdaysInSegment * HOURS_PER_WEEKDAY
    return {
      year: segment.year,
      month: segment.month,
      label: monthLabel(segment.year, segment.month),
      from: segment.from,
      to: segment.to,
      weekdaysInMonth: segment.weekdaysInMonth,
      weekdaysInPeriod: segment.weekdaysInSegment,
      monthNormHours,
      normHours: segmentNormHours,
      shareOfNorm: normHours > 0 ? segmentNormHours / normHours : 0,
    }
  })

  return {
    dateFrom,
    dateTo,
    weekdayCount,
    calendarDays: countCalendarDays(dateFrom, dateTo),
    normHours,
    hasWeekdays: weekdayCount > 0,
    weekMultiplier: weekdayCount / WEEKDAYS_PER_WEEK,
    dayMultiplier: weekdayCount,
    months,
  }
}

/**
 * Ставка часа календарного месяца — месячная ÷ норма полного месяца.
 * НЕ округляется (п.6): округление живёт только в отображении.
 */
export function monthlyHourlyRate(
  monthlyRate: number | null | undefined,
  monthNormHours: number,
): number | null {
  if (monthlyRate == null || !Number.isFinite(monthlyRate) || monthlyRate <= 0) return null
  if (!Number.isFinite(monthNormHours) || monthNormHours <= 0) return null
  return monthlyRate / monthNormHours
}

/**
 * Эффективная часовая ставка периода: Σ доля-нормы_m × ставка-часа_m.
 * `null`, когда денег быть не может — нет ставки участника (п.9) или в периоде
 * нет будних дней (п.24).
 */
export function effectiveHourlyRate(
  monthlyRate: number | null | undefined,
  period: PeriodCalendar,
): number | null {
  if (monthlyRate == null || !Number.isFinite(monthlyRate) || monthlyRate <= 0) return null
  if (!period.hasWeekdays) return null
  let rate = 0
  for (const month of period.months) {
    const monthRate = monthlyHourlyRate(monthlyRate, month.monthNormHours)
    if (monthRate == null) continue // месяц без будней не даёт ни нормы, ни доли
    rate += month.shareOfNorm * monthRate
  }
  return rate > 0 ? rate : null
}

/**
 * Начисление = round(часы × эффективная часовая) — округляется ПРОИЗВЕДЕНИЕ,
 * не ставка (п.6): 200 000 ÷ 184 × 160 = 173 913 ₽, а не 1 087 × 160 = 173 920.
 */
export function computeAccrual(hours: number, effectiveHourly: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(effectiveHourly)) return 0
  return Math.round(hours * effectiveHourly)
}

/**
 * Сплит по номиналу (п.5): доинвестиция округляется, деньги — остаток. Так
 * `cash + invest` всегда в точности равно начислению.
 */
export function computeSplit(
  accrual: number,
  splitPercent: number,
): { cash: number; invest: number } {
  const invest = Math.round((accrual * splitPercent) / 100)
  return { invest, cash: accrual - invest }
}

/** Серверный потолок заявленных часов: календарные дни периода × 24 (п.21). */
export function maxDeclarableHours(period: PeriodCalendar): number {
  return period.calendarDays * HOURS_PER_CALENDAR_DAY
}

/** Потолок ползунков в UI: будни × 12 — точное значение вводится числом (п.21). */
export function sliderMaxHours(period: PeriodCalendar): number {
  return Math.max(period.weekdayCount * 12, 1)
}
