import { describe, expect, it } from 'vitest'

import { projectTimeline } from '@/lib/finmodel/formula'
import { getVariables } from '@/lib/finmodel/variables'

/**
 * P&L проекта: накопленный убыток, каскад возврата вложенного, профит-шеринг.
 * Рабочее прочтение состава тиров зафиксировано в комментарии `projectTimeline`
 * и в спеке §11.7; числа периодов — модельные.
 */
const policy = getVariables().policy

describe('P&L: фазы проекта и каскад возврата', () => {
  it('фаза убытков: распределять нечего, убыток копится', () => {
    const timeline = projectTimeline(
      [
        { revenue: 0, costs: 5_000_000 },
        { revenue: 2_000_000, costs: 4_000_000 },
      ],
      policy,
      [{ amountRub: 10_000_000 }],
    )
    expect(timeline[0].phase).toBe('loss')
    expect(timeline[1].cumLoss).toBe(7_000_000)
    expect(timeline[1].distribution).toBeNull()
    expect(timeline[1].investorReturn).toBe(0)
  })

  it('возврат: покрытый убыток открывает возврат вложенного инвесторам', () => {
    const timeline = projectTimeline(
      [
        { revenue: 0, costs: 3_000_000 },
        { revenue: 20_000_000, costs: 5_000_000 },
      ],
      policy,
      [{ amountRub: 10_000_000 }],
    )
    expect(timeline[1].phase).toBe('payback')
    expect(timeline[1].cumLoss).toBe(0)
    expect(timeline[1].investorReturn).toBe(10_000_000)
    // остаток того же периода уходит в профит-шеринг
    expect(timeline[1].distribution?.royalty.total).toBe(100_000)
    expect(timeline[1].distribution?.x).toBeCloseTo((2_000_000 - 100_000) / 7, 5)
  })

  it('профит-шеринг: возвращённое вложение больше не гасится повторно', () => {
    const timeline = projectTimeline(
      [
        { revenue: 20_000_000, costs: 5_000_000 },
        { revenue: 20_000_000, costs: 5_000_000 },
      ],
      policy,
      [{ amountRub: 10_000_000 }],
    )
    expect(timeline[1].phase).toBe('profit_sharing')
    expect(timeline[1].investorReturn).toBe(0)
    expect(timeline[1].distribution?.base).toBe(15_000_000 - Math.round(15_000_000 * 0.05))
  })

  it('возврат идёт частями, пока вложенное не закрыто целиком', () => {
    const timeline = projectTimeline(
      [
        { revenue: 9_000_000, costs: 5_000_000 },
        { revenue: 12_000_000, costs: 5_000_000 },
      ],
      policy,
      [{ amountRub: 10_000_000 }],
    )
    expect(timeline[0].investorReturn).toBe(4_000_000)
    expect(timeline[0].distribution).toBeNull()
    expect(timeline[1].investorReturn).toBe(6_000_000)
    expect(timeline[1].distribution?.base).toBe(1_000_000 - Math.round(1_000_000 * 0.05))
  })
})

describe('P&L: граничные периоды', () => {
  it('нулевая прибыль при покрытом убытке и невозвращённом вложении — это payback, не loss', () => {
    const timeline = projectTimeline(
      [
        { revenue: 20_000_000, costs: 5_000_000 },
        { revenue: 5_000_000, costs: 5_000_000 },
      ],
      policy,
      [{ amountRub: 20_000_000 }],
    )
    expect(timeline[1].netProfit).toBe(0)
    expect(timeline[1].cumLoss).toBe(0)
    expect(timeline[1].remainingInvestment).toBe(5_000_000)
    // `loss` означает «накопленный убыток ещё не покрыт» — здесь он покрыт.
    expect(timeline[1].phase).toBe('payback')
    expect(timeline[1].investorReturn).toBe(0)
    expect(timeline[1].distribution).toBeNull()
  })

  it('нулевая прибыль при непокрытом убытке остаётся loss и убыток не растёт', () => {
    const timeline = projectTimeline(
      [
        { revenue: 0, costs: 3_000_000 },
        { revenue: 5_000_000, costs: 5_000_000 },
      ],
      policy,
      [{ amountRub: 10_000_000 }],
    )
    expect(timeline[1].phase).toBe('loss')
    expect(timeline[1].cumLoss).toBe(3_000_000)
  })
})

/**
 * База роялти — РЕШЕНИЕ, а не побочный эффект арифметики: 5% берутся с
 * распределяемого остатка периода (после покрытия убытка и возврата
 * вложенного), а не с чистой прибыли периода. Это прочтение §11.7,
 * зафиксированное тестом плана презентационной системы финмодели
 * (репо bbm, docs/superpowers/plans/2026-08-11-finmodel-presentation-system.md,
 * задача 5): период с чистой прибылью 15 млн внутри payback даёт
 * `royalty.total === 100_000`.
 */
describe('P&L: база роялти в фазе payback', () => {
  it('роялти считается с распределяемого остатка, а не с чистой прибыли периода', () => {
    const timeline = projectTimeline(
      [{ revenue: 20_000_000, costs: 5_000_000 }],
      policy,
      [{ amountRub: 13_000_000 }],
    )
    const point = timeline[0]
    expect(point.netProfit).toBe(15_000_000)
    expect(point.investorReturn).toBe(13_000_000)
    // 5% от остатка 2 млн, а НЕ 750 000 = 5% от 15 млн
    expect(point.distribution?.royalty.total).toBe(100_000)
  })
})
