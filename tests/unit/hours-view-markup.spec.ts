import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
  PeriodHeader,
  SignedInAs,
  SummaryTable,
} from '@/modules/hours/view/components'
// Таблица участников живёт отдельным файлом (как SavedCard): её тянет и
// серверная страница, и клиентская обвязка админки (issue #85).
import { ParticipantsTable } from '@/modules/hours/view/ParticipantsTable'
import { SavedCard } from '@/modules/hours/view/SavedCard'

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
    // ставка вычисляется: 150k + ½·(250k−150k) = 200 000 (решение 2026-07-30)
    fork_min: 150_000,
    fork_max: 250_000,
    grade: 'II',
  },
  {
    email: 'eduard@bbm.academy',
    name: 'Эдуард',
    role: 'Операции',
    fork_min: 100_000,
    fork_max: 200_000,
    grade: 'I',
  },
  // Участник «только имя + email» — вилки и грейда ещё нет (issue #83 п.5).
  {
    email: 'new@bbm.academy',
    name: 'Новый',
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

describe('ParticipantsTable (spec 102 — grouped desktop table)', () => {
  it('groups participant/fork details and shows monthly + selected-period hourly rates', () => {
    const host = render(
      React.createElement(ParticipantsTable, { participants, summaryPeriod: july }),
    )
    const rows = host.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)

    expect([...host.querySelectorAll('thead th')].map((cell) => text(cell))).toEqual([
      'Участник',
      'Вилка и грейд',
      'Ставка, ₽/мес',
      'Ставка, ₽/ч',
    ])
    expect(text(host.querySelector('.hours-rate-period'))).toBe(
      'Часовая ставка рассчитана для «Июль 2026» (01.07.2026—31.07.2026)',
    )

    const first = text(rows[0])
    expect(first).toContain('Антон')
    expect(first).toContain('Продукт')
    expect(first).toContain('150 000')
    expect(first).toContain('250 000')
    expect(first).toContain('II')
    expect(first).toContain('200 000 ₽') // 150k + ½·(250k−150k), не хранится
    expect(first).toContain('1 087 ₽') // отображение округляет 200 000 / 184
    expect(rows[0].querySelector('.hours-participant-name')).not.toBeNull()
    expect(rows[0].querySelector('.hours-participant-role')).not.toBeNull()
    expect(rows[0].querySelector('.hours-fork')).not.toBeNull()
    expect(rows[0].querySelector('.hours-grade')).not.toBeNull()

    // грейд I — середина нижней трети: 100k + ⅙·100k = 116 667
    expect(text(rows[1])).toContain('116 667 ₽')
  })

  it('участник без вилки и роли — прочерки, а не пустые ячейки (issue #83)', () => {
    const host = render(
      React.createElement(ParticipantsTable, { participants, summaryPeriod: july }),
    )
    const minimal = host.querySelectorAll('tbody tr')[2]
    const cells = [...minimal.querySelectorAll('td')].map((cell) => text(cell))
    expect(text(minimal.querySelector('.hours-participant-name'))).toBe('Новый')
    expect(text(minimal.querySelector('.hours-participant-role'))).toBe('—')
    expect(text(minimal.querySelector('.hours-fork'))).toBe('—')
    expect(text(minimal.querySelector('.hours-grade'))).toBe('—')
    expect(cells[2]).toBe('—') // месячная ставка не вычисляется
    expect(cells[3]).toBe('—') // часовая ставка не вычисляется
  })

  it('пустой список не рисует пустую таблицу молча', () => {
    const host = render(
      React.createElement(ParticipantsTable, { participants: [], summaryPeriod: july }),
    )
    expect(text(host)).toContain('участник')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0)
  })

  it('without periods explains the missing calendar and shows no hourly values', () => {
    const host = render(
      React.createElement(ParticipantsTable, { participants, summaryPeriod: null }),
    )
    expect(text(host.querySelector('.hours-rate-period'))).toBe(
      'Нет периода для расчёта часовой ставки.',
    )
    const hourlyCells = [...host.querySelectorAll('tbody tr')].map((row) =>
      text(row.querySelectorAll('td')[3]),
    )
    expect(hourlyCells).toEqual(['—', '—', '—'])
  })

  it('без обработчика правки колонки действий нет — /p/hours правку не предлагает', () => {
    const host = render(
      React.createElement(ParticipantsTable, { participants, summaryPeriod: july }),
    )
    expect(host.querySelector('button')).toBeNull()
    expect(host.querySelectorAll('thead th')).toHaveLength(4)
  })

  it('с обработчиком правки у каждой строки есть кнопка «Изменить» (issue #85)', () => {
    const host = render(
      React.createElement(ParticipantsTable, {
        participants,
        summaryPeriod: july,
        onEdit: () => undefined,
      }),
    )
    const buttons = [...host.querySelectorAll('tbody button')]
    expect(buttons).toHaveLength(3)
    for (const button of buttons) expect(text(button)).toBe('Изменить')
    // Кнопка не отправляет форму строки — она только заполняет форму ниже.
    expect(buttons.every((b) => b.getAttribute('type') === 'button')).toBe(true)
    expect([...host.querySelectorAll('thead th')].map((cell) => text(cell))).toEqual([
      'Участник',
      'Вилка и грейд',
      'Ставка, ₽/мес',
      'Ставка, ₽/ч',
      'Правка',
    ])
  })

  it('кнопки различимы на слух: доступное имя называет участника', () => {
    // Три кнопки «Изменить» подряд для скринридера неразличимы — имя строки
    // обязано попасть в доступное имя кнопки.
    const host = render(
      React.createElement(ParticipantsTable, {
        participants,
        summaryPeriod: july,
        onEdit: () => undefined,
      }),
    )
    const labels = [...host.querySelectorAll('tbody button')].map((b) =>
      b.getAttribute('aria-label'),
    )
    expect(labels).toEqual(['Изменить Антон', 'Изменить Эдуард', 'Изменить Новый'])
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
    const host = render(React.createElement(SummaryTable, { rows: [{ name: null, assessment }] }))
    expect(text(host.querySelector('tbody tr'))).toContain('anton@bbm.academy')
  })

  it('колонка сплита называется «В проекте», а не «В 4X» (лексика — issue #83 п.9)', () => {
    const host = render(React.createElement(SummaryTable, { rows }))
    const headers = [...host.querySelectorAll('th')].map((th) => text(th))
    expect(headers).toContain('В проекте')
    expect(headers).not.toContain('В 4X')
  })
})

