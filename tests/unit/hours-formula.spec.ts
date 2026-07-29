import { describe, expect, it } from 'vitest'

import {
  computeAccrual,
  computeSplit,
  describePeriod,
  effectiveHourlyRate,
  maxDeclarableHours,
  monthlyHourlyRate,
} from '@/lib/hours/formula'

/**
 * Формула начисления (спека 081 пп. 2–6) — помесячный канон
 * `bbm/outputs/2026-07-29-bbm-payout-mechanics.md` v5.
 *
 * Ставка часа месяца m = месячная ÷ (будни ПОЛНОГО месяца m × 8); часы периода
 * распределяются по месяцам пропорционально норме пересечения; эффективная
 * часовая периода = Σ доля-нормы × ставка-часа-месяца и от часов НЕ зависит.
 *
 * Порядок округления (п.6, единственный допустимый): ставки в расчётах не
 * округляются; accrual = round(hours × eff); invest = round(accrual × pct/100);
 * cash = accrual − invest.
 */

const MONTHLY = 200_000

describe('describePeriod', () => {
  it('июль 2026: 23 будня, 184 ч нормы, 31 календарный день', () => {
    const period = describePeriod('2026-07-01', '2026-07-31')
    expect(period.weekdayCount).toBe(23)
    expect(period.normHours).toBe(184)
    expect(period.calendarDays).toBe(31)
    expect(period.months).toHaveLength(1)
  })

  it('множители вкладок считаются от реального периода (п.20)', () => {
    const july = describePeriod('2026-07-01', '2026-07-31')
    // недели = будни ÷ 5, без округления
    expect(july.weekMultiplier).toBeCloseTo(4.6, 10)
    // дни = будни периода
    expect(july.dayMultiplier).toBe(23)
  })

  it('май–июнь 2026: 43 будня, 344 ч, две помесячные доли', () => {
    const period = describePeriod('2026-05-01', '2026-06-30')
    expect(period.weekdayCount).toBe(43)
    expect(period.normHours).toBe(344)
    expect(period.months.map((m) => m.label)).toEqual(['май 2026', 'июнь 2026'])
    expect(period.months[0].normHours).toBe(168)
    expect(period.months[1].normHours).toBe(176)
    // доли нормы суммируются в единицу
    expect(period.months[0].shareOfNorm + period.months[1].shareOfNorm).toBeCloseTo(1, 12)
  })

  it('период без будней описывается, но нормы не имеет', () => {
    const period = describePeriod('2026-07-04', '2026-07-05') // сб–вс
    expect(period.weekdayCount).toBe(0)
    expect(period.normHours).toBe(0)
    expect(period.calendarDays).toBe(2)
    expect(period.hasWeekdays).toBe(false)
  })

  it('частичный месяц: норма месяца и норма пересечения различаются', () => {
    const period = describePeriod('2026-07-01', '2026-07-15')
    expect(period.weekdayCount).toBe(11)
    expect(period.normHours).toBe(88)
    expect(period.months[0].monthNormHours).toBe(184)
    expect(period.months[0].normHours).toBe(88)
    expect(period.months[0].shareOfNorm).toBeCloseTo(1, 12)
  })
})

describe('monthlyHourlyRate', () => {
  it('ставка часа месяца = месячная ÷ (будни полного месяца × 8), без округления', () => {
    expect(monthlyHourlyRate(MONTHLY, 184)).toBeCloseTo(1086.9565217391305, 9)
    expect(monthlyHourlyRate(MONTHLY, 168)).toBeCloseTo(1190.4761904761904, 9)
    expect(monthlyHourlyRate(MONTHLY, 176)).toBeCloseTo(1136.3636363636363, 9)
  })

  it('нулевая норма не делит на ноль', () => {
    expect(monthlyHourlyRate(MONTHLY, 0)).toBeNull()
  })
})

