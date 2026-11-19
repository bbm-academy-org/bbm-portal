// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PollRecord } from '@/lib/vote/rules'

/**
 * The session-gated operations of the vote module (#575). The storage door
 * (`@/lib/vote/store`) is mocked: what is under test is WHO may do WHAT and
 * which ballot reaches storage — the voter's identity always comes from the
 * session, never from the submitted input, and every cabinet operation refuses
 * a session without `platform-admin` before it touches storage.
 */

const store = vi.hoisted(() => ({
  listPolls: vi.fn(),
  listOpenPolls: vi.fn(),
  getPoll: vi.fn(),
  insertPolls: vi.fn(),
  updatePollStatus: vi.fn(),
  upsertBallot: vi.fn(),
  listBallots: vi.fn(),
  listVoterBallots: vi.fn(),
}))

vi.mock('@/lib/vote/store', () => store)

const service = await import('@/lib/vote/service')

const member = { user: { email: ' Yulia@BBM.academy ', roles: ['platform-user'] } }
const admin = { user: { email: 'anton@bbm.academy', roles: ['platform-admin'] } }

function poll(overrides: Partial<PollRecord> = {}): PollRecord {
  return {
    id: 7,
    title: 'Цель',
    kind: 'rating',
    options: ['А', 'Б', 'В'],
    status: 'open',
    sourcePollId: null,
    ...overrides,
  }
}

beforeEach(() => {
  for (const fn of Object.values(store)) fn.mockReset()
  store.upsertBallot.mockResolvedValue('saved')
  store.updatePollStatus.mockResolvedValue(true)
})

describe('submitBallot', () => {
  it('stores a rating ballot under the SESSION email, ignoring any email in the input', async () => {
    store.getPoll.mockResolvedValue(poll())
    const result = await service.submitBallot(member, {
      pollId: 7,
      choices: [2, 0],
      voterEmail: 'someone-else@bbm.academy',
    })
    expect(result.ok).toBe(true)
    expect(store.upsertBallot).toHaveBeenCalledTimes(1)
    const [ctx, ballot] = store.upsertBallot.mock.calls[0]
    expect(ctx).toEqual({ actorEmail: 'yulia@bbm.academy', source: 'portal' })
    expect(ballot).toEqual({
      pollId: 7,
      voterEmail: 'yulia@bbm.academy',
      choices: [0, 2],
      consentAnswer: null,
      comment: null,
    })
  })

  it('refuses a third rating choice before storage', async () => {
    store.getPoll.mockResolvedValue(poll())
    const result = await service.submitBallot(member, { pollId: 7, choices: [0, 1, 2] })
    expect(result.ok).toBe(false)
    expect(store.upsertBallot).not.toHaveBeenCalled()
  })

  it('refuses an objection without a comment before storage', async () => {
    store.getPoll.mockResolvedValue(poll({ kind: 'consent', options: [] }))
    const result = await service.submitBallot(member, { pollId: 7, answer: 'object', comment: ' ' })
    expect(result.ok).toBe(false)
    expect(store.upsertBallot).not.toHaveBeenCalled()
  })

  it('stores a consent ballot with its comment', async () => {
    store.getPoll.mockResolvedValue(poll({ kind: 'consent', options: [] }))
    const result = await service.submitBallot(member, {
      pollId: 7,
      answer: 'accept_with_wish',
      comment: 'Короче',
    })
    expect(result.ok).toBe(true)
    expect(store.upsertBallot.mock.calls[0][1]).toEqual({
      pollId: 7,
      voterEmail: 'yulia@bbm.academy',
      choices: [],
      consentAnswer: 'accept_with_wish',
      comment: 'Короче',
    })
  })

  it('refuses a ballot on a closed or draft poll', async () => {
    store.getPoll.mockResolvedValue(poll({ status: 'closed' }))
    expect((await service.submitBallot(member, { pollId: 7, choices: [0] })).ok).toBe(false)
    store.getPoll.mockResolvedValue(poll({ status: 'draft' }))
    expect((await service.submitBallot(member, { pollId: 7, choices: [0] })).ok).toBe(false)
    expect(store.upsertBallot).not.toHaveBeenCalled()
  })

  it('reports a poll closed between the read and the write', async () => {
    store.getPoll.mockResolvedValue(poll())
    store.upsertBallot.mockResolvedValue('not-open')
    expect((await service.submitBallot(member, { pollId: 7, choices: [0] })).ok).toBe(false)
  })

  it('refuses a session without an email or without platform-user', async () => {
    store.getPoll.mockResolvedValue(poll())
    expect((await service.submitBallot(null, { pollId: 7, choices: [0] })).ok).toBe(false)
    expect(
      (
        await service.submitBallot(
          { user: { email: 'x@y.z', roles: [] } },
          { pollId: 7, choices: [0] },
        )
      ).ok,
    ).toBe(false)
    expect(store.upsertBallot).not.toHaveBeenCalled()
  })
})

