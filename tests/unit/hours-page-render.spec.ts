import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HoursDocument } from '@/lib/hours'

/**
 * Сборка страницы `/p/hours` целиком (спека 081, сценарии 2–4): сессия →
 * документ с диска → участник → открытый период → числа.
 *
 * Markup-тесты проверяют компоненты по отдельности; здесь проверяется, что
 * страница из них действительно собирается и показывает ПРАВИЛЬНЫЕ числа для
 * конкретного залогиненного email'а — то, что владелец увидит на приёмке.
 * Сервер-экшены замоканы: их гейты живут в своих тестах, а тянуть `next/cache`
 * в юнит незачем.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'Anton@BBM.Academy' } }) }))
vi.mock('@/modules/hours/actions', () => {
  const idle = async () => ({ status: 'idle', message: '', warnings: [], saved: null })
  return {
    createPeriodAction: idle,
    deletePeriodAction: idle,
    publishHoursToMattermostAction: idle,
    saveAssessmentAction: idle,
    saveParticipantAction: idle,
    setPeriodStatusAction: idle,
    updatePeriodAction: idle,
  }
})

/**
 * Хранилище модуля часов — ин-мемори двойник (`tests/helpers/hours-store-double.ts`).
 *
 * С #255 (спека 124) `@/lib/hours` отдаёт хранилище на схеме `core`, и фолбэка на
 * JSON у модуля нет (EARS-12): засеять документ временным файлом этот тир больше
 * не может — и не должен. Предмет здесь обвязка, а документ — фикстура; таблицы,
 * транзакция и advisory-лок проверяются в `tests/int/platform/hours-core*.int.spec.ts`.
 */
const store = vi.hoisted(() => ({ doc: null as unknown, writes: 0 }))
vi.mock('@/lib/hours', async (importOriginal) => {
  const { hoursStoreDouble } = await import('../helpers/hours-store-double')
  return { ...(await importOriginal<typeof import('@/lib/hours')>()), ...hoursStoreDouble(store) }
})

/** Заменяет документ в хранилище (аналог прежнего `writeFileSync` фикстуры). */
function setDocument(doc: unknown): void {
  store.doc = { publications: [], ...(doc as object) }
  store.writes = 0
}

