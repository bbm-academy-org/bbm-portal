import { describe, expect, it } from 'vitest'

import { saveAssessment, setPeriodStatus, updatePeriod } from '@/lib/hours/document'
import type { HoursDocument } from '@/lib/hours/types'

type Delivery = 'pending' | 'sent' | 'failed' | 'unknown'
type PublicationStatus = 'sending' | 'published' | 'incomplete'

interface PublicationMessage {
  email: string
  text: string
  delivery: Delivery
  sent_at: string | null
}

interface Publication {
  period_id: string
  status: PublicationStatus
  started_at: string
  published_at: string | null
  preview_fingerprint: string
  messages: PublicationMessage[]
}

type PublicationDocument = HoursDocument & { publications?: Publication[] }

interface PublicationPreview {
  period_id: string
  preview_fingerprint: string
  messages: Array<{ email: string; text: string }>
  eligibility: {
    status: 'eligible' | 'open' | 'empty' | 'published' | 'incomplete'
    can_publish: boolean
    reason: string | null
  }
}

interface PublicationApi {
  buildMattermostPreview: (doc: PublicationDocument, periodId: string) => PublicationPreview
  createPublicationBatch: (
    doc: PublicationDocument,
    periodId: string,
    expectedFingerprint: string,
    startedAt: string,
  ) =>
    | { ok: false; error: string }
    | { ok: true; doc: PublicationDocument; warnings: string[]; saved: Publication }
  recordPublicationDelivery: (
    doc: PublicationDocument,
    periodId: string,
    position: number,
    delivery: 'sent' | 'failed' | 'unknown',
    at: string,
  ) =>
    | { ok: false; error: string }
    | { ok: true; doc: PublicationDocument; warnings: string[]; saved: Publication }
}

async function publicationApi(): Promise<PublicationApi> {
  const hours = (await import('@/lib/hours')) as unknown as Partial<PublicationApi>
  expect(
    hours.buildMattermostPreview,
    'PHASE B: export buildMattermostPreview from the hours domain',
  ).toBeTypeOf('function')
  expect(
    hours.createPublicationBatch,
    'PHASE B: export createPublicationBatch from the hours domain',
  ).toBeTypeOf('function')
  expect(hours.recordPublicationDelivery).toBeTypeOf('function')
  return hours as PublicationApi
}

const MONEY_MESSAGE = `**Верификация часов — Антон**

Период: Июль 2026
Роль: Продукт
Грейд: II
Самооценка: 160 часов
Ставка на момент самооценки: 200 000 ₽/мес · 1 087 ₽/ч
Начисление: 173 913 ₽
Сплит:
- забирает зарплатой: 70% · 121 739 ₽
- оставляет в проекте: 30% · 52 174 ₽

👍 — согласен с оценкой
👎 — не согласен; напиши в треде, что именно считаешь завышенным или заниженным и почему.

Обсуждаем вклад и результат, а не только число часов.`

const HOURS_ONLY_MESSAGE = `**Верификация часов — Новый**

Период: Июль 2026
Роль: —
Грейд: —
Самооценка: 40 часов
Ставка и начисление не рассчитаны
Сплит:
- забирает зарплатой: 80%
- оставляет в проекте: 20%

👍 — согласен с оценкой
👎 — не согласен; напиши в треде, что именно считаешь завышенным или заниженным и почему.

Обсуждаем вклад и результат, а не только число часов.`

function document(status: 'open' | 'closed' = 'closed'): PublicationDocument {
  return {
    participants: [
      {
        email: 'anton@bbm.academy',
        name: 'Антон',
        role: 'Продукт',
        fork_min: 150_000,
        fork_max: 250_000,
        grade: 'II',
      },
      { email: 'new@bbm.academy', name: 'Новый' },
    ],
    periods: [
      {
        id: 'p-july',
        label: 'Июль 2026',
        date_from: '2026-07-01',
        date_to: '2026-07-31',
        status,
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
        saved_at: '2026-08-01T09:01:00.000Z',
      },
    ],
  }
}

function publication(preview: PublicationPreview, status: PublicationStatus): Publication {
  return {
    period_id: 'p-july',
    status,
    started_at: '2026-08-02T00:00:00.000Z',
    published_at: status === 'published' ? '2026-08-02T00:00:02.000Z' : null,
    preview_fingerprint: preview.preview_fingerprint,
    messages: preview.messages.map((message) => ({
      ...message,
      delivery: status === 'published' ? 'sent' : 'pending',
      sent_at: status === 'published' ? '2026-08-02T00:00:01.000Z' : null,
    })),
  }
}

