/**
 * Writing a mutated `HoursDocument` back into the `core` tables (spec 124
 * EARS-3, EARS-4, EARS-5, EARS-6, EARS-9, EARS-20, EARS-21).
 *
 * The domain layer (`../document.ts`, `../publication.ts`) is unchanged and still
 * pure: it takes a whole document and returns a whole document. This file is the
 * translation of «the document changed like THIS» into statements, and it works
 * by DIFFING the loaded document against the returned one — record by record,
 * keyed by each record's business identity (participant email, period id,
 * (period, member) for an assessment, period for a publication). Two reasons it
 * diffs rather than rewriting everything:
 *
 *  - `sort_key` and the assessment identity PK carry today's insertion order
 *    (EARS-21). A delete-and-reinsert would renumber them on every save.
 *  - `before` was read inside THIS transaction, under the module advisory lock
 *    (EARS-10), so «unchanged in the document» is exactly «unchanged in the
 *    database». Skipping unchanged records is therefore correct, not an
 *    optimistic guess.
 *
 * The write ORDER is load-bearing: participants (which may create a `member`) →
 * period inserts/updates → assessment deletes and upserts → publications →
 * period deletes. Rows can then never reference a period that does not exist yet,
 * and a period is never deleted while a row still points at it.
 *
 * Nothing here deletes a participant row or a publication: neither has a delete
 * path in the product (081 §16 — participant deletion is the owner's SQL escape
 * hatch; a delivery record is history). A document that drops one silently is a
 * bug in a caller, not an instruction, and the row stays.
 */
import { and, eq, inArray } from 'drizzle-orm'

import {
  ensureMemberByEmail,
  findMemberByEmail,
  MemberConflictError,
  updateMemberProfile,
} from '@/lib/member'
import type { Member } from '@/lib/member'
import { hoursAssessment } from '@/lib/platform/db/schema/hours/hours-assessment'
import { hoursParticipant } from '@/lib/platform/db/schema/hours/hours-participant'
import { hoursPeriod } from '@/lib/platform/db/schema/hours/hours-period'
import { hoursPublication } from '@/lib/platform/db/schema/hours/hours-publication'

import type { HoursTx } from './db'
import { HoursPersistRefusal } from './errors'
import type { Assessment, HoursDocument, Participant, Period, Publication } from '../types'

/** The (period, member) identity of an assessment, as a map key. */
function assessmentKey(periodId: string, email: string): string {
  return `${periodId}\u0000${email}`
}

function sameParticipant(a: Participant, b: Participant): boolean {
  return (
    a.name === b.name &&
    (a.role ?? null) === (b.role ?? null) &&
    (a.fork_min ?? null) === (b.fork_min ?? null) &&
    (a.fork_max ?? null) === (b.fork_max ?? null) &&
    (a.grade ?? null) === (b.grade ?? null)
  )
}

function samePeriod(a: Period, b: Period): boolean {
  return (
    a.label === b.label &&
    a.date_from === b.date_from &&
    a.date_to === b.date_to &&
    a.status === b.status
  )
}

function sameAssessment(a: Assessment, b: Assessment): boolean {
  return (
    a.hours === b.hours &&
    a.method === b.method &&
    a.weekend_hours === b.weekend_hours &&
    a.split_percent === b.split_percent &&
    a.monthly_rate === b.monthly_rate &&
    a.hourly_rate === b.hourly_rate &&
    a.accrual === b.accrual &&
    a.cash_amount === b.cash_amount &&
    a.invest_amount === b.invest_amount &&
    a.weekday_count === b.weekday_count &&
    a.saved_at === b.saved_at
  )
}

function samePublication(a: Publication, b: Publication): boolean {
  return (
    a.status === b.status &&
    a.started_at === b.started_at &&
    a.published_at === b.published_at &&
    a.preview_fingerprint === b.preview_fingerprint &&
    JSON.stringify(a.messages) === JSON.stringify(b.messages)
  )
}

