import { describe, expect, it } from 'vitest'

import {
  AGGREGATE_BUDGET,
  BUDGET,
  NEAR_RATIO,
  collectTargets,
  evaluateFile,
  formatReport,
  isPathScoped,
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
 * #157 closed the per-file loophole (six files at 199 lines each pass while the
 * session pays for 1194) with a corpus cap. #596 measures that corpus honestly —
 * only what a Claude session really loads at start: CLAUDE.md, the AGENTS.md it
 * imports, and the PATH-LESS `.claude/rules/*.md` files — and lowers the cap
 * toward ds-platform's 30 KB (owner go, Anton, 2026-11-24). The cap is an
 * explicit constant now, not four per-file budgets: the four-slot derivation
 * described a corpus that counted machine-local memory and lazy rules.
 */
describe('aggregate corpus budget', () => {
  const row = (path: string, lines: number, bytes: number, scope?: string) => ({
    path,
    lines,
    bytes,
    chars: bytes,
    status: 'PASS' as const,
    over: [] as string[],
    ...(scope ? { scope } : {}),
  })

  it('caps the always-on corpus at 32 KB / 400 lines (#596)', () => {
    expect(AGGREGATE_BUDGET).toEqual({ lines: 400, bytes: 32 * 1024 })
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

  it('keeps lazy rules and the machine-local memory index OFF the total', () => {
    const report = formatReport([
      row('CLAUDE.md', 50, 2000),
      row('.claude/rules/design-process.md', BUDGET.lines - 1, BUDGET.bytes - 1, 'lazy'),
      row('MEMORY.md', BUDGET.lines - 1, BUDGET.bytes - 1, 'machine-local'),
      row('.claude/rules/x.md', BUDGET.lines - 1, BUDGET.bytes - 1, 'lazy'),
    ])
    expect(report.verdict).toBe('PASS')
    expect(report.total).toEqual({ lines: 50, bytes: 2000 })
    expect(report.text).toContain('lazy')
    expect(report.text).toContain('machine-local')
  })

  it('still fails an off-total file that is over its own per-file budget', () => {
    const report = formatReport([
      row('CLAUDE.md', 50, 2000),
      {
        ...row('MEMORY.md', BUDGET.lines + 1, 1000, 'machine-local'),
        status: 'OVER',
        over: ['lines'],
      },
    ])
    expect(report.verdict).toBe('FAIL')
    expect(report.exitCode).toBe(1)
  })
})

/**
 * Claude Code loads a `.claude/rules/*.md` file with `paths:` frontmatter only
 * when the session touches a matching file — it is lazy, not always-on. The
 * classifier is strict (ds-platform #1371): the frontmatter must be the first
 * bytes of the file, terminated, and declare `paths` as a top-level key. The
 * word `paths:` in the body, or a markdown thematic break, is not frontmatter.
 */
describe('isPathScoped', () => {
  const doc = (...lines: string[]) => lines.join('\n') + '\n'

  it('recognises real top-level paths frontmatter', () => {
    expect(isPathScoped(doc('---', 'paths:', '  - "src/**/*.tsx"', '---', '', '# Rule'))).toBe(true)
  })

  it('accepts CRLF line endings', () => {
    expect(isPathScoped(['---', 'paths:', '  - "src/**"', '---', '# Rule', ''].join('\r\n'))).toBe(
      true,
    )
  })

  it('rejects frontmatter that is not the first bytes of the file', () => {
    expect(isPathScoped(doc('', '---', 'paths:', '  - "src/**"', '---'))).toBe(false)
  })

  it('rejects an unterminated block', () => {
    expect(isPathScoped(doc('---', 'paths:', '  - "src/**"', '# Rule'))).toBe(false)
  })

  it('rejects an indented or commented paths key and a body mention', () => {
    expect(isPathScoped(doc('---', 'meta:', '  paths: x', '---'))).toBe(false)
    expect(isPathScoped(doc('---', '# paths: x', '---'))).toBe(false)
    expect(isPathScoped(doc('# Rule', '', 'paths: src/**'))).toBe(false)
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

  it('scopes each target: path-less rules always-on, paths: rules lazy, memory machine-local', () => {
    const files: Record<string, string> = {
      '/repo/CLAUDE.md': filled(10),
      '/repo/AGENTS.md': filled(10),
      '/repo/.claude/rules/always.md': filled(10),
      '/repo/.claude/rules/lazy.md':
        ['---', 'paths:', '  - "src/**"', '---', ''].join('\n') + filled(BUDGET.lines - 10),
      '/home/.claude/projects/-repo/memory/MEMORY.md': filled(BUDGET.lines - 10),
    }
    const report = runBudgetLint({
      repoRoot: '/repo',
      home: '/home',
      exists: (p: string) => key(p) in files,
      readFile: (p: string) => files[key(p)],
      listRules: () => ['/repo/.claude/rules/always.md', '/repo/.claude/rules/lazy.md'],
    })
    expect(report.results.map((r: { scope: string }) => r.scope)).toEqual([
      'always-on',
      'always-on',
      'always-on',
      'lazy',
      'machine-local',
    ])
    expect(report.total).toEqual({ lines: 30, bytes: 330 })
  })
})
