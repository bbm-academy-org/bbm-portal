import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HoursDataError, type HoursDocument, type MutationResult } from '@/lib/hours'
import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

const state = vi.hoisted(() => ({
  session: null as unknown,
  audit: null as unknown,
  audits: [] as unknown[],
  dataError: null as Error | null,
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
    readHoursDocument: vi.fn(async () => {
      if (state.dataError) throw state.dataError
      return state.doc
    }),
    mutateHoursDocument: vi.fn(
      async (audit: unknown, mutate: (doc: HoursDocument) => MutationResult<unknown>) => {
        if (state.dataError) throw state.dataError
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
  state.dataError = null
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
  it('EARS-472: safely names unavailable Hours data across list, read and save handlers', async () => {
    const [periods, period, participants, participant, publication] = await Promise.all([
      import('@/app/(platform)/api/p/hours/admin/periods/route'),
      import('@/app/(platform)/api/p/hours/admin/periods/[id]/route'),
      import('@/app/(platform)/api/p/hours/admin/participants/route'),
      import('@/app/(platform)/api/p/hours/admin/participants/[email]/route'),
      import('@/app/(platform)/api/p/hours/admin/publication/route'),
    ])
    const periodContext = { params: Promise.resolve({ id: '2026-08' }) }
    const participantContext = {
      params: Promise.resolve({ email: 'anna%40bbm.academy' }),
    }
    const attempts: Array<[string, () => Promise<Response>]> = [
      ['period list', () => periods.GET(request('/api/p/hours/admin/periods'))],
      [
        'period create',
        () =>
          periods.POST(
            request('/api/p/hours/admin/periods', 'POST', {
              label: 'September 2026',
              dateFrom: '2026-09-01',
              dateTo: '2026-09-30',
            }),
          ),
      ],
      [
        'period read',
        () => period.GET(request('/api/p/hours/admin/periods/2026-08'), periodContext),
      ],
      [
        'period update',
        () =>
          period.PATCH(
            request('/api/p/hours/admin/periods/2026-08', 'PATCH', { status: 'closed' }),
            periodContext,
          ),
      ],
      [
        'period delete',
        () => period.DELETE(request('/api/p/hours/admin/periods/2026-08', 'DELETE'), periodContext),
      ],
      ['participant list', () => participants.GET(request('/api/p/hours/admin/participants'))],
      [
        'participant create',
        () =>
          participants.POST(
            request('/api/p/hours/admin/participants', 'POST', {
              email: 'new@bbm.academy',
              name: 'New participant',
              role: null,
              forkMin: null,
              forkMax: null,
              grade: null,
            }),
          ),
      ],
      [
        'participant read',
        () =>
          participant.GET(
            request('/api/p/hours/admin/participants/anna%40bbm.academy'),
            participantContext,
          ),
      ],
      [
        'participant update',
        () =>
          participant.PATCH(
            request('/api/p/hours/admin/participants/anna%40bbm.academy', 'PATCH', {
              name: 'Anna',
              role: null,
              forkMin: null,
              forkMax: null,
              grade: null,
            }),
            participantContext,
          ),
      ],
      [
        'publication preview',
        () => publication.GET(request('/api/p/hours/admin/publication?periodId=2026-08')),
      ],
    ]

    state.dataError = new HoursDataError(
      'connect ECONNREFUSED postgres://hours_writer:secret@private-host/hours',
    )
    const safeMessage =
      'Данные недоступны: база модуля часов не отвечает. Повторите попытку позже или обратитесь к владельцу.'

    for (const [label, attempt] of attempts) {
      const response = await attempt()
      expect(response.status, label).toBe(503)
      expect(await response.json(), label).toEqual({
        error: { code: 'unavailable', message: safeMessage },
      })
    }
  })

  it('EARS-451: every hours admin handler re-checks platform-admin', async () => {
    const [periods, period, participants, participant, publication] = await Promise.all([
      import('@/app/(platform)/api/p/hours/admin/periods/route'),
      import('@/app/(platform)/api/p/hours/admin/periods/[id]/route'),
      import('@/app/(platform)/api/p/hours/admin/participants/route'),
      import('@/app/(platform)/api/p/hours/admin/participants/[email]/route'),
      import('@/app/(platform)/api/p/hours/admin/publication/route'),
    ])
    const periodContext = { params: Promise.resolve({ id: '2026-08' }) }
    const participantContext = {
      params: Promise.resolve({ email: 'anna%40bbm.academy' }),
    }
    const attempts: Array<[string, () => Promise<Response>]> = [
      ['period list', () => periods.GET(request('/api/p/hours/admin/periods'))],
      [
        'period create',
        () =>
          periods.POST(
            request('/api/p/hours/admin/periods', 'POST', {
              label: 'Сентябрь 2026',
              dateFrom: '2026-09-01',
              dateTo: '2026-09-30',
            }),
          ),
      ],
      [
        'period read',
        () => period.GET(request('/api/p/hours/admin/periods/2026-08'), periodContext),
      ],
      [
        'period update',
        () =>
          period.PATCH(
            request('/api/p/hours/admin/periods/2026-08', 'PATCH', { status: 'closed' }),
            periodContext,
          ),
      ],
      [
        'period delete',
        () => period.DELETE(request('/api/p/hours/admin/periods/2026-08', 'DELETE'), periodContext),
      ],
      ['participant list', () => participants.GET(request('/api/p/hours/admin/participants'))],
      [
        'participant create',
        () =>
          participants.POST(
            request('/api/p/hours/admin/participants', 'POST', {
              email: 'new@bbm.academy',
              name: 'Новый участник',
              role: null,
              forkMin: null,
              forkMax: null,
              grade: null,
            }),
          ),
      ],
      [
        'participant read',
        () =>
          participant.GET(
            request('/api/p/hours/admin/participants/anna%40bbm.academy'),
            participantContext,
          ),
      ],
      [
        'participant update',
        () =>
          participant.PATCH(
            request('/api/p/hours/admin/participants/anna%40bbm.academy', 'PATCH', {
              name: 'Анна',
              role: null,
              forkMin: null,
              forkMax: null,
              grade: null,
            }),
            participantContext,
          ),
      ],
      [
        'publication preview',
        () => publication.GET(request('/api/p/hours/admin/publication?periodId=2026-08')),
      ],
      [
        'publication publish',
        () =>
          publication.POST(
            request('/api/p/hours/admin/publication', 'POST', {
              periodId: '2026-08',
              previewFingerprint: 'fingerprint',
            }),
          ),
      ],
    ]

    for (const deniedSession of [null, member]) {
      state.session = deniedSession
      for (const [label, attempt] of attempts) {
        expect((await attempt()).status, label).toBe(403)
      }
    }
  }, 30_000)

  it('lists periods with assessments and publication lock state', async () => {
    const { GET } = await import('@/app/(platform)/api/p/hours/admin/periods/route')
    const response = await GET(request('/api/p/hours/admin/periods'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      total: 1,
      data: [{ id: '2026-08', locked: false, assessments: [] }],
    })
  })

  it('preserves non-alphabetic participant and non-chronological period insertion order', async () => {
    state.doc.participants = [
      {
        email: 'yana@bbm.academy',
        name: 'Яна',
        role: null,
        fork_min: null,
        fork_max: null,
        grade: null,
      },
      {
        email: 'anna@bbm.academy',
        name: 'Анна',
        role: null,
        fork_min: null,
        fork_max: null,
        grade: null,
      },
    ]
    state.doc.periods = [
      {
        id: 'first-in-document',
        label: 'Первый в документе',
        date_from: '2026-01-01',
        date_to: '2026-01-31',
        status: 'closed',
      },
      {
        id: 'second-in-document',
        label: 'Второй в документе',
        date_from: '2026-12-01',
        date_to: '2026-12-31',
        status: 'closed',
      },
    ]

    const participants = await import('@/app/(platform)/api/p/hours/admin/participants/route')
    const periods = await import('@/app/(platform)/api/p/hours/admin/periods/route')
    const participantResponse = await participants.GET(
      request('/api/p/hours/admin/participants?pageSize=100'),
    )
    const periodResponse = await periods.GET(request('/api/p/hours/admin/periods?pageSize=100'))
    const participantPayload = await participantResponse.json()
    const periodPayload = await periodResponse.json()

    expect(participantPayload.data.map((record: { email: string }) => record.email)).toEqual([
      'yana@bbm.academy',
      'anna@bbm.academy',
    ])
    expect(periodPayload.data.map((record: { id: string }) => record.id)).toEqual([
      'first-in-document',
      'second-in-document',
    ])
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

  it('returns the immutable published batch after participant identity drift', async () => {
    makePublicationEligible(1)
    state.doc.participants[0] = {
      ...state.doc.participants[0],
      name: 'Анна после публикации',
      role: 'Новая роль',
      grade: 'III',
    }
    state.doc.publications = [
      {
        period_id: '2026-08',
        status: 'published',
        started_at: '2026-08-31T12:00:00.000Z',
        published_at: '2026-08-31T12:01:00.000Z',
        preview_fingerprint: 'sha256:frozen',
        messages: [
          {
            email: 'anna@bbm.academy',
            text: '**Верификация часов — Анна на момент публикации**',
            delivery: 'sent',
            sent_at: '2026-08-31T12:01:00.000Z',
          },
        ],
      },
    ]

    const { GET } = await import('@/app/(platform)/api/p/hours/admin/publication/route')
    const response = await GET(request('/api/p/hours/admin/publication?periodId=2026-08'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: 'mattermost-publication',
        periodId: '2026-08',
        previewFingerprint: 'sha256:frozen',
        messages: [
          {
            email: 'anna@bbm.academy',
            text: '**Верификация часов — Анна на момент публикации**',
            delivery: 'sent',
            sentAt: '2026-08-31T12:01:00.000Z',
          },
        ],
        eligibility: {
          status: 'published',
          canPublish: false,
          reason: 'Период уже опубликован в Mattermost.',
        },
        publicationStatus: 'published',
        startedAt: '2026-08-31T12:00:00.000Z',
        publishedAt: '2026-08-31T12:01:00.000Z',
      },
    })
  })

  it('returns persisted sent, unknown and failed delivery progress', async () => {
    makePublicationEligible(3)
    state.doc.publications = [
      {
        period_id: '2026-08',
        status: 'incomplete',
        started_at: '2026-08-31T12:00:00.000Z',
        published_at: null,
        preview_fingerprint: 'sha256:incomplete',
        messages: [
          {
            email: 'anna@bbm.academy',
            text: 'Сохранённое сообщение 1',
            delivery: 'sent',
            sent_at: '2026-08-31T12:00:10.000Z',
          },
          {
            email: 'member-1@bbm.academy',
            text: 'Сохранённое сообщение 2',
            delivery: 'unknown',
            sent_at: null,
          },
          {
            email: 'member-2@bbm.academy',
            text: 'Сохранённое сообщение 3',
            delivery: 'failed',
            sent_at: null,
          },
        ],
      },
    ]

    const { GET } = await import('@/app/(platform)/api/p/hours/admin/publication/route')
    const response = await GET(request('/api/p/hours/admin/publication?periodId=2026-08'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toMatchObject({
      previewFingerprint: 'sha256:incomplete',
      publicationStatus: 'incomplete',
      startedAt: '2026-08-31T12:00:00.000Z',
      publishedAt: null,
      messages: [
        { text: 'Сохранённое сообщение 1', delivery: 'sent' },
        { text: 'Сохранённое сообщение 2', delivery: 'unknown' },
        { text: 'Сохранённое сообщение 3', delivery: 'failed' },
      ],
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
