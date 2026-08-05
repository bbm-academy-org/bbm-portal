import { describe, expect, it } from 'vitest'

import {
  OUTPUT_LIMIT_BYTES,
  bootstrap,
  ciState,
  collect,
  fitToBytes,
  issueNumberFrom,
  isSharedMainTree,
  parseAheadBehind,
  parseBoardPage,
  prKind,
  recommend,
  renderSnapshot,
} from '../../tools/gh/session-bootstrap.mjs'

/**
 * SessionStart snapshot (issue #134). Two properties are load-bearing and are
 * therefore asserted end-to-end, not only on the pure helpers:
 *   * NEVER-THROW — a missing `gh`, a dead network or a non-repo cwd degrade to
 *     a diagnostic line; the hook still prints and the session still starts;
 *   * ≤ 2 KB ALWAYS — the snapshot goes straight into the context window.
 * Every external call is an injectable seam, so nothing here touches the
 * network or the filesystem.
 */

const bytes = (s: string) => Buffer.byteLength(s, 'utf8')

const okRun = (stdout: string) => ({ ok: true, status: 0, stdout, stderr: '' })

const WORKTREE_CWD = 'C:/Users/sidor/repos/bbm-portal/.claude/worktrees/134'
const MAIN_CWD = 'C:/Users/sidor/repos/bbm-portal'

function gitStub(over: Record<string, string> = {}) {
  const table: Record<string, string> = {
    'rev-parse --abbrev-ref HEAD': 'chore/134-session-bootstrap\n',
    'status --porcelain': ' M tools/gh/session-bootstrap.mjs\n',
    'rev-parse --git-dir --git-common-dir':
      'C:/Users/sidor/repos/bbm-portal/.git/worktrees/134\nC:/Users/sidor/repos/bbm-portal/.git\n',
    'rev-list --left-right --count origin/main...HEAD': '0\t2\n',
    ...over,
  }
  return (args: string[]) => okRun(table[args.join(' ')] ?? '')
}

const BOARD_PAGE = {
  data: {
    organization: {
      projectV2: {
        items: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: 'i1',
              fieldValueByName: { name: 'In Progress' },
              content: { number: 134, state: 'OPEN' },
            },
            {
              id: 'i2',
              fieldValueByName: { name: 'Todo' },
              content: { number: 140, state: 'OPEN' },
            },
          ],
        },
      },
    },
  },
}

function ghStub(over: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    pr: [
      {
        number: 150,
        title: 'chore(gh): SessionStart bootstrap snapshot',
        reviewDecision: 'APPROVED',
        headRefName: 'chore/134-session-bootstrap',
        isDraft: false,
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
      },
    ],
    api: BOARD_PAGE,
    issue: [{ number: 134 }, { number: 140 }, { number: 141 }],
    ...over,
  }
  return (args: string[]) => okRun(JSON.stringify(table[args[0]]))
}

const happyDeps = {
  cwd: WORKTREE_CWD,
  nowMs: Date.parse('2026-08-05T09:12:00Z'),
  runGit: gitStub(),
  runGh: ghStub(),
  readFlag: () => null,
  statMtime: () => null,
  sessionId: 'self',
}

// ── pure seams ──────────────────────────────────────────────────────────────

describe('parseAheadBehind', () => {
  it('reads left=behind / right=ahead from rev-list --left-right', () => {
    expect(parseAheadBehind('3\t7\n')).toEqual({ behind: 3, ahead: 7 })
  })

  it('returns null when origin/main is unknown (empty or error output)', () => {
    expect(parseAheadBehind('')).toBeNull()
    expect(parseAheadBehind('fatal: bad revision')).toBeNull()
  })
})

describe('issueNumberFrom', () => {
  it('prefers the worktree directory — a filesystem fact outranks a branch name', () => {
    expect(issueNumberFrom('feat/999-renamed', WORKTREE_CWD)).toBe(134)
  })

  it('falls back to the branch prefix in a non-worktree checkout', () => {
    expect(issueNumberFrom('fix/141-board-status', MAIN_CWD)).toBe(141)
  })

  it('returns null on main and on unnumbered branches', () => {
    expect(issueNumberFrom('main', MAIN_CWD)).toBeNull()
    expect(issueNumberFrom('spike/no-number', MAIN_CWD)).toBeNull()
  })
})

describe('isSharedMainTree', () => {
  it('is true only when git-dir and git-common-dir are the same .git', () => {
    expect(isSharedMainTree('.git', '.git', MAIN_CWD)).toBe(true)
    expect(
      isSharedMainTree(
        'C:/Users/sidor/repos/bbm-portal/.git/worktrees/134',
        'C:/Users/sidor/repos/bbm-portal/.git',
        WORKTREE_CWD,
      ),
    ).toBe(false)
  })
})

describe('ciState', () => {
  it('collapses the rollup to fail / run / ok / none', () => {
    expect(ciState({ statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })).toBe(
      'fail',
    )
    expect(ciState({ statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }] })).toBe(
      'run',
    )
    expect(ciState({ statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] })).toBe(
      'ok',
    )
    expect(ciState({})).toBe('none')
  })
})