describe('Mattermost preview — exact deterministic snapshot (spec 100 requirements 2–5)', () => {
  it('formats the money and hours-only variants exactly, in summary order', async () => {
    const { buildMattermostPreview } = await publicationApi()
    const preview = buildMattermostPreview(document(), 'p-july')

    expect(preview.messages.map((message) => message.email)).toEqual([
      'anton@bbm.academy',
      'new@bbm.academy',
    ])
    expect(preview.messages[0].text).toBe(MONEY_MESSAGE)
    expect(preview.messages[1].text).toBe(HOURS_ONLY_MESSAGE)
  })

  it('uses current identity but preserves saved monetary snapshots after identity drift', async () => {
    const { buildMattermostPreview } = await publicationApi()
    const drifted = document()
    drifted.participants[0] = {
      ...drifted.participants[0],
      name: 'Антон Сидоров',
      role: 'Архитектор',
      grade: 'III',
      fork_min: 500_000,
      fork_max: 700_000,
    }

    const text = buildMattermostPreview(drifted, 'p-july').messages[0].text
    expect(text).toContain('**Верификация часов — Антон Сидоров**')
    expect(text).toContain('Роль: Архитектор')
    expect(text).toContain('Грейд: III')
    expect(text).toContain('Ставка на момент самооценки: 200 000 ₽/мес · 1 087 ₽/ч')
    expect(text).toContain('Начисление: 173 913 ₽')
    expect(text).not.toContain('600 000')
  })

  it('is deterministic, while an assessment or participant change invalidates the fingerprint', async () => {
    const { buildMattermostPreview } = await publicationApi()
    const base = document()
    const first = buildMattermostPreview(base, 'p-july')
    const same = buildMattermostPreview(structuredClone(base), 'p-july')
    expect(same).toEqual(first)

    const assessmentChanged = structuredClone(base)
    assessmentChanged.assessments[0].hours = 161
    expect(buildMattermostPreview(assessmentChanged, 'p-july').preview_fingerprint).not.toBe(
      first.preview_fingerprint,
    )

    const identityChanged = structuredClone(base)
    identityChanged.participants[0].role = 'Архитектор'
    expect(buildMattermostPreview(identityChanged, 'p-july').preview_fingerprint).not.toBe(
      first.preview_fingerprint,
    )
  })
})

describe('eligibility and immutable batch (spec 100 requirements 6, 8–9, 15)', () => {
  it('allows preview for an open period but explains why publish is disabled', async () => {
    const { buildMattermostPreview } = await publicationApi()
    const preview = buildMattermostPreview(document('open'), 'p-july')
    expect(preview.messages).toHaveLength(2)
    expect(preview.eligibility).toMatchObject({
      status: 'open',
      can_publish: false,
      reason: expect.stringContaining('закрой'),
    })
  })

  it('distinguishes empty, eligible, published and incomplete periods', async () => {
    const { buildMattermostPreview } = await publicationApi()
    const empty = document()
    empty.assessments = []
    expect(buildMattermostPreview(empty, 'p-july').eligibility).toMatchObject({
      status: 'empty',
      can_publish: false,
      reason: expect.stringContaining('оцен'),
    })

    const eligible = buildMattermostPreview(document(), 'p-july')
    expect(eligible.eligibility).toEqual({
      status: 'eligible',
      can_publish: true,
      reason: null,
    })

    const published = document()
    published.publications = [publication(eligible, 'published')]
    expect(buildMattermostPreview(published, 'p-july').eligibility).toMatchObject({
      status: 'published',
      can_publish: false,
    })

    const incomplete = document()
    incomplete.publications = [publication(eligible, 'incomplete')]
    expect(buildMattermostPreview(incomplete, 'p-july').eligibility).toMatchObject({
      status: 'incomplete',
      can_publish: false,
    })
  })

  it('atomically creates one immutable batch from the exact shown preview', async () => {
    const { buildMattermostPreview, createPublicationBatch } = await publicationApi()
    const source = document()
    const preview = buildMattermostPreview(source, 'p-july')
    const created = createPublicationBatch(
      source,
      'p-july',
      preview.preview_fingerprint,
      '2026-08-02T00:00:00.000Z',
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.saved).toMatchObject({
      period_id: 'p-july',
      status: 'sending',
      started_at: '2026-08-02T00:00:00.000Z',
      published_at: null,
      preview_fingerprint: preview.preview_fingerprint,
    })
    expect(created.saved.messages.map(({ email, text }) => ({ email, text }))).toEqual(
      preview.messages,
    )
    expect(created.saved.messages.every((message) => message.delivery === 'pending')).toBe(true)

    const duplicate = createPublicationBatch(
      created.doc,
      'p-july',
      preview.preview_fingerprint,
      '2026-08-02T00:00:01.000Z',
    )
    expect(duplicate.ok).toBe(false)
  })

  it('rejects a stale fingerprint without creating a publication record', async () => {
    const { buildMattermostPreview, createPublicationBatch } = await publicationApi()
    const source = document()
    const stale = buildMattermostPreview(source, 'p-july').preview_fingerprint
    source.assessments[0].hours = 161

    const result = createPublicationBatch(source, 'p-july', stale, '2026-08-02T00:00:00.000Z')
    expect(result.ok).toBe(false)
    expect(source.publications ?? []).toEqual([])
  })
})

