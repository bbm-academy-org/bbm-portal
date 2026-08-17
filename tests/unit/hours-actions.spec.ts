import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HoursDataError } from '@/lib/hours'
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
    },
    {
      email: MEMBER,
      name: 'Эдуард',
      role: 'Операции',
      fork_min: 100_000,
      fork_max: 200_000,
      grade: 'I',
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

beforeEach(() => {
  setDocument(seed)
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

/** Документ, который сейчас лежит в хранилище. */
function stored(): HoursDocument {
  return store.doc as HoursDocument
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
      run: () =>
        actions.setPeriodStatusAction(IDLE, form({ periodId: 'p-july', status: 'closed' })),
    },
  ]
}

describe('мутации админки закрыты от не-админа (п.10, сценарий 9)', () => {
  it('EARS-32: участник вне HOURS_ADMIN_EMAILS получает отказ на всех пяти и ничего не меняет', async () => {
    const before = JSON.stringify(stored())
    for (const mutation of await adminMutations()) {
      const state = await mutation.run()
      expect(state.status, mutation.name).toBe('error')
      expect(state.message, mutation.name).toContain('администратор')
      expect(store.writes, `${mutation.name} не должен ничего записывать`).toBe(0)
      expect(JSON.stringify(stored()), mutation.name).toBe(before)
    }
  })

  it('EARS-32: пустая HOURS_ADMIN_EMAILS закрывает админку и самому админу (fail-closed)', async () => {
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

  it('EARS-32: админ из allowlist те же мутации проходит (гейт не «всегда нет»)', async () => {
    authState.session = { user: { email: ' Anton@BBM.Academy ' } }
    const actions = await import('@/modules/hours/actions')
    const state = await actions.createPeriodAction(
      IDLE,
      form({ label: 'Август 2026', dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
    )
    expect(state.status).toBe('ok')
    expect(stored().periods).toHaveLength(2)
  })
})

describe('заведение участника — вилка и грейд необязательны (issue #83)', () => {
  it('админ заводит участника только с именем и email — пустые поля формы становятся null', async () => {
    authState.session = { user: { email: ADMIN } }
    const actions = await import('@/modules/hours/actions')
    const state = await actions.saveParticipantAction(
      IDLE,
      form({
        email: 'new@bbm.academy',
        name: 'Новый',
        role: '',
        forkMin: '',
        forkMax: '',
        grade: '',
      }),
    )
    expect(state.status).toBe('ok')
    const saved = stored().participants.find((p) => p.email === 'new@bbm.academy')
    expect(saved).toMatchObject({
      name: 'Новый',
      role: null,
      fork_min: null,
      fork_max: null,
      grade: null,
    })
    expect(saved).not.toHaveProperty('monthly_rate')
  })

  it('мусор в границе вилки — отказ, а не молчаливый null', async () => {
    authState.session = { user: { email: ADMIN } }
    const actions = await import('@/modules/hours/actions')
    const state = await actions.saveParticipantAction(
      IDLE,
      form({
        email: 'new@bbm.academy',
        name: 'Новый',
        role: '',
        forkMin: 'сто',
        forkMax: '',
        grade: '',
      }),
    )
    expect(state.status).toBe('error')
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
    expect(stored().assessments).toHaveLength(0)
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
    expect(stored().assessments).toHaveLength(1)
    expect(stored().assessments[0].email).toBe(MEMBER)
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
    expect(stored().assessments).toHaveLength(0)
  })

  it('EARS-12: нечитаемое хранилище — понятный отказ, а не падение', async () => {
    store.doc = new HoursDataError('Данные модуля часов недоступны.')
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
    expect(state.message).toContain('база модуля часов не отвечает')
    expect(store.writes).toBe(0)
  })
})

/**
 * Правка периода, по которому уже есть оценки (issue #85). Домен проверен в
 * hours-document; здесь проверяется, что экшен доносит пересчёт до диска и
 * показывает предупреждение форме — то, что владелец увидит на приёмке.
 */
describe('правка периода с оценками — пересчёт доезжает до диска (issue #85)', () => {
  beforeEach(() => {
    setDocument({
      ...seed,
      assessments: [
        {
          period_id: 'p-july',
          email: ADMIN,
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
    } satisfies HoursDocument)
    authState.session = { user: { email: ADMIN } }
  })

  it('меняет даты, пересчитывает оценку и предупреждает о числе пересчитанных', async () => {
    const actions = await import('@/modules/hours/actions')
    const state = await actions.updatePeriodAction(
      IDLE,
      form({
        periodId: 'p-july',
        label: 'Май–июнь 2026',
        dateFrom: '2026-05-01',
        dateTo: '2026-06-30',
      }),
    )
    expect(state.status).toBe('ok')
    const warning = state.warnings.find((w) => w.includes('ересчитано'))
    expect(warning).toBeDefined()
    expect(warning).toContain('1')

    const saved = stored().assessments[0]
    expect(saved.weekday_count).toBe(43)
    expect(saved.accrual).toBe(186_047)
    expect(saved.monthly_rate).toBe(200_000) // снэпшот на момент декларации (п.15)
    expect(stored().periods[0].label).toBe('Май–июнь 2026')
  })

  it('удаление периода с оценками по-прежнему закрыто', async () => {
    const actions = await import('@/modules/hours/actions')
    const state = await actions.deletePeriodAction(IDLE, form({ periodId: 'p-july' }))
    expect(state.status).toBe('error')
    expect(stored().periods).toHaveLength(1)
  })
})