describe('parseBoardPage', () => {
  it('reports statuses and treats only OPEN items as in flight', () => {
    const parsed = parseBoardPage({
      organization: {
        projectV2: {
          items: {
            nodes: [
              { fieldValueByName: { name: 'In Progress' }, content: { number: 5, state: 'OPEN' } },
              {
                fieldValueByName: { name: 'In Progress' },
                content: { number: 6, state: 'CLOSED' },
              },
              { fieldValueByName: null, content: { number: 7, state: 'OPEN' } },
            ],
          },
        },
      },
    })
    expect(parsed.inProgress).toEqual([5])
    expect(parsed.statusOf[6]).toBe('In Progress')
    expect(parsed.statusOf[7]).toBeNull()
  })

  it('survives a shape it does not recognise', () => {
    expect(parseBoardPage(undefined).inProgress).toEqual([])
  })
})

describe('prKind', () => {
  it('separates task branches from dependency-bot branches', () => {
    expect(prKind({ headRefName: 'chore/134-session-bootstrap' })).toBe('task')
    expect(prKind({ headRefName: 'renovate/vitejs-plugin-react-4.x' })).toBe('deps')
    expect(prKind({ headRefName: 'dependabot/npm_and_yarn/next-15' })).toBe('deps')
    expect(prKind({ headRefName: 'spike/no-number' })).toBe('other')
  })
})

