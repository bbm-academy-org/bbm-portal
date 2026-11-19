// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { voteBallot } from '@/lib/platform/db/schema/vote/vote-ballot'
import { votePoll } from '@/lib/platform/db/schema/vote/vote-poll'
import {
  getPoll,
  insertPolls,
  listBallots,
  listOpenPolls,
  listPolls,
  listVoterBallots,
  updatePollStatus,
  upsertBallot,
} from '@/lib/vote/store'

import { fixtureWrite } from './hours-core-helpers'
import { truncateAsFixture } from './privilege-helpers'

/**
 * The vote module against the REAL `core` tables (#575, migration `0020_vote`).
 *
 * What a mock cannot assert: one ballot per (poll, voter) is a unique index, a
 * re-vote REPLACES the row through `on conflict`, a ballot on a poll that is not
 * open is refused inside the write transaction, and a status change only
 * happens from the status the caller saw.
 *
 * Needs `PLATFORM_DATABASE_URL` (this worktree's branch DB). Runs in CI's
 * `platform-int` job; `pnpm exec vitest run tests/int/platform`.
 */

const ACTOR = { actorEmail: 'yt@bbm.academy', source: 'portal' } as const

const db = getPlatformDb()

beforeEach(async () => {
  await truncateAsFixture(
    'truncate table core.vote_ballot, core.vote_poll restart identity cascade',
  )
})

afterAll(async () => {
  await closePlatformDb()
})

async function openRating(options = ['А', 'Б', 'В']) {
  const [poll] = await insertPolls(ACTOR, [
    { title: 'Цель', kind: 'rating', options, sourcePollId: null },
  ])
  expect(await updatePollStatus(ACTOR, poll.id, 'draft', 'open')).toBe(true)
  return poll
}

describe('the vote tables on core', () => {
  it('carry the module columns and the four audit columns', async () => {
    const rows = (
      await db.execute(sql`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'core' and table_name in ('vote_poll', 'vote_ballot')
        order by table_name, column_name
      `)
    ).rows as Array<{ table_name: string; column_name: string }>
    const columns = (table: string) =>
      rows.filter((r) => r.table_name === table).map((r) => r.column_name)

    expect(columns('vote_poll')).toEqual(
      [
        'created_at',
        'created_by',
        'id',
        'kind',
        'options',
        'source_poll_id',
        'status',
        'title',
        'updated_at',
        'updated_by',
      ].sort(),
    )
    expect(columns('vote_ballot')).toEqual(
      [
        'choices',
        'comment',
        'consent_answer',
        'created_at',
        'created_by',
        'id',
        'poll_id',
        'updated_at',
        'updated_by',
        'voter_email',
      ].sort(),
    )
    // The drizzle handles name the same tables the SQL reads.
    expect(votePoll).toBeDefined()
    expect(voteBallot).toBeDefined()
  })

  it('refuses an unknown kind and status at the database', async () => {
    await expect(
      fixtureWrite((tx) =>
        tx.execute(
          sql`insert into core.vote_poll (title, kind, options, status) values ('x', 'values', '{}', 'draft')`,
        ),
      ),
    ).rejects.toThrow()
    await expect(
      fixtureWrite((tx) =>
        tx.execute(
          sql`insert into core.vote_poll (title, kind, options, status) values ('x', 'rating', '{}', 'done')`,
        ),
      ),
    ).rejects.toThrow()
  })
})

describe('the vote store', () => {
  it('creates drafts, lists polls with their ballot count and only open polls as open', async () => {
    const rating = await openRating()
    const [draft] = await insertPolls(ACTOR, [
      { title: 'Согласие: А', kind: 'consent', options: [], sourcePollId: rating.id },
    ])
    expect(draft.status).toBe('draft')
    expect(draft.sourcePollId).toBe(rating.id)

    await upsertBallot(ACTOR, {
      pollId: rating.id,
      voterEmail: 'yt@bbm.academy',
      choices: [0, 1],
      consentAnswer: null,
      comment: null,
    })

    const polls = await listPolls()
    expect(polls.map((p) => [p.title, p.status, p.ballotCount])).toEqual([
      ['Согласие: А', 'draft', 0],
      ['Цель', 'open', 1],
    ])
    expect((await listOpenPolls()).map((p) => p.id)).toEqual([rating.id])
  })

  it('keeps one ballot per voter — a re-vote replaces it', async () => {
    const poll = await openRating()
    const ballot = {
      pollId: poll.id,
      voterEmail: 'yt@bbm.academy',
      choices: [0],
      consentAnswer: null,
      comment: null,
    }
    expect(await upsertBallot(ACTOR, ballot)).toBe('saved')
    expect(await upsertBallot(ACTOR, { ...ballot, choices: [1, 2] })).toBe('saved')

    const ballots = await listBallots(poll.id)
    expect(ballots).toHaveLength(1)
    expect(ballots[0].choices).toEqual([1, 2])
    expect((await listVoterBallots('yt@bbm.academy')).map((b) => b.choices)).toEqual([[1, 2]])
  })

  it('refuses a ballot once the poll is closed', async () => {
    const poll = await openRating()
    expect(await updatePollStatus(ACTOR, poll.id, 'open', 'closed')).toBe(true)
    expect(
      await upsertBallot(ACTOR, {
        pollId: poll.id,
        voterEmail: 'yt@bbm.academy',
        choices: [0],
        consentAnswer: null,
        comment: null,
      }),
    ).toBe('not-open')
    expect(await listBallots(poll.id)).toEqual([])
  })

  it('changes a status only from the status the caller saw', async () => {
    const poll = await openRating()
    expect(await updatePollStatus(ACTOR, poll.id, 'draft', 'open')).toBe(false)
    expect((await getPoll(poll.id))?.status).toBe('open')
  })
})
