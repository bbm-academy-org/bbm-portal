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
        // Ставка НЕ хранится: вилка 150–250 тыс. и грейд II дают 200 000 ₽/мес
        // (середина средней трети — решение владельца 2026-07-30, issue #83).
        fork_min: 150_000,
        fork_max: 250_000,
        grade: 'II',
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
  it('сохраняет оценку со всеми числами на момент декларации (ставка — из вилки и грейда)', () => {
    const result = ok(saveAssessment(doc(), validAssessment, NOW))
    const saved = result.saved
    expect(saved).toMatchObject({
      period_id: 'p-july',
      email: 'anton@bbm.academy',
      hours: 160,
      method: 'period',
      weekend_hours: 0,
      split_percent: 30,
      monthly_rate: 200_000, // снэпшот вычисленной ставки: 150k + ½·(250k−150k)
      accrual: 173_913,
      invest_amount: 52_174,
      cash_amount: 121_739,
      weekday_count: 23,
      saved_at: NOW,
    })
    expect(saved.hourly_rate).toBeCloseTo(200_000 / 184, 9)
    expect(result.doc.assessments).toHaveLength(1)
  })

  it('участник без вилки сохраняет оценку в режиме «только часы» (решение владельца 2026-07-30)', () => {
    const base = doc()
    base.participants.push({ email: 'new@bbm.academy', name: 'Новый' })
    const result = ok(saveAssessment(base, { ...validAssessment, email: 'new@bbm.academy' }, NOW))
    expect(result.saved).toMatchObject({
      email: 'new@bbm.academy',
      hours: 160,
      monthly_rate: null,
      hourly_rate: null,
      accrual: 0,
      cash_amount: 0,
      invest_amount: 0,
    })
  })

  it('нормализует email оценки (ключ пары period+email — lowercase)', () => {
    const result = ok(
      saveAssessment(doc(), { ...validAssessment, email: ' Anton@BBM.Academy ' }, NOW),
    )
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
    // Вилка выросла: 300–500 тыс., грейд II → вычисленная ставка 400 000 ₽/мес.
    const raised: HoursDocument = {
      ...first.doc,
      participants: [{ ...first.doc.participants[0], fork_min: 300_000, fork_max: 500_000 }],
    }
    // до пересохранения снэпшот не трогается — смена вилки не задним числом
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
    })
    const first = ok(saveAssessment(base, validAssessment, NOW))
    const second = ok(
      saveAssessment(
        first.doc,
        { ...validAssessment, email: 'eduard@bbm.academy', hours: 80 },
        NOW,
      ),
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
      saveAssessment(doc(), { ...validAssessment, method: 'guess' as unknown as 'period' }, NOW).ok,
    ).toBe(false)
  })
})