/**
 * The member behind a participant row, created or renamed as needed (EARS-9).
 *
 * Unknown email → a `member` is created (slug from the local part, numeric suffix
 * on collision) INSIDE this transaction, so a rolled-back save leaves no member
 * behind. Known email → `name` and `role` are pushed to the shared registry when
 * they differ, which is the form's documented consequence: a rename here reaches
 * every future reader of `core.member`.
 *
 * A `MemberConflictError` (the email is already somebody's alias) becomes a
 * refusal carrying the module's own sentence — the save never surfaces a raw
 * constraint error (EARS-9, EARS-20).
 */
async function memberForParticipant(tx: HoursTx, participant: Participant): Promise<Member> {
  const role = participant.role ?? null
  try {
    const existing = await findMemberByEmail(participant.email, { db: tx })
    if (!existing) {
      return await ensureMemberByEmail(
        { email: participant.email, name: participant.name, role },
        { db: tx },
      )
    }
    if (existing.name === participant.name && (existing.role ?? null) === role) return existing
    const updated = await updateMemberProfile(
      existing.id,
      { name: participant.name, role },
      { db: tx },
    )
    return updated ?? existing
  } catch (cause) {
    if (cause instanceof MemberConflictError)
      throw new HoursPersistRefusal(cause.message, { cause })
    throw cause
  }
}

/** Participants: member first, then the hours attributes (EARS-3, EARS-9, EARS-21). */
async function syncParticipants(
  tx: HoursTx,
  before: HoursDocument,
  after: HoursDocument,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ memberId: hoursParticipant.memberId, sortKey: hoursParticipant.sortKey })
    .from(hoursParticipant)
  let nextSortKey = rows.reduce((max, row) => Math.max(max, row.sortKey), -1) + 1

  const previousByEmail = new Map(before.participants.map((p) => [p.email, p]))
  const memberIds = new Map<string, number>()

  for (const participant of after.participants) {
    const member = await memberForParticipant(tx, participant)
    memberIds.set(participant.email, member.id)

    const previous = previousByEmail.get(participant.email)
    if (previous && sameParticipant(previous, participant)) continue

    const attributes = {
      forkMin: participant.fork_min ?? null,
      forkMax: participant.fork_max ?? null,
      grade: participant.grade ?? null,
    }
    if (previous) {
      await tx
        .update(hoursParticipant)
        .set(attributes)
        .where(eq(hoursParticipant.memberId, member.id))
    } else {
      // A brand-new participant appends after the current maximum (EARS-21). The
      // conflict branch covers the one case the document cannot see: a member who
      // already HAS a participant row that `before` did not list, i.e. a race the
      // advisory lock makes impossible and the constraint still refuses to lose.
      await tx
        .insert(hoursParticipant)
        .values({ memberId: member.id, ...attributes, sortKey: nextSortKey })
        .onConflictDoUpdate({ target: hoursParticipant.memberId, set: attributes })
      nextSortKey += 1
    }
  }

  return memberIds
}

/**
 * Periods: inserts and updates only (deletes run last, in `deleteRemovedPeriods`).
 *
 * Rows whose status becomes `closed` are written BEFORE rows that become `open`.
 * The «at most one open period» partial unique index is checked per statement, so
 * handing over the open slot in one document mutation would otherwise fail on
 * statement order alone rather than on anything being wrong.
 */
async function upsertPeriods(tx: HoursTx, before: HoursDocument, after: HoursDocument) {
  const rows = await tx
    .select({ id: hoursPeriod.id, sortKey: hoursPeriod.sortKey })
    .from(hoursPeriod)
  let nextSortKey = rows.reduce((max, row) => Math.max(max, row.sortKey), -1) + 1

  const previousById = new Map(before.periods.map((period) => [period.id, period]))
  const ordered = [...after.periods].sort(
    (a, b) => Number(a.status === 'open') - Number(b.status === 'open'),
  )

  for (const period of ordered) {
    const previous = previousById.get(period.id)
    if (previous && samePeriod(previous, period)) continue

    const columns = {
      label: period.label,
      dateFrom: period.date_from,
      dateTo: period.date_to,
      status: period.status,
    }
    if (previous) {
      await tx.update(hoursPeriod).set(columns).where(eq(hoursPeriod.id, period.id))
    } else {
      await tx.insert(hoursPeriod).values({ id: period.id, ...columns, sortKey: nextSortKey })
      nextSortKey += 1
    }
  }
}

