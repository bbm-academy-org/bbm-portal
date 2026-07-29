import { describe, expect, it } from 'vitest'

import {
  createPeriod,
  deletePeriod,
  findAssessment,
  pickSummaryPeriod,
  saveAssessment,
  setPeriodStatus,
  updatePeriod,
  upsertParticipant,
} from '@/lib/hours/document'
import { emptyHoursDocument, type HoursDocument } from '@/lib/hours/types'

/**
 * Операции над JSON-документом (спека 081 пп. 14–16, 21, 23, 24) — чистые
 * функции `(doc, input) → результат`: валидации, снэпшоты и freeze закрытого
 * периода тестируются без файловой системы и без сессии.
 */

const NOW = '2026-08-01T09:00:00.000Z'

function doc(): HoursDocument {
  return {
    participants: [
      {
        email: 'anton@bbm.academy',
        name: 'Антон',
        role: 'Продукт',
        fork_min: 150_000,
        fork_max: 250_000,
        grade: 'II',
        monthly_rate: 200_000,
      },
    ],
    periods: [
      {
        id: 'p-july',
        label: 'Июль 2026',
        date_from: '2026-07-01',
        date_to: '2026-07-31',
        status: 'open',
      },
    ],
    assessments: [],
  }
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result.ok, 'ожидался успешный результат: ' + JSON.stringify(result)).toBe(true)
  return result as Extract<T, { ok: true }>
}

const validAssessment = {
  periodId: 'p-july',
  email: 'anton@bbm.academy',
  hours: 160,
  method: 'period' as const,
  weekendHours: 0,
  splitPercent: 30,
}

describe('saveAssessment — снэпшоты (п.14, сценарий 3)', () => {
  it('сохраняет оценку со всеми числами на момент декларации', () => {
    const result = ok(saveAssessment(doc(), validAssessment, NOW))
    const saved = result.saved
    expect(saved).toMatchObject({
      period_id: 'p-july',
      email: 'anton@bbm.academy',
      hours: 160,
      method: 'period',
      weekend_hours: 0,
      split_percent: 30,
      monthly_rate: 200_000,
      accrual: 173_913,
      invest_amount: 52_174,
      cash_amount: 121_739,
      weekday_count: 23,
      saved_at: NOW,
    })
    expect(saved.hourly_rate).toBeCloseTo(200_000 / 184, 9)
    expect(result.doc.assessments).toHaveLength(1)
  })

  it('нормализует email оценки (ключ пары period+email — lowercase)', () => {
    const result = ok(saveAssessment(doc(), { ...validAssessment, email: ' Anton@BBM.Academy ' }, NOW))
    expect(result.saved.email).toBe('anton@bbm.academy')
  })

  it('пересохранение при открытом периоде перезаписывает запись, не плодит вторую', () => {
    const first = ok(saveAssessment(doc(), validAssessment, NOW))
    const second = ok(
      saveAssessment(first.doc, { ...validAssessment, hours: 120 }, '2026-08-01T10:00:00.000Z'),
    )
    expect(second.doc.assessments).toHaveLength(1)
    expect(second.doc.assessments[0].hours).toBe(120)
    expect(second.doc.assessments[0].saved_at).toBe('2026-08-01T10:00:00.000Z')
  })

  it('пересчитывает снэпшоты по ТЕКУЩЕЙ ставке при пересохранении (п.15)', () => {
    const first = ok(saveAssessment(doc(), validAssessment, NOW))
    const raised: HoursDocument = {
      ...first.doc,
      participants: [{ ...first.doc.participants[0], monthly_rate: 400_000 }],
    }
    // до пересохранения снэпшот не трогается — смена ставки не задним числом
    expect(raised.assessments[0].accrual).toBe(173_913)

    const again = ok(saveAssessment(raised, validAssessment, NOW))
    expect(again.saved.monthly_rate).toBe(400_000)
    expect(again.saved.accrual).toBe(347_826)
  })

  it('оценка чужого участника не трогается', () => {
    const base = doc()
    base.participants.push({
      email: 'eduard@bbm.academy',
      name: 'Эдуард',
      role: 'Операции',
      fork_min: 100_000,
      fork_max: 200_000,
      grade: 'I',
      monthly_rate: 150_000,
    })
    const first = ok(saveAssessment(base, validAssessment, NOW))
    const second = ok(
      saveAssessment(first.doc, { ...validAssessment, email: 'eduard@bbm.academy', hours: 80 }, NOW),
    )
    expect(second.doc.assessments).toHaveLength(2)
    expect(findAssessment(second.doc, 'p-july', 'anton@bbm.academy')?.hours).toBe(160)
    expect(findAssessment(second.doc, 'p-july', 'eduard@bbm.academy')?.hours).toBe(80)
  })
})