describe('upsertParticipant (п.23 — ставка не вводится, вилка/грейд/роль необязательны)', () => {
  const participant = {
    email: 'eduard@bbm.academy',
    name: 'Эдуард',
    role: 'Операции' as string | null,
    forkMin: 100_000 as number | null,
    forkMax: 200_000 as number | null,
    grade: 'I' as 'I' | null,
  }

  it('добавляет участника с нормализованным email', () => {
    const result = ok(upsertParticipant(doc(), { ...participant, email: ' EDUARD@bbm.academy ' }))
    expect(result.doc.participants).toHaveLength(2)
    expect(result.doc.participants[1].email).toBe('eduard@bbm.academy')
    expect(result.warnings).toEqual([])
  })

  it('заводит участника только с именем и email (решение владельца 2026-07-30)', () => {
    const result = ok(
      upsertParticipant(doc(), {
        email: 'new@bbm.academy',
        name: 'Новый',
        role: null,
        forkMin: null,
        forkMax: null,
        grade: null,
      }),
    )
    expect(result.doc.participants).toHaveLength(2)
    expect(result.doc.participants[1]).toMatchObject({
      email: 'new@bbm.academy',
      name: 'Новый',
      role: null,
      fork_min: null,
      fork_max: null,
      grade: null,
    })
    expect(result.warnings).toEqual([])
  })

  it('участник не хранит monthly_rate — ставка вычисляется, а не задаётся', () => {
    const result = ok(upsertParticipant(doc(), participant))
    expect(result.doc.participants[1]).not.toHaveProperty('monthly_rate')
  })

  it('правит существующего по email, не создавая дубль', () => {
    const result = ok(
      upsertParticipant(doc(), {
        ...participant,
        email: 'anton@bbm.academy',
        name: 'Антон С.',
        forkMin: 200_000,
        forkMax: 300_000,
      }),
    )
    expect(result.doc.participants).toHaveLength(1)
    expect(result.doc.participants[0].name).toBe('Антон С.')
    expect(result.doc.participants[0].fork_min).toBe(200_000)
    expect(result.doc.participants[0].fork_max).toBe(300_000)
  })

  it('fork_min > fork_max — жёсткий отказ (валидация вилки, когда вилка задана)', () => {
    const result = upsertParticipant(doc(), { ...participant, forkMin: 300_000, forkMax: 200_000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('вилк')
  })

  it('требует email и имя — роль больше не обязательна', () => {
    expect(upsertParticipant(doc(), { ...participant, email: '' }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, email: 'not-an-email' }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, name: '  ' }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, role: null }).ok).toBe(true)
  })

  it('отклоняет отрицательные границы вилки и неизвестный грейд', () => {
    expect(upsertParticipant(doc(), { ...participant, forkMin: -1 }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, forkMax: -1, forkMin: -2 }).ok).toBe(false)
    expect(upsertParticipant(doc(), { ...participant, grade: 'IV' as unknown as 'I' }).ok).toBe(
      false,
    )
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
    const result = createPeriod(
      doc(),
      { ...input, dateFrom: '2026-08-31', dateTo: '2026-08-01' },
      'x',
    )
    expect(result.ok).toBe(false)
  })

  it('отклоняет период без будних дней (иначе деление на ноль)', () => {
    const result = createPeriod(
      doc(),
      { ...input, dateFrom: '2026-07-04', dateTo: '2026-07-05' },
      'x',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('будн')
  })

  it('отклоняет некорректные даты и пустой label', () => {
    expect(createPeriod(doc(), { ...input, dateFrom: '01.08.2026' }, 'x').ok).toBe(false)
    expect(createPeriod(doc(), { ...input, label: '   ' }, 'x').ok).toBe(false)
  })

  it('пересечение с существующим периодом — мягкое предупреждение', () => {
    const result = ok(
      createPeriod(
        doc(),
        { label: 'Хвост июля', dateFrom: '2026-07-20', dateTo: '2026-08-10' },
        'x',
      ),
    )
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Июль 2026')
  })
})

describe('updatePeriod / deletePeriod (п.16, п.24)', () => {
  const edit = {
    id: 'p-july',
    label: 'Июль 2026 (правка)',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-30',
  }

  it('правит label и даты периода', () => {
    const result = ok(updatePeriod(doc(), edit))
    expect(result.doc.periods[0].label).toBe('Июль 2026 (правка)')
    expect(result.doc.periods[0].date_to).toBe('2026-07-30')
    expect(result.doc.periods[0].status).toBe('open')
  })

  it('правит период с оценками — запрета больше нет (issue #85)', () => {
    const withAssessment = ok(saveAssessment(doc(), validAssessment, NOW)).doc
    const result = ok(updatePeriod(withAssessment, edit))
    expect(result.doc.periods[0].label).toBe('Июль 2026 (правка)')
    expect(result.doc.periods[0].date_to).toBe('2026-07-30')
  })

  it('удаляет пустой период и отказывается удалять период с оценками', () => {
    expect(ok(deletePeriod(doc(), 'p-july')).doc.periods).toHaveLength(0)
    const withAssessment = ok(saveAssessment(doc(), validAssessment, NOW)).doc
    expect(deletePeriod(withAssessment, 'p-july').ok).toBe(false)
  })

  it('применяет к правке те же жёсткие валидации, что и к созданию', () => {
    expect(updatePeriod(doc(), { ...edit, dateFrom: '2026-07-04', dateTo: '2026-07-05' }).ok).toBe(
      false,
    )
    expect(updatePeriod(doc(), { ...edit, dateFrom: '2026-07-31', dateTo: '2026-07-01' }).ok).toBe(
      false,
    )
  })
})

/**
 * Правка дат периода, по которому уже есть оценки (issue #85, пп. 16/24).
 *
 * Семантика — решение владельца: производные поля пересчитываются СРАЗУ по
 * новым датам, но от СОХРАНЁННОГО снэпшота `monthly_rate` оценки. Канон п.15
 * («смена вилки/грейда не трогает старые оценки») этим не нарушается: ставка на
 * момент декларации остаётся ровно той, какой была.
 *
 * Числа проверяются руками, а не пересчётом через тот же `describePeriod`:
 * май–июнь 2026 = 21 будень мая (норма 168 ч) + 22 будня июня (норма 176 ч),
 * итого 43 будня / 344 ч. Эффективная часовая при месячной 200 000 ₽ =
 * (168/344)·(200000/168) + (176/344)·(200000/176) = 400000/344 ≈ 1 162,79 ₽;
 * начисление за 160 ч = round(160 × 1162,79…) = 186 047 ₽; сплит 30 % —
 * доинвестиция round(186047 × 0,3) = 55 814 ₽, деньгами остаток 130 233 ₽.
 */