const seed: HoursDocument = {
  participants: [
    {
      email: 'anton@bbm.academy',
      name: 'Антон',
      role: 'Продукт',
      // вычисленная ставка: 150k + ½·(250k−150k) = 200 000 ₽/мес
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
    {
      id: 'p-may-june',
      label: 'Май–июнь 2026',
      date_from: '2026-05-01',
      date_to: '2026-06-30',
      status: 'closed',
    },
  ],
  assessments: [
    {
      period_id: 'p-july',
      email: 'anton@bbm.academy',
      hours: 160,
      method: 'period',
      weekend_hours: 0,
      split_percent: 30,
      monthly_rate: 200_000,
      hourly_rate: 200_000 / 184,
      accrual: 173_913,
      cash_amount: 121_739,
      invest_amount: 52_174,
      weekday_count: 23,
      saved_at: '2026-08-01T09:00:00.000Z',
    },
  ],
}

beforeEach(() => {
  setDocument(seed)
})

async function renderPage(params: Record<string, string> = {}): Promise<string> {
  const { default: HoursPage } = await import('@/app/(platform)/p/hours/page')
  const element = await HoursPage({ searchParams: Promise.resolve(params) })
  // Неразрывные пробелы разрядов — к обычным, иначе ожидания нечитаемы.
  return renderToStaticMarkup(element).replace(/ /g, ' ')
}

function sectionByHeading(html: string, heading: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  const section = [...host.querySelectorAll('section')].find((candidate) =>
    candidate.querySelector('h2')?.textContent?.includes(heading),
  )
  if (!section) throw new Error(`Section not found: ${heading}`)
  return section as HTMLElement
}

describe('страница /p/hours собирается целиком', () => {
  it('заголовок «Сколько было отработано», под ним крупно имя участника (issue #83 пп.2-3)', async () => {
    const html = await renderPage()
    expect(html).toContain('Сколько было отработано')
    expect(html).not.toContain('Сколько ты отработал?')
    // Имя из participants по email сессии — берёт на себя приёмочную роль
    // «Вошёл как» (проверка email-claim, спека п.8).
    expect(html).toMatch(/hours-person[^>]*>Антон</)
  })

  it('хиро без лид-абзаца, строки «Вошёл как» и ссылки на админку (issue #83 п.2)', async () => {
    const html = await renderPage()
    expect(html).not.toContain('Оцени фактические часы')
    expect(html).not.toContain('ошёл как')
    expect(html).not.toContain('Админка часов')
    expect(html).not.toContain('/p/hours/admin')
  })

  it('называет участника, период и часовую ставку 1 087 ₽ (ставка — из вилки и грейда)', async () => {
    const html = await renderPage()
    expect(html).toContain('Антон')
    expect(html).toContain('Июль 2026')
    expect(html).toContain('01.07.2026')
    expect(html).toContain('1 087 ₽')
  })

  it('selected summary period drives the participant hourly rate and visible caption', async () => {
    const html = await renderPage({ period: 'p-may-june' })
    const participantsSection = sectionByHeading(html, 'Участники')
    const summarySection = sectionByHeading(html, 'Сводка оценок')

    expect(participantsSection.textContent).toContain('Май–июнь 2026')
    expect(participantsSection.textContent).toContain('01.05.2026—30.06.2026')
    expect(participantsSection.textContent).toContain('1 163 ₽')
    expect(summarySection.querySelector('select')?.getAttribute('value')).toBe(null)
    expect(summarySection.querySelector('option[selected]')?.getAttribute('value')).toBe(
      'p-may-june',
    )
  })

  it('показывает сводку с сохранённой оценкой (открытая верификация)', async () => {
    const html = await renderPage()
    expect(html).toContain('173 913 ₽')
    expect(html).toContain('121 739 ₽')
    expect(html).toContain('52 174 ₽')
  })

  it('ползунок «Часов в рабочий день» ограничен 12 (issue #83 п.8)', async () => {
    const html = await renderPage()
    expect(html).toMatch(/id="hours-day"[^>]*max="12"/)
  })

  it('лексика сплита: «оставляю в проекте», а не «доинвестиция в 4X» (issue #83 п.9)', async () => {
    const html = await renderPage()
    expect(html).toContain('Оставляю в проекте, увеличивая свою долю')
    expect(html).not.toContain('доинвестицией в 4X')
    expect(html).not.toContain('Доля доинвестиции в 4X')
    // сводка и таймлайн согласованы с легендой
    expect(html).toContain('В проекте')
    expect(html).not.toContain('В 4X</th>')
  })

  it('рисует ровно одну карточку сохранённой оценки, а не две', async () => {
    // Раньше карточку рисовали и страница, и калькулятор — после сохранения
    // участник видел рядом старые и новые числа.
    const html = await renderPage()
    expect(html.match(/hours-saved__cap/g) ?? []).toHaveLength(1)
  })

  it('для одномесячного периода помесячной разбивки нет — она там не нужна', async () => {
    const html = await renderPage()
    expect(html).not.toContain('data-month')
  })
})

describe('страница показывает помесячную разбивку многомесячного периода (п.20, сценарий 4)', () => {
  beforeEach(() => {
    // Кейс владельца «Май–июнь 2026» одним периодом: 21 + 22 будня. Ставка
    // часа считается по КАЖДОМУ полному месяцу, и участник обязан видеть это
    // на странице, а не только итоговую эффективную.
    setDocument({
      participants: seed.participants,
      periods: [
        {
          id: 'p-may-june',
          label: 'Май–июнь 2026',
          date_from: '2026-05-01',
          date_to: '2026-06-30',
          status: 'open',
        },
      ],
      assessments: [],
    })
  })

  it('показывает эффективную 1 163 ₽ и обе помесячные ставки', async () => {
    const html = await renderPage()
    expect(html).toContain('Май–июнь 2026')
    expect(html).toContain('1 163 ₽')
    expect(html).toContain('май 2026')
    expect(html).toContain('июнь 2026')
    expect(html).toContain('1 190 ₽')
    expect(html).toContain('1 136 ₽')
    // ровно два месяца в разбивке
    expect(html.match(/data-month=/g) ?? []).toHaveLength(2)
  })

  it('называет 43 будних дня и норму 344 ч', async () => {
    const html = await renderPage()
    expect(html).toContain('43 будних дня')
    expect(html).toContain('344 ч')
  })

  it('без ставки участника денежной части на странице нет (п.9)', async () => {
    setDocument({
      participants: [],
      periods: [
        {
          id: 'p-may-june',
          label: 'Май–июнь 2026',
          date_from: '2026-05-01',
          date_to: '2026-06-30',
          status: 'open',
        },
      ],
      assessments: [],
    })
    const html = await renderPage()
    expect(html).toContain('нет в списке участников')
    expect(html).toContain('43 будних дня')
    expect(html).not.toContain('1 163 ₽')
    // залогиненного нет в participants — под заголовком его email
    expect(html).toMatch(/hours-person[^>]*>anton@bbm\.academy</)
  })
})

describe('участник без вилки и грейда — режим «только часы» (issue #83 п.5)', () => {
  beforeEach(() => {
    setDocument({
      participants: [{ email: 'anton@bbm.academy', name: 'Антон' }],
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
    })
  })

  it('денежная часть не показывается, но он участник: плашки «нет в списке» нет, сохранять можно', async () => {
    const html = await renderPage()
    expect(html).toContain('Сколько было отработано')
    expect(html).toMatch(/hours-person[^>]*>Антон</)
    expect(html).not.toContain('нет в списке участников')
    expect(html).not.toContain('сохранить оценку нельзя')
    // ставки нет — формула честно говорит об этом, денег на странице нет
    expect(html).toContain('Месячной ставки нет')
    expect(html).not.toContain('1 087 ₽')
    // в таблице участников — прочерки вместо вилки и ставки
    expect(html).toMatch(/<td[^>]*>—<\/td>/)
  })
})

describe('страницы без периодов (spec 102)', () => {
  beforeEach(() => {
    setDocument({ participants: seed.participants, periods: [], assessments: [] })
  })

  it('public page explains why hourly rates are unavailable', async () => {
    const html = await renderPage()
    const participantsSection = sectionByHeading(html, 'Участники')
    expect(participantsSection.textContent).toContain('Нет периода для расчёта часовой ставки.')
    expect(participantsSection.querySelectorAll('tbody td:nth-child(4)')).toHaveLength(1)
    expect(participantsSection.querySelector('tbody td:nth-child(4)')?.textContent).toBe('—')
  })
})
