/**
 * The cutover import: a whole legacy `HoursDocument` into empty `core` tables
 * (spec 124 EARS-13, EARS-21).
 *
 * This is deliberately NOT `./persist.ts` with an empty `before` document, even
 * though that would type-check and mostly work. Three differences are the whole
 * point of the clause:
 *
 *  - **An unknown email aborts instead of creating a member.** `persist` calls
 *    `ensureMemberByEmail`, because that is exactly right for the admin form
 *    (EARS-9): a new participant SHOULD get a registry row. In the cutover it is
 *    the opposite — the registry was seeded by hand with the owner (EARS-14), so
 *    an email the seed does not know means the seed and the document disagree,
 *    and the honest answer is to stop with the list of names rather than to invent
 *    people at 3am inside a maintenance window.
 *  - **It never touches a `member` row.** `persist` pushes the participant's
 *    name/role onto the registry, since the admin form owns both. An import that
 *    did that would let a stale `hours.json` silently overwrite the curated seed;
 *    instead a disagreement surfaces as a differing path in the EARS-27 verdict,
 *    which is what the rehearsal (EARS-26) exists to catch.
 *  - **Order is assigned, not diffed.** `sort_key` comes from the JSON array
 *    position and the assessment identity PK from the array iteration order
 *    (EARS-21) — the property every later render depends on and no later save can
 *    reconstruct.
 *
 * Everything here runs on ONE transaction handle, given by the caller, which has
 * already taken the module advisory lock (EARS-10, EARS-13): a constraint firing
 * on the last statement must leave nothing at all behind.
 */
import { count } from 'drizzle-orm'

import { findMemberByEmail } from '@/lib/member'
import { hoursAssessment } from '@/lib/platform/db/schema/hours/hours-assessment'
import { hoursParticipant } from '@/lib/platform/db/schema/hours/hours-participant'
import { hoursPeriod } from '@/lib/platform/db/schema/hours/hours-period'
import { hoursPublicationMessage } from '@/lib/platform/db/schema/hours/hours-publication-message'
import { hoursPublication } from '@/lib/platform/db/schema/hours/hours-publication'

import type { HoursTx } from './db'
import type { HoursDocument } from '../types'

/**
 * An import that refuses to start, or to finish, in words.
 *
 * A throw rather than a return value, for the reason `HoursPersistRefusal` is one
 * too: the refusal is found with the transaction open, and returning from the
 * transaction callback COMMITS.
 */
export class HoursImportRefusal extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HoursImportRefusal'
  }
}

/** Rows per hours table — the import summary, and the emptiness pre-check. */
export type HoursRowCounts = {
  periods: number
  participants: number
  assessments: number
  publications: number
  messages: number
}

/** The table names as the refusal prints them, next to their counts. */
const TABLE_NAMES: Record<keyof HoursRowCounts, string> = {
  periods: 'core.hours_period',
  participants: 'core.hours_participant',
  assessments: 'core.hours_assessment',
  publications: 'core.hours_publication',
  messages: 'core.hours_publication_message',
}

/**
 * Current row counts of the five hours tables.
 *
 * Sequential, not `Promise.all`: these run on ONE transaction handle, i.e. one pg
 * client, and overlapping queries on a single client are deprecated in pg 8 and
 * removed in pg 9 — the driver prints «client.query() when the client is already
 * executing a query» and the second query is not made faster by asking for it
 * early.
 */
export async function countHoursRows(tx: HoursTx): Promise<HoursRowCounts> {
  const periods = await tx.select({ n: count() }).from(hoursPeriod)
  const participants = await tx.select({ n: count() }).from(hoursParticipant)
  const assessments = await tx.select({ n: count() }).from(hoursAssessment)
  const publications = await tx.select({ n: count() }).from(hoursPublication)
  // The child table of #274. The FK makes an orphan message impossible, so it
  // adds nothing to the emptiness pre-check — it is the POST-import comparison
  // it belongs in: without it, «written vs expected» stops proving that every
  // message of every batch was actually written.
  const messages = await tx.select({ n: count() }).from(hoursPublicationMessage)
  return {
    periods: Number(periods[0]?.n ?? 0),
    participants: Number(participants[0]?.n ?? 0),
    assessments: Number(assessments[0]?.n ?? 0),
    publications: Number(publications[0]?.n ?? 0),
    messages: Number(messages[0]?.n ?? 0),
  }
}

/**
 * Refuse a non-empty destination (EARS-13).
 *
 * `hours_*` only, on purpose: the member seed legitimately runs BEFORE the import,
 * so a populated `core.member` is the expected state and a populated
 * `core.hours_period` is a re-run. The documented answer to a re-run is the
 * truncate-and-retry of `docs/runbooks/hours-core-cutover.md`, executed by hand
 * inside the window — never an automatic truncate, which is the one operation that
 * could delete real history on a mistyped command.
 */
export async function assertHoursTablesEmpty(tx: HoursTx): Promise<void> {
  const counts = await countHoursRows(tx)
  const populated = (Object.keys(counts) as Array<keyof HoursRowCounts>).filter(
    (table) => counts[table] > 0,
  )
  if (populated.length === 0) return
  throw new HoursImportRefusal(
    'The hours tables are not empty, so this would be a SECOND import: ' +
      populated.map((table) => `${TABLE_NAMES[table]} has ${counts[table]} row(s)`).join(', ') +
      '. Nothing was written. A deliberate re-run is the truncate-and-retry of ' +
      'docs/runbooks/hours-core-cutover.md, valid only inside the maintenance window.',
  )
}

