import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildMattermostPreview, createPublicationBatch } from '@/lib/hours'
import type { HoursDocument, Publication } from '@/lib/hours'

const authState = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/auth', () => ({ auth: async () => authState.session }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

interface PublicationActionState {
  status: 'idle' | 'ok' | 'error'
  message: string
}

type PublishAction = (
  previous: PublicationActionState,
  formData: FormData,
) => Promise<PublicationActionState>

type PublicationDocument = HoursDocument & { publications?: Publication[] }

interface DeliveryApi {
  recordPublicationDelivery: (
    doc: PublicationDocument,
    periodId: string,
    messageIndex: number,
    delivery: 'sent' | 'failed' | 'unknown',
    at: string,
  ) =>
    | { ok: false; error: string }
    | { ok: true; doc: PublicationDocument; warnings: string[]; saved: Publication }
}

const ADMIN = 'anton@bbm.academy'
const MEMBER = 'member@bbm.academy'
const WEBHOOK = 'https://chat.bbm.academy/hooks/hours-test'
const IDLE: PublicationActionState = { status: 'idle', message: '' }

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
    { email: 'eduard@bbm.academy', name: 'Эдуард', role: 'Операции', grade: 'I' },
    { email: 'new@bbm.academy', name: 'Новый' },
  ],
  periods: [
    {
      id: 'p-july',
      label: 'Июль 2026',
      date_from: '2026-07-01',
      date_to: '2026-07-31',
      status: 'closed',
    },
  ],
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
    {
      period_id: 'p-july',
      email: 'eduard@bbm.academy',
      hours: 80,
      method: 'week',
      weekend_hours: 0,
      split_percent: 0,
      monthly_rate: 150_000,
      hourly_rate: 150_000 / 184,
      accrual: 65_217,
      cash_amount: 65_217,
      invest_amount: 0,
      weekday_count: 23,
      saved_at: '2026-08-01T09:01:00.000Z',
    },
    {
      period_id: 'p-july',
      email: 'new@bbm.academy',
      hours: 40,
      method: 'day',
      weekend_hours: 0,
      split_percent: 20,
      monthly_rate: null,
      hourly_rate: null,
      accrual: 0,
      cash_amount: 0,
      invest_amount: 0,
      weekday_count: 23,
      saved_at: '2026-08-01T09:02:00.000Z',
    },
  ],
}

const dir = mkdtempSync(join(tmpdir(), 'bbm-hours-publication-actions-'))
const file = join(dir, 'hours.json')
const originalDataFile = process.env.HOURS_DATA_FILE
const originalAdmins = process.env.HOURS_ADMIN_EMAILS
const originalWebhook = process.env.MATTERMOST_HOURS_WEBHOOK_URL

beforeAll(() => {
  process.env.HOURS_DATA_FILE = file
})

beforeEach(() => {
  vi.clearAllMocks()
  writeFileSync(file, JSON.stringify(seed), 'utf8')
  process.env.HOURS_ADMIN_EMAILS = ADMIN
  process.env.MATTERMOST_HOURS_WEBHOOK_URL = WEBHOOK
  authState.session = { user: { email: ADMIN } }
  vi.stubGlobal('fetch', vi.fn<typeof fetch>())
})

