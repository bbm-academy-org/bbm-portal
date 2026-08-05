import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { STAGED_TOKEN_RE, STAGING_RE } from '../../tools/hooks/dispatch-guard.mjs'
import {
  deriveBranch,
  extractPathTokens,
  gatherState,
  renderBrief,
  repoRootFromCommonDir,
} from '../../tools/gh/dispatch-brief.mjs'
import {
  checkCoverage,
  checkSkillRequirement,
  checkStagingDeclaration,
  extractAcSection,
  extractPathTokens as checkerExtractPathTokens,
  formatSkillRow,
  formatStagingRow,
  verifyBrief,
} from '../../tools/gh/dispatch-brief-check.mjs'
import {
  STALE_THRESHOLD_SECONDS,
  classifyVerdict,
  formatAge,
  formatLine,
  gatherEvidence,
  parsePorcelainPath,
} from '../../tools/gh/dispatch-probe.mjs'

/**
 * The dispatch trio of task 7.3 (#134): `dispatch:brief` writes a brief,
 * `dispatch:brief-check` validates one, `dispatch:probe` reads a worktree's
 * liveness off disk. All three keep their decision logic in pure seams and
 * their `gh`/`git`/fs access behind injectable runners, so nothing here shells
 * out. The load-bearing seam is the STAGED-token alignment: brief-check imports
 * the regexes from `tools/hooks/dispatch-guard.mjs`, so it accepts exactly the
 * briefs the guard accepts.
 */

// ── dispatch:brief ───────────────────────────────────────────────────────────

describe('dispatch:brief — extractPathTokens', () => {
  it('keeps repo paths and drops prose slashes', () => {
    const tokens = extractPathTokens(
      'touch `tools/gh/pr-land.mjs` and .claude/skills/task-canon/SKILL.md, and/or nothing in tools/',
    )
    expect(tokens).toEqual(['tools/gh/pr-land.mjs', '.claude/skills/task-canon/SKILL.md'])
  })

  it('keeps an extensionless path with ≥2 separators, dedupes repeats', () => {
    expect(extractPathTokens('tests/unit/fixtures tests/unit/fixtures')).toEqual([
      'tests/unit/fixtures',
    ])
  })

  it('drops a prose version range: a file extension starts with a letter', () => {
    // `v2.1/v2.2` has a dot in its last segment but `.2` is not an extension,
    // and with a single separator it is not a path either.
    expect(extractPathTokens('bump v2.1/v2.2 of the spec')).toEqual([])
    expect(extractPathTokens('read docs/adr/0003-domains.md')).toEqual(['docs/adr/0003-domains.md'])
  })

  it('drops URLs — a link is not a file surface this repo can name', () => {
    expect(
      extractPathTokens(
        'see github.com/bbm-academy-org/bbm-portal/issues/117 and portal.bbm.academy/p/hours',
      ),
    ).toEqual([])
  })

  it('is the very function dispatch:brief-check uses — one heuristic, no drift', () => {
    expect(extractPathTokens).toBe(checkerExtractPathTokens)
  })
})

describe('dispatch:brief — deriveBranch', () => {
  it('derives the prefix from the native Type, the slug from the title', () => {
    expect(
      deriveBranch({ issueNumber: 134, title: 'Port the dispatch scripts', issueType: 'Task' }),
    ).toBe('chore/134-port-the-dispatch-scripts')
    expect(deriveBranch({ issueNumber: 7, title: 'Hours calculator', issueType: 'Feature' })).toBe(
      'feat/7-hours-calculator',
    )
    expect(deriveBranch({ issueNumber: 8, title: 'Login is broken', issueType: 'Bug' })).toBe(
      'fix/8-login-is-broken',
    )
  })

  it('falls back to the title prefix without a Type, and to a placeholder slug without a title', () => {
    expect(deriveBranch({ issueNumber: 9, title: 'fix(auth): token refresh' })).toBe(
      'fix/9-token-refresh',
    )
    expect(deriveBranch({ issueNumber: 10 })).toBe('chore/10-<fill-slug>')
  })
})

