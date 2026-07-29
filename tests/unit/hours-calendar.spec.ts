import { describe, expect, it } from 'vitest'

import {
  countCalendarDays,
  countWeekdays,
  isValidIsoDate,
  isoDayOfWeek,
  monthLabel,
  monthSegments,
} from '@/lib/hours/calendar'

/**
 * Календарь будней (спека 081 п.1). Пн–Пт реального календаря, праздники не
 * вычитаются, никаких производственных календарей. Вся арифметика — по ISO-
 * строке (days-from-civil), без `Date` и таймзон: результат обязан совпадать
 * на проде (UTC) и на машине владельца (MSK).
 */

describe('isValidIsoDate', () => {
  it('принимает корректную ISO-дату', () => {
    expect(isValidIsoDate('2026-07-01')).toBe(true)
    expect(isValidIsoDate('2000-02-29')).toBe(true)
  })

  it('отбрасывает мусор, несуществующие дни и не-ISO формат', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2027-02-29')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('2026-00-10')).toBe(false)
    expect(isValidIsoDate('01.07.2026')).toBe(false)
    expect(isValidIsoDate('2026-7-1')).toBe(false)
    expect(isValidIsoDate('')).toBe(false)
  })
})

describe('isoDayOfWeek', () => {
  it('считает день недели чистой арифметикой (0 = воскресенье)', () => {
    expect(isoDayOfWeek('1970-01-01')).toBe(4) // четверг — опорная дата
    expect(isoDayOfWeek('1999-12-31')).toBe(5)
    expect(isoDayOfWeek('2000-02-29')).toBe(2)
    expect(isoDayOfWeek('2026-07-01')).toBe(3)
    expect(isoDayOfWeek('2026-07-04')).toBe(6)
    expect(isoDayOfWeek('2026-07-05')).toBe(0)
    expect(isoDayOfWeek('2026-08-01')).toBe(6)
  })
})

describe('countWeekdays', () => {
  it('считает будни календарных месяцев из спеки', () => {
    expect(countWeekdays('2026-07-01', '2026-07-31')).toBe(23)
    expect(countWeekdays('2026-05-01', '2026-05-31')).toBe(21)
    expect(countWeekdays('2026-06-01', '2026-06-30')).toBe(22)
    expect(countWeekdays('2026-05-01', '2026-06-30')).toBe(43)
  })

  it('включает обе границы диапазона', () => {
    // 2026-07-01 — среда, 2026-07-03 — пятница.
    expect(countWeekdays('2026-07-01', '2026-07-03')).toBe(3)
    // один будний день сам по себе
    expect(countWeekdays('2026-07-01', '2026-07-01')).toBe(1)
    // одна суббота сама по себе
    expect(countWeekdays('2026-07-04', '2026-07-04')).toBe(0)
  })

  it('возвращает 0 для периода без будней', () => {
    // сб 04.07.2026 – вс 05.07.2026
    expect(countWeekdays('2026-07-04', '2026-07-05')).toBe(0)
  })

  it('возвращает 0 для перевёрнутого диапазона', () => {
    expect(countWeekdays('2026-07-31', '2026-07-01')).toBe(0)
  })

  it('считает частичный месяц', () => {
    expect(countWeekdays('2026-07-01', '2026-07-15')).toBe(11)
  })

  it('не зависит от локальной таймзоны процесса', () => {
    const original = process.env.TZ
    try {
      process.env.TZ = 'Pacific/Kiritimati' // UTC+14
      const east = countWeekdays('2026-07-01', '2026-07-31')
      process.env.TZ = 'Pacific/Midway' // UTC−11
      const west = countWeekdays('2026-07-01', '2026-07-31')
      expect(east).toBe(23)
      expect(west).toBe(23)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})

describe('countCalendarDays', () => {
  it('считает календарные дни включительно (потолок часов — п.21)', () => {
    expect(countCalendarDays('2026-07-01', '2026-07-31')).toBe(31)
    expect(countCalendarDays('2026-05-01', '2026-06-30')).toBe(61)
    expect(countCalendarDays('2026-07-01', '2026-07-01')).toBe(1)
    expect(countCalendarDays('2026-07-31', '2026-07-01')).toBe(0)
  })
})

describe('monthSegments', () => {
  it('режет период на пересечения с календарными месяцами', () => {
    const segments = monthSegments('2026-05-01', '2026-06-30')
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({
      year: 2026,
      month: 5,
      from: '2026-05-01',
      to: '2026-05-31',
      weekdaysInMonth: 21,
      weekdaysInSegment: 21,
    })
    expect(segments[1]).toEqual({
      year: 2026,
      month: 6,
      from: '2026-06-01',
      to: '2026-06-30',
      weekdaysInMonth: 22,
      weekdaysInSegment: 22,
    })
  })

  it('для частичного месяца различает норму месяца и норму пересечения', () => {
    const segments = monthSegments('2026-07-01', '2026-07-15')
    expect(segments).toHaveLength(1)
    expect(segments[0].weekdaysInMonth).toBe(23)
    expect(segments[0].weekdaysInSegment).toBe(11)
    expect(segments[0].to).toBe('2026-07-15')
  })

  it('покрывает период, начинающийся и кончающийся в середине разных месяцев', () => {
    const segments = monthSegments('2026-05-20', '2026-07-10')
    expect(segments.map((s) => `${s.year}-${s.month}`)).toEqual(['2026-5', '2026-6', '2026-7'])
    expect(segments[0].from).toBe('2026-05-20')
    expect(segments[0].to).toBe('2026-05-31')
    expect(segments[1].weekdaysInSegment).toBe(segments[1].weekdaysInMonth)
    expect(segments[2].from).toBe('2026-07-01')
    expect(segments[2].to).toBe('2026-07-10')
    // сумма пересечений = будни всего периода
    const total = segments.reduce((acc, s) => acc + s.weekdaysInSegment, 0)
    expect(total).toBe(countWeekdays('2026-05-20', '2026-07-10'))
  })

  it('пересекает границу года', () => {
    const segments = monthSegments('2025-12-15', '2026-01-15')
    expect(segments.map((s) => `${s.year}-${s.month}`)).toEqual(['2025-12', '2026-1'])
  })

  it('возвращает пустой список для перевёрнутого диапазона', () => {
    expect(monthSegments('2026-07-31', '2026-07-01')).toEqual([])
  })
})

describe('monthLabel', () => {
  it('называет месяц по-русски', () => {
    expect(monthLabel(2026, 5)).toBe('май 2026')
    expect(monthLabel(2026, 7)).toBe('июль 2026')
    expect(monthLabel(2025, 12)).toBe('декабрь 2025')
  })
})
