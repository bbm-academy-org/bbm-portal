import { describe, expect, it } from 'vitest'

import { formatPercent, formatRub } from '@/lib/finmodel/format'
import {
  distributeProfit,
  miningScore,
  perTokenPayout,
  royaltySplit,
  splitReserve,
} from '@/lib/finmodel/formula'
import { getVariables } from '@/lib/finmodel/variables'

/**
 * Эталонные («golden») тесты расчётного модуля. Числа в названиях — примеры
 * канона модели (репо bbm, §3.4 и разбор звонка 06.08); это МОДЕЛЬНЫЕ значения,
 * на которых проверяется арифметика, а не зафиксированные обещания.
 *
 * Проценты и доли берутся из снапшота, а не пишутся руками (спека §9 п.5):
 * поменяется мастер — тест поедет вместе с ним, и это правильный сигнал.
 */
const policy = getVariables().policy

describe('распределение прибыли: роялти 2+3 и семь долей', () => {
  const distribution = distributeProfit(70_000_000, policy)

  it('роялти 3,5 млн = 1,4 млн фонду эволюционной цели + 2,1 млн держателям BBM', () => {
    expect(distribution.royalty.total).toBe(3_500_000)
    expect(distribution.royalty.missionFund).toBe(1_400_000)
    expect(distribution.royalty.bbmHolders).toBe(2_100_000)
  })

  it('база 66,5 млн делится на семь долей: 1x = 9,5 млн, 4x/2x/1x = 38/19/9,5 млн', () => {
    expect(distribution.base).toBe(66_500_000)
    expect(distribution.x).toBe(9_500_000)
    expect(distribution.investors).toBe(38_000_000)
    expect(distribution.author).toBe(19_000_000)
    expect(distribution.coauthors).toBe(9_500_000)
  })

  it('адресат роялти — не автор: доля автора и роялти считаются раздельно', () => {
    expect(distribution.author).not.toBe(distribution.royalty.total)
    expect(distribution.royalty.total + distribution.base).toBe(70_000_000)
  })
})

describe('резерв: пропорциональный сплит каждой входящей суммы', () => {
  it('15% от 10 млн — 1,5 млн в резерв, 8,5 млн дальше в проект', () => {
    expect(splitReserve(10_000_000, 15)).toEqual({ reserve: 1_500_000, toProject: 8_500_000 })
  })

  it('сплит не теряет и не создаёт рублей', () => {
    const split = splitReserve(1_234_567, policy.reserve_percent)
    expect(split.reserve + split.toProject).toBe(1_234_567)
  })
})

/**
 * В отличие от цепочки 70 млн → 3,5 млн → 9,5 млн выше, сценарий ниже —
 * АРИФМЕТИКА ИСПОЛНИТЕЛЯ под AC задачи (3% от 100 млн ÷ 5000), а не golden
 * канона: 600 ₽ на токен ничего не обещают и меняются вместе с входными
 * числами сценария.
 */
describe('выплата на токен', () => {
  it('доля держателей BBM от прибыли 100 млн на 5000 токенов — 600 ₽ на токен', () => {
    const holders = royaltySplit(100_000_000, policy.royalty_percent).bbmHolders
    expect(perTokenPayout(holders, 5000)).toBe(600)
  })

  it('нулевой тираж не делит на ноль', () => {
    expect(perTokenPayout(3_000_000, 0)).toBe(0)
  })
})

describe('майнинг внимания: score по весам проекта', () => {
  it('веса 4:1:2 из снапшота: по одному действию каждого вида — score 7', () => {
    const weights = getVariables().projects.doctor_school.mining_weights
    expect(miningScore({ pul: 1, bre: 1, con: 1 }, weights)).toBe(7)
  })

  it('score линеен по количеству действий', () => {
    const weights = getVariables().projects.doctor_school.mining_weights
    expect(miningScore({ pul: 3, bre: 0, con: 2 }, weights)).toBe(3 * 4 + 2 * 2)
  })
})

describe('форматирование', () => {
  it('рубли с неразрывными разрядами и процент целым', () => {
    expect(formatRub(9_500_000)).toBe('9 500 000 ₽')
    expect(formatPercent(policy.royalty_percent.total)).toBe('5%')
    expect(formatRub(null)).toBe('—')
  })
})