describe('delivery is addressed by position (spec 201 EARS-31 step 3)', () => {
  /**
   * `position` is the storage-level identity of a message since #274:
   * `core.hours_publication_message` is keyed `(period_id, position)`, and
   * `src/lib/hours/core/load.ts` rebuilds the document array sorted on that
   * column and refuses a gap. These tests pin the domain half of that contract —
   * the argument names WHICH message moves, and nothing else moves with it.
   */
  async function sendingBatch() {
    const { buildMattermostPreview, createPublicationBatch, recordPublicationDelivery } =
      await publicationApi()
    const source = document()
    const preview = buildMattermostPreview(source, 'p-july')
    const created = createPublicationBatch(
      source,
      'p-july',
      preview.preview_fingerprint,
      '2026-08-02T00:00:00.000Z',
    )
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.error)
    return { doc: created.doc, saved: created.saved, recordPublicationDelivery }
  }

  it('moves exactly the message at the given position and leaves its neighbours untouched', async () => {
    const { doc, saved, recordPublicationDelivery } = await sendingBatch()
    expect(saved.messages.length).toBeGreaterThan(1)
    const before = structuredClone(saved.messages)

    const progressed = recordPublicationDelivery(
      doc,
      'p-july',
      0,
      'sent',
      '2026-08-02T00:00:01.000Z',
    )
    expect(progressed.ok).toBe(true)
    if (!progressed.ok) throw new Error(progressed.error)

    const messages = progressed.saved.messages
    expect(messages[0]).toEqual({
      ...before[0],
      delivery: 'sent',
      sent_at: '2026-08-02T00:00:01.000Z',
    })
    expect(messages.slice(1)).toEqual(before.slice(1))
    // The recipients and their order are the invariant spec 100 req. 2/10 states.
    expect(messages.map((message) => message.email)).toEqual(before.map((message) => message.email))
  })

  it('refuses a position out of order — messages go strictly in preview order', async () => {
    const { doc, recordPublicationDelivery } = await sendingBatch()
    const outOfOrder = recordPublicationDelivery(
      doc,
      'p-july',
      1,
      'sent',
      '2026-08-02T00:00:01.000Z',
    )
    expect(outOfOrder.ok).toBe(false)
    if (outOfOrder.ok) throw new Error('unreachable')
    expect(outOfOrder.error).toBe('Сообщения должны отправляться последовательно.')
  })

  it('never re-sends an already delivered message: a replayed position is refused', async () => {
    const { doc, recordPublicationDelivery } = await sendingBatch()
    const first = recordPublicationDelivery(doc, 'p-july', 0, 'sent', '2026-08-02T00:00:01.000Z')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.error)

    const replay = recordPublicationDelivery(
      first.doc,
      'p-july',
      0,
      'sent',
      '2026-08-02T00:00:09.000Z',
    )
    expect(replay.ok).toBe(false)
    if (replay.ok) throw new Error('unreachable')
    expect(replay.error).toBe('Сообщение уже обработано или не найдено.')
    expect(first.saved.messages[0].sent_at).toBe('2026-08-02T00:00:01.000Z')
  })

  it('refuses a position that names no message', async () => {
    const { doc, saved, recordPublicationDelivery } = await sendingBatch()
    const missing = recordPublicationDelivery(
      doc,
      'p-july',
      saved.messages.length,
      'sent',
      '2026-08-02T00:00:01.000Z',
    )
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('unreachable')
    expect(missing.error).toBe('Сообщение уже обработано или не найдено.')
  })
})

