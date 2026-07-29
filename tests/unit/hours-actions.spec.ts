import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HoursDocument } from '@/lib/hours'

/**
 * Обвязка Server Actions (спека 081 пп. 9, 10, 11).
 *
 * Доменные правила проверены в hours-document/hours-access; здесь проверяется
 * ровно то, что живёт в самих экшенах и больше нигде: каждый вызывает `auth()`
 * САМ и применяет свои гейты САМ. Это принципиально — layout защищает рендер
 * страницы, а экшен вызывается напрямую, минуя её, и «админку не показали» не
 * является защитой.
 */

const authState = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/auth', () => ({ auth: async () => authState.session }))
// revalidatePath требует рантайма Next; кэш-инвалидация здесь не предмет теста.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

const dir = mkdtempSync(join(tmpdir(), 'bbm-hours-actions-'))
const file = join(dir, 'hours.json')
const originalDataFile = process.env.HOURS_DATA_FILE
const originalAdmins = process.env.HOURS_ADMIN_EMAILS

const ADMIN = 'anton@bbm.academy'
const MEMBER = 'eduard@bbm.academy'

const seed: HoursDocument = {
  participants: [
    {
      email: ADMIN,
      name: 'Антон',
      role: 'Продукт',
      fork_min: 150_000,
      fork_max: 250_000,
      grade: 'II',
      monthly_rate: 200_000,
    },
    {
      email: MEMBER,
      name: 'Эдуард',
      role: 'Операции',
      fork_min: 100_000,
      fork_max: 200_000,
      grade: 'I',
      monthly_rate: 150_000,
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

beforeAll(() => {
  process.env.HOURS_DATA_FILE = file
})

afterAll(() => {
  if (originalDataFile === undefined) delete process.env.HOURS_DATA_FILE
  else process.env.HOURS_DATA_FILE = originalDataFile
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  writeFileSync(file, JSON.stringify(seed), 'utf8')
  process.env.HOURS_ADMIN_EMAILS = ADMIN
  authState.session = { user: { email: MEMBER } }
})

afterEach(() => {
  if (originalAdmins === undefined) delete process.env.HOURS_ADMIN_EMAILS
  else process.env.HOURS_ADMIN_EMAILS = originalAdmins
})

const IDLE = { status: 'idle' as const, message: '', warnings: [], saved: null }

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

function onDisk(): HoursDocument {
  return JSON.parse(readFileSync(file, 'utf8')) as HoursDocument
}

/** Все пять мутаций админки с заведомо валидными полями. */
async function adminMutations() {
  const actions = await import('@/modules/hours/actions')
  return [
    {
      name: 'saveParticipantAction',
      run: () =>
        actions.saveParticipantAction(
          IDLE,
          form({
            email: 'new@bbm.academy',
            name: 'Новый',
            role: 'Разработка',
            forkMin: '100000',
            forkMax: '200000',
            grade: 'I',
            monthlyRate: '150000',
          }),
        ),
    },
    {
      name: 'createPeriodAction',
      run: () =>
        actions.createPeriodAction(
          IDLE,
          form({ label: 'Август 2026', dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
        ),
    },
    {
      name: 'updatePeriodAction',
      run: () =>
        actions.updatePeriodAction(
          IDLE,
          form({
            periodId: 'p-july',
            label: 'Июль 2026 (правка)',
            dateFrom: '2026-07-01',
            dateTo: '2026-07-31',
          }),
        ),
    },
    {
      name: 'deletePeriodAction',
      run: () => actions.deletePeriodAction(IDLE, form({ periodId: 'p-july' })),
    },
    {
      name: 'setPeriodStatusAction',
      run: () => actions.setPeriodStatusAction(IDLE, form({ periodId: 'p-july', status: 'closed' })),
    },
  ]
}

describe('мутации админки закрыты от не-админа (п.10, сценарий 9)', () => {
  it('участник вне HOURS_ADMIN_EMAILS получает отказ на всех пяти и ничего не меняет', async () => {
    const before = readFileSync(file, 'utf8')
    for (const mutation of await adminMutations()) {
      const state = await mutation.run()
      expect(state.status, mutation.name).toBe('error')
      expect(state.message, mutation.name).toContain('администратор')
      expect(readFileSync(file, 'utf8'), `${mutation.name} не должен писать на диск`).toBe(before)
    }
  })

  it('пустая HOURS_ADMIN_EMAILS закрывает админку и самому админу (fail-closed)', async () => {
    authState.session = { user: { email: ADMIN } }
    process.env.HOURS_ADMIN_EMAILS = ''
    for (const mutation of await adminMutations()) {
      expect((await mutation.run()).status, mutation.name).toBe('error')
    }
  })

  it('аноним (сессии нет) не проходит ни одну мутацию', async () => {
    authState.session = null
    for (const mutation of await adminMutations()) {
      expect((await mutation.run()).status, mutation.name).toBe('error')
    }
  })

  it('сессия без email не проходит, даже если email в allowlist есть', async () => {
    authState.session = { user: { email: null } }
    for (const mutation of await adminMutations()) {
      const state = await mutation.run()
      expect(state.status, mutation.name).toBe('error')
    }
  })

  it('админ из allowlist те же мутации проходит (гейт не «всегда нет»)', async () => {
    authState.session = { user: { email: ' Anton@BBM.Academy ' } }
    const actions = await import('@/modules/hours/actions')
    const state = await actions.createPeriodAction(
      IDLE,
      form({ label: 'Август 2026', dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
    )
    expect(state.status).toBe('ok')
    expect(onDisk().periods).toHaveLength(2)
  })
})

describe('сохранение оценки — только за себя (п.9, сценарий 6)', () => {
  it('мутация с чужим email отклоняется', async () => {
    const actions = await import('@/modules/hours/actions')
    const state = await actions.saveAssessmentAction(
      IDLE,
      form({
        periodId: 'p-july',
        email: ADMIN, // сессия у MEMBER
        hours: '160',
        method: 'period',
        weekendHours: '0',
        splitPercent: '0',
      }),
    )
    expect(state.status).toBe('error')
    expect(state.message).toContain('только за себя')
    expect(onDisk().assessments).toHaveLength(0)
  })

  it('email оценки берётся из сессии, а не из формы (регистр формы не важен)', async () => {
    const actions = await import('@/modules/hours/actions')
    const state = await actions.saveAssessmentAction(
      IDLE,
      form({
        periodId: 'p-july',
        email: 'EDUARD@BBM.Academy ',
        hours: '80',
        method: 'period',
        weekendHours: '0',
        splitPercent: '0',
      }),
    )
    expect(state.status).toBe('ok')
    expect(state.saved?.email).toBe(MEMBER)
    expect(onDisk().assessments).toHaveLength(1)
    expect(onDisk().assessments[0].email).toBe(MEMBER)
  })

  it('сессия без email не сохраняет ничего (п.8)', async () => {
    authState.session = { user: {} }
    const actions = await import('@/modules/hours/actions')
    const state = await actions.saveAssessmentAction(
      IDLE,
      form({
        periodId: 'p-july',
        email: MEMBER,
        hours: '80',
        method: 'period',
        weekendHours: '0',
        splitPercent: '0',
      }),
    )
    expect(state.status).toBe('error')
    expect(state.message).toContain('email')
    expect(onDisk().assessments).toHaveLength(0)
  })

  it('битые данные на диске — понятный отказ, а не падение', async () => {
    writeFileSync(file, 'не json', 'utf8')
    const actions = await import('@/modules/hours/actions')
    const state = await actions.saveAssessmentAction(
      IDLE,
      form({
        periodId: 'p-july',
        email: MEMBER,
        hours: '80',
        method: 'period',
        weekendHours: '0',
        splitPercent: '0',
      }),
    )
    expect(state.status).toBe('error')
    expect(state.message).toContain('не читаются')
    expect(readFileSync(file, 'utf8')).toBe('не json')
  })
})