describe('saveAssessment — валидации (п.21)', () => {
  it('отклоняет несуществующий период', () => {
    const result = saveAssessment(doc(), { ...validAssessment, periodId: 'nope' }, NOW)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('Период') })
  })

  it('замораживает закрытый период (сценарий 8)', () => {
    const frozen = doc()
    frozen.periods[0].status = 'closed'
    const result = saveAssessment(frozen, validAssessment, NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('закрыт')
  })

  it('отклоняет участника, которого нет в списке (сценарий 7)', () => {
    const result = saveAssessment(doc(), { ...validAssessment, email: 'stranger@bbm.academy' }, NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('участник')
  })

  it('отклоняет отрицательные и нечисловые часы', () => {
    expect(saveAssessment(doc(), { ...validAssessment, hours: -1 }, NOW).ok).toBe(false)
    expect(saveAssessment(doc(), { ...validAssessment, hours: Number.NaN }, NOW).ok).toBe(false)
  })

  it('держит потолок часов от длины периода, а не фиксированное число', () => {
    // 31 календарный день × 24 = 744
    expect(saveAssessment(doc(), { ...validAssessment, hours: 744 }, NOW).ok).toBe(true)
    expect(saveAssessment(doc(), { ...validAssessment, hours: 745 }, NOW).ok).toBe(false)
  })

  it('требует 0 ≤ weekend_hours ≤ hours', () => {
    expect(saveAssessment(doc(), { ...validAssessment, weekendHours: 160 }, NOW).ok).toBe(true)
    expect(saveAssessment(doc(), { ...validAssessment, weekendHours: 161 }, NOW).ok).toBe(false)
    expect(saveAssessment(doc(), { ...validAssessment, weekendHours: -1 }, NOW).ok).toBe(false)
  })

  it('держит split_percent в 0–100', () => {
    expect(saveAssessment(doc(), { ...validAssessment, splitPercent: 0 }, NOW).ok).toBe(true)
    expect(saveAssessment(doc(), { ...validAssessment, splitPercent: 100 }, NOW).ok).toBe(true)
    expect(saveAssessment(doc(), { ...validAssessment, splitPercent: 101 }, NOW).ok).toBe(false)
    expect(saveAssessment(doc(), { ...validAssessment, splitPercent: -1 }, NOW).ok).toBe(false)
  })

  it('принимает только способы оценки из вкладок', () => {
    for (const method of ['period', 'week', 'day'] as const) {
      expect(saveAssessment(doc(), { ...validAssessment, method }, NOW).ok).toBe(true)
    }
    expect(
      saveAssessment(
        doc(),
        { ...validAssessment, method: 'guess' as unknown as 'period' },
        NOW,
      ).ok,
    ).toBe(false)
  })
})

