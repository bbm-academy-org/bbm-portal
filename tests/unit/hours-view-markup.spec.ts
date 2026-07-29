import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { describePeriod } from '@/lib/hours'
import type { Assessment, Participant, Period } from '@/lib/hours'
import {
  DataUnavailable,
  FormulaBreakdown,
  NoPeriodsNotice,
  NotAParticipantNotice,
  ParticipantsTable,
  PeriodHeader,
  SavedCard,
  SignedInAs,
  SummaryTable,
} from '@/modules/hours/view/components'

/**
 * Разметка вью модуля часов (спека 081 пп. 8, 9, 19, 20, 21, 22). Проверяется
 * то, что владелец увидит глазами на приёмке: «вошёл как …» (доказательство
 * email-claim'а), таблица участников, честная формула с числом будней и
 * помесячной разбивкой, сводка оценок.
 */

const REPO_ROOT = join(__dirname, '..', '..')

const participants: Participant[] = [
  {
    email: 'anton@bbm.academy',
    name: 'Антон',
    role: 'Продукт',
    fork_min: 150_000,
    fork_max: 250_000,
    grade: 'II',
    monthly_rate: 200_000,
  },
  {
    email: 'eduard@bbm.academy',
    name: 'Эдуард',
    role: 'Операции',
    fork_min: 100_000,
    fork_max: 200_000,
    grade: 'I',
    monthly_rate: 150_000,
  },
]

const july: Period = {
  id: 'p-july',
  label: 'Июль 2026',
  date_from: '2026-07-01',
  date_to: '2026-07-31',
  status: 'open',
}

const assessment: Assessment = {
  period_id: 'p-july',
  email: 'anton@bbm.academy',
  hours: 160,
  method: 'period',
  weekend_hours: 12,
  split_percent: 30,
  monthly_rate: 200_000,
  hourly_rate: 200_000 / 184,
  accrual: 173_913,
  cash_amount: 121_739,
  invest_amount: 52_174,
  weekday_count: 23,
  saved_at: '2026-08-01T09:00:00.000Z',
}

function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(element)
  return host
}

/** Текст без неразрывных пробелов — сравнивать удобнее, смысл тот же. */
function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

describe('SignedInAs (п.8 — email-claim виден глазами)', () => {
  it('называет email сессии', () => {
    const host = render(React.createElement(SignedInAs, { email: 'anton@bbm.academy' }))
    expect(text(host)).toContain('ошёл как')
    expect(text(host)).toContain('anton@bbm.academy')
  })

  it('без email в сессии говорит об этом прямо — мутации откажут', () => {
    const host = render(React.createElement(SignedInAs, { email: '' }))
    expect(text(host)).toContain('email')
    expect(text(host)).not.toContain('ошёл как ')
  })
})

describe('NotAParticipantNotice (п.9, сценарий 7)', () => {
  it('объясняет, что делать', () => {
    const host = render(React.createElement(NotAParticipantNotice))
    const content = text(host)
    expect(content).toContain('нет в списке участников')
    expect(content).toContain('администратору')
  })
})

describe('ParticipantsTable (п.19)', () => {
  it('показывает имя, роль, вилку, грейд и месячную ставку', () => {
    const host = render(React.createElement(ParticipantsTable, { participants }))
    const rows = host.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)

    const first = text(rows[0])
    expect(first).toContain('Антон')
    expect(first).toContain('Продукт')
    expect(first).toContain('150 000')
    expect(first).toContain('250 000')
    expect(first).toContain('II')
    expect(first).toContain('200 000 ₽')
  })

  it('пустой список не рисует пустую таблицу молча', () => {
    const host = render(React.createElement(ParticipantsTable, { participants: [] }))
    expect(text(host)).toContain('участник')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0)
  })
})

describe('PeriodHeader (п.20)', () => {
  it('называет период, диапазон дат и число будних дней', () => {
    const host = render(
      React.createElement(PeriodHeader, {
        period: july,
        calendar: describePeriod(july.date_from, july.date_to),
      }),
    )
    const content = text(host)
    expect(content).toContain('Июль 2026')
    expect(content).toContain('01.07.2026')
    expect(content).toContain('31.07.2026')
    expect(content).toContain('23')
    expect(content).toContain('будн')
  })

  it('помечает закрытый период', () => {
    const host = render(
      React.createElement(PeriodHeader, {
        period: { ...july, status: 'closed' },
        calendar: describePeriod(july.date_from, july.date_to),
      }),
    )
    expect(text(host)).toContain('закрыт')
  })
})

