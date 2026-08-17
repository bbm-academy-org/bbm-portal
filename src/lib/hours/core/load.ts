/**
 * Assembling the legacy `HoursDocument` out of the `core` tables (spec 124
 * EARS-11, EARS-21, EARS-22).
 *
 * The shape produced here is a CONTRACT, not a convenience:
 *
 *  - the top-level key order (`participants`, `periods`, `assessments`,
 *    `publications`) and each record's field order are what makes the owner's
 *    «Скачать данные (JSON)» export byte-comparable across the cutover (EARS-11,
 *    EARS-27's diff verdict);
 *  - a participant carries ONLY the six legacy fields, so the fingerprint the
 *    publication preview digests cannot move when an unrelated `member` column
 *    (`status`, `timezone`, timestamps) is touched (EARS-22);
 *  - every list has an explicit `ORDER BY` reproducing today's insertion order
 *    (EARS-21) — `sort_key` for participants and periods, the identity PK for
 *    assessments, the period order for publications, which have no order of their
 *    own (their PK IS the period).
 *
 * Objects are rebuilt field by field rather than spread from a row, and that is
 * deliberate for `jsonb` in particular: Postgres does not preserve object key
 * order in `jsonb` (it stores keys sorted by length, then bytewise), so a message
 * read straight back out of the column would serialize as
 * `{text, email, sent_at, delivery}` and quietly break the export diff.
 *
 * `member` data is read through the member module's public API (EARS-8) — never
 * by importing `schema/member/`.
 */
import { asc, eq } from 'drizzle-orm'

import { getMembersByIds } from '@/lib/member'
import type { Member } from '@/lib/member'
import { hoursAssessment } from '@/lib/platform/db/schema/hours/hours-assessment'
import { hoursParticipant } from '@/lib/platform/db/schema/hours/hours-participant'
import { hoursPeriod } from '@/lib/platform/db/schema/hours/hours-period'
import { hoursPublication } from '@/lib/platform/db/schema/hours/hours-publication'

import type { HoursTx } from './db'
import { HoursDataError } from './errors'
import type {
  Assessment,
  AssessmentMethod,
  Grade,
  HoursDocument,
  Participant,
  Period,
  PeriodStatus,
  Publication,
  PublicationDelivery,
  PublicationMessage,
  PublicationStatus,
} from '../types'

/** The `member` rows the hours tables reference, by id — through the API (EARS-8). */
async function membersById(tx: HoursTx, ids: number[]): Promise<Map<number, Member>> {
  const members = await getMembersByIds([...new Set(ids)], { db: tx })
  return new Map(members.map((member) => [member.id, member]))
}

/**
 * The messages of one batch, rebuilt in the legacy field order.
 *
 * The column is `jsonb` and this module wrote it, so the ARRAY order and length
 * are exactly what was stored (EARS-6). The per-message KEY order is restored
 * here, since jsonb has none.
 */
function readMessages(raw: unknown, periodId: string): PublicationMessage[] {
  if (!Array.isArray(raw)) {
    throw new HoursDataError(`Публикация периода ${periodId} хранится в неожиданном виде.`)
  }
  return raw.map((entry) => {
    const message = entry as Partial<PublicationMessage>
    if (
      typeof message?.email !== 'string' ||
      typeof message?.text !== 'string' ||
      typeof message?.delivery !== 'string'
    ) {
      throw new HoursDataError(`Публикация периода ${periodId} содержит повреждённое сообщение.`)
    }
    return {
      email: message.email,
      text: message.text,
      delivery: message.delivery as PublicationDelivery,
      sent_at: message.sent_at ?? null,
    }
  })
}

/** Reads the whole document on one handle — a transaction, always (see `./db.ts`). */
export async function loadDocument(tx: HoursTx): Promise<HoursDocument> {
  const participantRows = await tx
    .select()
    .from(hoursParticipant)
    .orderBy(asc(hoursParticipant.sortKey), asc(hoursParticipant.memberId))
  const assessmentRows = await tx.select().from(hoursAssessment).orderBy(asc(hoursAssessment.id))
  const periodRows = await tx
    .select()
    .from(hoursPeriod)
    .orderBy(asc(hoursPeriod.sortKey), asc(hoursPeriod.id))
  // Publications carry no order column: the PK is the period, so the period order
  // (EARS-21) is theirs, and it is stable across delivery updates.
  const publicationRows = await tx
    .select({ publication: hoursPublication })
    .from(hoursPublication)
    .innerJoin(hoursPeriod, eq(hoursPeriod.id, hoursPublication.periodId))
    .orderBy(asc(hoursPeriod.sortKey), asc(hoursPeriod.id))

  const members = await membersById(tx, [
    ...participantRows.map((row) => row.memberId),
    ...assessmentRows.map((row) => row.memberId),
  ])
  const memberOf = (memberId: number): Member => {
    const member = members.get(memberId)
    if (member === undefined) {
      // Unreachable while the FKs of migration 0002 stand — stated rather than
      // trusted, so a future `ON DELETE CASCADE` could not silently drop people
      // out of the participants table instead of failing.
      throw new HoursDataError(
        `В реестре нет участника #${memberId}, на которого ссылается модуль часов.`,
      )
    }
    return member
  }

  const participants: Participant[] = participantRows.map((row) => {
    const member = memberOf(row.memberId)
    return {
      email: member.email,
      name: member.name,
      role: member.role,
      fork_min: row.forkMin,
      fork_max: row.forkMax,
      grade: row.grade as Grade | null,
    }
  })

  const periods: Period[] = periodRows.map((row) => ({
    id: row.id,
    label: row.label,
    date_from: row.dateFrom,
    date_to: row.dateTo,
    status: row.status as PeriodStatus,
  }))

  const assessments: Assessment[] = assessmentRows.map((row) => ({
    period_id: row.periodId,
    email: memberOf(row.memberId).email,
    hours: row.hours,
    method: row.method as AssessmentMethod,
    weekend_hours: row.weekendHours,
    split_percent: row.splitPercent,
    monthly_rate: row.monthlyRate,
    hourly_rate: row.hourlyRate,
    accrual: row.accrual,
    cash_amount: row.cashAmount,
    invest_amount: row.investAmount,
    weekday_count: row.weekdayCount,
    saved_at: row.savedAt,
  }))

  const publications: Publication[] = publicationRows.map(({ publication }) => ({
    period_id: publication.periodId,
    status: publication.status as PublicationStatus,
    started_at: publication.startedAt,
    published_at: publication.publishedAt,
    preview_fingerprint: publication.previewFingerprint,
    messages: readMessages(publication.messages, publication.periodId),
  }))

  return { participants, periods, assessments, publications }
}
