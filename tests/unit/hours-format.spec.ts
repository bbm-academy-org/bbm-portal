import { describe, expect, it } from 'vitest'

import {
  formatHours,
  formatInt,
  formatIsoDate,
  formatPercent,
  formatRub,
  formatSavedAt,
  formatWeekdayCount,
  formatWeeks,
  plural,
} from '@/lib/hours/format'

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

/**
 * Общее русское словоизменение по числу. Отдельная функция появилась после
 * ревью PR #86: тот же четырёхветочный алгоритм жил в `formatWeekdayCount` и
 * был скопирован в домен мутаций, где ни одного прямого теста у копии не было —
 * и «заявлено в 1 оценка» проехало в предупреждение владельцу.
 */
describe('plural (склонение по числу)', () => {
  const grade = (n: number) => plural(n, 'оценка', 'оценки', 'оценок')

  it('берёт форму по последней цифре', () => {
    expect(grade(1)).toBe('оценка')
    expect(grade(2)).toBe('оценки')
    expect(grade(3)).toBe('оценки')
    expect(grade(4)).toBe('оценки')
    expect(grade(5)).toBe('оценок')
    expect(grade(9)).toBe('оценок')
  })

  it('вторая десятка — исключение целиком (11–14)', () => {
    expect(grade(11)).toBe('оценок')
    expect(grade(12)).toBe('оценок')
    expect(grade(13)).toBe('оценок')
    expect(grade(14)).toBe('оценок')
    expect(grade(15)).toBe('оценок')
  })

  it('за пределами первой сотни правило то же', () => {
    expect(grade(21)).toBe('оценка')
    expect(grade(22)).toBe('оценки')
    expect(grade(25)).toBe('оценок')
    expect(grade(101)).toBe('оценка')
    expect(grade(111)).toBe('оценок')
    expect(grade(114)).toBe('оценок')
    expect(grade(122)).toBe('оценки')
  })

  it('ноль и дробь/минус не ломают форму', () => {
    expect(grade(0)).toBe('оценок')
    expect(grade(1.4)).toBe('оценка')
    expect(grade(-1)).toBe('оценка')
    expect(grade(-5)).toBe('оценок')
  })

  it('работает и для предложного падежа — падеж выбирает вызывающий', () => {
    // Ровно тот дефект, который ревью PR #86 нашло: предлог «в» требует
    // предложного падежа, именительный там всегда неверен.
    const inCase = (n: number) => plural(n, 'оценке', 'оценках', 'оценках')
    expect(inCase(1)).toBe('оценке')
    expect(inCase(2)).toBe('оценках')
    expect(inCase(5)).toBe('оценках')
  })
})

describe('formatWeekdayCount', () => {
  it('склоняет «будний день» по-русски', () => {
    expect(formatWeekdayCount(1)).toBe('1 будний день')
    expect(formatWeekdayCount(2)).toBe('2 будних дня')
    expect(formatWeekdayCount(23)).toBe('23 будних дня')
    expect(formatWeekdayCount(21)).toBe('21 будний день')
    expect(formatWeekdayCount(25)).toBe('25 будних дней')
    expect(formatWeekdayCount(11)).toBe('11 будних дней')
    expect(formatWeekdayCount(0)).toBe('0 будних дней')
  })
})

describe('formatIsoDate / formatSavedAt', () => {
  it('переворачивает ISO-дату без участия Date (таймзона не сдвигает день)', () => {
    expect(formatIsoDate('2026-07-01')).toBe('01.07.2026')
    expect(formatIsoDate('2026-12-31')).toBe('31.12.2026')
    expect(formatIsoDate('мусор')).toBe('—')
  })

  it('называет зону момента сохранения явно', () => {
    expect(formatSavedAt('2026-08-01T09:00:00.000Z')).toBe('01.08.2026 09:00 UTC')
    expect(formatSavedAt(undefined)).toBe('—')
  })
})
