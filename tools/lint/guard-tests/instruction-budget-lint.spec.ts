import { describe, expect, it } from 'vitest'

import {
  AGGREGATE_BUDGET,
  AGGREGATE_SLOTS,
  BUDGET,
  NEAR_RATIO,
  collectTargets,
  evaluateFile,
  formatReport,
  memoryIndexPath,
  projectSlug,
  runBudgetLint,
} from '../instruction-budget-lint.mjs'

/**
 * `pnpm lint:instruction-budget` (#139) turns the prose rule «compact, never
 * just append» (`.claude/skills/wrap/SKILL.md` phase 3) into a deterministic
 * gate over the always-on corpus the wrap itself maintains. Everything under
 * test is a pure seam: the filesystem is injected, so no test ever reads the
 * real CLAUDE.md or the real memory index.
 */

const filled = (lines: number, lineLength = 10) =>
  Array.from({ length: lines }, () => 'x'.repeat(lineLength)).join('\n') + '\n'

/** `path.join` yields backslashes on Windows; every fake fs key is POSIX. */
const key = (p: string) => p.replace(/\\/g, '/')

describe('evaluateFile', () => {
  it('passes a small file', () => {
    const result = evaluateFile('CLAUDE.md', filled(10))
    expect(result.status).toBe('PASS')
    expect(result.lines).toBe(10)
    expect(result.bytes).toBe(110) // 10 lines of 10 chars + 10 newlines
  })

  it('flags NEAR once a file crosses the near ratio on lines', () => {
    const result = evaluateFile('AGENTS.md', filled(Math.ceil(BUDGET.lines * NEAR_RATIO)))
    expect(result.status).toBe('NEAR')
  })

  it('flags OVER past the line budget', () => {
    const result = evaluateFile('AGENTS.md', filled(BUDGET.lines + 1))
    expect(result.status).toBe('OVER')
    expect(result.over).toContain('lines')
  })

  it('flags OVER past the byte budget even when the line count is small', () => {
    const result = evaluateFile('AGENTS.md', filled(4, BUDGET.bytes / 2))
    expect(result.status).toBe('OVER')
    expect(result.over).toContain('bytes')
  })

  it('counts multi-byte characters as bytes, not as characters', () => {
    const result = evaluateFile('CLAUDE.md', '«тире — ёлочки»\n')
    expect(result.bytes).toBeGreaterThan(result.chars)
  })
})

describe('projectSlug / memoryIndexPath', () => {
  it('derives the Claude project slug from the repo root', () => {
    expect(projectSlug('C:\\Users\\sidor\\repos\\bbm-portal')).toBe(
      'C--Users-sidor-repos-bbm-portal',
    )
  })

  it('derives the same slug from a POSIX-style root', () => {
    expect(projectSlug('/home/anton/repos/bbm-portal')).toBe('-home-anton-repos-bbm-portal')
  })

  it('points the memory index at the project memory dir', () => {
    const p = memoryIndexPath('C:\\Users\\sidor\\repos\\bbm-portal', 'C:\\Users\\sidor')
    expect(p.replace(/\\/g, '/')).toBe(
      'C:/Users/sidor/.claude/projects/C--Users-sidor-repos-bbm-portal/memory/MEMORY.md',
    )
  })
})

describe('collectTargets', () => {
  const repoRoot = '/repo'
  const home = '/home'

  it('collects the always-on core: CLAUDE.md, AGENTS.md, every rule file, the memory index', () => {
    const targets = collectTargets({
      repoRoot,
      home,
      exists: () => true,
      listRules: () => [
        '/repo/.claude/rules/dev-env.md',
        '/repo/.claude/rules/parallel-sessions.md',
      ],
    })
    expect(targets.map((t) => t.replace(/\\/g, '/'))).toEqual([
      '/repo/CLAUDE.md',
      '/repo/AGENTS.md',
      '/repo/.claude/rules/dev-env.md',
      '/repo/.claude/rules/parallel-sessions.md',
      '/home/.claude/projects/-repo/memory/MEMORY.md',
    ])
  })

  it('keys the memory index off the MAIN checkout while measuring the edited worktree', () => {
    const targets = collectTargets({
      repoRoot: '/repo/.claude/worktrees/139',
      memoryRoot: '/repo',
      home,
      exists: () => true,
      listRules: () => [],
    })
    expect(targets.map(key)).toEqual([
      '/repo/.claude/worktrees/139/CLAUDE.md',
      '/repo/.claude/worktrees/139/AGENTS.md',
      '/home/.claude/projects/-repo/memory/MEMORY.md',
    ])
  })

  it('skips what does not exist instead of failing', () => {
    const targets = collectTargets({
      repoRoot,
      home,
      exists: (p: string) => key(p).includes('CLAUDE.md'),
      listRules: () => [],
    })
    expect(targets.map((t) => t.replace(/\\/g, '/'))).toEqual(['/repo/CLAUDE.md'])
  })
})