describe('effectiveHourlyRate', () => {
  it('июль 2026 при 200 000 ₽/мес ≈ 1 087 ₽/ч (сценарий 3)', () => {
    const period = describePeriod('2026-07-01', '2026-07-31')
    const eff = effectiveHourlyRate(MONTHLY, period)!
    expect(eff).toBeCloseTo(200_000 / 184, 9)
    expect(Math.round(eff)).toBe(1087)
  })

  it('май–июнь 2026 даёт эффективную ≈ 1 163 ₽/ч, а не 581 (сценарий 4)', () => {
    const period = describePeriod('2026-05-01', '2026-06-30')
    const eff = effectiveHourlyRate(MONTHLY, period)!
    // Σ доля-нормы × ставка-часа-месяца = (2 × месячная) ÷ норма периода
    expect(eff).toBeCloseTo(400_000 / 344, 9)
    expect(Math.round(eff)).toBe(1163)
    // буквальное прочтение ТЗ «месячная ÷ (будни периода × 8)» дало бы это —
    // канон v5 его отменяет
    expect(Math.round(eff)).not.toBe(Math.round(MONTHLY / 344))
  })

  it('для периода из целых месяцев совпадает с буквальной формулой ТЗ (частный случай)', () => {
    const july = describePeriod('2026-07-01', '2026-07-31')
    expect(effectiveHourlyRate(MONTHLY, july)).toBeCloseTo(MONTHLY / (23 * 8), 9)
  })

  it('период короче месяца даёт ставку того же месяца (фуллтайм половины = половина месячной)', () => {
    const half = describePeriod('2026-07-01', '2026-07-15')
    const eff = effectiveHourlyRate(MONTHLY, half)!
    expect(eff).toBeCloseTo(MONTHLY / 184, 9)
    expect(computeAccrual(88, eff)).toBe(Math.round((MONTHLY * 88) / 184))
  })

  it('от заявленных часов не зависит (это ставка, а не начисление)', () => {
    const period = describePeriod('2026-05-01', '2026-06-30')
    const eff = effectiveHourlyRate(MONTHLY, period)
    expect(eff).toBe(effectiveHourlyRate(MONTHLY, period))
  })

  it('период без будней — ставки нет (деление на ноль не происходит)', () => {
    const period = describePeriod('2026-07-04', '2026-07-05')
    expect(effectiveHourlyRate(MONTHLY, period)).toBeNull()
  })

  it('без месячной ставки участника денег нет', () => {
    const period = describePeriod('2026-07-01', '2026-07-31')
    expect(effectiveHourlyRate(null, period)).toBeNull()
    expect(effectiveHourlyRate(0, period)).toBeNull()
  })
})

describe('computeAccrual (п.6 — округляется произведение, не ставка)', () => {
  it('июль: 160 ч при 200 000 ₽/мес → ровно 173 913 ₽', () => {
    const period = describePeriod('2026-07-01', '2026-07-31')
    const eff = effectiveHourlyRate(MONTHLY, period)!
    expect(computeAccrual(160, eff)).toBe(173_913)
    // округлённая ставка дала бы 173 920 — так считать нельзя
    expect(computeAccrual(160, eff)).not.toBe(Math.round(eff) * 160)
  })

  it('май–июнь: 344 ч фуллтайма → ровно 400 000 ₽ (две месячные)', () => {
    const period = describePeriod('2026-05-01', '2026-06-30')
    const eff = effectiveHourlyRate(MONTHLY, period)!
    expect(computeAccrual(344, eff)).toBe(400_000)
  })

  it('ноль часов — ноль начисления', () => {
    expect(computeAccrual(0, 1086.9565217391305)).toBe(0)
  })
})

describe('computeSplit (п.5, п.6)', () => {
  it('доинвестиция округляется, деньги — остаток (сумма всегда равна начислению)', () => {
    expect(computeSplit(173_913, 30)).toEqual({ invest: 52_174, cash: 121_739 })
    const { invest, cash } = computeSplit(173_913, 30)
    expect(invest + cash).toBe(173_913)
  })

  it('крайние доли', () => {
    expect(computeSplit(400_000, 0)).toEqual({ invest: 0, cash: 400_000 })
    expect(computeSplit(400_000, 100)).toEqual({ invest: 400_000, cash: 0 })
  })

  it('нечётные суммы не теряют рубль', () => {
    const { invest, cash } = computeSplit(1001, 50)
    expect(invest).toBe(501)
    expect(cash).toBe(500)
    expect(invest + cash).toBe(1001)
  })
})

describe('maxDeclarableHours (п.21 — физический потолок от длины периода)', () => {
  it('календарные дни × 24, а не фиксированное число', () => {
    expect(maxDeclarableHours(describePeriod('2026-07-01', '2026-07-31'))).toBe(31 * 24)
    expect(maxDeclarableHours(describePeriod('2026-05-01', '2026-06-30'))).toBe(61 * 24)
  })
})