/** Assessments: the (period, member) upsert of EARS-4, plus removals. */
async function syncAssessments(
  tx: HoursTx,
  before: HoursDocument,
  after: HoursDocument,
  memberIds: Map<string, number>,
) {
  const memberIdFor = async (email: string): Promise<number> => {
    const known = memberIds.get(email)
    if (known !== undefined) return known
    const member = await findMemberByEmail(email, { db: tx })
    if (!member) {
      throw new HoursPersistRefusal('Такой участник не заведён — обратись к администратору.')
    }
    memberIds.set(email, member.id)
    return member.id
  }

  const previousByKey = new Map(
    before.assessments.map((a) => [assessmentKey(a.period_id, a.email), a]),
  )
  const keptKeys = new Set(after.assessments.map((a) => assessmentKey(a.period_id, a.email)))

  for (const [key, assessment] of previousByKey) {
    if (keptKeys.has(key)) continue
    await tx
      .delete(hoursAssessment)
      .where(
        and(
          eq(hoursAssessment.periodId, assessment.period_id),
          eq(hoursAssessment.memberId, await memberIdFor(assessment.email)),
        ),
      )
  }

  for (const assessment of after.assessments) {
    const previous = previousByKey.get(assessmentKey(assessment.period_id, assessment.email))
    if (previous && sameAssessment(previous, assessment)) continue

    const columns = {
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
    }
    await tx
      .insert(hoursAssessment)
      .values({
        periodId: assessment.period_id,
        memberId: await memberIdFor(assessment.email),
        ...columns,
      })
      .onConflictDoUpdate({
        target: [hoursAssessment.periodId, hoursAssessment.memberId],
        set: columns,
      })
  }
}

/** Publications: the whole `jsonb` batch is rewritten as one value (EARS-6). */
async function upsertPublications(tx: HoursTx, before: HoursDocument, after: HoursDocument) {
  const previousByPeriod = new Map((before.publications ?? []).map((p) => [p.period_id, p]))

  for (const publication of after.publications ?? []) {
    const previous = previousByPeriod.get(publication.period_id)
    if (previous && samePublication(previous, publication)) continue

    const columns = {
      status: publication.status,
      startedAt: publication.started_at,
      publishedAt: publication.published_at,
      previewFingerprint: publication.preview_fingerprint,
      messages: publication.messages,
    }
    await tx
      .insert(hoursPublication)
      .values({ periodId: publication.period_id, ...columns })
      .onConflictDoUpdate({ target: hoursPublication.periodId, set: columns })
  }
}

/** Period deletes, last: nothing may still reference the row (081 §16). */
async function deleteRemovedPeriods(tx: HoursTx, before: HoursDocument, after: HoursDocument) {
  const keptIds = new Set(after.periods.map((period) => period.id))
  const removed = before.periods.filter((period) => !keptIds.has(period.id)).map((p) => p.id)
  if (removed.length === 0) return
  await tx.delete(hoursPeriod).where(inArray(hoursPeriod.id, removed))
}

/** Applies the whole diff. Throws `HoursPersistRefusal` for an explained refusal. */
export async function persistDocument(
  tx: HoursTx,
  before: HoursDocument,
  after: HoursDocument,
): Promise<void> {
  const memberIds = await syncParticipants(tx, before, after)
  await upsertPeriods(tx, before, after)
  await syncAssessments(tx, before, after, memberIds)
  await upsertPublications(tx, before, after)
  await deleteRemovedPeriods(tx, before, after)
}