describe('updatePeriod — пересчёт оценок при смене дат (issue #85, пп. 16/24)', () => {
  const toMayJune = {
    id: 'p-july',
    label: 'Май–июнь 2026',
    dateFrom: '2026-05-01',
    dateTo: '2026-06-30',
  }

  /** Документ с одной сохранённой оценкой Антона (ставка 200 000 ₽/мес). */
  function withAssessment(): HoursDocument {
    return ok(saveAssessment(doc(), validAssessment, NOW)).doc
  }

  /** Документ с `count` оценками по одному периоду — для проверки склонений. */
  function withAssessments(count: number): HoursDocument {
    const participants = Array.from({ length: count }, (_, index) => ({
      email: `p${index}@bbm.academy`,
      name: `Участник ${index}`,
      fork_min: 150_000,
      fork_max: 250_000,
      grade: 'II' as const,
    }))
    let current: HoursDocument = { ...doc(), participants }
    for (const participant of participants) {
      current = ok(
        saveAssessment(current, { ...validAssessment, email: participant.email }, NOW),
      ).doc
    }
    return current
  }

  /** Тот же документ, но участник без вилки и грейда — режим «только часы». */
  function hoursOnly(): HoursDocument {
    const base = doc()
    const bare: HoursDocument = {
      ...base,
      participants: [{ email: 'anton@bbm.academy', name: 'Антон' }],
    }
    return ok(saveAssessment(bare, validAssessment, NOW)).doc
  }

  it('пересчитывает производные поля всех оценок периода по новым датам', () => {
    const result = ok(updatePeriod(withAssessment(), toMayJune))
    const assessment = result.doc.assessments[0]

    expect(assessment.weekday_count).toBe(43)
    expect(assessment.hourly_rate).toBeCloseTo(400_000 / 344, 9)
    expect(assessment.accrual).toBe(186_047)
    expect(assessment.invest_amount).toBe(55_814)
    expect(assessment.cash_amount).toBe(130_233)
    // Сплит по номиналу (п.5) не разъезжается после пересчёта.
    expect(assessment.cash_amount + assessment.invest_amount).toBe(assessment.accrual)
  })

  it('НЕ трогает снэпшот monthly_rate, часы, способ и время сохранения (п.15)', () => {
    const before = withAssessment().assessments[0]
    const after = ok(updatePeriod(withAssessment(), toMayJune)).doc.assessments[0]

    expect(after.monthly_rate).toBe(before.monthly_rate)
    expect(after.monthly_rate).toBe(200_000)
    expect(after.hours).toBe(before.hours)
    expect(after.method).toBe(before.method)
    expect(after.weekend_hours).toBe(before.weekend_hours)
    expect(after.split_percent).toBe(before.split_percent)
    expect(after.saved_at).toBe(before.saved_at)
  })

  it('в режиме «только часы» деньги остаются пустыми, а будни пересчитываются', () => {
    const result = ok(updatePeriod(hoursOnly(), toMayJune))
    const assessment = result.doc.assessments[0]

    expect(assessment.monthly_rate).toBeNull()
    expect(assessment.hourly_rate).toBeNull()
    expect(assessment.accrual).toBe(0)
    expect(assessment.cash_amount).toBe(0)
    expect(assessment.invest_amount).toBe(0)
    expect(assessment.weekday_count).toBe(43)
  })

  it('предупреждает о пересчёте и называет число затронутых оценок', () => {
    const result = ok(updatePeriod(withAssessment(), toMayJune))
    const warning = result.warnings.find((w) => w.includes('ересчитано'))
    expect(warning, 'предупреждение о пересчёте обязано быть').toBeDefined()
    expect(warning).toContain('1')
    expect(warning).toContain('ставки на момент декларации сохранены')
  })

  it('пересчитывает ВСЕ оценки периода и не трогает оценки соседнего периода', () => {
    const base = withAssessment()
    const twoPeriods: HoursDocument = {
      participants: [
        ...base.participants,
        {
          email: 'eduard@bbm.academy',
          name: 'Эдуард',
          role: 'Операции',
          fork_min: 100_000,
          fork_max: 200_000,
          grade: 'I',
        },
      ],
      periods: [
        ...base.periods,
        {
          id: 'p-aug',
          label: 'Август 2026',
          date_from: '2026-08-01',
          date_to: '2026-08-31',
          status: 'open',
        },
      ],
      assessments: base.assessments,
    }
    const withSecond = ok(
      saveAssessment(twoPeriods, { ...validAssessment, email: 'eduard@bbm.academy' }, NOW),
    ).doc
    const foreign = ok(
      saveAssessment(withSecond, { ...validAssessment, periodId: 'p-aug' }, NOW),
    ).doc

    const result = ok(updatePeriod(foreign, toMayJune))
    const july = result.doc.assessments.filter((a) => a.period_id === 'p-july')
    const august = result.doc.assessments.filter((a) => a.period_id === 'p-aug')

    expect(july).toHaveLength(2)
    for (const assessment of july) expect(assessment.weekday_count).toBe(43)
    expect(result.warnings.find((w) => w.includes('ересчитано'))).toContain('2')

    expect(august).toHaveLength(1)
    expect(august[0].weekday_count).toBe(21) // будни августа 2026 — период не тронут
  })

  it('правка одного label не пересчитывает ничего и не предупреждает зря', () => {
    const source = withAssessment()
    const result = ok(
      updatePeriod(source, {
        id: 'p-july',
        label: 'Июль 2026 (опечатка исправлена)',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
      }),
    )
    // Массив оценок не пересобирается: даты те же — пересчитывать нечего.
    expect(result.doc.assessments).toBe(source.assessments)
    expect(result.warnings.find((w) => w.includes('ересчитано'))).toBeUndefined()
    expect(result.doc.periods[0].label).toBe('Июль 2026 (опечатка исправлена)')
  })

  it('цикл дат июль → май-июнь → июль возвращает исходные числа', () => {
    // Настоящая идемпотентность: пересчёт обязан выводиться из снэпшота
    // monthly_rate и часов, а НЕ из предыдущего результата — иначе туда-обратно
    // числа бы «поехали». Правка теми же датами этого не проверяет вовсе:
    // там срабатывает short-circuit `datesChanged === false` (тест выше).
    const source = withAssessment()
    const before = source.assessments[0]

    const moved = ok(updatePeriod(source, toMayJune)).doc
    expect(moved.assessments[0].accrual).not.toBe(before.accrual) // пересчёт был

    const back = ok(
      updatePeriod(moved, {
        id: 'p-july',
        label: 'Июль 2026',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
      }),
    ).doc

    expect(back.assessments[0].weekday_count).toBe(23)
    expect(back.assessments[0].accrual).toBe(173_913)
    expect(back.assessments[0].hourly_rate).toBeCloseTo(200_000 / 184, 9)
    expect(back.assessments[0]).toEqual(before)
  })

  it('сжатие периода ниже заявленных часов — мягкое предупреждение, не блок', () => {
    // 160 ч в периоде из одного календарного дня физически невозможны (п.21);
    // это данные, которые домен уже не принял бы заново, — молчать нельзя.
    const result = ok(
      updatePeriod(withAssessments(2), {
        id: 'p-july',
        label: 'Июль 2026',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-01',
      }),
    )
    const warning = result.warnings.find((w) => w.includes('физически'))
    expect(warning).toBeDefined()
    expect(warning).toContain('24 часа') // 1 календарный день × 24 (п.21)
    expect(warning).toContain('в 2 оценках')
    // Путь починки назван честно: в закрытый период участник не сохранит (п.21),
    // сначала его надо переоткрыть (п.24).
    expect(warning).toContain('переоткр')
  })

  it('склоняет «оценка» по числу в обоих предупреждениях (ревью PR #86)', () => {
    const shrink = {
      id: 'p-july',
      label: 'Июль 2026',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-01',
    }
    const forms = [1, 2, 5].map((count) => {
      const warnings = ok(updatePeriod(withAssessments(count), shrink)).warnings
      return {
        recalculated: warnings.find((w) => w.includes('ересчитано')) ?? '',
        overCeiling: warnings.find((w) => w.includes('физически')) ?? '',
      }
    })

    // Именительный падеж — «пересчитано: N …».
    expect(forms[0].recalculated).toContain('1 оценка')
    expect(forms[1].recalculated).toContain('2 оценки')
    expect(forms[2].recalculated).toContain('5 оценок')

    // Предложный — «заявлено в N …»; именительный здесь неверен при ЛЮБОМ N.
    expect(forms[0].overCeiling).toContain('в 1 оценке')
    expect(forms[1].overCeiling).toContain('в 2 оценках')
    expect(forms[2].overCeiling).toContain('в 5 оценках')
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
      createPeriod(
        doc(),
        { label: 'Август 2026', dateFrom: '2026-08-01', dateTo: '2026-08-31' },
        'p-aug',
      ),
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
    expect(emptyHoursDocument()).toEqual({
      participants: [],
      periods: [],
      assessments: [],
      publications: [],
    })
  })
})
