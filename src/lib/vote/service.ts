/**
 * The vote module's operations, each gated on the session it is handed (#575).
 *
 * The Server Actions and the pages pass `await auth()` straight through, so
 * the gate lives here — next to the operation, unit-testable without Next —
 * and holds for every caller: a member operation needs `platform-user`, a
 * cabinet operation `platform-admin`, and both refuse before storage is
 * touched. The voter is ALWAYS the session email; nothing submitted can name
 * another member.
 */
import {
  hasClaim,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_USER_ROLE,
  sessionActorEmail,
  type SessionLike,
} from '@/lib/platform/authGate'
import type { AuditContext } from '@/lib/platform/db/transaction'

import {
  ensureVotable,
  tallyConsent,
  tallyRating,
  topTwoLeaders,
  transitionPoll,
  validateConsentBallot,
  validatePollDraft,
  validateRatingBallot,
  type ConsentTally,
  type LeadersResult,
  type PollRecord,
  type PollStatus,
  type RatingTally,
} from './rules'
import {
  getPoll,
  insertPolls,
  listBallots,
  listOpenPolls,
  listPolls,
  listVoterBallots,
  updatePollStatus,
  upsertBallot,
  type PollWithCount,
  type VoterBallot,
} from './store'

type Session = SessionLike | null | undefined

export type VoteResult<T = null> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): VoteResult<T> => ({ ok: true, value })
const fail = <T>(error: string): VoteResult<T> => ({ ok: false, error })

type Gate = { ok: true; ctx: AuditContext; email: string } | { ok: false; error: string }

function gate(session: Session, role: string): Gate {
  const email = sessionActorEmail(session)
  if (!email) return { ok: false, error: 'Сессия истекла — войдите заново.' }
  if (!hasClaim(session, role)) return { ok: false, error: 'Недостаточно прав.' }
  return { ok: true, email, ctx: { actorEmail: email, source: 'portal' } }
}

function pollIdOf(value: unknown): number | null {
  const id = typeof value === 'string' ? Number(value) : value
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

// ── member side ──────────────────────────────────────────────────────────────

export interface MemberPoll {
  poll: PollRecord
  myBallot: VoterBallot | null
}

/** The open polls, each with the signed-in member's current answer. */
export async function memberOverview(session: Session): Promise<VoteResult<MemberPoll[]>> {
  const g = gate(session, PLATFORM_USER_ROLE)
  if (!g.ok) return fail(g.error)
  const polls = await listOpenPolls()
  const mine = await listVoterBallots(
    g.email,
    polls.map((p) => p.id),
  )
  const byPoll = new Map(mine.map((b) => [b.pollId, b]))
  return ok(polls.map((poll) => ({ poll, myBallot: byPoll.get(poll.id) ?? null })))
}

/** Untrusted input: any other field — a voter email included — is ignored. */
export interface BallotInput {
  [field: string]: unknown
  pollId: unknown
  choices?: unknown
  answer?: unknown
  comment?: unknown
}

export async function submitBallot(session: Session, input: BallotInput): Promise<VoteResult> {
  const g = gate(session, PLATFORM_USER_ROLE)
  if (!g.ok) return fail(g.error)
  const pollId = pollIdOf(input.pollId)
  const poll = pollId === null ? null : await getPoll(pollId)
  if (!poll) return fail('Голосование не найдено.')

  const votable = ensureVotable(poll.status)
  if (!votable.ok) return fail(votable.error)

  let ballot
  if (poll.kind === 'rating') {
    const choices = validateRatingBallot(input.choices, poll.options.length)
    if (!choices.ok) return fail(choices.error)
    ballot = { choices: choices.value, consentAnswer: null, comment: null }
  } else {
    const consent = validateConsentBallot(input.answer, input.comment)
    if (!consent.ok) return fail(consent.error)
    ballot = { choices: [], consentAnswer: consent.value.answer, comment: consent.value.comment }
  }

  const saved = await upsertBallot(g.ctx, { pollId: poll.id, voterEmail: g.email, ...ballot })
  if (saved === 'not-open') return fail('Голосование уже закрыто.')
  return ok(null)
}

// ── cabinet side ─────────────────────────────────────────────────────────────

export async function adminOverview(session: Session): Promise<VoteResult<PollWithCount[]>> {
  const g = gate(session, PLATFORM_ADMIN_ROLE)
  if (!g.ok) return fail(g.error)
  return ok(await listPolls())
}

export async function createPoll(
  session: Session,
  input: { title: unknown; kind: unknown; options: unknown },
): Promise<VoteResult<PollRecord>> {
  const g = gate(session, PLATFORM_ADMIN_ROLE)
  if (!g.ok) return fail(g.error)
  const draft = validatePollDraft(input)
  if (!draft.ok) return fail(draft.error)
  const [poll] = await insertPolls(g.ctx, [{ ...draft.value, sourcePollId: null }])
  return ok(poll)
}

async function movePoll(session: Session, id: unknown, to: PollStatus): Promise<VoteResult> {
  const g = gate(session, PLATFORM_ADMIN_ROLE)
  if (!g.ok) return fail(g.error)
  const pollId = pollIdOf(id)
  const poll = pollId === null ? null : await getPoll(pollId)
  if (!poll) return fail('Голосование не найдено.')
  const next = transitionPoll(poll.status, to)
  if (!next.ok) return fail(next.error)
  const moved = await updatePollStatus(g.ctx, poll.id, poll.status, next.value)
  return moved ? ok(null) : fail('Статус уже изменился — обновите страницу.')
}

export function openPoll(session: Session, id: unknown): Promise<VoteResult> {
  return movePoll(session, id, 'open')
}

export function closePoll(session: Session, id: unknown): Promise<VoteResult> {
  return movePoll(session, id, 'closed')
}

export interface PollResults {
  poll: PollRecord
  tally: RatingTally | ConsentTally
  leaders: LeadersResult | null
}

export async function pollResults(session: Session, id: unknown): Promise<VoteResult<PollResults>> {
  const g = gate(session, PLATFORM_ADMIN_ROLE)
  if (!g.ok) return fail(g.error)
  const pollId = pollIdOf(id)
  const poll = pollId === null ? null : await getPoll(pollId)
  if (!poll) return fail('Голосование не найдено.')
  const ballots = await listBallots(poll.id)
  if (poll.kind === 'rating') {
    const tally = tallyRating(poll.options, ballots)
    return ok({ poll, tally, leaders: topTwoLeaders(tally) })
  }
  return ok({ poll, tally: tallyConsent(ballots), leaders: null })
}

/** Two consent drafts from a closed rating, one per finalist — or the tie, reported. */
export async function createConsentFromLeaders(
  session: Session,
  id: unknown,
): Promise<VoteResult<PollRecord[]>> {
  const g = gate(session, PLATFORM_ADMIN_ROLE)
  if (!g.ok) return fail(g.error)
  const pollId = pollIdOf(id)
  const poll = pollId === null ? null : await getPoll(pollId)
  if (!poll) return fail('Голосование не найдено.')
  if (poll.kind !== 'rating') return fail('Согласие создаётся только из рейтинга.')
  if (poll.status !== 'closed') return fail('Сначала закройте рейтинг.')

  const leaders = topTwoLeaders(tallyRating(poll.options, await listBallots(poll.id)))
  if (leaders.status !== 'ok') return fail(leaders.message)
  const created = await insertPolls(
    g.ctx,
    leaders.leaders.map((leader) => ({
      title: `Согласие: ${leader.text}`,
      kind: 'consent' as const,
      options: [],
      sourcePollId: poll.id,
    })),
  )
  return ok(created)
}
