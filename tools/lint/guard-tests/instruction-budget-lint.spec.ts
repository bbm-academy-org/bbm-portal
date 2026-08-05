import { describe, expect, it } from 'vitest'

import {
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

  it('reports an empty corpus as PASS with an explicit note', () => {
    const report = formatReport([])
    expect(report.verdict).toBe('PASS')
    expect(report.text).toContain('no always-on files found')
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

  it('never throws on an unreadable file — the gate degrades to a skip', () => {
    const report = runBudgetLint({
      repoRoot: '/repo',
      home: '/home',
      exists: () => true,
      readFile: () => {
        throw new Error('EACCES')
      },
      listRules: () => [],
    })
    expect(report.verdict).toBe('PASS')
    expect(report.text).toContain('unreadable')
  })
})
