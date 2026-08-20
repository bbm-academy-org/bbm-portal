import { describe, expect, it, vi } from 'vitest'

import {
  STAGES,
  classifyChecks,
  classifyMergeResult,
  cwdGuardMessage,
  failCode,
  findAgentApproval,
  gateConditions,
  isBaseMergeCommit,
  isWorktreeCwd,
  issueCandidates,
  landPr,
  parseCommitFacts,
  parseFlags,
  parsePartOfRefs,
  reviewBaselineDate,
  runGate,
  runViewPr,
  stageRemedy,
  withCommitFacts,
  withPartOfFacts,
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

/**
 * Regression (#142). `gh pr merge --delete-branch` does three things behind one
 * exit code: it merges remotely, deletes the remote branch, then deletes the
 * LOCAL branch. The last one always fails when a worktree holds that branch —
 * the norm in this repo (`.claude/rules/parallel-sessions.md`). So the exit code
 * on its own cannot tell a failed merge from a landed one with leftover local
 * cleanup; the PR's own state read back afterwards can.
 */
describe('classifyMergeResult', () => {
  it('exit 0 is a clean merge', () => {
    expect(classifyMergeResult(0, 'OPEN')).toBe('merged')
  })

  it('a non-zero exit on a PR that is nevertheless MERGED is local-cleanup fallout', () => {
    expect(classifyMergeResult(1, 'MERGED')).toBe('merged-dirty')
  })

  it('a non-zero exit on a PR that is still open is a real merge failure', () => {
    expect(classifyMergeResult(1, 'OPEN')).toBe('failed')
  })

  it('a non-zero exit with an unreadable state fails — an unverifiable merge is not a merge', () => {
    expect(classifyMergeResult(1, null)).toBe('failed')
  })

  it('a gh killed by a signal (status null) whose merge landed is still local-cleanup fallout', () => {
    expect(classifyMergeResult(null, 'MERGED')).toBe('merged-dirty')
    expect(classifyMergeResult(null, 'OPEN')).toBe('failed')
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

/**
 * #222. `main` carries `required_status_checks.strict` since #216, so
 * `gh pr update-branch` sits on the critical path of every raced merge — and it
 * appends a merge commit to the head branch. Measuring review freshness against
 * the last commit ON THE BRANCH therefore staled the reviewer's verdict for a
 * commit that changed no reviewed line.
 *
 * The baseline is the last commit that changed the PR's OWN diff: trailing
 * base-merge commits are stepped over, everything else is not. The direction
 * that must not be bought away — a real commit after the approval — is pinned
 * here and in `gateConditions` below.
 */
const commit = (oid: string, committedDate: string, parents?: string[]) => ({
  oid,
  committedDate,
  ...(parents ? { parents } : {}),
})

/**
 * The same, created SERVER-SIDE by GitHub — what `gh pr update-branch` produces,
 * and the only merge shape the gate is allowed to step over (review of PR #226,
 * blocker 1).
 */
const ghMerge = (oid: string, committedDate: string, parents: string[]) => ({
  ...commit(oid, committedDate, parents),
  githubCreated: true,
})

describe('isBaseMergeCommit', () => {
  const own = new Set(['a', 'b', 'm'])

  it('two parents, the first being the previous PR commit and the second coming from outside', () => {
    expect(isBaseMergeCommit(ghMerge('m', 't', ['b', 'mainTip']), commit('b', 't'), own)).toBe(true)
  })

  /**
   * Review of PR #226, blocker 1 — the path that put this whole clause here.
   * When `gh pr update-branch` refuses because the update conflicts (routine
   * here: nearly every PR appends to DEBT.md), the fallback is `git merge
   * origin/main` + resolve by hand. That commit has EXACTLY the shape of an
   * update-branch merge — parents `[previous head, main tip]` — while carrying
   * hand-written resolution hunks nobody reviewed. Only provenance separates the
   * two, so provenance is a clause and not a comment.
   */
  it('a hand-resolved merge has the right shape and is refused anyway: GitHub did not create it', () => {
    expect(isBaseMergeCommit(commit('m', 't', ['b', 'mainTip']), commit('b', 't'), own)).toBe(false)
  })

  it('an ordinary single-parent commit is never a base merge', () => {
    expect(isBaseMergeCommit(ghMerge('m', 't', ['b']), commit('b', 't'), own)).toBe(false)
  })

  it('a merge whose second parent IS a commit of this PR brings unreviewed code — not neutral', () => {
    // `git merge some-other-branch`: that branch's commits are not reachable from
    // the base, so GitHub lists them among the PR's own — and they ride into the
    // squash. Also covers a sibling PR merged into this head through the web UI,
    // which IS created by GitHub and so passes the provenance clause.
    expect(isBaseMergeCommit(ghMerge('m', 't', ['b', 'a']), commit('b', 't'), own)).toBe(false)
  })

  it('a merge that does not sit on top of the PR’s own line is not recognised', () => {
    expect(isBaseMergeCommit(ghMerge('m', 't', ['mainTip', 'b']), commit('b', 't'), own)).toBe(
      false,
    )
  })

  it('without parent data nothing is recognised — the conservative direction', () => {
    expect(isBaseMergeCommit({ oid: 'm', githubCreated: true }, commit('b', 't'), own)).toBe(false)
  })

  it('an octopus merge is not an update-branch merge', () => {
    expect(isBaseMergeCommit(ghMerge('m', 't', ['b', 'x', 'y']), commit('b', 't'), own)).toBe(false)
  })
})

describe('reviewBaselineDate', () => {
  it('with no parent data it is the LAST commit’s date — the old, strict behaviour', () => {
    expect(reviewBaselineDate({ commits: [{ committedDate: 'a' }, { committedDate: 'b' }] })).toBe(
      'b',
    )
  })

  it('returns null on an empty commit list instead of throwing', () => {
    expect(reviewBaselineDate({})).toBeNull()
  })

  it('steps over a trailing update-branch merge', () => {
    expect(
      reviewBaselineDate({
        commits: [
          commit('a', '2026-08-14T10:00:00Z', ['base']),
          commit('b', '2026-08-14T11:00:00Z', ['a']),
          ghMerge('m', '2026-08-14T15:00:00Z', ['b', 'mainTip']),
        ],
      }),
    ).toBe('2026-08-14T11:00:00Z')
  })

  it('steps over a RUN of them — two sessions racing in a row', () => {
    expect(
      reviewBaselineDate({
        commits: [
          commit('b', '2026-08-14T11:00:00Z', ['base']),
          ghMerge('m1', '2026-08-14T15:00:00Z', ['b', 'mainX']),
          ghMerge('m2', '2026-08-14T16:00:00Z', ['m1', 'mainY']),
        ],
      }),
    ).toBe('2026-08-14T11:00:00Z')
  })

  it('a REAL commit on top of an update-branch merge is the baseline', () => {
    expect(
      reviewBaselineDate({
        commits: [
          commit('b', '2026-08-14T11:00:00Z', ['base']),
          ghMerge('m', '2026-08-14T15:00:00Z', ['b', 'mainTip']),
          commit('c', '2026-08-14T17:00:00Z', ['m']),
        ],
      }),
    ).toBe('2026-08-14T17:00:00Z')
  })

  /**
   * Review of PR #226, blocker 1: the conflicting-update fallback. The gate must
   * send this back for a re-review — the resolution hunks are real, unreviewed
   * code.
   */
  it('a HAND-resolved merge of main into head is not stepped over', () => {
    expect(
      reviewBaselineDate({
        commits: [
          commit('b', '2026-08-14T11:00:00Z', ['base']),
          commit('m', '2026-08-14T15:00:00Z', ['b', 'mainTip']),
        ],
      }),
    ).toBe('2026-08-14T15:00:00Z')
  })

  /** Review of PR #226, minor 3: the trailing-run licence must not reach past a real commit. */
  it('a real commit SANDWICHED between two update-branch merges is not stepped over', () => {
    expect(
      reviewBaselineDate({
        commits: [
          commit('b', '2026-08-14T11:00:00Z', ['base']),
          ghMerge('m1', '2026-08-14T13:00:00Z', ['b', 'mainX']),
          commit('c', '2026-08-14T14:00:00Z', ['m1']),
          ghMerge('m2', '2026-08-14T16:00:00Z', ['c', 'mainY']),
        ],
      }),
    ).toBe('2026-08-14T14:00:00Z')
  })

  /**
   * Review of PR #226, minor 3: a STACKED PR, whose base is another feature
   * branch. `main` merged into such a head really does change the diff against
   * that base — and `main`'s tip is not reachable from the base, so GitHub lists
   * it among the PR's own commits and clause 3 refuses the skip by itself.
   */
  it('a stacked PR (base ≠ main) is not stepped over — refused by clause 3', () => {
    // Ordered so the merge DOES sit on top of the PR's own line (clause 2
    // passes); what refuses it is `mainTip` being among the PR's own commits.
    expect(
      reviewBaselineDate({
        commits: [
          commit('mainTip', '2026-08-14T10:00:00Z', ['x']),
          commit('b', '2026-08-14T11:00:00Z', ['featureBase']),
          ghMerge('m', '2026-08-14T15:00:00Z', ['b', 'mainTip']),
        ],
      }),
    ).toBe('2026-08-14T15:00:00Z')
  })

  /**
   * Round-2 review of PR #226: the JSDoc asserts that `gh pr update-branch
   * --rebase` is covered by clause 1, so the assertion gets a test. A rebase
   * REWRITES the PR's commits server-side instead of merging — GitHub-created,
   * fresh dates, but single-parent — and single-parent commits are never stepped
   * over, so the verdict goes stale and the review is re-run.
   */
  it('an update-branch --rebase rewrite is not stepped over: rebased commits have one parent', () => {
    expect(
      reviewBaselineDate({
        commits: [
          { ...commit('b2', '2026-08-14T16:00:00Z', ['newBase']), githubCreated: true },
          { ...commit('c2', '2026-08-14T16:00:01Z', ['b2']), githubCreated: true },
        ],
      }),
    ).toBe('2026-08-14T16:00:01Z')
  })

  it('a merge that pulls in another branch of its own is NOT stepped over', () => {
    expect(
      reviewBaselineDate({
        commits: [
          commit('b', '2026-08-14T11:00:00Z', ['base']),
          commit('z', '2026-08-14T14:00:00Z', ['b']),
          ghMerge('m', '2026-08-14T15:00:00Z', ['b', 'z']),
        ],
      }),
    ).toBe('2026-08-14T15:00:00Z')
  })

  it('the first commit is never stepped over — a PR is never zero-commit', () => {
    expect(reviewBaselineDate({ commits: [commit('m', '2026-08-14T15:00:00Z', ['x', 'y'])] })).toBe(
      '2026-08-14T15:00:00Z',
    )
  })
})

/**
 * The REST row shape `GET /repos/…/pulls/<n>/commits` returns. Provenance is
 * verified on real data: a `gh pr update-branch` merge comes back as committer
 * `GitHub <noreply@github.com>` with `verification.verified: true` (GitHub signs
 * it with its own key), a local `git merge` as the developer's own identity,
 * unsigned.
 */
const restRow = (sha: string, parents: string[], over: Record<string, unknown> = {}) => ({
  sha,
  parents: parents.map((p) => ({ sha: p })),
  commit: {
    committer: { name: 'GitHub', email: 'noreply@github.com' },
    verification: { verified: true, reason: 'valid' },
    ...over,
  },
})

describe('parseCommitFacts', () => {
  it('maps every commit to its parents and to who created it', () => {
    expect(parseCommitFacts([restRow('m', ['b', 'main'])])).toEqual({
      m: { parents: ['b', 'main'], githubCreated: true },
    })
  })

  it('a commit committed by a person is not GitHub-created, signed or not', () => {
    const local = restRow('m', ['b', 'main'], {
      committer: { name: 'Anton', email: 'a@anticodeguy.com' },
      verification: { verified: false, reason: 'unsigned' },
    })
    expect(parseCommitFacts([local])?.m.githubCreated).toBe(false)
  })

  it('GitHub’s committer identity without a valid signature proves nothing — that half is forgeable', () => {
    const forged = restRow('m', ['b', 'main'], {
      verification: { verified: false, reason: 'unsigned' },
    })
    expect(parseCommitFacts([forged])?.m.githubCreated).toBe(false)
  })

  it('a signature by someone else does not make a commit GitHub’s', () => {
    const signedByHuman = restRow('m', ['b', 'main'], {
      committer: { name: 'Anton', email: 'a@anticodeguy.com' },
      verification: { verified: true, reason: 'valid' },
    })
    expect(parseCommitFacts([signedByHuman])?.m.githubCreated).toBe(false)
  })

  /**
   * Review of PR #226, minor 2. Clause 3 reads «absent from the PR's own
   * commits» as «contained in the base», which is only exact while the list is
   * COMPLETE. A full page may be a truncated one, and there is no way to tell
   * from here — so a full page buys nothing and is refused outright.
   */
  it('a page that may be truncated is refused whole — the exactness argument needs the full list', () => {
    const page = Array.from({ length: 100 }, (_, i) => restRow(`c${i}`, ['x']))
    expect(parseCommitFacts(page)).toBeNull()
    expect(parseCommitFacts(page.slice(0, 99))).not.toBeNull()
  })

  it('an unreadable body yields no facts at all', () => {
    expect(parseCommitFacts(null)).toBeNull()
    expect(parseCommitFacts('nonsense')).toBeNull()
  })
})

describe('withCommitFacts', () => {
  it('stamps the facts onto the commits gh pr view cannot carry them on', () => {
    const data = withCommitFacts(
      { commits: [{ oid: 'a' }, { oid: 'm' }] },
      { m: { parents: ['a', 'main'], githubCreated: true } },
    ) as { commits: { oid: string; parents?: string[]; githubCreated?: boolean }[] }
    expect(data.commits[1]).toMatchObject({ oid: 'm', parents: ['a', 'main'], githubCreated: true })
    expect(data.commits[0].parents).toBeUndefined()
  })

  it('an unavailable fact map leaves the payload untouched — freshness stays strict', () => {
    const data = { commits: [{ oid: 'a' }] }
    expect(withCommitFacts(data, null)).toBe(data)
  })
})

/** Review of PR #226, minor 1 and minor 4: the wiring itself, and its cost. */
describe('runViewPr', () => {
  const view = (oid: string) => () => ({ ok: true, data: { headRefOid: oid, commits: [{ oid }] } })
  const facts = () => ({ ['h1']: { parents: ['b', 'main'], githubCreated: true } })

  it('a failed PR read passes straight through — nothing is stamped onto an error', () => {
    const res = runViewPr(7, {
      view: () => ({ ok: false, error: 'gh crashed' }),
      facts,
      cache: new Map(),
    })
    expect(res).toMatchObject({ ok: false, error: 'gh crashed' })
  })

  it('stamps the facts onto a successful read', () => {
    const res = runViewPr(7, { view: view('h1'), facts, cache: new Map() })
    expect(res.data.commits[0]).toMatchObject({ oid: 'h1', githubCreated: true })
  })

  /**
   * `runViewPr` is called on EVERY probe of the gate's polling loop (up to the
   * whole `--timeout` window), and the parents of commits already in the payload
   * do not change while we wait. Keyed by head SHA, so a head that moves is read
   * again rather than served a stale answer.
   */
  it('reads the facts once per head SHA, not once per poll', () => {
    const spy = vi.fn(facts)
    const cache = new Map()
    const io = { view: view('h1'), facts: spy, cache }
    runViewPr(7, io)
    runViewPr(7, io)
    runViewPr(7, io)
    expect(spy).toHaveBeenCalledTimes(1)
    runViewPr(7, { view: view('h2'), facts: spy, cache })
    expect(spy).toHaveBeenCalledTimes(2)
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

  /**
   * Round-2 review of PR #226. The web conflict editor is the one merge the
   * freshness gate cannot see through (`isBaseMergeCommit`, COVERAGE BOUNDARY),
   * and GitHub offers that button on the PR page at exactly the moment this RED
   * fires. A skill file is read when it is loaded; this string is read by the
   * session that is standing in front of the trap.
   */
  it('the conflict RED names the button the session is about to be offered', () => {
    const red = gateConditions({ ...ok, mergeable: 'CONFLICTING' }).red.join('\n')
    expect(red).toMatch(/Resolve conflicts/)
    expect(red).toMatch(/worktree/)
    expect(red).toMatch(/re-review/)
  })

  it('no linkage at all is RED: board-done would have nowhere to set Done', () => {
    expect(gateConditions({ ...ok, closingIssuesReferences: [] }).red[0]).toMatch(/Closes #N/)
  })

  /**
   * Retro 2026-08-20 (#299), theme `closes-target-issues`. Requiring `Closes #N`
   * from EVERY PR made a partial PR pay a synthetic sub-issue for the privilege
   * of landing — #261 for PR #260, #270 for PR #265, #279 for PR #266 in three
   * days, each one +1 filed and +1 closed for zero new work. `Part of #N` on a
   * LIVE parent is the honest linkage for a slice, and it is not RED.
   */
  it('`Part of #N` with an OPEN parent is a valid linkage, not RED', () => {
    const res = gateConditions({
      ...ok,
      closingIssuesReferences: [],
      partOfIssues: [{ number: 201, state: 'OPEN' }],
    })
    expect(res.red).toEqual([])
    expect(res.partOf).toEqual([201])
    expect(res.warn.join('\n')).toMatch(/Part of #201/)
  })

  it('`Part of #N` pointing at a CLOSED parent is not a linkage — RED', () => {
    const res = gateConditions({
      ...ok,
      closingIssuesReferences: [],
      partOfIssues: [{ number: 201, state: 'CLOSED' }],
    })
    expect(res.red[0]).toMatch(/Part of #N/)
    expect(res.partOf).toEqual([])
  })

  it('the no-linkage RED names `Part of #N` so nobody files a sub-issue to satisfy it', () => {
    const red = gateConditions({ ...ok, closingIssuesReferences: [] }).red.join('\n')
    expect(red).toMatch(/Part of #N/)
    expect(red).toMatch(/sub-issue/)
  })

  it('a `Closes #N` PR that also says `Part of #N` still lands on Closes', () => {
    const res = gateConditions({ ...ok, partOfIssues: [{ number: 201, state: 'OPEN' }] })
    expect(res.red).toEqual([])
    expect(res.closes).toEqual([130])
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

  /**
   * #222, both directions of the same rule, at the level the gate is actually
   * read at.
   */
  it('an update-branch merge after the APPROVE does not stale it — no re-review for a merge commit', () => {
    const res = gateConditions({
      ...ok,
      reviewDecision: '',
      commits: [
        commit('b', '2026-08-14T12:00:00Z', ['base']),
        ghMerge('m', '2026-08-14T15:00:00Z', ['b', 'mainTip']),
      ],
      comments: [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-14T12:30:00Z' }],
    })
    expect(res.red).toEqual([])
  })

  it('a REAL commit after the APPROVE is still RED, update-branch merge or not', () => {
    const res = gateConditions({
      ...ok,
      reviewDecision: '',
      commits: [
        commit('b', '2026-08-14T12:00:00Z', ['base']),
        ghMerge('m', '2026-08-14T15:00:00Z', ['b', 'mainTip']),
        commit('c', '2026-08-14T16:00:00Z', ['m']),
      ],
      comments: [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-14T12:30:00Z' }],
    })
    expect(res.red.join('\n')).toMatch(/older than the last commit/)
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

  // Was a remark until #216. `main` now carries `required_status_checks.strict`,
  // so BEHIND is no longer a hint that the merge MIGHT refuse — the server will
  // refuse it. A remark would let the gate report green and then fail at the
  // merge call, which is the one outcome the gate exists to prevent.
  it('a branch behind its base is RED, not a remark: under strict checks the server refuses', () => {
    const res = gateConditions({ ...ok, mergeStateStatus: 'BEHIND' })
    expect(res.red.join('\n')).toMatch(/BEHIND/)
    expect(res.red.join('\n')).toMatch(/update the branch/i)
    expect(res.warn.join('\n')).not.toMatch(/BEHIND/)
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
  /** The real sequence of state probes: OPEN before the merge, MERGED after it. */
  const openThenMerged = () => {
    let calls = 0
    return () => ({
      ok: true,
      state: calls++ === 0 ? 'OPEN' : 'MERGED',
      closes: [130],
      branch: 'chore/130-x',
      mergeCommit: 'abcdef1234567890',
    })
  }
  const mergedPr = () => ({
    ok: true,
    state: 'MERGED',
    closes: [130],
    branch: 'chore/130-x',
    mergeCommit: 'abcdef1234567890',
  })
  const openPr = () => ({
    ok: true,
    state: 'OPEN',
    closes: [130],
    branch: 'chore/130-x',
    mergeCommit: null,
  })

  const okRunners = (over = {}) => ({
    gate: greenGate,
    merge: () => ({ status: 0 }),
    prState: openThenMerged(),
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
    const res = drive({ merge: () => ({ status: 1 }), prState: openPr, boardDone })
    expect(boardDone).not.toHaveBeenCalled()
    expect(res.code).toBe(1)
  })

  /**
   * Regression (#142), scenario 1. On the first live run (merge of PR #141) the
   * remote merge landed and `gh pr merge --delete-branch` still exited non-zero,
   * because a worktree held the local branch. The stage was reported FAILED, the
   * tail aborted before board-done, and the board was left stale — while the
   * remedy line offered a re-merge of a PR that was already merged.
   */
  it('a non-zero merge whose PR really did land is a warning, not a stage failure', () => {
    const boardDone = vi.fn(() => ({ status: 0 }))
    const res = drive({ merge: () => ({ status: 1 }), boardDone })
    expect(res.code).toBe(0)
    expect(boardDone).toHaveBeenCalledWith(130)
    expect(res.log).toMatch(/merge-cleanup: WARNING/)
  })

  it('the cleanup warning sends the operator to `git branch -D`, naming the branch', () => {
    const res = drive({ merge: () => ({ status: 1 }) })
    // `worktree:teardown` KEEPS a squash-merged branch (worktree-teardown.mjs,
    // `cleanupBranch` deletes only what main already contains), so naming it as
    // the remedy would print advice that does not work.
    expect(res.err).toMatch(/git branch -D chore\/130-x/)
    expect(res.err).toMatch(/KEEPS this branch/)
  })

  it('on a cleanup warning the LATER stages still run — the tail is not silently short', () => {
    const clearBoardItem = vi.fn(() => ({ status: 'deleted', detail: 'PVTI_x' }))
    const teardown = vi.fn(() => ({ status: 0 }))
    const listRemoteBranches = vi.fn(() => ({ status: 0, count: 1 }))
    const res = drive({
      merge: () => ({ status: 1 }),
      worktreeExists: () => true,
      clearBoardItem,
      teardown,
      listRemoteBranches,
    })
    expect(clearBoardItem).toHaveBeenCalledWith(7)
    expect(teardown).toHaveBeenCalledWith(130)
    expect(listRemoteBranches).toHaveBeenCalled()
    expect(res.log).toMatch(/re-sweep: OK/)
    expect(res.code).toBe(0)
  })

  it('a cleanup warning does not let the report claim this run merged the pinned SHA', () => {
    // `merged-dirty` also covers a parallel session merging a NEWER head, which
    // is exactly what --match-head-commit refuses; the pinned-SHA claim belongs
    // to the clean path only (review of PR #161).
    const dirty = drive({ merge: () => ({ status: 1 }) })
    expect(dirty.log).not.toContain('merge: OK (squash')
    expect(dirty.log).toMatch(/the PR is MERGED as abcdef123456/)
    expect(drive().log).toMatch(/head pinned at deadbeef/)
  })

  it('a merge failure the state probe cannot read fails the stage — unverifiable is not merged', () => {
    const boardDone = vi.fn()
    const res = drive({
      merge: () => ({ status: 1 }),
      prState: () => ({ ok: false, error: 'gh crashed' }),
      boardDone,
    })
    expect(res.code).toBe(1)
    expect(boardDone).not.toHaveBeenCalled()
  })

  /**
   * Regression (#142), scenario 2. After that aborted run the tail had to be
   * finished by hand: re-running `pr:land` dead-ended, because the gate reads a
   * MERGED PR as "not open". A repeat run must resume from the first stage that
   * never finished instead of demanding a merge that already happened.
   */
  it('an already-MERGED PR skips gate and merge and finishes the remaining stages', () => {
    const gate = vi.fn(greenGate)
    const merge = vi.fn(() => ({ status: 0 }))
    const boardDone = vi.fn(() => ({ status: 0 }))
    const res = drive({ prState: mergedPr, gate, merge, boardDone })
    expect(gate).not.toHaveBeenCalled()
    expect(merge).not.toHaveBeenCalled()
    expect(boardDone).toHaveBeenCalledWith(130)
    expect(res.code).toBe(0)
    expect(res.log).toMatch(/gate: skip/)
    expect(res.log).toMatch(/merge: skip/)
  })

  it('a resumed run takes the Closes numbers and the branch from the merged PR itself', () => {
    const boardDone = vi.fn(() => ({ status: 0 }))
    const teardown = vi.fn(() => ({ status: 0 }))
    drive({
      prState: () => ({
        ok: true,
        state: 'MERGED',
        closes: [131],
        branch: 'chore/131-x',
        mergeCommit: 'abcdef1234567890',
      }),
      boardDone,
      worktreeExists: () => true,
      teardown,
    })
    expect(boardDone).toHaveBeenCalledWith(131)
    expect(teardown).toHaveBeenCalledWith(131)
  })

  it('an unreadable pre-flight state probe does not block the normal path', () => {
    expect(drive({ prState: () => ({ ok: false, error: 'gh crashed' }) }).code).toBe(0)
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

/**
 * Parsing the `Part of #N` linkage out of a PR body (#299). Kept pure and
 * separate from the state lookup: what the body CLAIMS and whether the parent is
 * actually live are two different facts, and only the pair is a linkage.
 */
describe('parsePartOfRefs', () => {
  it('reads every `Part of #N` form the template produces, deduped', () => {
    expect(parsePartOfRefs('Part of #201\n\nsome text\npart of #201\nPart of  #7')).toEqual([
      201, 7,
    ])
  })

  it('ignores the template instructions in an HTML comment', () => {
    expect(parsePartOfRefs('<!-- Part of #123 if this is a slice -->\nCloses #5')).toEqual([])
  })

  it('does not read `Closes #N` as a partial linkage', () => {
    expect(parsePartOfRefs('Closes #5')).toEqual([])
  })

  it('a missing body is not a crash', () => {
    expect(parsePartOfRefs(null)).toEqual([])
  })
})

describe('withPartOfFacts', () => {
  it('stamps the parent states onto the payload', () => {
    const data = withPartOfFacts({ body: 'Part of #201' }, { 201: 'OPEN' })
    expect(data.partOfIssues).toEqual([{ number: 201, state: 'OPEN' }])
  })

  it('an unresolved parent is dropped rather than guessed OPEN', () => {
    const data = withPartOfFacts({ body: 'Part of #201' }, {})
    expect(data.partOfIssues).toEqual([])
  })
})

/**
 * The read side of the second linkage: `runViewPr` resolves `Part of #N` ONLY
 * when the PR closes nothing, so a normal `Closes #N` land costs no extra call.
 */
describe('runViewPr — Part of resolution', () => {
  it('resolves the parents of a PR that closes nothing', () => {
    const issueStates = vi.fn(() => ({ 201: 'OPEN' }))
    const res = runViewPr(7, {
      view: () => ({ ok: true, data: { body: 'Part of #201', closingIssuesReferences: [] } }),
      facts: () => null,
      issueStates,
      cache: new Map(),
    })
    expect(issueStates).toHaveBeenCalledWith([201])
    expect(res.data.partOfIssues).toEqual([{ number: 201, state: 'OPEN' }])
  })

  it('does not read a single issue when `Closes #N` is already there', () => {
    const issueStates = vi.fn(() => ({}))
    runViewPr(7, {
      view: () => ({
        ok: true,
        data: { body: 'Part of #201', closingIssuesReferences: [{ number: 5 }] },
      }),
      facts: () => null,
      issueStates,
      cache: new Map(),
    })
    expect(issueStates).not.toHaveBeenCalled()
  })
})