afterAll(() => {
  if (originalDataFile === undefined) delete process.env.HOURS_DATA_FILE
  else process.env.HOURS_DATA_FILE = originalDataFile
  if (originalAdmins === undefined) delete process.env.HOURS_ADMIN_EMAILS
  else process.env.HOURS_ADMIN_EMAILS = originalAdmins
  if (originalWebhook === undefined) delete process.env.MATTERMOST_HOURS_WEBHOOK_URL
  else process.env.MATTERMOST_HOURS_WEBHOOK_URL = originalWebhook
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

function onDisk(): PublicationDocument {
  return JSON.parse(readFileSync(file, 'utf8')) as PublicationDocument
}

function fingerprint(): string {
  return buildMattermostPreview(onDisk(), 'p-july').preview_fingerprint
}

function publishForm(previewFingerprint: string): FormData {
  const data = new FormData()
  data.set('periodId', 'p-july')
  data.set('previewFingerprint', previewFingerprint)
  return data
}

async function publishAction(): Promise<PublishAction> {
  const actions = await import('@/modules/hours/actions')
  const candidate = (actions as unknown as { publishHoursToMattermostAction?: PublishAction })
    .publishHoursToMattermostAction
  expect(
    candidate,
    'PHASE B3: export publishHoursToMattermostAction from hours actions',
  ).toBeTypeOf('function')
  return candidate as PublishAction
}

async function deliveryApi(): Promise<DeliveryApi> {
  const hours = (await import('@/lib/hours')) as unknown as Partial<DeliveryApi>
  expect(
    hours.recordPublicationDelivery,
    'PHASE B3: export recordPublicationDelivery from the hours domain',
  ).toBeTypeOf('function')
  return hours as DeliveryApi
}

function fetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.mocked(globalThis.fetch)
}

describe('pure delivery transitions (spec 100 requirements 10–11)', () => {
  function batch(): { doc: PublicationDocument; publication: Publication } {
    const preview = buildMattermostPreview(seed, 'p-july')
    const created = createPublicationBatch(
      seed,
      'p-july',
      preview.preview_fingerprint,
      '2026-08-02T00:00:00.000Z',
    )
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.error)
    return { doc: created.doc, publication: created.saved }
  }

  it('persists each pending → sent transition and publishes only after all messages are sent', async () => {
    const { recordPublicationDelivery } = await deliveryApi()
    const created = batch()

    const first = recordPublicationDelivery(
      created.doc,
      'p-july',
      0,
      'sent',
      '2026-08-02T00:00:01.000Z',
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.saved.status).toBe('sending')
    expect(first.saved.published_at).toBeNull()
    expect(first.saved.messages.map((message) => message.delivery)).toEqual([
      'sent',
      'pending',
      'pending',
    ])
    expect(first.saved.messages[0].sent_at).toBe('2026-08-02T00:00:01.000Z')

    const second = recordPublicationDelivery(
      first.doc,
      'p-july',
      1,
      'sent',
      '2026-08-02T00:00:02.000Z',
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const complete = recordPublicationDelivery(
      second.doc,
      'p-july',
      2,
      'sent',
      '2026-08-02T00:00:03.000Z',
    )
    expect(complete.ok).toBe(true)
    if (!complete.ok) return
    expect(complete.saved.status).toBe('published')
    expect(complete.saved.published_at).toBe('2026-08-02T00:00:03.000Z')
    expect(complete.saved.messages.every((message) => message.delivery === 'sent')).toBe(true)
  })

  it.each(['failed', 'unknown'] as const)(
    '%s marks the batch incomplete, leaves later messages pending and never publishes',
    async (outcome) => {
      const { recordPublicationDelivery } = await deliveryApi()
      const created = batch()
      const result = recordPublicationDelivery(
        created.doc,
        'p-july',
        0,
        outcome,
        '2026-08-02T00:00:01.000Z',
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.saved.status).toBe('incomplete')
      expect(result.saved.published_at).toBeNull()
      expect(result.saved.messages.map((message) => message.delivery)).toEqual([
        outcome,
        'pending',
        'pending',
      ])
      expect(result.saved.messages[0].sent_at).toBeNull()
    },
  )

  it('does not auto-retry a sending or incomplete batch', async () => {
    const { recordPublicationDelivery } = await deliveryApi()
    const created = batch()
    const duplicate = createPublicationBatch(
      created.doc,
      'p-july',
      created.publication.preview_fingerprint,
      '2026-08-02T00:00:01.000Z',
    )
    expect(duplicate.ok).toBe(false)

    const incomplete = recordPublicationDelivery(
      created.doc,
      'p-july',
      0,
      'unknown',
      '2026-08-02T00:00:01.000Z',
    )
    expect(incomplete.ok).toBe(true)
    if (!incomplete.ok) return
    const retry = recordPublicationDelivery(
      incomplete.doc,
      'p-july',
      0,
      'sent',
      '2026-08-02T00:00:02.000Z',
    )
    expect(retry.ok).toBe(false)
  })
})

describe('publish action gates (spec 100 requirements 7, 9, 11)', () => {
  it('rejects a non-admin before secret lookup/fetch and leaves JSON byte-for-byte unchanged', async () => {
    const publish = await publishAction()
    authState.session = { user: { email: MEMBER } }
    delete process.env.MATTERMOST_HOURS_WEBHOOK_URL
    const before = readFileSync(file, 'utf8')

    const state = await publish(IDLE, publishForm('stale'))

    expect(state.status).toBe('error')
    expect(state.message).toContain('администратор')
    expect(fetchMock()).not.toHaveBeenCalled()
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('fails closed when HOURS_ADMIN_EMAILS is empty', async () => {
    const publish = await publishAction()
    process.env.HOURS_ADMIN_EMAILS = ''
    const state = await publish(IDLE, publishForm(fingerprint()))
    expect(state.status).toBe('error')
    expect(fetchMock()).not.toHaveBeenCalled()
    expect(onDisk().publications ?? []).toEqual([])
  })

  it('missing MATTERMOST_HOURS_WEBHOOK_URL creates no batch and makes no request', async () => {
    const publish = await publishAction()
    const previewFingerprint = fingerprint()
    delete process.env.MATTERMOST_HOURS_WEBHOOK_URL

    const state = await publish(IDLE, publishForm(previewFingerprint))

    expect(state.status).toBe('error')
    expect(state.message).toMatch(/Mattermost|настроен|секрет/i)
    expect(fetchMock()).not.toHaveBeenCalled()
    expect(onDisk().publications ?? []).toEqual([])
  })

  it('stale preview creates neither webhook calls nor a publications record', async () => {
    const publish = await publishAction()
    const stale = fingerprint()
    const changed = onDisk()
    changed.assessments[0].hours = 161
    writeFileSync(file, JSON.stringify(changed), 'utf8')

    const state = await publish(IDLE, publishForm(stale))

    expect(state.status).toBe('error')
    expect(state.message).toContain('редпросмотр')
    expect(fetchMock()).not.toHaveBeenCalled()
    expect(onDisk().publications ?? []).toEqual([])
  })
})

describe('publish action delivery (spec 100 requirements 8, 10–11)', () => {
  it('posts exact { text } bodies sequentially and accepts only 200 + body "ok"', async () => {
    const publish = await publishAction()
    const preview = buildMattermostPreview(onDisk(), 'p-july')
    fetchMock().mockImplementation(async () => new Response('ok', { status: 200 }))

    const state = await publish(IDLE, publishForm(preview.preview_fingerprint))

    expect(state.status).toBe('ok')
    expect(fetchMock()).toHaveBeenCalledTimes(3)
    for (const [index, call] of fetchMock().mock.calls.entries()) {
      const [url, init] = call
      expect(url).toBe(WEBHOOK)
      expect(init?.method).toBe('POST')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(JSON.parse(String(init?.body))).toEqual({ text: preview.messages[index].text })
      expect(Object.keys(JSON.parse(String(init?.body)) as Record<string, unknown>)).toEqual([
        'text',
      ])
    }
    const publication = onDisk().publications?.[0]
    expect(publication?.status).toBe('published')
    expect(publication?.messages.every((message) => message.delivery === 'sent')).toBe(true)
    expect(publication?.published_at).toBeTruthy()
  })

  it.each([
    { status: 201, body: 'ok' },
    { status: 200, body: 'OK' },
  ])('treats HTTP $status body "$body" as a failed delivery', async ({ status, body }) => {
    const publish = await publishAction()
    fetchMock().mockResolvedValue(new Response(body, { status }))

    const state = await publish(IDLE, publishForm(fingerprint()))

    expect(state.status).toBe('error')
    expect(fetchMock()).toHaveBeenCalledTimes(1)
    expect(onDisk().publications?.[0]).toMatchObject({
      status: 'incomplete',
      published_at: null,
      messages: [{ delivery: 'failed' }, { delivery: 'pending' }, { delivery: 'pending' }],
    })
  })

  it('stops after a partial failure and persists sent X/N without duplicating the first post', async () => {
    const publish = await publishAction()
    fetchMock()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('error', { status: 500 }))

    const state = await publish(IDLE, publishForm(fingerprint()))

    expect(state.status).toBe('error')
    expect(state.message).toContain('1 из 3')
    expect(fetchMock()).toHaveBeenCalledTimes(2)
    expect(onDisk().publications?.[0]).toMatchObject({
      status: 'incomplete',
      published_at: null,
      messages: [
        { delivery: 'sent', sent_at: expect.any(String) },
        { delivery: 'failed', sent_at: null },
        { delivery: 'pending', sent_at: null },
      ],
    })
  })

  it('a thrown timeout records unknown and blocks self-service retry', async () => {
    const publish = await publishAction()
    fetchMock().mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))

    const state = await publish(IDLE, publishForm(fingerprint()))

    expect(state.status).toBe('error')
    expect(state.message).toMatch(/неизвест|0 из 3/i)
    expect(fetchMock()).toHaveBeenCalledTimes(1)
    expect(onDisk().publications?.[0]).toMatchObject({
      status: 'incomplete',
      messages: [
        { delivery: 'unknown', sent_at: null },
        { delivery: 'pending' },
        { delivery: 'pending' },
      ],
    })

    const retry = await publish(IDLE, publishForm(fingerprint()))
    expect(retry.status).toBe('error')
    expect(fetchMock()).toHaveBeenCalledTimes(1)
  })

  it('two concurrent actions create one batch; the second is blocked before another request', async () => {
    const publish = await publishAction()
    let releaseFirst: ((response: Response) => void) | undefined
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve
    })
    fetchMock()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () => new Response('ok', { status: 200 }))
    const previewFingerprint = fingerprint()

    const first = publish(IDLE, publishForm(previewFingerprint))
    await vi.waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1))
    const second = await publish(IDLE, publishForm(previewFingerprint))

    expect(second.status).toBe('error')
    expect(second.message).toMatch(/попыт|отправ|публик/i)
    expect(fetchMock()).toHaveBeenCalledTimes(1)
    expect(onDisk().publications).toHaveLength(1)

    releaseFirst?.(new Response('ok', { status: 200 }))
    await expect(first).resolves.toMatchObject({ status: 'ok' })
    expect(fetchMock()).toHaveBeenCalledTimes(3)
    expect(onDisk().publications).toHaveLength(1)
  })
})