describe('dispatch:brief — repoRootFromCommonDir', () => {
  it('reads the PRIMARY tree root out of an absolute common dir', () => {
    // The bug this seam exists for: `--show-toplevel` inside a linked worktree
    // answers with the worktree, and the brief then names
    // `.../worktrees/134/.claude/worktrees/134`. The common dir never does.
    expect(repoRootFromCommonDir('C:/Users/x/repo/.git\n')).toBe('C:/Users/x/repo')
    expect(repoRootFromCommonDir('C:\\Users\\x\\repo\\.git')).toBe('C:/Users/x/repo')
    expect(repoRootFromCommonDir('/home/x/repo/.git')).toBe('/home/x/repo')
  })

  it('resolves a relative answer against the cwd, and empty output to null', () => {
    expect(repoRootFromCommonDir('.git', 'C:/Users/x/repo')).toBe('C:/Users/x/repo')
    expect(repoRootFromCommonDir('', 'C:/Users/x/repo')).toBe(null)
  })
})

describe('dispatch:brief — gatherState', () => {
  const issue = {
    title: 'Port the dispatch scripts',
    body: '## Acceptance criteria\n- [ ] `tools/gh/dispatch-probe.mjs` exists\n',
    issueType: { name: 'Task' },
    milestone: { title: 'Платформа: эксплуатация и упрочнение' },
  }

  it('seeds title, type, milestone and path tokens from gh, and the repo root from git', () => {
    const calls: string[][] = []
    const runner = {
      gh: (args: string[]) => {
        calls.push(args)
        return { status: 0, stdout: JSON.stringify(issue), stderr: '' }
      },
      git: (args: string[]) => {
        calls.push(args)
        return { status: 0, stdout: 'C:/repo/.git\n', stderr: '' }
      },
    }
    const state = gatherState({
      issueNumber: 134,
      runner,
      exists: (p: string) => !p.includes('worktrees'),
    })
    expect(state.title).toBe('Port the dispatch scripts')
    expect(state.issueType).toBe('Task')
    expect(state.milestone).toBe('Платформа: эксплуатация и упрочнение')
    expect(state.seededFiles).toEqual(['tools/gh/dispatch-probe.mjs'])
    expect(state.repoRoot).toBe('C:/repo')
    // targets our repo explicitly, never the ambient default
    expect(calls[0]).toContain('--repo')
    expect(calls[0]).toContain('bbm-academy-org/bbm-portal')
  })

  it('seeds the scope from the worktree diff, naming the tree absolutely with -C', () => {
    const probed: string[] = []
    const runner = {
      gh: () => ({ status: 0, stdout: JSON.stringify(issue), stderr: '' }),
      git: (args: string[]) => {
        if (!args.includes('diff')) return { status: 0, stdout: 'C:/repo/.git\n', stderr: '' }
        expect(args.slice(0, 2)).toEqual(['-C', 'C:/repo/.claude/worktrees/134'])
        return { status: 0, stdout: 'tools/gh/a.mjs\ntests/unit/a.spec.ts\n', stderr: '' }
      },
    }
    const state = gatherState({
      issueNumber: 134,
      runner,
      exists: (p: string) => {
        probed.push(p)
        return true
      },
    })
    expect(probed).toEqual(['C:/repo/.claude/worktrees/134'])
    expect(state.worktreeChanged).toEqual(['tools/gh/a.mjs', 'tests/unit/a.spec.ts'])
  })

  it('keeps only real surfaces in the scope seed — a file, or a path on disk', () => {
    const runner = {
      gh: () => ({
        status: 0,
        stdout: JSON.stringify({
          ...issue,
          body: '## Acceptance criteria\n- rewrite `tools/gh/new-file.mjs`, touch tools/gh/lib, not links/statuses/owner\n',
        }),
        stderr: '',
      }),
      git: () => ({ status: 0, stdout: 'C:/repo/.git\n', stderr: '' }),
    }
    const state = gatherState({
      issueNumber: 134,
      runner,
      exists: (p: string) => p === 'C:/repo/tools/gh/lib',
    })
    expect(state.seededFiles).toEqual(['tools/gh/new-file.mjs', 'tools/gh/lib'])
  })

  it('degrades without throwing when gh and git both fail', () => {
    const runner = {
      gh: () => ({ status: 1, stdout: '', stderr: 'gh: not found' }),
      git: () => ({ status: 128, stdout: '', stderr: 'not a git repository' }),
    }
    const state = gatherState({ issueNumber: 134, runner, exists: () => false })
    expect(state).toMatchObject({ title: null, issueType: null, repoRoot: null })
    expect(state.seededFiles).toEqual([])
  })
})

