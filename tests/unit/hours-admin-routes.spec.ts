import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

const state = vi.hoisted(() => ({
  session: null as unknown,
  audit: null as unknown,
  doc: {
    participants: [
      {
        email: 'anna@bbm.academy',
        name: 'Анна',
        role: 'Продюсер',
        fork_min: 100_000,
        fork_max: 160_000,
        grade: 'II',
      },
    ],
    periods: [
      {
        id: '2026-08',
        label: 'Август 2026',
        date_from: '2026-08-01',
        date_to: '2026-08-31',
        status: 'closed',
      },
    ],
    assessments: [],
    publications: [],
  },
}))

vi.mock('@/auth', () => ({ auth: async () => state.session }))
vi.mock('@/lib/hours/store-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hours/store-core')>()
  return {
    ...actual,
    readHoursDocument: vi.fn(async () => state.doc),
    mutateHoursDocument: vi.fn(async (audit: unknown, mutate: (doc: unknown) => unknown) => {
      state.audit = audit
      return mutate(state.doc)
    }),
  }
})

const admin = { user: { email: ' ADMIN@bbm.local ', roles: [PLATFORM_ADMIN_ROLE] } }
const member = { user: { email: 'member@bbm.local', roles: [PLATFORM_USER_ROLE] } }

function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://portal.bbm.academy${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  state.session = admin
  state.audit = null
  vi.resetModules()
})

describe('hours cabinet HTTP surface (spec 311 EARS-446..452)', () => {
  it('re-checks platform-admin before the periods handler runs', async () => {
    const { GET } = await import('@/app/(platform)/api/p/hours/admin/periods/route')
    state.session = null
    expect((await GET(request('/api/p/hours/admin/periods'))).status).toBe(403)
    state.session = member
    expect((await GET(request('/api/p/hours/admin/periods'))).status).toBe(403)
  })

  it('lists periods with assessments and publication lock state', async () => {
    const { GET } = await import('@/app/(platform)/api/p/hours/admin/periods/route')
    const response = await GET(request('/api/p/hours/admin/periods'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      total: 1,
      data: [{ id: '2026-08', locked: false, assessments: [] }],
    })
  })

  it('attributes a period write to the signed-in platform admin', async () => {
    const { POST } = await import('@/app/(platform)/api/p/hours/admin/periods/route')
    const response = await POST(
      request('/api/p/hours/admin/periods', 'POST', {
        label: 'Сентябрь 2026',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
      }),
    )
    expect(response.status).toBe(200)
    expect(state.audit).toEqual({ actorEmail: 'admin@bbm.local', source: 'portal' })
  })

  it('keeps period deletion only for records without assessments', async () => {
    const { DELETE } = await import('@/app/(platform)/api/p/hours/admin/periods/[id]/route')
    const response = await DELETE(request('/api/p/hours/admin/periods/2026-08', 'DELETE'), {
      params: Promise.resolve({ id: '2026-08' }),
    })
    expect(response.status).toBe(200)
    expect(state.audit).toEqual({ actorEmail: 'admin@bbm.local', source: 'portal' })
  })

  it('rejects email changes and exposes no assessment mutation handler', async () => {
    const participant =
      await import('@/app/(platform)/api/p/hours/admin/participants/[email]/route')
    const assessment = await import('@/app/(platform)/api/p/hours/admin/assessments/route').catch(
      () => null,
    )
    expect(assessment).toBeNull()
    const response = await participant.PATCH(
      request('/api/p/hours/admin/participants/anna%40bbm.academy', 'PATCH', {
        email: 'other@bbm.academy',
        name: 'Анна',
      }),
      { params: Promise.resolve({ email: 'anna%40bbm.academy' }) },
    )
    expect(response.status).toBe(400)
  })

  it('returns the legacy JSON document byte-for-byte as an attachment', async () => {
    const { GET } = await import('@/app/(platform)/api/p/hours/admin/export/route')
    const response = await GET(request('/api/p/hours/admin/export'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(JSON.stringify(state.doc, null, 2))
    expect(response.headers.get('content-disposition')).toContain('attachment')
  })

  it('builds a publication preview without publishing it', async () => {
    const { GET } = await import('@/app/(platform)/api/p/hours/admin/publication/route')
    const response = await GET(request('/api/p/hours/admin/publication?periodId=2026-08'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        periodId: '2026-08',
        eligibility: { status: 'empty', canPublish: false },
        messages: [],
      },
    })
  })
})
