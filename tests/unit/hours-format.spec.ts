import { describe, expect, it } from 'vitest'

import { formatHours, formatInt, formatPercent, formatRub, formatWeeks } from '@/lib/hours/format'

/**
 * Отображение чисел (спека 081 п.6: округление ставок — ТОЛЬКО при показе).
 * Разряды разделяются неразрывным пробелом, как в прототипе, чтобы «173 913 ₽»
 * не переносилось по строке.
 */

const NBSP = ' '

describe('formatInt', () => {
  it('разбивает разряды неразрывным пробелом', () => {
    expect(formatInt(173913)).toBe(`173${NBSP}913`)
    expect(formatInt(1163)).toBe(`1${NBSP}163`)
    expect(formatInt(999)).toBe('999')
    expect(formatInt(1234567)).toBe(`1${NBSP}234${NBSP}567`)
  })

  it('округляет до целого при показе', () => {
    expect(formatInt(1162.79)).toBe(`1${NBSP}163`)
    expect(formatInt(1086.9565)).toBe(`1${NBSP}087`)
  })
})

describe('formatRub', () => {
  it('добавляет рубль через неразрывный пробел', () => {
    expect(formatRub(173913)).toBe(`173${NBSP}913${NBSP}₽`)
    expect(formatRub(1162.79)).toBe(`1${NBSP}163${NBSP}₽`)
  })

  it('пустое значение показывается прочерком, а не «NaN ₽»', () => {
    expect(formatRub(null)).toBe('—')
    expect(formatRub(Number.NaN)).toBe('—')
  })
})

describe('formatHours', () => {
  it('один знак после запятой, разделитель — запятая', () => {
    expect(formatHours(160)).toBe('160')
    expect(formatHours(4.6)).toBe('4,6')
    expect(formatHours(163.25)).toBe('163,3')
  })
})

describe('formatWeeks', () => {
  it('множитель недель показывается с одним знаком (п.20)', () => {
    expect(formatWeeks(23 / 5)).toBe('4,6')
    expect(formatWeeks(43 / 5)).toBe('8,6')
    expect(formatWeeks(5)).toBe('5')
  })
})

describe('formatPercent', () => {
  it('целые проценты сплита', () => {
    expect(formatPercent(30)).toBe('30%')
    expect(formatPercent(0)).toBe('0%')
  })
})
