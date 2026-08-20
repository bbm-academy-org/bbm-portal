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
 * deliberate: the legacy key order is the export contract, and a spread would
 * serialize a publication message in the child table's column order instead. The
 * same rule used to be about `jsonb` — Postgres stores object keys sorted by
 * length, then bytewise — and survives the #274 normalisation unchanged, now for
 * `core.hours_publication_message` (spec 201 EARS-31).
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
import { hoursPublicationMessage } from '@/lib/platform/db/schema/hours/hours-publication-message'
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
 * The messages of every batch, from `core.hours_publication_message` (#274,
 * spec 201 EARS-31 step 3), keyed by period and ordered by `position`.
 *
 * `position` is the explicit form of the array index spec 100 req. 2/10 and spec
 * 124 EARS-21 rely on, so the legacy array is rebuilt by SORTING on it — the row
 * order the database happens to return is never trusted. The contiguity check
 * below is what keeps «array index» and «position» from drifting apart above this
 * layer: every consumer of `Publication.messages` (the delivery loop, the panel,
 * the export) may therefore keep reading the array positionally, and
 * `recordPublicationDelivery` addresses a message by the position it is given.
 *
 * The per-message KEY order is restored here, exactly as it was when the batch
 * lived in `jsonb`: it is the legacy export shape (spec 124 EARS-11) and a row
 * spread would serialize its columns in the table's own order instead.
 */
async function messagesByPeriod(tx: HoursTx): Promise<Map<string, PublicationMessage[]>> {
  const rows = await tx
    .select()
    .from(hoursPublicationMessage)
    .orderBy(asc(hoursPublicationMessage.periodId), asc(hoursPublicationMessage.position))

  const byPeriod = new Map<string, PublicationMessage[]>()
  for (const row of rows) {
    const messages = byPeriod.get(row.periodId) ?? []
    if (row.position !== messages.length) {
      // Unreachable while the module owns every write (a batch is created whole
      // and only ever updated in place). Stated rather than trusted, because a
      // gap would silently shift every later message one place to the left and
      // delivery would then address the wrong person.
      throw new HoursDataError(
        `Публикация периода ${row.periodId} хранится в неожиданном виде: пропущено сообщение №${messages.length}.`,
      )
    }
    messages.push({
      email: row.email,
      text: row.text,
      delivery: row.delivery as PublicationDelivery,
      sent_at: row.sentAt,
    })
    byPeriod.set(row.periodId, messages)
  }
  return byPeriod
}

/**
 * The Release-A READ FALLBACK: one batch's messages rebuilt from the legacy
 * `core.hours_publication.messages` array (`docs/runbooks/migrations-expand-contract.md`,
 * «The two-release split» — read the new representation WITH A FALLBACK TO THE
 * OLD).
 *
 * The window it covers is narrow and real: `pnpm deploy:prod --rollback <sha>`
 * brings back the previous app, which writes the `jsonb` column only. A batch
 * CREATED in that window has no child rows at all, and without this fallback the
 * rolled-forward code would read it as a batch of zero messages — a `sending`
 * publication that blocks its period (spec 100 req. 12/15) and shows nobody to
 * deliver to. Read from the array instead, the batch is whole, and the next save
 * that touches it writes ALL of its rows through `./persist.ts`, which heals it:
 * `materialisedMessageCounts` there sees the batch is short in the database and
 * suspends the per-message diff for it. Without that suspension the save would
 * write only the position it changed, this function would stop being reached for
 * the batch (a non-empty child set is never re-read from the array), and the
 * other messages would silently drop out of the document.
 *
 * A batch that HAS child rows is never re-read from the array: those rows are
 * the representation, and the divergence the other half of that window can leave
 * behind — stale `delivery`/`sent_at` on rows that already exist — is reconciled
 * by re-running the backfill of `0004_hours_publication_message.sql`, which takes
 * the array as authoritative on conflict. The two halves are one mechanism.
 *
 * The corruption check is the one `readMessages` carried before #274, kept here
 * and tightened to the child table's own constraints: this is the only path that
 * still reads an untyped `jsonb` value, so `delivery` is checked against the
 * values the `hours_publication_message_delivery_allowed` CHECK admits and
 * `sent_at` against its `text` column, rather than being cast on trust. A value
 * the table would refuse must not enter the document through the fallback and
 * fail later, at the write. The whole function goes away with the column in #281.
 */
const LEGACY_DELIVERIES: readonly string[] = ['pending', 'sent', 'failed', 'unknown']

function messagesFromLegacyColumn(raw: unknown, periodId: string): PublicationMessage[] {
  if (!Array.isArray(raw)) {
    throw new HoursDataError(`Публикация периода ${periodId} хранится в неожиданном виде.`)
  }
  return raw.map((entry) => {
    const message = entry as Partial<PublicationMessage>
    if (
      typeof message?.email !== 'string' ||
      typeof message?.text !== 'string' ||
      typeof message?.delivery !== 'string' ||
      !LEGACY_DELIVERIES.includes(message.delivery) ||
      (message.sent_at !== undefined &&
        message.sent_at !== null &&
        typeof message.sent_at !== 'string')
    ) {
      throw new HoursDataError(`Публикация периода ${periodId} содержит повреждённое сообщение.`)
    }
    // Field by field, in the legacy key order — the export contract of the module
    // header applies to the fallback exactly as it does to the child table.
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

  const publicationMessages = await messagesByPeriod(tx)

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
    messages:
      publicationMessages.get(publication.periodId) ??
      messagesFromLegacyColumn(publication.messages, publication.periodId),
  }))

  return { participants, periods, assessments, publications }
}