describe('FormulaBreakdown (п.20, сценарии 3–4)', () => {
  it('показывает формулу с числом будней и часовой ≈ 1 087 ₽ (июль)', () => {
    const host = render(
      React.createElement(FormulaBreakdown, {
        calendar: describePeriod('2026-07-01', '2026-07-31'),
        monthlyRate: 200_000,
      }),
    )
    const content = text(host)
    expect(content).toContain('23')
    expect(content).toContain('184')
    expect(content).toContain('1 087 ₽')
    expect(content).toContain('200 000 ₽')
  })

  it('для многомесячного периода даёт помесячную разбивку и эффективную ≈ 1 163 ₽', () => {
    const host = render(
      React.createElement(FormulaBreakdown, {
        calendar: describePeriod('2026-05-01', '2026-06-30'),
        monthlyRate: 200_000,
      }),
    )
    const content = text(host)
    expect(content).toContain('1 163 ₽')
    // помесячные ставки видны честно, а не спрятаны за средним
    expect(content).toContain('май 2026')
    expect(content).toContain('июнь 2026')
    expect(content).toContain('1 190 ₽')
    expect(content).toContain('1 136 ₽')
    expect(host.querySelectorAll('[data-month]')).toHaveLength(2)
  })

  it('без ставки участника денег не показывает вовсе (п.9)', () => {
    const host = render(
      React.createElement(FormulaBreakdown, {
        calendar: describePeriod('2026-07-01', '2026-07-31'),
        monthlyRate: null,
      }),
    )
    const content = text(host)
    expect(content).toContain('23')
    expect(content).not.toContain('₽')
  })
})

describe('SummaryTable (п.22)', () => {
  const rows = [{ name: 'Антон', assessment }]

  it('показывает имя, часы, способ, начисление, сплит в ₽/% и время', () => {
    const host = render(React.createElement(SummaryTable, { rows }))
    const row = text(host.querySelector('tbody tr'))
    expect(row).toContain('Антон')
    expect(row).toContain('160')
    expect(row).toContain('по часам за период')
    expect(row).toContain('173 913 ₽')
    expect(row).toContain('121 739 ₽')
    expect(row).toContain('52 174 ₽')
    expect(row).toContain('30%')
    expect(row).toContain('01.08.2026')
  })

  it('пустая сводка говорит, что оценок пока нет', () => {
    const host = render(React.createElement(SummaryTable, { rows: [] }))
    expect(text(host)).toContain('оцен')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0)
  })

  it('участник без имени в списке всё равно виден по email', () => {
    const host = render(
      React.createElement(SummaryTable, { rows: [{ name: null, assessment }] }),
    )
    expect(text(host.querySelector('tbody tr'))).toContain('anton@bbm.academy')
  })
})

describe('SavedCard (п.21)', () => {
  it('подтверждает сохранение итоговыми числами', () => {
    const host = render(
      React.createElement(SavedCard, { assessment, periodLabel: 'Июль 2026' }),
    )
    const content = text(host)
    expect(content).toContain('сохранена')
    expect(content).toContain('Июль 2026')
    expect(content).toContain('160')
    expect(content).toContain('173 913 ₽')
    expect(content).toContain('121 739 ₽')
    expect(content).toContain('52 174 ₽')
    // справочная детализация выходных (п.4)
    expect(content).toContain('12')
  })
})

describe('NoPeriodsNotice / DataUnavailable (п.17, п.22)', () => {
  it('без периодов страница говорит об этом явно', () => {
    expect(text(render(React.createElement(NoPeriodsNotice)))).toContain('период')
  })

  it('битые данные — «данные недоступны», а не пустая страница', () => {
    expect(text(render(React.createElement(DataUnavailable)))).toContain('анные недоступны')
  })
})

describe('контракт клиентской интерактивности (п.27)', () => {
  const viewDir = join(REPO_ROOT, 'src', 'modules', 'hours', 'view')

  it('калькулятор — отдельный клиентский компонент', () => {
    const source = readFileSync(join(viewDir, 'Calculator.tsx'), 'utf8')
    expect(source.startsWith("'use client'")).toBe(true)
  })

  it('презентационные компоненты остаются серверными (без use client)', () => {
    const source = readFileSync(join(viewDir, 'components.tsx'), 'utf8')
    expect(source).not.toContain("'use client'")
  })
})

describe('контракт стилей модуля (п.29 — палитра принадлежит поверхности)', () => {
  const css = readFileSync(
    join(REPO_ROOT, 'src', 'modules', 'hours', 'view', 'hours.css'),
    'utf8',
  )

  it('токены объявлены на корне поверхности, а не на :root группы', () => {
    expect(css).toMatch(/\.hours-root\s*\{[^}]*--page:/)
    expect(css).not.toMatch(/^:root\s*\{/m)
  })

  it('фон холста красит сама поверхность (per-surface, не вся группа)', () => {
    expect(css).toMatch(/body:has\(\.hours-root\)\s*\{[^}]*background:/)
  })

  it('поддерживает тёмную тему системы и явный переключатель', () => {
    expect(css).toContain('prefers-color-scheme: dark')
    expect(css).toMatch(/\[data-theme=['"]dark['"]\]/)
    expect(css).toMatch(/\[data-theme=['"]light['"]\]/)
  })
})
