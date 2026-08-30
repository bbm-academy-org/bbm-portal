import {
  buildMattermostPreview,
  isPeriodMutationLocked,
  participantMonthlyRate,
  type HoursDocument,
  type HoursParticipantRecord,
  type HoursPeriodRecord,
  type HoursPublicationRecord,
  type MutationResult,
} from '@/lib/hours'
import { ModuleApiError } from '@/lib/platform/api'
import type { AuditContext } from '@/lib/platform/db/transaction'

import { mutateHoursDocument } from '@/lib/hours/store-core'

export function routeText(value: string | string[] | undefined, field: string): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) throw new ModuleApiError('bad-request', `${field}: значение обязательно.`)
  try {
    return decodeURIComponent(raw)
  } catch {
    throw new ModuleApiError('bad-request', `${field}: некорректное значение.`)
  }
}

export function periodRecord(
  doc: HoursDocument,
  periodId: string,
  warnings: string[] = [],
): HoursPeriodRecord {
  const period = doc.periods.find((candidate) => candidate.id === periodId)
  if (!period) throw new ModuleApiError('not-found', 'Период не найден.')
  const participants = new Map(
    doc.participants.map((participant) => [participant.email, participant]),
  )
  const publication = doc.publications?.find((candidate) => candidate.period_id === period.id)

  return {
    id: period.id,
    label: period.label,
    dateFrom: period.date_from,
    dateTo: period.date_to,
    status: period.status,
    locked: isPeriodMutationLocked(doc, period.id),
    publicationStatus: publication?.status ?? null,
    warnings,
    assessments: doc.assessments
      .filter((assessment) => assessment.period_id === period.id)
      .map((assessment) => ({
        email: assessment.email,
        name: participants.get(assessment.email)?.name ?? assessment.email,
        hours: assessment.hours,
        method: assessment.method,
        weekendHours: assessment.weekend_hours,
        splitPercent: assessment.split_percent,
        monthlyRate: assessment.monthly_rate,
        hourlyRate: assessment.hourly_rate,
        accrual: assessment.accrual,
        cashAmount: assessment.cash_amount,
        investAmount: assessment.invest_amount,
        weekdayCount: assessment.weekday_count,
        savedAt: assessment.saved_at,
      })),
  }
}

export function participantRecord(
  participant: HoursDocument['participants'][number],
): HoursParticipantRecord {
  return {
    email: participant.email,
    name: participant.name,
    role: participant.role ?? null,
    forkMin: participant.fork_min ?? null,
    forkMax: participant.fork_max ?? null,
    grade: participant.grade ?? null,
    monthlyRate: participantMonthlyRate(participant),
  }
}

export function publicationRecord(doc: HoursDocument, periodId: string): HoursPublicationRecord {
  let preview
  try {
    preview = buildMattermostPreview(doc, periodId)
  } catch (error) {
    throw new ModuleApiError(
      'not-found',
      error instanceof Error ? error.message : 'Период не найден.',
    )
  }
  const publication = doc.publications?.find((candidate) => candidate.period_id === periodId)
  return {
    id: 'mattermost-publication',
    periodId,
    previewFingerprint: preview.preview_fingerprint,
    messages: preview.messages,
    eligibility: {
      status: preview.eligibility.status,
      canPublish: preview.eligibility.can_publish,
      reason: preview.eligibility.reason,
    },
    publicationStatus: publication?.status ?? null,
  }
}

export async function hoursWrite<T>(
  audit: AuditContext,
  mutate: (doc: HoursDocument) => MutationResult<T>,
): Promise<{ saved: T; warnings: string[]; doc: HoursDocument }> {
  const result = await mutateHoursDocument(audit, mutate)
  if (!result.ok) throw new ModuleApiError('conflict', result.error)
  return { saved: result.saved, warnings: result.warnings, doc: result.doc }
}