describe('recommend', () => {
  const base = {
    git: { ok: true, inMainTree: false, dirty: false },
    prs: [],
    parallel: 0,
    board: { ok: true, statusOf: {}, inProgress: [] },
    issueNumber: null,
  }

  it('puts an unanswered review above everything else', () => {
    const out = recommend({
      ...base,
      prs: [{ number: 9, reviewDecision: 'CHANGES_REQUESTED' }],
      issueNumber: 134,
    })
    expect(out).toMatch(/PR #9.*CHANGES_REQUESTED/)
  })

  it('names red CI before new work', () => {
    const out = recommend({
      ...base,
      prs: [
        {
          number: 9,
          headRefName: 'fix/9-thing',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
        },
      ],
    })
    expect(out).toMatch(/CI is red on your PR #9/)
  })

  it('never lets a red dependency-bot PR outrank the session task (Renovate runs under @me here)', () => {
    const renovate = {
      number: 147,
      headRefName: 'renovate/vitejs-plugin-react-4.x',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
    }
    const out = recommend({
      ...base,
      prs: [renovate],
      issueNumber: 134,
      board: { ok: true, statusOf: { 134: 'In Progress' } },
    })
    expect(out).toMatch(/Resume #134/)
    expect(out).not.toMatch(/#147/)
  })

  it('mentions dependency PRs only when nothing is claimed', () => {
    const out = recommend({
      ...base,
      prs: [
        { number: 147, headRefName: 'renovate/x' },
        { number: 146, headRefName: 'renovate/y' },
      ],
    })
    expect(out).toMatch(/2 dependency PR\(s\) also await triage/)
  })

  it('orders isolation ahead of task work in the shared checkout', () => {
    const out = recommend({
      ...base,
      git: { ok: true, inMainTree: true, dirty: false },
      parallel: 2,
    })
    expect(out).toMatch(/task:worktree/)
  })

  it('names the half-missing claim when the board lags the worktree', () => {
    const out = recommend({
      ...base,
      issueNumber: 134,
      board: { ok: true, statusOf: { 134: 'Todo' } },
    })
    expect(out).toMatch(/board:status 134 "In Progress"/)
  })

  it('recommends resuming when both claim signals agree', () => {
    const out = recommend({
      ...base,
      issueNumber: 134,
      board: { ok: true, statusOf: { 134: 'In Progress' } },
    })
    expect(out).toMatch(/Resume #134/)
  })

  it('degrades to a diagnostic pointer when git is unreadable', () => {
    expect(recommend({ ...base, git: { ok: false } })).toMatch(/git state unreadable/)
  })
})

// ── the 2 KB cap ────────────────────────────────────────────────────────────

describe('fitToBytes', () => {
  it('leaves a snapshot that already fits untouched', () => {
    const text = '# head\n- a\n→ next: go'
    expect(fitToBytes(text, 2048)).toBe(text)
  })

  it('caps a long snapshot and keeps the header and the recommendation', () => {
    const lines = ['# session bootstrap — head']
    for (let i = 0; i < 400; i++) lines.push(`- filler line number ${i} with some padding text`)
    lines.push('→ next: land PR #150')
    const out = fitToBytes(lines.join('\n'), OUTPUT_LIMIT_BYTES)

    expect(bytes(out)).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES)
    expect(out.split('\n')[0]).toBe('# session bootstrap — head')
    expect(out.split('\n').at(-1)).toBe('→ next: land PR #150')
    expect(out).toMatch(/line\(s\) trimmed to fit 2048 B/)
  })

  it('hard-cuts a single unbroken blob without splitting a multi-byte char', () => {
    const out = fitToBytes('—'.repeat(5000), 100)
    expect(bytes(out)).toBeLessThanOrEqual(100)
    expect(out).not.toMatch(/\uFFFD/)
  })
})

// ── end-to-end: never throw, always ≤ 2 KB ──────────────────────────────────

describe('bootstrap — never throws', () => {
  it('degrades to diagnostics when every runner throws (no gh, no git)', () => {
    const boom = () => {
      throw new Error('spawnSync git ENOENT')
    }
    let out = ''
    expect(() => {
      out = bootstrap({ ...happyDeps, runGit: boom, runGh: boom })
    }).not.toThrow()

    expect(out).toMatch(/^# session bootstrap/)
    expect(out).toMatch(/! git branch: spawnSync git ENOENT/)
    expect(out).toMatch(/→ next: /)
    expect(bytes(out)).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES)
  })

  it('degrades when the runners report failure instead of throwing (gh not installed)', () => {
    const failing = (args: string[]) => ({
      ok: false,
      status: -1,
      stdout: '',
      stderr: '',
      error: `gh failed to start: spawnSync gh ENOENT (${args[0]})`,
    })
    const out = bootstrap({ ...happyDeps, runGh: failing })

    expect(out).toMatch(/! gh pr list: gh failed to start/)
    expect(out).toMatch(/your PRs: unread/)
    // git still worked — the git line must survive a total gh outage.
    expect(out).toMatch(/branch `chore\/134-session-bootstrap`/)
    expect(bytes(out)).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES)
  })

  it('survives non-JSON output from gh', () => {
    const out = bootstrap({ ...happyDeps, runGh: () => okRun('<html>login required</html>') })
    expect(out).toMatch(/response is not JSON/)
    expect(bytes(out)).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES)
  })

  it('caps the real output even when a probe returns something enormous', () => {
    const huge = gitStub({ 'rev-parse --abbrev-ref HEAD': `${'x'.repeat(20000)}\n` })
    const out = bootstrap({ ...happyDeps, runGit: huge })

    expect(bytes(out)).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES)
    expect(out).toMatch(/^# session bootstrap/)
    expect(out.trimEnd().split('\n').at(-1)).toMatch(/^→ next: /)
  })

  it('skips the network probes once the time budget is spent', () => {
    let t = 0
    const out = bootstrap({
      ...happyDeps,
      budgetMs: 10,
      clock: () => (t += 1000),
      runGh: () => {
        throw new Error('must not be called after the budget is spent')
      },
    })
    expect(out).toMatch(/time budget 10 ms spent/)
    expect(out).not.toMatch(/must not be called/)
  })
})

describe('bootstrap — happy path', () => {
  it('renders tree, board, PR and recommendation inside the cap', () => {
    const out = bootstrap(happyDeps)

    expect(bytes(out)).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES)
    expect(out).toContain('bbm-academy-org/bbm-portal')
    expect(out).toContain('worktree .claude/worktrees/134')
    expect(out).toContain('branch `chore/134-session-bootstrap` DIRTY')
    expect(out).toContain('2 ahead / 0 behind origin/main')
    expect(out).toContain('this tree = #134 [In Progress]')
    expect(out).toContain('open issues: 3')
    expect(out).toContain('#150')
    expect(out).toMatch(/→ next: #134: PR #150 open \(APPROVED\)/)
    // Clean run — no diagnostics.
    expect(out).not.toMatch(/^! /m)
    expect(out.endsWith('\n')).toBe(true)
  })

  it('folds dependency-bot PRs into one count line', () => {
    const withRenovate = ghStub({
      pr: [
        {
          number: 150,
          title: 'chore(gh): SessionStart bootstrap snapshot',
          reviewDecision: 'APPROVED',
          headRefName: 'chore/134-session-bootstrap',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        },
        {
          number: 147,
          title: 'chore(deps): update dependency @vitejs/plugin-react to v4',
          headRefName: 'renovate/vitejs-plugin-react-4.x',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
        },
      ],
    })
    const out = bootstrap({ ...happyDeps, runGh: withRenovate })
    expect(out).toContain('- your PRs (1):')
    expect(out).toContain('- dependency PRs: 1 open (1 with red CI)')
    expect(out).toMatch(/→ next: #134: PR #150 open/)
  })

  it('collect exposes the model without throwing on a clean run', () => {
    const model = collect(happyDeps)
    expect(model.warnings).toEqual([])
    expect(model.issueNumber).toBe(134)
    expect(model.git.inMainTree).toBe(false)
    expect(model.board.inProgress).toEqual([134])
    expect(model.openIssues).toBe(3)
  })

  it('renderSnapshot always ends with the recommendation line', () => {
    const text = renderSnapshot(collect(happyDeps))
    expect(text.split('\n').at(-1)).toMatch(/^→ next: /)
  })
})
