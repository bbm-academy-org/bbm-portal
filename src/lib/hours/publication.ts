import { createHash } from 'node:crypto'

import { normalizeEmail } from './access'
import { formatHours } from './format'
import type {
  Assessment,
  HoursDocument,
  Participant,
  Period,
  Publication,
  PublicationMessage,
} from './types'

export type PublicationEligibilityStatus =
  | 'eligible'
  | 'open'
  | 'empty'
  | 'published'
  | 'incomplete'

export interface PublicationEligibility {
  status: PublicationEligibilityStatus
  can_publish: boolean
  reason: string | null
}

export interface PublicationPreviewMessage {
  email: string
  text: string
}

export interface PublicationPreview {
  period_id: string
  preview_fingerprint: string
  messages: PublicationPreviewMessage[]
  eligibility: PublicationEligibility
}

export type PublicationMutationResult =
  | { ok: false; error: string }
  | { ok: true; doc: HoursDocument; warnings: string[]; saved: Publication }

function formatInt(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

function identityFor(doc: HoursDocument, assessment: Assessment): Participant | undefined {
  const email = normalizeEmail(assessment.email)
  return doc.participants.find((participant) => participant.email === email)
}

function messageText(period: Period, assessment: Assessment, participant?: Participant): string {
  const name = participant?.name?.trim() || normalizeEmail(assessment.email)
  const role = participant?.role?.trim() || '—'
  const grade = participant?.grade ?? '—'
  const cashPercent = 100 - assessment.split_percent
  const heading = [
    `**Верификация часов — ${name}**`,
    '',
    `Период: ${period.label}`,
    `Роль: ${role}`,
    `Грейд: ${grade}`,
    `Самооценка: ${formatHours(assessment.hours)} часов`,
  ]

  const money =
    assessment.monthly_rate == null || assessment.hourly_rate == null
      ? [
          'Ставка и начисление не рассчитаны',
          'Сплит:',
          `- забирает зарплатой: ${formatPercent(cashPercent)}`,
          `- оставляет в проекте: ${formatPercent(assessment.split_percent)}`,
        ]
      : [
          `Ставка на момент самооценки: ${formatInt(assessment.monthly_rate)} ₽/мес · ${formatInt(assessment.hourly_rate)} ₽/ч`,
          `Начисление: ${formatInt(assessment.accrual)} ₽`,
          'Сплит:',
          `- забирает зарплатой: ${formatPercent(cashPercent)} · ${formatInt(assessment.cash_amount)} ₽`,
          `- оставляет в проекте: ${formatPercent(assessment.split_percent)} · ${formatInt(assessment.invest_amount)} ₽`,
        ]

  return [
    ...heading,
    ...money,
    '',
    '👍 — согласен с оценкой',
    '👎 — не согласен; напиши в треде, что именно считаешь завышенным или заниженным и почему.',
    '',
    'Обсуждаем вклад и результат, а не только число часов.',
  ].join('\n')
}

function fingerprint(
  period: Period,
  rows: Array<{
    assessment: Assessment
    participant: Participant | null
    message: PublicationPreviewMessage
  }>,
): string {
  const canonical = JSON.stringify({
    period,
    rows,
  })
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}

function eligibility(
  period: Period,
  messages: PublicationPreviewMessage[],
  existing?: Publication,
): PublicationEligibility {
  if (existing?.status === 'published') {
    return {
      status: 'published',
      can_publish: false,
      reason: 'Период уже опубликован в Mattermost.',
    }
  }
  if (existing) {
    return {
      status: 'incomplete',
      can_publish: false,
      reason: 'У периода уже есть незавершённая попытка публикации.',
    }
  }
  if (messages.length === 0) {
    return {
      status: 'empty',
      can_publish: false,
      reason: 'За этот период нет сохранённых оценок.',
    }
  }
  if (period.status === 'open') {
    return {
      status: 'open',
      can_publish: false,
      reason: 'Сначала закрой период.',
    }
  }
  return { status: 'eligible', can_publish: true, reason: null }
}

/**
 * Builds the complete immutable preview without I/O. The digest covers more
 * than visible text (`saved_at`, method, full participant record), so any
 * assessment or identity edit after render makes the publish request stale.
 */
export function buildMattermostPreview(doc: HoursDocument, periodId: string): PublicationPreview {
  const period = doc.periods.find((candidate) => candidate.id === periodId)
  if (!period) {
    throw new Error('Период не найден — обнови страницу.')
  }

  const rows = doc.assessments
    .filter((assessment) => assessment.period_id === periodId)
    .map((assessment) => {
      const participant = identityFor(doc, assessment) ?? null
      const message = {
        email: normalizeEmail(assessment.email),
        text: messageText(period, assessment, participant ?? undefined),
      }
      return { assessment, participant, message }
    })
  const messages = rows.map((row) => row.message)
  const existing = doc.publications?.find((publication) => publication.period_id === periodId)

  return {
    period_id: periodId,
    preview_fingerprint: fingerprint(period, rows),
    messages,
    eligibility: eligibility(period, messages, existing),
  }
}

/**
 * Freezes a batch before network I/O. It is a pure document mutation, so the
 * store mutex can make the one-batch-per-period check and append atomic.
 */
export function createPublicationBatch(
  doc: HoursDocument,
  periodId: string,
  expectedFingerprint: string,
  startedAt: string,
): PublicationMutationResult {
  let preview: PublicationPreview
  try {
    preview = buildMattermostPreview(doc, periodId)
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'Не удалось собрать предпросмотр.',
    }
  }

  if (preview.preview_fingerprint !== expectedFingerprint) {
    return { ok: false, error: 'Предпросмотр устарел — обнови страницу и проверь сообщения снова.' }
  }
  if (!preview.eligibility.can_publish) {
    return {
      ok: false,
      error: preview.eligibility.reason ?? 'Публикация этого периода недоступна.',
    }
  }

  const messages: PublicationMessage[] = preview.messages.map((message) => ({
    ...message,
    delivery: 'pending',
    sent_at: null,
  }))
  const publication: Publication = {
    period_id: periodId,
    status: 'sending',
    started_at: startedAt,
    published_at: null,
    preview_fingerprint: preview.preview_fingerprint,
    messages,
  }

  return {
    ok: true,
    doc: {
      ...doc,
      publications: [...(doc.publications ?? []), publication],
    },
    warnings: [],
    saved: publication,
  }
}