/**
 * Every email the document needs a `member` for, in first-seen order.
 *
 * Participants and assessments, because both carry a `member_id` column. NOT the
 * publication messages: a delivery record is frozen history, carried verbatim
 * into `core.hours_publication_message`, and its addressee may well have left the
 * team since.
 */
export function documentEmails(doc: HoursDocument): string[] {
  const emails: string[] = []
  const seen = new Set<string>()
  for (const email of [
    ...doc.participants.map((participant) => participant.email),
    ...doc.assessments.map((assessment) => assessment.email),
  ]) {
    if (seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

/**
 * Map every email in the document onto a seeded `member` id, or abort with the
 * whole list of the ones that have none (EARS-13).
 *
 * The whole list, not the first miss: inside a maintenance window the operator
 * needs to know how many names the seed is short of, in one pass, and the member
 * module's API is the only thing consulted for the answer (EARS-8).
 */
export async function resolveMemberIds(
  tx: HoursTx,
  doc: HoursDocument,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  const missing: string[] = []
  for (const email of documentEmails(doc)) {
    const member = await findMemberByEmail(email, { db: tx })
    if (member) ids.set(email, member.id)
    else missing.push(email)
  }
  if (missing.length > 0) {
    throw new HoursImportRefusal(
      `${missing.length} email(s) in the document have no core.member row: ${missing.join(', ')}. ` +
        'Nothing was written — seed the registry first (pnpm platform:member:seed), then import.',
    )
  }
  return ids
}

/**
 * Write the whole document into the empty hours tables, verbatim (EARS-13).
 *
 * Statement order is load-bearing: periods first (assessments and publications
 * reference them), then participants, then assessments, then the publication
 * batches. Periods that are `closed` go in before the `open` one for the same
 * reason `persist.ts` sorts them — the «at most one open period» partial unique
 * index is checked per statement.
 *
 * Assessments are inserted one at a time, in array order, because that order IS
 * the identity-PK order the export reproduces (EARS-21); a single multi-row insert
 * would leave the sequence assignment to drizzle's parameter batching.
 */
export async function importDocument(tx: HoursTx, doc: HoursDocument): Promise<HoursRowCounts> {
  await assertHoursTablesEmpty(tx)
  const memberIds = await resolveMemberIds(tx, doc)
  const memberIdFor = (email: string): number => {
    const id = memberIds.get(email)
    if (id === undefined) {
      // Unreachable: `resolveMemberIds` above has already aborted on any missing
      // email. Stated rather than trusted, so a future edit cannot turn a missing
      // person into a null column.
      throw new HoursImportRefusal(`Unresolved member for ${email} — nothing was written.`)
    }
    return id
  }

  const periodsInWriteOrder = doc.periods
    .map((period, index) => ({ period, index }))
    .sort((a, b) => Number(a.period.status === 'open') - Number(b.period.status === 'open'))
  for (const { period, index } of periodsInWriteOrder) {
    await tx.insert(hoursPeriod).values({
      id: period.id,
      label: period.label,
      dateFrom: period.date_from,
      dateTo: period.date_to,
      status: period.status,
      sortKey: index,
    })
  }

  for (const [index, participant] of doc.participants.entries()) {
    await tx.insert(hoursParticipant).values({
      memberId: memberIdFor(participant.email),
      forkMin: participant.fork_min ?? null,
      forkMax: participant.fork_max ?? null,
      grade: participant.grade ?? null,
      sortKey: index,
    })
  }

  for (const assessment of doc.assessments) {
    await tx.insert(hoursAssessment).values({
      periodId: assessment.period_id,
      memberId: memberIdFor(assessment.email),
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
    })
  }

  for (const publication of doc.publications ?? []) {
    await tx.insert(hoursPublication).values({
      periodId: publication.period_id,
      status: publication.status,
      startedAt: publication.started_at,
      publishedAt: publication.published_at,
      previewFingerprint: publication.preview_fingerprint,
    })
    // One row per message, the array ordinal as the explicit `position` (#274,
    // spec 201 EARS-31) — the same assignment the migration's backfill makes for
    // the batches that were already stored, and the order delivery addresses
    // (spec 100 req. 2/10).
    for (const [position, message] of publication.messages.entries()) {
      await tx.insert(hoursPublicationMessage).values({
        periodId: publication.period_id,
        position,
        email: message.email,
        text: message.text,
        delivery: message.delivery,
        sentAt: message.sent_at ?? null,
      })
    }
  }

  const written = await countHoursRows(tx)
  const expected: HoursRowCounts = {
    periods: doc.periods.length,
    participants: doc.participants.length,
    assessments: doc.assessments.length,
    publications: (doc.publications ?? []).length,
    messages: (doc.publications ?? []).reduce((n, p) => n + p.messages.length, 0),
  }
  // A silent short write is the failure this import cannot be allowed to have:
  // the verdict of EARS-27 would still be computed, but on a document nobody
  // asked for. Compared inside the transaction, so a mismatch rolls back.
  for (const table of Object.keys(expected) as Array<keyof HoursRowCounts>) {
    if (written[table] !== expected[table]) {
      throw new HoursImportRefusal(
        `${TABLE_NAMES[table]} holds ${written[table]} row(s) after importing ` +
          `${expected[table]} — refusing to commit a partial import.`,
      )
    }
  }
  return written
}