describe('formatReport', () => {
  it('returns exit code 0 and a PASS verdict when nothing is over budget', () => {
    const report = formatReport([
      { path: 'CLAUDE.md', lines: 72, bytes: 4000, chars: 4000, status: 'PASS', over: [] },
    ])
    expect(report.verdict).toBe('PASS')
    expect(report.exitCode).toBe(0)
    expect(report.text).toContain('CLAUDE.md')
  })

  it('keeps the verdict PASS but names the NEAR files', () => {
    const report = formatReport([
      { path: 'AGENTS.md', lines: 180, bytes: 20000, chars: 20000, status: 'NEAR', over: [] },
    ])
    expect(report.verdict).toBe('PASS')
    expect(report.exitCode).toBe(0)
    expect(report.text).toContain('NEAR')
  })

  it('fails with exit code 1 as soon as one file is over budget', () => {
    const report = formatReport([
      { path: 'CLAUDE.md', lines: 72, bytes: 4000, chars: 4000, status: 'PASS', over: [] },
      { path: 'AGENTS.md', lines: 400, bytes: 4000, chars: 4000, status: 'OVER', over: ['lines'] },
    ])
    expect(report.verdict).toBe('FAIL')
    expect(report.exitCode).toBe(1)
    expect(report.text).toContain('OVER')
    expect(report.text).toContain('compact')
  })

  /**
   * #157. An empty corpus used to be a PASS with a note — a fail-open: a run
   * that measured nothing cleared nothing, and «a check that never ran must not
   * look clean» (canon §2.3 / .claude/rules/design-process.md). CLAUDE.md and
   * AGENTS.md are not optional files; measuring zero of them means the guard
   * was pointed at the wrong tree, not that the tree is within budget.
   */
  it('reports an empty corpus as an ERROR, not a pass (exit 2)', () => {
    const report = formatReport([])
    expect(report.verdict).toBe('EMPTY')
    expect(report.exitCode).toBe(2)
    expect(report.text).toContain('no always-on files found')
  })
})

/**
 * #157, second delta: the per-file budget alone is a loophole — six files each
 * at 199 lines pass individually while the session pays for 1194. The aggregate
 * cap closes it, and is DERIVED from the per-file limit rather than invented:
 * the corpus is designed to have four slots (CLAUDE.md, AGENTS.md, the MEMORY.md
 * index, and `.claude/rules/` AS A WHOLE), so the cap is four per-file budgets.
 * Treating the rules directory as one slot is the point — otherwise adding a
 * rule file would raise the ceiling it is supposed to be constrained by.
 */
describe('aggregate corpus budget', () => {
  const row = (path: string, lines: number, bytes: number) => ({
    path,
    lines,
    bytes,
    chars: bytes,
    status: 'PASS' as const,
    over: [] as string[],
  })

  it('derives the cap from the per-file budget and the slot count', () => {
    expect(AGGREGATE_SLOTS).toBe(4)
    expect(AGGREGATE_BUDGET.lines).toBe(BUDGET.lines * AGGREGATE_SLOTS)
    expect(AGGREGATE_BUDGET.bytes).toBe(BUDGET.bytes * AGGREGATE_SLOTS)
  })

  it('fails on the corpus SUM even though every single file passes', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`f${i}.md`, BUDGET.lines - 1, 1000))
    const report = formatReport(rows)
    expect(rows.every((r) => r.status === 'PASS')).toBe(true)
    expect(report.verdict).toBe('FAIL')
    expect(report.exitCode).toBe(1)
    expect(report.text).toContain('TOTAL')
    expect(report.text).toContain('corpus')
  })

  it('fails on the corpus byte sum too, not only on lines', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`f${i}.md`, 10, BUDGET.bytes - 1))
    const report = formatReport(rows)
    expect(report.verdict).toBe('FAIL')
    expect(report.exitCode).toBe(1)
  })

  it('stays PASS while the corpus is inside the cap, and always prints the total', () => {
    const report = formatReport([row('CLAUDE.md', 80, 4499), row('AGENTS.md', 140, 15428)])
    expect(report.verdict).toBe('PASS')
    expect(report.exitCode).toBe(0)
    expect(report.text).toContain('TOTAL')
    expect(report.text).toContain('220 lines')
  })

  it('names the corpus in the NEAR tier before it fails', () => {
    const near = Math.ceil(AGGREGATE_BUDGET.lines * NEAR_RATIO)
    const report = formatReport([row('CLAUDE.md', near, 1000)])
    expect(report.verdict).toBe('PASS')
    expect(report.text).toContain('corpus')
  })
})

describe('runBudgetLint', () => {
  it('reads every collected target and reports on it', () => {
    const files: Record<string, string> = {
      '/repo/CLAUDE.md': filled(10),
      '/repo/AGENTS.md': filled(BUDGET.lines + 5),
    }
    const report = runBudgetLint({
      repoRoot: '/repo',
      home: '/home',
      exists: (p: string) => key(p) in files,
      readFile: (p: string) => files[key(p)],
      listRules: () => [],
    })
    expect(report.verdict).toBe('FAIL')
    expect(report.results).toHaveLength(2)
    expect(report.results[1].status).toBe('OVER')
  })

  it('never throws on an unreadable file, and never calls it a pass (exit 2)', () => {
    const report = runBudgetLint({
      repoRoot: '/repo',
      home: '/home',
      exists: () => true,
      readFile: () => {
        throw new Error('EACCES')
      },
      listRules: () => [],
    })
    expect(report.verdict).toBe('UNREADABLE')
    expect(report.exitCode).toBe(2)
    expect(report.text).toContain('unreadable')
  })

  it('lets a real finding outrank an unreadable target — exit 1 wins over exit 2', () => {
    const files: Record<string, string> = { '/repo/AGENTS.md': filled(BUDGET.lines + 5) }
    const report = runBudgetLint({
      repoRoot: '/repo',
      home: '/home',
      exists: () => true,
      readFile: (p: string) => {
        const content = files[key(p)]
        if (content === undefined) throw new Error('EACCES')
        return content
      },
      listRules: () => [],
    })
    expect(report.verdict).toBe('FAIL')
    expect(report.exitCode).toBe(1)
  })
})