describe('dispatch:brief — renderBrief', () => {
  const brief = renderBrief({
    issueNumber: 134,
    title: 'Port the dispatch scripts',
    issueType: 'Task',
    seededFiles: ['tools/gh/dispatch-probe.mjs'],
    repoRoot: 'C:/repo',
  })

  it('stamps the branch, the worktree and the repo the work belongs to', () => {
    expect(brief).toContain('chore/134-port-the-dispatch-scripts')
    expect(brief).toContain('C:/repo/.claude/worktrees/134')
    expect(brief).toContain('bbm-academy-org/bbm-portal#134')
  })

  it('stamps the canon blocks: governing skill, gates, PR, return contract, deviations', () => {
    expect(brief).toContain('.claude/skills/task-cycle/SKILL.md')
    expect(brief).toContain('pnpm install')
    expect(brief).toContain('pnpm dev:ports')
    expect(brief).toContain('pnpm test:unit')
    expect(brief).toContain('Closes #134')
    expect(brief).toContain('Return contract (≤30 lines)')
    expect(brief).toContain('Отклонения от конвенций')
    expect(brief).toContain('pnpm dispatch:brief-check 134')
  })

  it('seeds the scope from the issue path tokens, and marks unknown fields <fill>', () => {
    expect(brief).toContain('- `tools/gh/dispatch-probe.mjs`')
    expect(renderBrief({ issueNumber: 99 })).toContain('<fill: issue #99 title>')
    expect(renderBrief({ issueNumber: 99 })).toContain('<repo-root>/.claude/worktrees/99')
  })

  it('is direct-apply: the scaffold never trips the dispatch guard on its own boilerplate', () => {
    // The alignment that matters. A scaffold whose own wording matched
    // STAGING_RE would warn on every dispatch and train the lead to ignore it.
    expect(STAGING_RE.test(brief)).toBe(false)
    // …and the STAGED token it advertises is an UNFILLED placeholder, so it
    // satisfies neither the guard nor brief-check until someone fills it in.
    expect(brief).toContain('STAGED: <irreversible|conflicting|owner-preapproval>')
    expect(STAGED_TOKEN_RE.test(brief)).toBe(false)
  })

  it('passes its own brief-check: skill declared, staging clean', () => {
    expect(checkSkillRequirement(brief)).toEqual({
      verdict: 'skill',
      skillPath: '.claude/skills/task-cycle/SKILL.md',
    })
    expect(checkStagingDeclaration(brief)).toEqual({ verdict: 'direct-apply' })
  })
})

// ── dispatch:brief-check ─────────────────────────────────────────────────────

const AC_BODY = [
  '**Source:** session retro',
  '',
  '## Scope',
  '',
  '- irrelevant `tools/gh/ignored.mjs`',
  '',
  '### Acceptance criteria',
  '',
  '- [ ] `tools/gh/dispatch-probe.mjs` runs and prints a verdict',
  '- [ ] `tests/unit/dispatch-scripts.spec.ts` is green',
  '',
  '## Notes',
  '',
  '- `tools/gh/other.mjs` is out of scope',
].join('\n')

describe('dispatch:brief-check — extractAcSection', () => {
  it('reads the AC block at either heading level and stops at the next heading', () => {
    const section = extractAcSection(AC_BODY)
    expect(section).toContain('dispatch-probe.mjs')
    expect(section).not.toContain('ignored.mjs')
    expect(section).not.toContain('other.mjs')
  })

  it('returns empty when the issue has no AC block', () => {
    expect(extractAcSection('## Scope\n- something')).toBe('')
  })
})

