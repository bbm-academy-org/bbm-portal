import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/modules/hours/actions', () => ({
  saveAssessmentAction: async () => ({ status: 'idle', message: '', warnings: [], saved: null }),
}))

const dir = mkdtempSync(join(tmpdir(), 'bbm-hours-page-'))
const file = join(dir, 'hours.json')
const originalDataFile = process.env.HOURS_DATA_FILE
const originalAdmins = process.env.HOURS_ADMIN_EMAILS

const seed: HoursDocument = {
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

beforeAll(() => {
  writeFileSync(file, JSON.stringify(seed), 'utf8')
  process.env.HOURS_DATA_FILE = file
  process.env.HOURS_ADMIN_EMAILS = 'anton@bbm.academy'
})

afterAll(() => {
  if (originalDataFile === undefined) delete process.env.HOURS_DATA_FILE
  else process.env.HOURS_DATA_FILE = originalDataFile
  if (originalAdmins === undefined) delete process.env.HOURS_ADMIN_EMAILS
  else process.env.HOURS_ADMIN_EMAILS = originalAdmins
  rmSync(dir, { recursive: true, force: true })
})

async function renderPage(params: Record<string, string> = {}): Promise<string> {
  const { default: HoursPage } = await import('@/app/(platform)/p/hours/page')
  const element = await HoursPage({ searchParams: Promise.resolve(params) })
  // Неразрывные пробелы разрядов — к обычным, иначе ожидания нечитаемы.
  return renderToStaticMarkup(element).replace(/ /g, ' ')
}

describe('страница /p/hours собирается целиком', () => {
  it('называет email сессии, участника, период и часовую ставку 1 087 ₽', async () => {
    const html = await renderPage()
    expect(html).toContain('ошёл как')
    expect(html).toContain('anton@bbm.academy')
    expect(html).toContain('Антон')
    expect(html).toContain('Июль 2026')
    expect(html).toContain('01.07.2026')
    expect(html).toContain('1 087 ₽')
  })

  it('показывает сводку с сохранённой оценкой (открытая верификация)', async () => {
    const html = await renderPage()
    expect(html).toContain('173 913 ₽')
    expect(html).toContain('121 739 ₽')
    expect(html).toContain('52 174 ₽')
  })

  it('показывает админу ссылку на админку (allowlist)', async () => {
    const html = await renderPage()
    expect(html).toContain('/p/hours/admin')
  })
})
