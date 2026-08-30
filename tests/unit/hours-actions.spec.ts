import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HoursDocument } from '@/lib/hours'

const authState = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/auth', () => ({ auth: async () => authState.session }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

const store = vi.hoisted(() => ({ doc: null as unknown, writes: 0, audit: null as unknown }))
vi.mock('@/lib/hours', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hours')>()
  return {
    ...actual,
    readHoursDocument: async () => store.doc,
    mutateHoursDocument: async (
      audit: unknown,
      mutate: (doc: HoursDocument) => import('@/lib/hours').MutationResult<unknown>,
    ) => {
      store.audit = audit
      const result = mutate(store.doc as HoursDocument)
      if (result.ok) {
        store.doc = result.doc
        store.writes += 1
      }
      return result
    },
  }
})

const member = 'member@bbm.academy'
const seed: HoursDocument = {
  participants: [{ email: member, name: 'Участник', role: null, grade: null }],
  periods: [
    {
      id: '2026-08',
      label: 'Август 2026',
      date_from: '2026-08-01',
      date_to: '2026-08-31',
      status: 'open',
    },
  ],
  assessments: [],
  publications: [],
}

const idle = { status: 'idle' as const, message: '', warnings: [], saved: null }

function assessmentForm(email = member): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    email,
    periodId: '2026-08',
    hours: '8',
    method: 'period',
    weekendHours: '0',
    splitPercent: '20',
  })) {
    data.set(key, value)
  }
  return data
}

beforeEach(() => {
  store.doc = structuredClone(seed)
  store.writes = 0
  store.audit = null
  authState.session = { user: { email: member } }
})

describe('hours participant action after cabinet migration', () => {
  it('keeps /p/hours self-assessment behavior and attributes the write', async () => {
    const { saveAssessmentAction } = await import('@/modules/hours/actions')
    const result = await saveAssessmentAction(idle, assessmentForm())
    expect(result.status).toBe('ok')
    expect(store.writes).toBe(1)
    expect(store.audit).toEqual({ actorEmail: member, source: 'portal' })
  })

  it('still refuses writing an assessment for another participant', async () => {
    const { saveAssessmentAction } = await import('@/modules/hours/actions')
    const result = await saveAssessmentAction(idle, assessmentForm('other@bbm.academy'))
    expect(result.status).toBe('error')
    expect(store.writes).toBe(0)
  })
})