describe('upsertParticipant (п.23)', () => {
  const participant = {
    email: 'eduard@bbm.academy',
    name: 'Эдуард',
    role: 'Операции',
    forkMin: 100_000,
    forkMax: 200_000,
    grade: 'I' as const,
    monthlyRate: 150_000,
  }

  it('добавляет участника с нормализованным email', () => {
    const result = ok(upsertParticipant(doc(), { ...participant, email: ' EDUARD@bbm.academy ' }))
    expect(result.doc.participants).toHaveLength(2)
    expect(result.doc.participants[1].email).toBe('eduard@bbm.academy')
    expect(result.warnings).toEqual([])
  })

  it('правит существующего по email, не создавая дубль', () => {
    const result = ok(
      upsertParticipant(doc(), {
        ...participant,
        email: 'anton@bbm.academy',
        name: 'Антон С.',
        monthlyRate: 220_000,
      }),
    )
    expect(result.doc.participants).toHaveLength(1)
    expect(result.doc.participants[0].name).toBe('Антон С.')
    expect(result.doc.participants[0].monthly_rate).toBe(220_000)
  })

  it('fork_min > fork_max — жёсткий отказ', () => {
    const result = upsertParticipant(doc(), { ...participant, forkMin: 300_000, forkMax: 200_000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('вилк')
  })

  it('ставка вне вилки — мягкое предупреждение, сохранить можно (сценарий 8)', () => {
    const above = ok(upsertParticipant(doc(), { ...participant, monthlyRate: 500_000 }))
    expect(above.warnings).toHaveLength(1)
    expect(above.warnings[0]).toContain('вилк')
    expect(above.doc.participants[1].monthly_rate).toBe(500_000)

    const below = ok(upsertParticipant(doc(), { ...participant, monthlyRate: 1_000 }))
    expect(below.warnings).toHaveLength(1)
  })

  it('требует email, имя и роль', () => {
    expect(upsertParticipant(doc(), { ...participant, email: '' }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, email: 'not-an-email' }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, name: '  ' }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, role: '' }).ok).toBe(false)
  })

  it('отклоняет отрицательные деньги и неизвестный грейд', () => {
    expect(upsertParticipant(doc(), { ...participant, forkMin: -1 }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, monthlyRate: -1 }).ok).toBe(false)
    expect(
      upsertParticipant(doc(), { ...participant, grade: 'IV' as unknown as 'I' }).ok,
    ).toBe(false)
  })
})

