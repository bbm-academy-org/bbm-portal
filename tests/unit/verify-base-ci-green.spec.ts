import { describe, expect, it } from 'vitest'

import { EXIT, classifyRuns, disclaimer, parseFlags } from '../../tools/gh/verify-base-ci-green.mjs'

/**
 * `pnpm ci:verify-base` — task-cycle stage 3's "before pushing, check CI is
 * green on main" as a command with an exit code instead of prose (#136).
 *
 * The failure it prevents: an agent reads its own PR's red CI, takes an
 * inherited baseline failure for its own regression, and spends the session
 * fixing someone else's red.
 */

const run = (over: Record<string, unknown> = {}) => ({
  workflowName: 'CI',
  status: 'completed',
  conclusion: 'success',
  headSha: 'abc1234def',
  displayTitle: 'feat: something',
  url: 'https://github.com/o/r/actions/runs/1',
  createdAt: '2026-08-05T10:00:00Z',
  ...over,
})

describe('classifyRuns', () => {
  it('green on the newest completed successful run', () => {
    expect(classifyRuns([run()]).verdict).toBe('green')
  })

  it('red on a failed run, and hands back the run itself for the disclaimer', () => {
    const res = classifyRuns([run({ conclusion: 'failure' })])
    expect(res.verdict).toBe('red')
    expect(res.run?.url).toBe('https://github.com/o/r/actions/runs/1')
  })

  it('treats cancelled and timed_out as red — neither proved the base builds', () => {
    expect(classifyRuns([run({ conclusion: 'cancelled' })]).verdict).toBe('red')
    expect(classifyRuns([run({ conclusion: 'timed_out' })]).verdict).toBe('red')
  })

  it('ignores an in-progress run and reads the newest COMPLETED one', () => {
    const res = classifyRuns([
      run({ status: 'in_progress', conclusion: null, createdAt: '2026-08-05T12:00:00Z' }),
      run({ conclusion: 'failure', createdAt: '2026-08-05T11:00:00Z' }),
    ])
    expect(res.verdict).toBe('red')
  })

  it('is pending when nothing has completed yet — pending is not green', () => {
    expect(classifyRuns([run({ status: 'queued', conclusion: null })]).verdict).toBe('pending')
  })

  // Review of PR #154, finding 4: `skipped` used to read as GREEN here while the
  // `ci` meta-job treats a skipped need as RED ("a job that never ran proves
  // nothing"). One word must not mean two things inside one canon — a skipped
  // base run is no evidence, so it is pending.
  it('is pending on a skipped run — the same reading the `ci` aggregate uses', () => {
    expect(classifyRuns([run({ conclusion: 'skipped' })]).verdict).toBe('pending')
  })

  it('is pending on an empty list — a base with no run proves nothing', () => {
    expect(classifyRuns([]).verdict).toBe('pending')
  })

  it('only reads the named workflow', () => {
    const res = classifyRuns([run({ workflowName: 'Deploy', conclusion: 'failure' })], 'CI')
    expect(res.verdict).toBe('pending')
  })

  it('reads every workflow when the filter is empty', () => {
    const res = classifyRuns([run({ workflowName: 'Deploy', conclusion: 'failure' })], '')
    expect(res.verdict).toBe('red')
  })
})

describe('disclaimer', () => {
  it('produces a PR-body block naming the run, so red is attributed correctly', () => {
    const text = disclaimer(run({ conclusion: 'failure' }), 'main')
    expect(text).toContain('main')
    expect(text).toContain('abc1234')
    expect(text).toContain('https://github.com/o/r/actions/runs/1')
  })
})

describe('parseFlags', () => {
  it('defaults to main and the CI workflow', () => {
    expect(parseFlags([])).toMatchObject({ ok: true, branch: 'main', workflow: 'CI' })
  })

  it('takes an explicit branch, workflow and --json', () => {
    expect(parseFlags(['--branch', 'release', '--workflow', '', '--json'])).toMatchObject({
      ok: true,
      branch: 'release',
      workflow: '',
      json: true,
    })
  })

  it('refuses an unknown flag rather than silently ignoring it', () => {
    expect(parseFlags(['--nope']).ok).toBe(false)
  })
})

describe('EXIT', () => {
  it('keeps the three verdicts distinguishable to a caller', () => {
    expect([EXIT.green, EXIT.red, EXIT.pending]).toEqual([0, 1, 2])
  })
})