describe('dispatch:brief-check — checkCoverage', () => {
  it('counts a directory token as covered by a file beneath it', () => {
    expect(checkCoverage(['tools/gh/lib'], 'touch `tools/gh/lib/gh.mjs`')).toEqual([
      { path: 'tools/gh/lib', covered: true },
    ])
  })

  it('ignores backticks and line wrapping in the brief', () => {
    const rows = checkCoverage(
      ['tools/gh/dispatch-probe.mjs'],
      'edit `tools/gh/dispatch-probe.mjs`',
    )
    expect(rows[0].covered).toBe(true)
  })
})

describe('dispatch:brief-check — checkSkillRequirement', () => {
  it('accepts a governing skill path', () => {
    expect(checkSkillRequirement('runs under `.claude/skills/task-canon/SKILL.md`')).toEqual({
      verdict: 'skill',
      skillPath: '.claude/skills/task-canon/SKILL.md',
    })
  })

  it('accepts the declared engineering-task escape', () => {
    expect(checkSkillRequirement('kind: engineering-task')).toEqual({
      verdict: 'engineering-task',
    })
  })

  it('rejects a brief that declares neither, and names both remedies', () => {
    expect(checkSkillRequirement('just do the thing')).toEqual({ verdict: 'missing' })
    const row = formatSkillRow({ verdict: 'missing' })
    expect(row.startsWith('MISSING-SKILL')).toBe(true)
    expect(row).toContain('.claude/skills/<name>/SKILL.md')
    expect(row).toContain('kind: engineering-task')
  })
})

describe('dispatch:brief-check — checkStagingDeclaration (the guard alignment)', () => {
  const staging = 'Write the rewritten text as drafts on disk; do not apply the edits yourself.'

  it('calls a plain direct-apply brief direct-apply', () => {
    expect(checkStagingDeclaration('Apply the edits in the worktree and commit.')).toEqual({
      verdict: 'direct-apply',
    })
  })

  it('fails a brief that stages its output with no token — the case the guard warns about', () => {
    expect(STAGING_RE.test(staging)).toBe(true) // the guard would warn here
    expect(checkStagingDeclaration(staging)).toEqual({ verdict: 'undeclared' })
    const row = formatStagingRow({ verdict: 'undeclared' })
    expect(row.startsWith('MISSING-STAGED')).toBe(true)
    expect(row).toContain('STAGED: irreversible|conflicting|owner-preapproval')
  })

  it('passes the same brief once the token is filled in, and records the reason', () => {
    const declared = `${staging}\nSTAGED: irreversible — the migration cannot be rolled back.`
    expect(checkStagingDeclaration(declared)).toEqual({ verdict: 'staged', reason: 'irreversible' })
    expect(formatStagingRow(checkStagingDeclaration(declared))).toBe(
      'STAGING staged (irreversible)',
    )
    // the guard agrees: token present ⇒ no warning
    expect(STAGED_TOKEN_RE.test(declared)).toBe(true)
  })

  it('does not accept the scaffold placeholder as a justification', () => {
    const placeholder = `${staging}\nSTAGED: <irreversible|conflicting|owner-preapproval>`
    expect(checkStagingDeclaration(placeholder)).toEqual({ verdict: 'undeclared' })
    expect(STAGED_TOKEN_RE.test(placeholder)).toBe(false)
  })

  it('accepts each reason the guard accepts, and no other', () => {
    for (const reason of ['irreversible', 'conflicting', 'owner-preapproval']) {
      expect(checkStagingDeclaration(`${staging}\nSTAGED: ${reason}`)).toEqual({
        verdict: 'staged',
        reason,
      })
    }
    expect(checkStagingDeclaration(`${staging}\nSTAGED: because I said so`)).toEqual({
      verdict: 'undeclared',
    })
  })
})

