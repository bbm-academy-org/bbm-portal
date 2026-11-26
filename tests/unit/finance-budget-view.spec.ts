/** Display helpers of the budget dashboard (spec 584, #586) — formatting and the limit input. */
import { describe, expect, it } from 'vitest'

import {
  cbrMarkText,
  differenceText,
  figureText,
  formatMoney,
  limitText,
  parseLimitAmount,
} from '@/app/(platform)/p/finance/reports/budget/budget-view'

describe('budget dashboard display helpers', () => {
  it('writes minor units as grouped money, kopecks only on request', () => {
    expect(formatMoney(123456789n, 'RUB', 2)).toBe('1 234 567 ₽')
    expect(formatMoney(-123456789n, 'RUB', 2, { cents: true })).toBe('−1 234 567,89 ₽')
    expect(formatMoney(500n, 'THB', 2, { cents: true })).toBe('5 THB')
  })

  it('names the currencies of a withheld figure instead of a number (EARS-720)', () => {
    expect(figureText({ status: 'withheld', currencies: ['THB', 'USDT'] }, 'RUB', 2)).toEqual({
      text: 'не посчитано: THB, USDT',
      withheld: true,
    })
  })

  it('says which date had no Bank of Russia rate instead of a number (EARS-729 item 3)', () => {
    expect(
      figureText({ status: 'withheld', currencies: [], noRateOn: ['2026-03-05'] }, 'USD', 2),
    ).toEqual({ text: 'нет курса ЦБ на 5 марта 2026', withheld: true })
    expect(
      figureText(
        {
          status: 'withheld',
          currencies: [],
          noRateOn: ['2026-03-05', '2026-04-05', '2026-05-05'],
        },
        'USD',
        2,
      ),
    ).toEqual({ text: 'нет курса ЦБ на 5 марта 2026 и ещё 2 даты', withheld: true })
  })

  it('marks a flow figure the fallback converted, wholly or in part (EARS-729 items 1–2)', () => {
    const known = (cbr?: { amount: bigint; items: number; of: number; rateDate?: string }) =>
      ({ status: 'known', amount: 100_00n, cbr }) as const
    expect(cbrMarkText(known(), 'USD', 2)).toBeNull()
    expect(cbrMarkText(known({ amount: 0n, items: 0, of: 3 }), 'USD', 2)).toBeNull()
    expect(cbrMarkText(known({ amount: 100_00n, items: 3, of: 3 }), 'USD', 2)).toBe('по курсу ЦБ')
    expect(
      cbrMarkText(known({ amount: 100_00n, items: 1, of: 1, rateDate: '2026-03-05' }), 'USD', 2),
    ).toBe('по курсу ЦБ на 5 марта 2026')
    expect(cbrMarkText(known({ amount: 40_00n, items: 1, of: 3 }), 'USD', 2)).toBe(
      'частично по курсу ЦБ: 40 $',
    )
  })

  it('writes a relation difference with its sign (EARS-722 item 4)', () => {
    expect(differenceText(1_000_00n, 'USD', 2)).toBe('+1 000 $')
    expect(differenceText(-5_50n, 'USD', 2)).toBe('−5,50 $')
  })

  it('reads the typed limit into minor units, refusing finer-than-precision input (EARS-724)', () => {
    expect(parseLimitAmount('1 000 000', 2)).toBe(100000000n)
    expect(parseLimitAmount('1000,5', 2)).toBe(100050n)
    expect(parseLimitAmount('1,005', 2)).toBeNull()
    expect(parseLimitAmount('0', 2)).toBeNull()
    expect(parseLimitAmount('abc', 2)).toBeNull()
    expect(limitText(100050n, 2)).toBe('1000,50')
    expect(limitText(100000000n, 2)).toBe('1000000')
  })
})