describe('publication-batch freeze (spec 100 requirement 12)', () => {
  async function batchAt(status: PublicationStatus): Promise<PublicationDocument> {
    const { buildMattermostPreview, createPublicationBatch, recordPublicationDelivery } =
      await publicationApi()
    const source = document()
    const preview = buildMattermostPreview(source, 'p-july')
    const created = createPublicationBatch(
      source,
      'p-july',
      preview.preview_fingerprint,
      '2026-08-02T00:00:00.000Z',
    )
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.error)
    if (status === 'sending') return created.doc

    if (status === 'incomplete') {
      const incomplete = recordPublicationDelivery(
        created.doc,
        'p-july',
        0,
        'unknown',
        '2026-08-02T00:00:01.000Z',
      )
      expect(incomplete.ok).toBe(true)
      if (!incomplete.ok) throw new Error(incomplete.error)
      return incomplete.doc
    }

    let current = created.doc
    for (const index of created.saved.messages.keys()) {
      const progressed = recordPublicationDelivery(
        current,
        'p-july',
        index,
        'sent',
        `2026-08-02T00:00:0${index + 1}.000Z`,
      )
      expect(progressed.ok).toBe(true)
      if (!progressed.ok) throw new Error(progressed.error)
      current = progressed.doc
    }
    return current
  }

  it.each<PublicationStatus>(['sending', 'published'])(
    'blocks reopening and label/date edits after the atomic batch reaches %s',
    async (status) => {
      const source = await batchAt(status)
      const periodBefore = structuredClone(source.periods[0])
      const assessmentsBefore = structuredClone(source.assessments)

      const reopen = setPeriodStatus(source, 'p-july', 'open')
      expect(reopen.ok).toBe(false)
      if (!reopen.ok) expect(reopen.error).toMatch(/публикац/i)

      const edit = updatePeriod(source, {
        id: 'p-july',
        label: 'Июль 2026 — исправлено',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-30',
      })
      expect(edit.ok).toBe(false)
      if (!edit.ok) expect(edit.error).toMatch(/публикац/i)
      expect(source.periods[0]).toEqual(periodBefore)
      expect(source.assessments).toEqual(assessmentsBefore)
    },
  )

  it('allows incomplete-period repair without mutating the frozen batch or enabling retry', async () => {
    const { buildMattermostPreview, createPublicationBatch } = await publicationApi()
    const source = await batchAt('incomplete')
    const frozenBatch = structuredClone(source.publications?.[0])

    const reopened = setPeriodStatus(source, 'p-july', 'open')
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) throw new Error(reopened.error)

    const edited = updatePeriod(reopened.doc, {
      id: 'p-july',
      label: 'Июль 2026 — исправлено после сверки',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-30',
    })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(edited.error)

    expect(edited.doc.periods[0]).toMatchObject({
      status: 'open',
      label: 'Июль 2026 — исправлено после сверки',
      date_to: '2026-07-30',
    })
    expect(edited.doc.publications?.[0]).toEqual(frozenBatch)
    expect(edited.doc.publications?.[0]).toMatchObject({ status: 'incomplete' })

    const changedPreview = buildMattermostPreview(edited.doc, 'p-july')
    expect(changedPreview.eligibility).toMatchObject({
      status: 'incomplete',
      can_publish: false,
    })
    expect(
      createPublicationBatch(
        edited.doc,
        'p-july',
        changedPreview.preview_fingerprint,
        '2026-08-02T00:02:00.000Z',
      ).ok,
    ).toBe(false)
  })

  it('cannot finish a batch as published with an open period or mutable assessments', async () => {
    const { recordPublicationDelivery } = await publicationApi()
    const sending = await batchAt('sending')
    const frozenTexts = sending.publications?.[0].messages.map((message) => message.text)

    expect(setPeriodStatus(sending, 'p-july', 'open').ok).toBe(false)
    expect(
      updatePeriod(sending, {
        id: 'p-july',
        label: 'Июль 2026 — подменён',
        dateFrom: '2026-07-02',
        dateTo: '2026-07-30',
      }).ok,
    ).toBe(false)

    let current = sending
    for (const index of sending.publications?.[0].messages.keys() ?? []) {
      const progressed = recordPublicationDelivery(
        current,
        'p-july',
        index,
        'sent',
        `2026-08-02T00:00:0${index + 1}.000Z`,
      )
      expect(progressed.ok).toBe(true)
      if (!progressed.ok) throw new Error(progressed.error)
      current = progressed.doc
    }

    expect(current.periods[0]).toMatchObject({
      status: 'closed',
      label: 'Июль 2026',
      date_from: '2026-07-01',
      date_to: '2026-07-31',
    })
    expect(current.publications?.[0]).toMatchObject({ status: 'published' })
    expect(current.publications?.[0].messages.map((message) => message.text)).toEqual(frozenTexts)

    const assessmentMutation = saveAssessment(
      current,
      {
        periodId: 'p-july',
        email: 'anton@bbm.academy',
        hours: 161,
        method: 'period',
        weekendHours: 0,
        splitPercent: 30,
      },
      '2026-08-02T00:01:00.000Z',
    )
    expect(assessmentMutation.ok).toBe(false)
    expect(current.assessments[0].hours).toBe(160)
  })
})
