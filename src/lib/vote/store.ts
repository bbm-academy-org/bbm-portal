/**
 * The vote module's storage door (#575) — the only file that touches
 * `core.vote_poll` / `core.vote_ballot`. Writes go through
 * `platformTransaction()` (every write attributed, spec 201); the audit
 * columns are stamped by the database and never set here.
 *
 * It holds no permission logic: `./service.ts` decides who may call what,
 * and `./rules.ts` what a valid ballot is.
 */
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'

import { listMembers } from '@/lib/member'
import { getPlatformDb } from '@/lib/platform/db/client'
import { voteBallot } from '@/lib/platform/db/schema/vote/vote-ballot'
import { votePoll, type VotePollRow } from '@/lib/platform/db/schema/vote/vote-poll'
import { platformTransaction, type AuditContext } from '@/lib/platform/db/transaction'

import {
  isConsentAnswer,
  isPollKind,
  isPollStatus,
  type BallotView,
  type ConsentAnswer,
  type PollKind,
  type PollRecord,
  type PollStatus,
} from './rules'

export interface PollWithCount extends PollRecord {
  ballotCount: number
}

export interface PollInsert {
  title: string
  kind: PollKind
  options: string[]
  sourcePollId: number | null
}

export interface BallotInsert {
  pollId: number
  voterEmail: string
  choices: number[]
  consentAnswer: ConsentAnswer | null
  comment: string | null
}

export interface VoterBallot {
  pollId: number
  choices: number[]
  consentAnswer: ConsentAnswer | null
  comment: string | null
}

function toPoll(row: VotePollRow): PollRecord {
  // The CHECK constraints keep both columns inside the vocabulary; the guards
  // only narrow the type.
  return {
    id: row.id,
    title: row.title,
    kind: isPollKind(row.kind) ? row.kind : 'rating',
    options: row.options,
    status: isPollStatus(row.status) ? row.status : 'closed',
    sourcePollId: row.sourcePollId,
  }
}

/** Every poll, newest first, with how many members have voted. */
export async function listPolls(): Promise<PollWithCount[]> {
  const db = getPlatformDb()
  const polls = await db.select().from(votePoll).orderBy(desc(votePoll.id))
  const counts = await db
    .select({ pollId: voteBallot.pollId, n: count() })
    .from(voteBallot)
    .groupBy(voteBallot.pollId)
  const byPoll = new Map(counts.map((c) => [c.pollId, Number(c.n)]))
  return polls.map((row) => ({ ...toPoll(row), ballotCount: byPoll.get(row.id) ?? 0 }))
}

/** The polls a member can vote in right now, in creation order. */
export async function listOpenPolls(): Promise<PollRecord[]> {
  const rows = await getPlatformDb()
    .select()
    .from(votePoll)
    .where(eq(votePoll.status, 'open'))
    .orderBy(asc(votePoll.id))
  return rows.map(toPoll)
}

export async function getPoll(id: number): Promise<PollRecord | null> {
  const rows = await getPlatformDb().select().from(votePoll).where(eq(votePoll.id, id)).limit(1)
  return rows[0] ? toPoll(rows[0]) : null
}

/** New polls are always drafts; several are inserted in one transaction. */
export async function insertPolls(ctx: AuditContext, polls: PollInsert[]): Promise<PollRecord[]> {
  if (polls.length === 0) return []
  const rows = await platformTransaction(ctx, (tx) =>
    tx
      .insert(votePoll)
      .values(polls.map((p) => ({ ...p, status: 'draft' })))
      .returning(),
  )
  return rows.map(toPoll)
}

/** Compare-and-set: changes the status only if it still is `from`. */
export async function updatePollStatus(
  ctx: AuditContext,
  id: number,
  from: PollStatus,
  to: PollStatus,
): Promise<boolean> {
  const rows = await platformTransaction(ctx, (tx) =>
    tx
      .update(votePoll)
      .set({ status: to })
      .where(and(eq(votePoll.id, id), eq(votePoll.status, from)))
      .returning({ id: votePoll.id }),
  )
  return rows.length === 1
}

/**
 * One ballot per (poll, voter): a re-vote replaces it. The poll row is locked
 * and re-read inside the same transaction, so a ballot racing the close is
 * refused rather than counted after the results were shown.
 */
export async function upsertBallot(
  ctx: AuditContext,
  ballot: BallotInsert,
): Promise<'saved' | 'not-open'> {
  return platformTransaction(ctx, async (tx) => {
    const [poll] = await tx
      .select({ status: votePoll.status })
      .from(votePoll)
      .where(eq(votePoll.id, ballot.pollId))
      .for('share')
    if (poll?.status !== 'open') return 'not-open'

    await tx
      .insert(voteBallot)
      .values(ballot)
      .onConflictDoUpdate({
        target: [voteBallot.pollId, voteBallot.voterEmail],
        set: {
          choices: ballot.choices,
          consentAnswer: ballot.consentAnswer,
          comment: ballot.comment,
        },
      })
    return 'saved'
  })
}

/** A poll's ballots, the voter resolved to the member's name where one is known. */
export async function listBallots(pollId: number): Promise<BallotView[]> {
  const rows = await getPlatformDb()
    .select()
    .from(voteBallot)
    .where(eq(voteBallot.pollId, pollId))
    .orderBy(asc(voteBallot.id))
  if (rows.length === 0) return []

  const names = new Map((await listMembers()).map((m) => [m.email.toLowerCase(), m.name]))
  return rows.map((row) => ({
    voterEmail: row.voterEmail,
    voterName: names.get(row.voterEmail) ?? row.voterEmail,
    choices: row.choices,
    consentAnswer: isConsentAnswer(row.consentAnswer) ? row.consentAnswer : null,
    comment: row.comment,
  }))
}

/** One member's ballots, optionally narrowed to some polls. */
export async function listVoterBallots(email: string, pollIds?: number[]): Promise<VoterBallot[]> {
  if (pollIds && pollIds.length === 0) return []
  const where = pollIds
    ? and(eq(voteBallot.voterEmail, email), inArray(voteBallot.pollId, pollIds))
    : eq(voteBallot.voterEmail, email)
  const rows = await getPlatformDb()
    .select()
    .from(voteBallot)
    .where(where)
    .orderBy(asc(voteBallot.pollId))
  return rows.map((row) => ({
    pollId: row.pollId,
    choices: row.choices,
    consentAnswer: isConsentAnswer(row.consentAnswer) ? row.consentAnswer : null,
    comment: row.comment,
  }))
}