/**
 * Persists one delivery outcome. Only the next pending message of an active
 * `sending` batch may move; incomplete/published batches are immutable because
 * an incoming webhook has no post id with which to make a retry idempotent.
 */
export function recordPublicationDelivery(
  doc: HoursDocument,
  periodId: string,
  messageIndex: number,
  delivery: 'sent' | 'failed' | 'unknown',
  at: string,
): PublicationMutationResult {
  const publications = doc.publications ?? []
  const publicationIndex = publications.findIndex(
    (publication) => publication.period_id === periodId,
  )
  if (publicationIndex < 0) {
    return { ok: false, error: 'Попытка публикации не найдена.' }
  }

  const existing = publications[publicationIndex]
  if (existing.status !== 'sending') {
    return {
      ok: false,
      error: 'Эта попытка уже завершена — автоматический повтор заблокирован.',
    }
  }
  const message = existing.messages[messageIndex]
  if (!message || message.delivery !== 'pending') {
    return { ok: false, error: 'Сообщение уже обработано или не найдено.' }
  }
  if (existing.messages.slice(0, messageIndex).some((candidate) => candidate.delivery !== 'sent')) {
    return { ok: false, error: 'Сообщения должны отправляться последовательно.' }
  }

  const messages = existing.messages.map((candidate, index) =>
    index === messageIndex
      ? {
          ...candidate,
          delivery,
          sent_at: delivery === 'sent' ? at : null,
        }
      : candidate,
  )
  const allSent = messages.every((candidate) => candidate.delivery === 'sent')
  const publication: Publication = {
    ...existing,
    status: delivery === 'sent' ? (allSent ? 'published' : 'sending') : 'incomplete',
    published_at: allSent ? at : null,
    messages,
  }
  const nextPublications = [...publications]
  nextPublications[publicationIndex] = publication

  return {
    ok: true,
    doc: { ...doc, publications: nextPublications },
    warnings: [],
    saved: publication,
  }
}

export function isPeriodMutationLocked(doc: HoursDocument, periodId: string): boolean {
  const status = doc.publications?.find((publication) => publication.period_id === periodId)?.status
  return status === 'sending' || status === 'published'
}
