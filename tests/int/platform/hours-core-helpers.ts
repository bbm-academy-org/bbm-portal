import { sql } from 'drizzle-orm'

import type { Assessment, HoursDocument, Participant } from '@/lib/hours'
import type { PlatformDb } from '@/lib/platform/db/client'
import {
  platformTransaction,
  type AuditContext,
  type PlatformTx,
} from '@/lib/platform/db/transaction'

import { truncateAsFixture } from './privilege-helpers'

/**
 * Seeding and truncation for the hours-on-core integration specs (spec 124).
 *
 * Everything here writes RAW SQL rather than importing the table files: a test
 * that seeds through the module's own repository would prove the repository
 * consistent with itself. Raw SQL is also what the owner's escape hatch and the
 * cutover import use, which is the write path several of these clauses are about.
 *
 * Since spec 201 every seed runs through `platformTransaction` under
 * `cli:int-fixture`: `getPlatformDb()` is the app-marked pool (EARS-26), so a
 * fixture INSERT with no audit context is refused by `core.audit_row_change()`
 * exactly like an application write that skipped the helper would be. That is
 * the delivery's own scope, named in the spec — «a delivery that marks the pool
 * without converting them turns its own test seeds into failed writes».
 */

/** The fixture's own door (EARS-7): a repo-owned writer with no human behind it. */
export const FIXTURE_AUDIT_CTX: AuditContext = { actorEmail: null, source: 'cli:int-fixture' }

/**
 * One raw fixture statement (or a few), inside one attributed transaction.
 *
 * The door a spec uses when it writes SQL of its own — the escape hatch's shape,
 * which is exactly the write path several of spec 124's clauses are about — so
 * that the statement is attributed instead of refused (spec 201 EARS-26).
 */
export function fixtureWrite<T>(fn: (tx: PlatformTx) => Promise<T>): Promise<T> {
  return platformTransaction(FIXTURE_AUDIT_CTX, fn)
}
export type IntDb = PlatformDb

/**
 * The tables every hours spec resets, children first. `member` is included
 * because the hours participant FK points at it (ON DELETE RESTRICT), so a
 * leftover member would carry a participant into the next test.
 *
 * Runs through the FIXTURE connection, not the application pool — see
 * `truncateAsFixture` in `./privilege-helpers`. The `db` parameter is kept only
 * so every call site reads exactly as it did before, and is unused.
 */
export async function truncateHoursTables(_db?: IntDb): Promise<void> {
  await truncateAsFixture(`truncate table
    core.hours_publication_message, core.hours_publication, core.hours_assessment,
    core.hours_participant, core.hours_period,
    core.member_alias, core.member
    restart identity cascade`)
}

export async function seedMember(input: {
  email: string
  name: string
  role?: string | null
  slug?: string
}): Promise<number> {
  const slug = input.slug ?? input.email.split('@')[0]
  return platformTransaction(FIXTURE_AUDIT_CTX, async (tx) => {
    const rows = (
      await tx.execute(sql`insert into core.member (slug, email, name, role)
                           values (${slug}, ${input.email}, ${input.name}, ${input.role ?? null})
                           returning id`)
    ).rows as Array<{ id: number }>
    return rows[0].id
  })
}

export async function seedParticipant(
  memberId: number,
  input: {
    forkMin?: number | null
    forkMax?: number | null
    grade?: string | null
    sortKey: number
  },
): Promise<void> {
  await platformTransaction(FIXTURE_AUDIT_CTX, async (tx) =>
    tx.execute(sql`insert into core.hours_participant
    (member_id, fork_min, fork_max, grade, sort_key)
    values (${memberId}, ${input.forkMin ?? null}, ${input.forkMax ?? null},
            ${input.grade ?? null}, ${input.sortKey})`),
  )
}

export async function seedPeriod(input: {
  id: string
  label: string
  from: string
  to: string
  status?: 'open' | 'closed'
  sortKey?: number
}): Promise<void> {
  await platformTransaction(FIXTURE_AUDIT_CTX, async (tx) =>
    tx.execute(sql`insert into core.hours_period
    (id, label, date_from, date_to, status, sort_key)
    values (${input.id}, ${input.label}, ${input.from}, ${input.to},
            ${input.status ?? 'closed'}, ${input.sortKey ?? 0})`),
  )
}

export function participantOf(doc: HoursDocument, email: string): Participant | undefined {
  return doc.participants.find((participant) => participant.email === email)
}

export function assessmentOf(
  doc: HoursDocument,
  periodId: string,
  email: string,
): Assessment | undefined {
  return doc.assessments.find(
    (assessment) => assessment.period_id === periodId && assessment.email === email,
  )
}