describe('cabinet operations refuse a non-admin before storage', () => {
  it.each([
    ['adminOverview', () => service.adminOverview(member)],
    [
      'createPoll',
      () => service.createPoll(member, { title: 'Ц', kind: 'rating', options: 'А\nБ' }),
    ],
    ['openPoll', () => service.openPoll(member, 7)],
    ['closePoll', () => service.closePoll(member, 7)],
    ['pollResults', () => service.pollResults(member, 7)],
    ['createConsentFromLeaders', () => service.createConsentFromLeaders(member, 7)],
  ])('%s', async (_name, run) => {
    const result = await run()
    expect(result.ok).toBe(false)
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('createPoll', () => {
  it('creates a draft from the options textarea', async () => {
    store.insertPolls.mockResolvedValue([poll({ status: 'draft' })])
    const result = await service.createPoll(admin, {
      title: ' Цель ',
      kind: 'rating',
      options: 'А\n\nБ\n',
    })
    expect(result.ok).toBe(true)
    expect(store.insertPolls).toHaveBeenCalledWith(
      { actorEmail: 'anton@bbm.academy', source: 'portal' },
      [{ title: 'Цель', kind: 'rating', options: ['А', 'Б'], sourcePollId: null }],
    )
  })

  it('refuses a rating with one option', async () => {
    const result = await service.createPoll(admin, { title: 'Ц', kind: 'rating', options: 'А' })
    expect(result.ok).toBe(false)
    expect(store.insertPolls).not.toHaveBeenCalled()
  })
})

describe('openPoll / closePoll', () => {
  it('opens a draft and closes an open poll', async () => {
    store.getPoll.mockResolvedValue(poll({ status: 'draft' }))
    expect((await service.openPoll(admin, 7)).ok).toBe(true)
    expect(store.updatePollStatus).toHaveBeenLastCalledWith(
      { actorEmail: 'anton@bbm.academy', source: 'portal' },
      7,
      'draft',
      'open',
    )
    store.getPoll.mockResolvedValue(poll({ status: 'open' }))
    expect((await service.closePoll(admin, 7)).ok).toBe(true)
    expect(store.updatePollStatus).toHaveBeenLastCalledWith(
      { actorEmail: 'anton@bbm.academy', source: 'portal' },
      7,
      'open',
      'closed',
    )
  })

  it('refuses to reopen a closed poll', async () => {
    store.getPoll.mockResolvedValue(poll({ status: 'closed' }))
    expect((await service.openPoll(admin, 7)).ok).toBe(false)
    expect(store.updatePollStatus).not.toHaveBeenCalled()
  })
})

describe('createConsentFromLeaders', () => {
  const ballots = (choices: number[][]) =>
    choices.map((c, i) => ({
      voterEmail: `${i}@bbm.academy`,
      voterName: String(i),
      choices: c,
      consentAnswer: null,
      comment: null,
    }))

  it('creates two consent drafts, one per finalist, linked to the rating', async () => {
    store.getPoll.mockResolvedValue(poll({ status: 'closed' }))
    store.listBallots.mockResolvedValue(
      ballots([
        [0, 1],
        [0, 1],
        [0, 2],
      ]),
    )
    store.insertPolls.mockResolvedValue([])
    const result = await service.createConsentFromLeaders(admin, 7)
    expect(result.ok).toBe(true)
    expect(store.insertPolls).toHaveBeenCalledWith(
      { actorEmail: 'anton@bbm.academy', source: 'portal' },
      [
        { title: 'Согласие: А', kind: 'consent', options: [], sourcePollId: 7 },
        { title: 'Согласие: Б', kind: 'consent', options: [], sourcePollId: 7 },
      ],
    )
  })

  it('reports a tie for the second place instead of guessing', async () => {
    store.getPoll.mockResolvedValue(poll({ status: 'closed' }))
    store.listBallots.mockResolvedValue(
      ballots([
        [0, 1],
        [0, 2],
      ]),
    )
    const result = await service.createConsentFromLeaders(admin, 7)
    expect(result).toEqual({
      ok: false,
      error: 'Ничья за второе место — создайте согласие вручную',
    })
    expect(store.insertPolls).not.toHaveBeenCalled()
  })

  it('refuses a rating that is still open, and a consent poll', async () => {
    store.getPoll.mockResolvedValue(poll({ status: 'open' }))
    expect((await service.createConsentFromLeaders(admin, 7)).ok).toBe(false)
    store.getPoll.mockResolvedValue(poll({ status: 'closed', kind: 'consent', options: [] }))
    expect((await service.createConsentFromLeaders(admin, 7)).ok).toBe(false)
    expect(store.insertPolls).not.toHaveBeenCalled()
  })
})
