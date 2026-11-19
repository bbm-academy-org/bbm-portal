'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import {
  closePoll,
  createConsentFromLeaders,
  createPoll,
  openPoll,
  submitBallot,
  type VoteResult,
} from '@/lib/vote'

/**
 * The vote module's Server Actions (#575), the same shape as
 * `src/modules/hours/actions.ts`: Next checks the request's Origin for an
 * action, and every action asks `auth()` itself — neither the `/p` layout nor
 * the cabinet layout covers an action endpoint (EARS-462). The permission and
 * the rules are the service's (`@/lib/vote`), so each action is one call; the
 * voter is the session email, never a submitted field.
 */

/** What a form shows: the outcome, never the stored rows. */
export type VoteActionResult = { ok: true } | { ok: false; error: string }

function done(result: VoteResult<unknown>, ...paths: string[]): VoteActionResult {
  if (!result.ok) return { ok: false, error: result.error }
  for (const path of paths) revalidatePath(path)
  return { ok: true }
}

export async function submitBallotAction(input: {
  pollId: number
  choices?: number[]
  answer?: string
  comment?: string
}): Promise<VoteActionResult> {
  const result = await submitBallot(await auth(), {
    pollId: input.pollId,
    choices: input.choices,
    answer: input.answer,
    comment: input.comment,
  })
  return done(result, '/p/vote')
}

export async function createPollAction(input: {
  title: string
  kind: string
  options: string
}): Promise<VoteActionResult> {
  return done(await createPoll(await auth(), input), '/p/admin/vote/polls')
}

export async function openPollAction(pollId: number): Promise<VoteActionResult> {
  return done(await openPoll(await auth(), pollId), '/p/admin/vote/polls', '/p/vote')
}

export async function closePollAction(pollId: number): Promise<VoteActionResult> {
  return done(await closePoll(await auth(), pollId), '/p/admin/vote/polls', '/p/vote')
}

export async function createConsentFromLeadersAction(pollId: number): Promise<VoteActionResult> {
  return done(await createConsentFromLeaders(await auth(), pollId), '/p/admin/vote/polls')
}
