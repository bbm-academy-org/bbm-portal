import { describe, expect, it, vi } from 'vitest'

import {
  STAGES,
  classifyChecks,
  cwdGuardMessage,
  failCode,
  findAgentApproval,
  gateConditions,
  headCommittedDate,
  isWorktreeCwd,
  issueCandidates,
  landPr,
  parseFlags,
  runGate,
  stageRemedy,
} from '../../tools/gh/pr-land.mjs'

/**
 * `pnpm pr:land` — the PR closing tail. Every stage is injected, so the test
 * drives their order and their aborts with no subprocess and no network.
 * Canon: `.claude/skills/task-canon/SKILL.md` §7.
 */

describe('classifyChecks', () => {
  it('everything completed successfully is green', () => {
    expect(
      classifyChecks([{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }]).verdict,
    ).toBe('green')
  })

  it('an unfinished run means wait, not «green»', () => {
    expect(classifyChecks([{ name: 'ci', status: 'IN_PROGRESS' }]).verdict).toBe('pending')
  })

  it('zero registered runs does not count as green', () => {
    expect(classifyChecks([]).verdict).toBe('pending')
  })

  it('CANCELLED is red: a cancelled run proved nothing', () => {
    const res = classifyChecks([{ name: 'ci', status: 'COMPLETED', conclusion: 'CANCELLED' }])
    expect(res.verdict).toBe('red')
    expect(res.failed[0]).toMatch(/CANCELLED/)
  })

  it('SKIPPED and NEUTRAL are a legitimate «nothing to do»', () => {
    expect(
      classifyChecks([
        { name: 'a', status: 'COMPLETED', conclusion: 'SKIPPED' },
        { name: 'b', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      ]).verdict,
    ).toBe('green')
  })

  it('parses StatusContext rows by their state field too', () => {
    expect(classifyChecks([{ context: 'legacy', state: 'FAILURE' }]).verdict).toBe('red')
    expect(classifyChecks([{ context: 'legacy', state: 'PENDING' }]).verdict).toBe('pending')
    expect(classifyChecks([{ context: 'legacy', state: 'SUCCESS' }]).verdict).toBe('green')
  })

  it('red beats pending — there is nothing left to wait for', () => {
    expect(
      classifyChecks([
        { name: 'a', status: 'IN_PROGRESS' },
        { name: 'b', status: 'COMPLETED', conclusion: 'FAILURE' },
      ]).verdict,
    ).toBe('red')
  })
})

describe('findAgentApproval', () => {
  const HEAD = '2026-08-04T12:00:00Z'

  it('a fresh VERDICT: APPROVE counts', () => {
    const res = findAgentApproval(
      [{ body: 'review…\n\nVERDICT: APPROVE', createdAt: '2026-08-04T12:30:00Z' }],
      HEAD,
    )
    expect(res.ok).toBe(true)
  })

  it('an APPROVE older than the last commit is stale: it is about different code', () => {
    const res = findAgentApproval(
      [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-04T11:00:00Z' }],
      HEAD,
    )
    expect(res).toMatchObject({ ok: false, reason: 'stale' })
  })

  it('a later REQUEST_CHANGES overrides an earlier APPROVE', () => {
    const res = findAgentApproval(
      [
        { body: 'VERDICT: APPROVE', createdAt: '2026-08-04T12:10:00Z' },
        { body: 'VERDICT: REQUEST_CHANGES', createdAt: '2026-08-04T12:20:00Z' },
      ],
      HEAD,
    )
    expect(res).toMatchObject({ ok: false, reason: 'changes' })
  })

  it('an ordinary comment does not count as a verdict', () => {
    expect(findAgentApproval([{ body: 'looks ok, merging', createdAt: HEAD }], HEAD)).toMatchObject(
      { ok: false, reason: 'none' },
    )
  })

  it('without a last-commit date freshness is not checked, but an APPROVE is still required', () => {
    expect(
      findAgentApproval([{ body: 'VERDICT: APPROVE', createdAt: '2020-01-01T00:00:00Z' }], null).ok,
    ).toBe(true)
    expect(findAgentApproval([], null).ok).toBe(false)
  })
})

describe('headCommittedDate', () => {
  it('takes the date of the PR’s LAST commit', () => {
    expect(headCommittedDate({ commits: [{ committedDate: 'a' }, { committedDate: 'b' }] })).toBe(
      'b',
    )
  })

  it('returns null on an empty commit list instead of throwing', () => {
    expect(headCommittedDate({})).toBeNull()
  })
})

describe('gateConditions', () => {
  const ok = {
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    closingIssuesReferences: [{ number: 130 }],
  }

  it('a healthy PR yields no RED reasons', () => {
    expect(gateConditions(ok).red).toEqual([])
  })

  it('a closed, a draft and a conflicting PR are all RED', () => {
    expect(gateConditions({ ...ok, state: 'MERGED' }).red[0]).toMatch(/not open/)
    expect(gateConditions({ ...ok, isDraft: true }).red[0]).toMatch(/draft/)
    expect(gateConditions({ ...ok, mergeable: 'CONFLICTING' }).red[0]).toMatch(/conflicts/)
  })

  it('no `Closes #N` is RED: board-done would have nowhere to set Done', () => {
    expect(gateConditions({ ...ok, closingIssuesReferences: [] }).red[0]).toMatch(/Closes #N/)
  })

  it('no review at all is RED by default, and says how to close that', () => {
    const res = gateConditions({ ...ok, reviewDecision: '' })
    expect(res.red[0]).toMatch(/review is not confirmed/)
    expect(res.red[0]).toMatch(/--no-review-gate/)
  })

  it('a subagent reviewer’s comment counts on a par with a human APPROVE', () => {
    const res = gateConditions({
      ...ok,
      reviewDecision: '',
      commits: [{ committedDate: '2026-08-04T12:00:00Z' }],
      comments: [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-04T12:30:00Z' }],
    })
    expect(res.red).toEqual([])
  })

  it('a stale subagent verdict does not save the PR — RED', () => {
    const res = gateConditions({
      ...ok,
      reviewDecision: '',
      commits: [{ committedDate: '2026-08-04T12:00:00Z' }],
      comments: [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-04T11:00:00Z' }],
    })
    expect(res.red[0]).toMatch(/older than the last commit/)
  })

  it('with --require-review a subagent comment does not count', () => {
    const res = gateConditions(
      {
        ...ok,
        reviewDecision: '',
        comments: [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-04T12:30:00Z' }],
      },
      { requireReview: true },
    )
    expect(res.red[0]).toMatch(/human APPROVE/)
  })

  it('a lifted gate does not go red, but the gap stays in the remarks', () => {
    const res = gateConditions({ ...ok, reviewDecision: '' }, { reviewGate: false })
    expect(res.red).toEqual([])
    expect(res.warn.join('\n')).toMatch(/review gate was lifted by hand/)
  })

  it('the owner-acceptance reminder is printed ALWAYS, even on an APPROVE', () => {
    expect(gateConditions(ok).warn.join('\n')).toMatch(/stage 5/)
  })

  it('a branch behind its base is a remark', () => {
    expect(gateConditions({ ...ok, mergeStateStatus: 'BEHIND' }).warn.join('\n')).toMatch(/BEHIND/)
  })
})

describe('runGate', () => {
  const pr = (over = {}) => ({
    ok: true,
    data: {
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      closingIssuesReferences: [{ number: 130 }],
      headRefName: 'chore/130-x',
      headRefOid: 'aaa',
      statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      ...over,
    },
  })

  it('green checks give a green gate; the Closes numbers and the SHA are passed on', () => {
    const res = runGate(
      1,
      { timeout: 10, interval: 1, requireReview: false },
      { viewPr: () => pr() },
    )
    expect(res.verdict).toBe('green')
    expect(res.closes).toEqual([130])
    expect(res.branch).toBe('chore/130-x')
    expect(res.sha).toBe('aaa')
  })

  it('waits out unfinished checks and takes the green on the second probe', () => {
    const responses = [pr({ statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS' }] }), pr()]
    const sleep = vi.fn()
    const res = runGate(
      1,
      { timeout: 100, interval: 1, requireReview: false },
      { viewPr: () => responses.shift()!, sleep, now: () => 0 },
    )
    expect(res.verdict).toBe('green')
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('head moving while we wait is RED: a green on the old SHA means nothing', () => {
    const responses = [
      pr({ statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS' }] }),
      pr({ headRefOid: 'bbb' }),
    ]
    const res = runGate(
      1,
      { timeout: 100, interval: 1, requireReview: false },
      { viewPr: () => responses.shift()!, sleep: () => {}, now: () => 0 },
    )
    expect(res.verdict).toBe('red')
    expect(res.reasons[0]).toMatch(/head moved/)
    // the PINNED SHA is what leaves the function, not the last one read
    expect(res.sha).toBe('aaa')
  })

  it('an expired timeout is its own verdict, neither «green» nor «red»', () => {
    let t = 0
    const res = runGate(
      1,
      { timeout: 1, interval: 1, requireReview: false },
      {
        viewPr: () => pr({ statusCheckRollup: [{ name: 'ci', status: 'QUEUED' }] }),
        sleep: () => {},
        now: () => (t += 100_000),
      },
    )
    expect(res.verdict).toBe('timeout')
  })

  it('an unreachable PR is RED, carrying gh’s error text', () => {
    const res = runGate(
      1,
      { timeout: 1, interval: 1, requireReview: false },
      { viewPr: () => ({ ok: false, error: 'gh crashed' }) },
    )
    expect(res.verdict).toBe('red')
    expect(res.reasons[0]).toBe('gh crashed')
  })
})

describe('issueCandidates', () => {
  it('takes the numbers from Closes and from the branch name, without duplicates', () => {
    expect(issueCandidates([130], 'chore/130-kanon')).toEqual([130])
    expect(issueCandidates([130], 'chore/131-other')).toEqual([130, 131])
  })

  it('invents no candidates on a branch that carries no number', () => {
    expect(issueCandidates([], 'main')).toEqual([])
  })
})

describe('failCode', () => {
  it('a child’s non-zero code passes through as is', () => {
    expect(failCode(4)).toBe(4)
  })

  it('a child killed by a signal (null) never reads as success', () => {
    expect(failCode(null)).toBe(1)
    expect(failCode(0)).toBe(1)
  })
})

describe('isWorktreeCwd', () => {
  it('recognises a worktree with either separator', () => {
    expect(isWorktreeCwd('C:\\repo\\.claude\\worktrees\\130')).toBe(true)
    expect(isWorktreeCwd('/c/repo/.claude/worktrees/130')).toBe(true)
  })

  it('does not take the main checkout for a worktree', () => {
    expect(isWorktreeCwd('C:\\Users\\sidor\\repos\\bbm-portal')).toBe(false)
  })

  it('the refusal text explains why it is not allowed', () => {
    expect(cwdGuardMessage('X')).toMatch(/main checkout/)
  })
})

describe('parseFlags', () => {
  it('parses the PR number and the flags with their defaults', () => {
    expect(parseFlags(['12'])).toMatchObject({ ok: true, pr: 12, timeout: 900, interval: 20 })
    expect(parseFlags(['12', '--require-review'])).toMatchObject({ requireReview: true })
    expect(parseFlags(['12', '--timeout', '60'])).toMatchObject({ timeout: 60 })
  })

  it('fails on a bad number, an unknown flag and a non-numeric timeout', () => {
    expect(parseFlags(['x!'])).toMatchObject({ ok: false })
    expect(parseFlags(['12', '--force'])).toMatchObject({ ok: false })
    expect(parseFlags(['12', '--timeout', 'soon'])).toMatchObject({ ok: false })
  })
})

describe('landPr — stage order and aborts', () => {
  const greenGate = () => ({
    verdict: 'green',
    reasons: [],
    warn: [],
    closes: [130],
    branch: 'chore/130-x',
    sha: 'deadbeef',
  })
  const okRunners = (over = {}) => ({
    gate: greenGate,
    merge: () => ({ status: 0 }),
    mergedSha: () => 'abcdef1234567890',
    clearBoardItem: () => ({ status: 'deleted', detail: 'PVTI_x' }),
    boardDone: () => ({ status: 0 }),
    worktreeExists: () => false,
    teardown: () => ({ status: 0 }),
    listOpenPrs: () => ({ status: 0, count: 0 }),
    listRemoteBranches: () => ({ status: 0, count: 1 }),
    ...over,
  })

  // landPr always leaves through exit(); in the test exit throws, so execution
  // stops exactly where the process would have stopped.
  const drive = (over = {}) => {
    const log: string[] = []
    const err: string[] = []
    let code: number | null = null
    try {
      landPr(
        { pr: 7, timeout: 10, interval: 1, requireReview: false },
        {
          ...okRunners(over),
          exit: ((c: number) => {
            code = c
            throw new Error('__exit__')
          }) as never,
          log: (m: string) => log.push(m),
          err: (m: string) => err.push(m),
        },
      )
    } catch (e) {
      if ((e as Error).message !== '__exit__') throw e
    }
    return { log: log.join(''), err: err.join('\n'), code }
  }

  it('the canonical stage order is pinned', () => {
    expect(STAGES).toEqual(['gate', 'merge', 'board-clear', 'board-done', 'teardown', 're-sweep'])
  })

  it('a fully green run reports every stage and exits 0', () => {
    const res = drive()
    expect(res.code).toBe(0)
    for (const stage of [
      'gate:',
      'merge:',
      'board-clear:',
      'board-done:',
      'teardown:',
      're-sweep:',
    ]) {
      expect(res.log).toContain(stage)
    }
  })

  /**
   * Regression: the gate pinned head only on the read side while `gh pr merge`
   * went unpinned — a commit that landed during the wait (up to 900 s) rode
   * into main unchecked. The SHA must reach the merge command.
   */
  it('exactly the SHA that passed the gate goes into the merge', () => {
    const merge = vi.fn(() => ({ status: 0 }))
    drive({ merge })
    expect(merge).toHaveBeenCalledWith(7, 'deadbeef')
  })

  it('a red gate stops the tail BEFORE the merge', () => {
    const merge = vi.fn()
    const res = drive({
      gate: () => ({
        verdict: 'red',
        reasons: ['red checks'],
        warn: [],
        closes: [],
        branch: null,
      }),
      merge,
    })
    expect(merge).not.toHaveBeenCalled()
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/stage «gate» failed/)
  })

  it('a gate timeout differs from a RED by its exit code', () => {
    expect(
      drive({
        gate: () => ({
          verdict: 'timeout',
          reasons: ['did not make it'],
          warn: [],
          closes: [],
          branch: null,
        }),
      }).code,
    ).toBe(2)
  })

  it('a failed merge does not let the board move', () => {
    const boardDone = vi.fn()
    const res = drive({ merge: () => ({ status: 1 }), boardDone })
    expect(boardDone).not.toHaveBeenCalled()
    expect(res.code).toBe(1)
  })

  it('a failed board-clear is not fatal — the merge has already landed', () => {
    const res = drive({ clearBoardItem: () => ({ status: 'error', detail: 'no rights' }) })
    expect(res.code).toBe(0)
    expect(res.log).toMatch(/board-clear: WARNING/)
  })

  it('a failed board-done aborts the tail and names the manual command', () => {
    const res = drive({ boardDone: () => ({ status: 1 }) })
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/pnpm board:status/)
  })

  it('with no linked Closes the board-done stage is skipped loudly', () => {
    const res = drive({
      gate: () => ({ verdict: 'green', reasons: [], warn: [], closes: [], branch: 'chore/9-x' }),
    })
    expect(res.log).toMatch(/board-done: skip/)
  })

  it('teardown runs only when the worktree exists', () => {
    const teardown = vi.fn(() => ({ status: 0 }))
    drive({ worktreeExists: (n: number) => n === 130, teardown })
    expect(teardown).toHaveBeenCalledWith(130)
  })

  it('a failed re-sweep aborts the tail as well', () => {
    expect(drive({ listOpenPrs: () => ({ status: 1, count: null }) }).code).toBe(1)
  })
})

describe('stageRemedy', () => {
  it('gives a non-empty hint for every stage', () => {
    for (const stage of STAGES) expect(stageRemedy(stage, 7).length).toBeGreaterThan(10)
  })

  it('after the merge the hint does not offer «just retry»', () => {
    expect(stageRemedy('board-done', 7)).toMatch(/the merge landed/)
  })
})
