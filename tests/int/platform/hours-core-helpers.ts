import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type { Assessment, HoursDocument, Participant } from '@/lib/hours'

/**
 * Seeding and truncation for the hours-on-core integration specs (spec 124).
 *
 * Everything here writes RAW SQL rather than importing the table files: a test
 * that seeds through the module's own repository would prove the repository
 * consistent with itself. Raw SQL is also what the owner's escape hatch and the
 * cutover import use, which is the write path several of these clauses are about.
 */
export type IntDb = NodePgDatabase

/**
 * The tables every hours spec resets, children first. `member` is included
 * because the hours participant FK points at it (ON DELETE RESTRICT), so a
 * leftover member would carry a participant into the next test.
 */
export async function truncateHoursTables(db: IntDb): Promise<void> {
  await db.execute(sql`truncate table
    core.hours_publication, core.hours_assessment, core.hours_participant, core.hours_period,
    core.member_alias, core.member
    restart identity cascade`)
}

export async function seedMember(
  db: IntDb,
  input: { email: string; name: string; role?: string | null; slug?: string },
): Promise<number> {
  const slug = input.slug ?? input.email.split('@')[0]
  const rows = (
    await db.execute(sql`insert into core.member (slug, email, name, role)
                         values (${slug}, ${input.email}, ${input.name}, ${input.role ?? null})
                         returning id`)
  ).rows as Array<{ id: number }>
  return rows[0].id
}

export async function seedParticipant(
  db: IntDb,
  memberId: number,
  input: {
    forkMin?: number | null
    forkMax?: number | null
    grade?: string | null
    sortKey: number
  },
): Promise<void> {
  await db.execute(sql`insert into core.hours_participant
    (member_id, fork_min, fork_max, grade, sort_key)
    values (${memberId}, ${input.forkMin ?? null}, ${input.forkMax ?? null},
            ${input.grade ?? null}, ${input.sortKey})`)
}

export async function seedPeriod(
  db: IntDb,
  input: {
    id: string
    label: string
    from: string
    to: string
    status?: 'open' | 'closed'
    sortKey?: number
  },
): Promise<void> {
  await db.execute(sql`insert into core.hours_period
    (id, label, date_from, date_to, status, sort_key)
    values (${input.id}, ${input.label}, ${input.from}, ${input.to},
            ${input.status ?? 'closed'}, ${input.sortKey ?? 0})`)
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