describe('dispatch:brief-check — verifyBrief', () => {
  const ghOk = (args: string[]) => {
    expect(args).toContain('--repo')
    expect(args).toContain('bbm-academy-org/bbm-portal')
    return { status: 0, stdout: JSON.stringify({ body: AC_BODY }), stderr: '' }
  }

  it('passes a brief that names every AC surface', () => {
    const brief =
      'Edit `tools/gh/dispatch-probe.mjs` and cover it in `tests/unit/dispatch-scripts.spec.ts`.'
    const { rows, missing } = verifyBrief({
      issueNumber: 134,
      briefText: brief,
      runner: { gh: ghOk },
    })
    expect(missing).toBe(0)
    expect(rows.map((r) => r.path)).toEqual([
      'tools/gh/dispatch-probe.mjs',
      'tests/unit/dispatch-scripts.spec.ts',
    ])
  })

  it('flags the AC surface a brief silently omits', () => {
    const { rows, missing } = verifyBrief({
      issueNumber: 134,
      briefText: 'Edit `tools/gh/dispatch-probe.mjs`.',
      runner: { gh: ghOk },
    })
    expect(missing).toBe(1)
    expect(rows.find((r) => !r.covered)?.path).toBe('tests/unit/dispatch-scripts.spec.ts')
  })

  it('is green when the AC block names no paths at all', () => {
    const runner = {
      gh: () => ({
        status: 0,
        stdout: JSON.stringify({ body: '## Acceptance criteria\n- [ ] the page loads' }),
        stderr: '',
      }),
    }
    expect(verifyBrief({ issueNumber: 1, briefText: 'anything', runner })).toEqual({
      rows: [],
      missing: 0,
    })
  })

  it('throws (→ exit 2) on a gh failure instead of reporting a false PASS', () => {
    const runner = { gh: () => ({ status: 1, stdout: '', stderr: 'HTTP 404' }) }
    expect(() => verifyBrief({ issueNumber: 134, briefText: 'x', runner })).toThrow(/HTTP 404/)
  })

  it('throws on unparseable gh output', () => {
    const runner = { gh: () => ({ status: 0, stdout: 'not json', stderr: '' }) }
    expect(() => verifyBrief({ issueNumber: 134, briefText: 'x', runner })).toThrow(
      /could not parse/,
    )
  })
})

// ── dispatch:probe ───────────────────────────────────────────────────────────

describe('dispatch:probe — classifyVerdict', () => {
  it('ALIVE on any commit, however old', () => {
    expect(classifyVerdict({ commitCount: 2, dirtyCount: 0, ageSeconds: 99999 })).toEqual({
      verdict: 'ALIVE',
      killAdvised: false,
    })
  })

  it('ALIVE on freshly touched dirty files, QUIET once they age past the threshold', () => {
    expect(classifyVerdict({ commitCount: 0, dirtyCount: 3, ageSeconds: 30 })).toEqual({
      verdict: 'ALIVE',
      killAdvised: false,
    })
    expect(
      classifyVerdict({ commitCount: 0, dirtyCount: 3, ageSeconds: STALE_THRESHOLD_SECONDS }),
    ).toEqual({ verdict: 'QUIET', killAdvised: false })
  })

  it('STILL-CLEAN on an empty tree, advising a kill only past the threshold', () => {
    expect(classifyVerdict({ commitCount: 0, dirtyCount: 0, ageSeconds: 60 })).toEqual({
      verdict: 'STILL-CLEAN',
      killAdvised: false,
    })
    expect(classifyVerdict({ commitCount: 0, dirtyCount: 0, ageSeconds: 601 })).toEqual({
      verdict: 'STILL-CLEAN',
      killAdvised: true,
    })
  })

  it('honours an explicit threshold', () => {
    expect(
      classifyVerdict({ commitCount: 0, dirtyCount: 0, ageSeconds: 60, thresholdSeconds: 30 }),
    ).toMatchObject({ killAdvised: true })
  })
})

