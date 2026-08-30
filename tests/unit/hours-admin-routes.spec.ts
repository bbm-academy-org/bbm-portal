import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HoursDocument, MutationResult } from '@/lib/hours'
import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

const state = vi.hoisted(() => ({
  session: null as unknown,
  audit: null as unknown,
  audits: [] as unknown[],
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
  } as HoursDocument,
}))

vi.mock('@/auth', () => ({ auth: async () => state.session }))
vi.mock('@/lib/hours/store-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hours/store-core')>()
  return {
    ...actual,
    readHoursDocument: vi.fn(async () => state.doc),
    mutateHoursDocument: vi.fn(
      async (audit: unknown, mutate: (doc: HoursDocument) => MutationResult<unknown>) => {
        state.audit = audit
        state.audits.push(audit)
        const result = mutate(state.doc)
        if (result.ok) state.doc = result.doc
        return result
      },
    ),
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
  state.audits = []
  state.doc = {
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
  }
  delete process.env.MATTERMOST_HOURS_WEBHOOK_URL
  vi.unstubAllGlobals()
  vi.resetModules()
})

function makePublicationEligible(messageCount = 2) {
  state.doc.assessments = Array.from({ length: messageCount }, (_, index) => ({
    period_id: '2026-08',
    email: index === 0 ? 'anna@bbm.academy' : `member-${index}@bbm.academy`,
    hours: 8 + index,
    method: 'period' as const,
    weekend_hours: 0,
    split_percent: 20,
    monthly_rate: 120_000,
    hourly_rate: 750,
    accrual: 6_000,
    cash_amount: 4_800,
    invest_amount: 1_200,
    weekday_count: 20,
    saved_at: `2026-08-31T10:0${index}:00.000Z`,
  }))
}

describe('hours cabinet HTTP surface (spec 311 EARS-446..452)', () => {
  it('re-checks platform-admin before the periods handler runs', async () => {
    const { GET } = await import('@/app/(platform)/api/p/hours/admin/periods/route')
    state.session = null
    expect((await GET(request('/api/p/hours/admin/periods'))).status).toBe(403)
    state.session = member
    expect((await GET(request('/api/p/hours/admin/periods'))).status).toBe(403)
  }, 20_000)

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
    expect(
      existsSync(join(process.cwd(), 'src/app/(platform)/api/p/hours/admin/assessments/route.ts')),
    ).toBe(false)
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
    const response = await GET()
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

  it('refuses publication before storage or network access without the webhook', async () => {
    makePublicationEligible(1)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET, POST } = await import('@/app/(platform)/api/p/hours/admin/publication/route')
    const preview = await GET(request('/api/p/hours/admin/publication?periodId=2026-08'))
    const fingerprint = (await preview.json()).data.previewFingerprint as string
    const response = await POST(
      request('/api/p/hours/admin/publication', 'POST', {
        periodId: '2026-08',
        previewFingerprint: fingerprint,
      }),
    )
    expect(response.status).toBe(409)
    expect(state.audits).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('publishes sequentially and attributes the batch plus every delivery update', async () => {
    makePublicationEligible(2)
    process.env.MATTERMOST_HOURS_WEBHOOK_URL = 'https://chat.bbm.academy/hooks/hours'
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET, POST } = await import('@/app/(platform)/api/p/hours/admin/publication/route')
    const preview = await GET(request('/api/p/hours/admin/publication?periodId=2026-08'))
    const fingerprint = (await preview.json()).data.previewFingerprint as string
    const response = await POST(
      request('/api/p/hours/admin/publication', 'POST', {
        periodId: '2026-08',
        previewFingerprint: fingerprint,
      }),
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(state.doc.publications?.[0]).toMatchObject({
      status: 'published',
      messages: [{ delivery: 'sent' }, { delivery: 'sent' }],
    })
    expect(state.audits).toEqual([
      { actorEmail: 'admin@bbm.local', source: 'portal' },
      { actorEmail: 'admin@bbm.local', source: 'portal' },
      { actorEmail: 'admin@bbm.local', source: 'portal' },
    ])
  })

  it('records a failed delivery, stops, and blocks automatic retry', async () => {
    makePublicationEligible(2)
    process.env.MATTERMOST_HOURS_WEBHOOK_URL = 'https://chat.bbm.academy/hooks/hours'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET, POST } = await import('@/app/(platform)/api/p/hours/admin/publication/route')
    const preview = await GET(request('/api/p/hours/admin/publication?periodId=2026-08'))
    const fingerprint = (await preview.json()).data.previewFingerprint as string
    const response = await POST(
      request('/api/p/hours/admin/publication', 'POST', {
        periodId: '2026-08',
        previewFingerprint: fingerprint,
      }),
    )

    expect(response.status).toBe(409)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(state.doc.publications?.[0]).toMatchObject({
      status: 'incomplete',
      messages: [{ delivery: 'sent' }, { delivery: 'failed' }],
    })
    const retry = await POST(
      request('/api/p/hours/admin/publication', 'POST', {
        periodId: '2026-08',
        previewFingerprint: fingerprint,
      }),
    )
    expect(retry.status).toBe(409)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('records an unknown result on network ambiguity and never continues', async () => {
    makePublicationEligible(2)
    process.env.MATTERMOST_HOURS_WEBHOOK_URL = 'https://chat.bbm.academy/hooks/hours'
    const fetchMock = vi.fn(async () => {
      throw new Error('timeout')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { GET, POST } = await import('@/app/(platform)/api/p/hours/admin/publication/route')
    const preview = await GET(request('/api/p/hours/admin/publication?periodId=2026-08'))
    const fingerprint = (await preview.json()).data.previewFingerprint as string
    const response = await POST(
      request('/api/p/hours/admin/publication', 'POST', {
        periodId: '2026-08',
        previewFingerprint: fingerprint,
      }),
    )
    expect(response.status).toBe(409)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.doc.publications?.[0]?.messages.map((message) => message.delivery)).toEqual([
      'unknown',
      'pending',
    ])
  })
})
import { existsSync } from 'node:fs'
import { join } from 'node:path'