describe('createPeriod (п.24)', () => {
  const input = { label: 'Август 2026', dateFrom: '2026-08-01', dateTo: '2026-08-31' }

  it('создаёт период закрытым — открытие отдельным действием', () => {
    const result = ok(createPeriod(doc(), input, 'p-aug'))
    expect(result.doc.periods).toHaveLength(2)
    expect(result.doc.periods[1]).toEqual({
      id: 'p-aug',
      label: 'Август 2026',
      date_from: '2026-08-01',
      date_to: '2026-08-31',
      status: 'closed',
    })
  })

  it('отклоняет date_from > date_to', () => {
    const result = createPeriod(doc(), { ...input, dateFrom: '2026-08-31', dateTo: '2026-08-01' }, 'x')
    expect(result.ok).toBe(false)
  })

  it('отклоняет период без будних дней (иначе деление на ноль)', () => {
    const result = createPeriod(doc(), { ...input, dateFrom: '2026-07-04', dateTo: '2026-07-05' }, 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('будн')
  })

  it('отклоняет некорректные даты и пустой label', () => {
    expect(createPeriod(doc(), { ...input, dateFrom: '01.08.2026' }, 'x').ok).toBe(false)
    expect(createPeriod(doc(), { ...input, label: '   ' }, 'x').ok).toBe(false)
  })

  it('пересечение с существующим периодом — мягкое предупреждение', () => {
    const result = ok(
      createPeriod(doc(), { label: 'Хвост июля', dateFrom: '2026-07-20', dateTo: '2026-08-10' }, 'x'),
    )
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Июль 2026')
  })
})

describe('updatePeriod / deletePeriod (п.16, п.24)', () => {
  const edit = { id: 'p-july', label: 'Июль 2026 (правка)', dateFrom: '2026-07-01', dateTo: '2026-07-30' }

  it('правит период, пока по нему нет ни одной оценки', () => {
    const result = ok(updatePeriod(doc(), edit))
    expect(result.doc.periods[0].label).toBe('Июль 2026 (правка)')
    expect(result.doc.periods[0].date_to).toBe('2026-07-30')
    expect(result.doc.periods[0].status).toBe('open')
  })

  it('запрещает правку периода с оценками — дальше только escape-hatch владельца', () => {
    const withAssessment = ok(saveAssessment(doc(), validAssessment, NOW)).doc
    const result = updatePeriod(withAssessment, edit)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('оценк')
  })

  it('удаляет пустой период и отказывается удалять период с оценками', () => {
    expect(ok(deletePeriod(doc(), 'p-july')).doc.periods).toHaveLength(0)
    const withAssessment = ok(saveAssessment(doc(), validAssessment, NOW)).doc
    expect(deletePeriod(withAssessment, 'p-july').ok).toBe(false)
  })

  it('применяет к правке те же жёсткие валидации, что и к созданию', () => {
    expect(updatePeriod(doc(), { ...edit, dateFrom: '2026-07-04', dateTo: '2026-07-05' }).ok).toBe(false)
    expect(updatePeriod(doc(), { ...edit, dateFrom: '2026-07-31', dateTo: '2026-07-01' }).ok).toBe(false)
  })
})

describe('setPeriodStatus (п.24)', () => {
  it('закрывает открытый период', () => {
    const result = ok(setPeriodStatus(doc(), 'p-july', 'closed'))
    expect(result.doc.periods[0].status).toBe('closed')
  })

  it('переоткрывает закрытый период — путь исправить опечатку перед выплатой', () => {
    const closed = ok(setPeriodStatus(doc(), 'p-july', 'closed')).doc
    const reopened = ok(setPeriodStatus(closed, 'p-july', 'open'))
    expect(reopened.doc.periods[0].status).toBe('open')
  })

  it('не даёт держать два открытых периода одновременно', () => {
    const base = ok(
      createPeriod(doc(), { label: 'Август 2026', dateFrom: '2026-08-01', dateTo: '2026-08-31' }, 'p-aug'),
    ).doc
    const result = setPeriodStatus(base, 'p-aug', 'open')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('открыт')
  })

  it('отклоняет неизвестный период', () => {
    expect(setPeriodStatus(doc(), 'nope', 'open').ok).toBe(false)
  })
})

describe('pickSummaryPeriod (п.22)', () => {
  function withPeriods(): HoursDocument {
    const base = doc()
    base.periods[0].status = 'closed'
    base.periods.push({
      id: 'p-june',
      label: 'Июнь 2026',
      date_from: '2026-06-01',
      date_to: '2026-06-30',
      status: 'closed',
    })
    return base
  }

  it('по умолчанию берёт открытый период', () => {
    expect(pickSummaryPeriod(doc())?.id).toBe('p-july')
  })

  it('без открытого — последний закрытый по дате конца', () => {
    expect(pickSummaryPeriod(withPeriods())?.id).toBe('p-july')
  })

  it('явно выбранный в селекторе выигрывает', () => {
    expect(pickSummaryPeriod(withPeriods(), 'p-june')?.id).toBe('p-june')
  })

  it('несуществующий id не ломает страницу', () => {
    expect(pickSummaryPeriod(withPeriods(), 'nope')?.id).toBe('p-july')
  })

  it('без периодов — ничего', () => {
    expect(pickSummaryPeriod(emptyHoursDocument())).toBeUndefined()
  })
})

describe('emptyHoursDocument', () => {
  it('пустая структура — валидный документ первого запуска', () => {
    expect(emptyHoursDocument()).toEqual({ participants: [], periods: [], assessments: [] })
  })
})