describe('dispatch:probe — formatting seams', () => {
  it('formats ages compactly', () => {
    expect(formatAge(45)).toBe('45s')
    expect(formatAge(600)).toBe('10m')
    expect(formatAge(587)).toBe('9m47s')
    expect(formatAge(3900)).toBe('1h5m')
    expect(formatAge(-5)).toBe('0s')
  })

  it('reads the destination path of a porcelain line, including renames and quotes', () => {
    expect(parsePorcelainPath(' M tools/gh/dispatch-probe.mjs')).toBe('tools/gh/dispatch-probe.mjs')
    expect(parsePorcelainPath('R  old/a.mjs -> new/b.mjs')).toBe('new/b.mjs')
    expect(parsePorcelainPath('?? "with space.md"')).toBe('with space.md')
  })

  it('appends the kill advice only when it is advised', () => {
    const evidence = { commitCount: 0, dirtyCount: 0, ageSeconds: 900 }
    expect(formatLine(134, evidence, classifyVerdict(evidence))).toBe(
      'STILL-CLEAN #134 age=15m commits=0 dirty=0 advice=kill+re-dispatch',
    )
    const alive = { commitCount: 1, dirtyCount: 2, ageSeconds: 12 }
    expect(formatLine(134, alive, classifyVerdict(alive))).toBe(
      'ALIVE #134 age=12s commits=1 dirty=2',
    )
  })
})

describe('dispatch:probe — gatherEvidence', () => {
  const NOW = 1_800_000_000_000

  it('happy path: commits present → age comes from the last commit time', () => {
    const seen: string[][] = []
    const runner = {
      git: (tree: string, args: string[]) => {
        seen.push(args)
        expect(tree).toBe('/wt/134')
        if (args[0] === 'rev-list') return { status: 0, stdout: '3\n', stderr: '' }
        if (args[0] === 'status') return { status: 0, stdout: ' M a.ts\n?? b.ts\n', stderr: '' }
        return { status: 0, stdout: `${NOW / 1000 - 120}\n`, stderr: '' }
      },
    }
    const ev = gatherEvidence({
      worktreePath: '/wt/134',
      runner,
      statMtime: () => null,
      nowMs: NOW,
    })
    expect(ev).toEqual({ commitCount: 3, dirtyCount: 2, ageSeconds: 120 })
    expect(seen.map((a) => a[0])).toEqual(['rev-list', 'status', 'log'])
  })

  it('no commits, dirty files → age comes from the newest dirty-file mtime', () => {
    const runner = {
      git: (_tree: string, args: string[]) =>
        args[0] === 'rev-list'
          ? { status: 0, stdout: '0\n', stderr: '' }
          : { status: 0, stdout: ' M a.ts\n M b.ts\n', stderr: '' },
    }
    const mtimes: Record<string, number> = {
      [join('/wt/134', 'a.ts')]: NOW - 300_000,
      [join('/wt/134', 'b.ts')]: NOW - 60_000,
    }
    const ev = gatherEvidence({
      worktreePath: '/wt/134',
      runner,
      statMtime: (p: string) => mtimes[p] ?? null,
      nowMs: NOW,
    })
    expect(ev).toMatchObject({ commitCount: 0, dirtyCount: 2, ageSeconds: 60 })
  })

  it('clean tree → age comes from the worktree .git link file (dispatch time)', () => {
    const runner = {
      git: () => ({ status: 0, stdout: '', stderr: '' }),
    }
    const ev = gatherEvidence({
      worktreePath: '/wt/134',
      runner,
      statMtime: (p: string) => (p.endsWith('.git') ? NOW - 900_000 : null),
      nowMs: NOW,
    })
    expect(ev).toEqual({ commitCount: 0, dirtyCount: 0, ageSeconds: 900 })
    expect(classifyVerdict(ev)).toEqual({ verdict: 'STILL-CLEAN', killAdvised: true })
  })

  it('failure path: git errors on every call → zero evidence, age 0, never a false kill advice', () => {
    const runner = {
      git: () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' }),
    }
    const ev = gatherEvidence({
      worktreePath: '/wt/134',
      runner,
      statMtime: () => null,
      nowMs: NOW,
    })
    expect(ev).toEqual({ commitCount: 0, dirtyCount: 0, ageSeconds: 0 })
    expect(classifyVerdict(ev).killAdvised).toBe(false)
  })
})