describe('SavedCard (п.21)', () => {
  it('подтверждает сохранение итоговыми числами', () => {
    const host = render(React.createElement(SavedCard, { assessment, periodLabel: 'Июль 2026' }))
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

  it('строка сплита — «оставлено в проекте», не «доинвестиция в 4X» (issue #83 п.9)', () => {
    const content = text(
      render(React.createElement(SavedCard, { assessment, periodLabel: 'Июль 2026' })),
    )
    expect(content).toContain('в проекте')
    expect(content).not.toContain('Доинвестиция в 4X')
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

describe('что реально уезжает в клиентский бандл (п.27)', () => {
  const moduleDir = join(REPO_ROOT, 'src', 'modules', 'hours')
  const viewDir = join(moduleDir, 'view')

  /** Файл модуля по import-спецификатору; null — импорт за пределы модуля. */
  function resolve(spec: string, fromDir: string): string | null {
    const path = spec.startsWith('./')
      ? join(fromDir, spec.slice(2))
      : spec.startsWith('@/modules/hours/')
        ? join(moduleDir, spec.slice('@/modules/hours/'.length))
        : null
    if (!path) return null
    for (const candidate of [`${path}.tsx`, `${path}.ts`]) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  /**
   * Импорты, которые реально попадают в бандл: `import type` стирается
   * компилятором и ничего не тянет, поэтому в счёт не идёт.
   */
  function importsOf(file: string): string[] {
    const source = readFileSync(file, 'utf8')
    return [...source.matchAll(/(?:^|\n)\s*import\s+([\s\S]*?)from\s+'([^']+)'/g)]
      .filter((match) => !match[1].trimStart().startsWith('type'))
      .map((match) => match[2])
  }

  /**
   * Транзитивное замыкание клиентского бандла. Корни — файлы с директивой
   * 'use client' (директива тут не предмет проверки, а способ найти вход);
   * проверяется СЛЕДСТВИЕ: что через эти входы утягивается.
   */
  function clientClosure(): { files: Set<string>; specs: Set<string> } {
    const roots = readdirSync(viewDir)
      .map((name) => join(viewDir, name))
      .filter((path) => /\.tsx?$/.test(path))
      .filter((path) => readFileSync(path, 'utf8').startsWith("'use client'"))
    expect(roots.length, 'в модуле должен быть хотя бы один клиентский вход').toBeGreaterThan(0)

    const files = new Set<string>()
    const specs = new Set<string>()
    const queue = [...roots]
    while (queue.length > 0) {
      const current = queue.pop()!
      if (files.has(current)) continue
      files.add(current)
      for (const spec of importsOf(current)) {
        specs.add(spec)
        const next = resolve(spec, join(current, '..'))
        // 'use server' — граница: клиент получает сетевую заглушку экшена, а
        // не его код, поэтому обход дальше не идёт (как и у бандлера).
        if (next && !readFileSync(next, 'utf8').startsWith("'use server'")) queue.push(next)
      }
    }
    return { files, specs }
  }

  it('серверные компоненты страницы не утягиваются в бандл через калькулятор', () => {
    // Бандлер тянет МОДУЛЬ целиком, а не использованный экспорт: импорт одной
    // карточки из components.tsx увёз бы в браузер и таблицу участников, и
    // сводку, и все плашки. Карточка поэтому живёт отдельным файлом.
    const { files } = clientClosure()
    expect([...files].map((f) => f.replace(/\\/g, '/'))).not.toContain(
      join(viewDir, 'components.tsx').replace(/\\/g, '/'),
    )
    expect([...files].some((f) => f.endsWith('SavedCard.tsx'))).toBe(true)
  })

  it('в клиентский бандл не тянется ни барель домена, ни node:fs', () => {
    // Барель @/lib/hours реэкспортирует store.ts с `node:fs`. Клиентские файлы
    // импортируют домен точечно — это единственная причина такого правила.
    const { specs } = clientClosure()
    expect([...specs]).not.toContain('@/lib/hours')
    expect([...specs].filter((spec) => spec.startsWith('node:'))).toEqual([])
  })
})

describe('контракт стилей модуля (п.29 — палитра принадлежит поверхности)', () => {
  const css = readFileSync(join(REPO_ROOT, 'src', 'modules', 'hours', 'view', 'hours.css'), 'utf8')

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

  it('reset и цвет ссылок не перебивают компонентные классы (issue #83 пп.1, 7)', () => {
    // Первопричина бага отступов и «зелёного на зелёном»: правило вида
    // `.hours-root p` / `.hours-root a` имеет специфичность (0,1,1) и бьёт
    // одноклассовые `.hours-notice` (padding) и `.hours-btn` (color) — (0,1,0).
    // Базовые правила с типом элемента обязаны сидеть в :where(...) с нулевой
    // специфичностью, чтобы ЛЮБОЙ класс компонента их перекрывал.
    expect(css).toMatch(/:where\([^)]*\.hours-root p\b[^)]*\)\s*\{[^}]*margin: 0/)
    expect(css).toMatch(/:where\(\.hours-root\) a\s*\{/)
    expect(css).not.toMatch(/^\s*\.hours-root a\s*\{/m)
    // reset-блок «margin: 0; padding: 0» существует только внутри :where(...)
    expect(css).not.toMatch(/^\.hours-root h1,$/m)
  })

  it('desktop table wraps roles without clipping and keeps numbers aligned', () => {
    expect(css).toMatch(/\.hours-table th,\s*\.hours-table td\s*\{[^}]*white-space:\s*nowrap/)
    expect(css).toMatch(
      /\.hours-participants-table th,\s*\.hours-participants-table td\s*\{[^}]*white-space:\s*normal/,
    )
    expect(css).toMatch(/\.hours-participant-role\s*\{[^}]*white-space:\s*normal/)
    expect(css).toMatch(/\.hours-participant-role\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.hours-participant-role\s*\{[^}]*text-overflow:\s*clip/)
    expect(css).toMatch(/\.hours-table \.hours-num\s*\{[^}]*text-align:\s*right/)
    expect(css).toMatch(/\.hours-table \.hours-num\s*\{[^}]*white-space:\s*nowrap/)
  })
})
