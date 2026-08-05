import { describe, expect, it } from 'vitest'

import {
  CLAUDE_SOFT_LINES,
  MAX_BYTES,
  MAX_LINES,
  collectTargets,
  evaluateBudget,
  exitCodeFor,
  isLazyRule,
  measure,
  severityFromEnv,
} from '../../tools/lint/instruction-budget-lint.mjs'

/**
 * The budget is not a style rule: the always-on context (CLAUDE.md + AGENTS.md
 * + path-less `.claude/rules/*.md`) is re-sent on every turn, and recall of any
 * single rule degrades as the total grows. 200 lines / 25 KB is Anthropic's own
 * CLAUDE.md target and the MEMORY.md auto-load cutoff — the same numbers, not a
 * new invented one.
 */

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')

describe('measure', () => {
  it('counts lines and bytes of a file body', () => {
    expect(measure('a\nb\nc')).toEqual({ lines: 3, bytes: 5 })
  })

  it('counts bytes, not characters — Cyrillic rules are two bytes a letter', () => {
    expect(measure('ё').bytes).toBe(2)
  })
})

describe('isLazyRule', () => {
  it('treats a rule with `paths:` frontmatter as lazy — it is not always-on', () => {
    expect(isLazyRule('---\npaths:\n  - src/**\n---\n\n# Rule\n')).toBe(true)
  })

  it('treats a plain rule as always-on', () => {
    expect(isLazyRule('# Rule\n\nSome text with paths: in prose.\n')).toBe(false)
  })
})

describe('evaluateBudget — per-file', () => {
  it('passes files inside the budget', () => {
    const r = evaluateBudget([{ label: 'CLAUDE.md', text: lines(50), alwaysOn: true }])
    expect(r.findings).toEqual([])
    expect(r.overBudget).toEqual([])
  })

  it('flags a file over the line ceiling', () => {
    const r = evaluateBudget([{ label: 'AGENTS.md', text: lines(MAX_LINES + 1), alwaysOn: true }])
    expect(r.findings.join('\n')).toMatch(/AGENTS\.md.*lines/)
    expect(r.overBudget).toContain('AGENTS.md')
  })

  it('flags a file over the byte ceiling even when its line count is fine', () => {
    const fat = 'x'.repeat(MAX_BYTES + 1)
    const r = evaluateBudget([{ label: 'CLAUDE.md', text: fat, alwaysOn: true }])
    expect(r.findings.join('\n')).toMatch(/KB/)
  })

  it('warns (without a finding) when CLAUDE.md passes the soft target', () => {
    const r = evaluateBudget([
      {
        label: 'CLAUDE.md',
        text: lines(CLAUDE_SOFT_LINES + 5),
        alwaysOn: true,
        softLines: CLAUDE_SOFT_LINES,
      },
    ])
    expect(r.findings).toEqual([])
    expect(r.warnings.join('\n')).toMatch(/soft target/)
  })

  it('keeps an over-budget on-demand skill a warning, never a finding', () => {
    const r = evaluateBudget([
      { label: 'skill: task-canon', text: lines(MAX_LINES + 100), alwaysOn: false, warnOnly: true },
    ])
    expect(r.findings).toEqual([])
    expect(r.warnings.join('\n')).toMatch(/task-canon/)
  })
})

describe('evaluateBudget — the always-on total', () => {
  it('sums only always-on files; skills and lazy rules stay off the total', () => {
    const r = evaluateBudget([
      { label: 'CLAUDE.md', text: lines(60), alwaysOn: true },
      { label: 'AGENTS.md', text: lines(40), alwaysOn: true },
      { label: '.claude/rules/lazy.md (lazy)', text: lines(500), alwaysOn: false },
      { label: 'skill: wrap', text: lines(500), alwaysOn: false, warnOnly: true },
    ])
    expect(r.total.lines).toBe(100)
    expect(r.findings).toEqual([])
  })

  it('flags the total when the sum of always-on files busts the ceiling', () => {
    const r = evaluateBudget([
      { label: 'CLAUDE.md', text: lines(120), alwaysOn: true },
      { label: 'AGENTS.md', text: lines(120), alwaysOn: true },
    ])
    expect(r.total.lines).toBe(240)
    expect(r.findings.join('\n')).toMatch(/always-on total/i)
  })

  it('reports missing required files as findings', () => {
    const r = evaluateBudget([{ label: 'CLAUDE.md', text: null, alwaysOn: true }])
    expect(r.findings.join('\n')).toMatch(/missing/i)
  })

  it('skips an optional absent file (MEMORY.md lives outside git; CI has none)', () => {
    const r = evaluateBudget([{ label: 'MEMORY.md', text: null, alwaysOn: true, optional: true }])
    expect(r.findings).toEqual([])
    expect(r.report.join('\n')).toMatch(/skip/i)
  })
})

describe('collectTargets', () => {
  it('classifies the real repo files: always-on set, lazy rules, on-demand skills', () => {
    const targets = collectTargets()
    const labels = targets.map((t) => t.label)
    expect(labels).toContain('CLAUDE.md')
    expect(labels).toContain('AGENTS.md')
    expect(labels.some((l) => l.startsWith('.claude/rules/'))).toBe(true)
    // Skills are read-on-demand: present, warn-only, and off the always-on total.
    const skill = targets.find((t) => t.label.startsWith('skill: '))
    expect(skill?.warnOnly).toBe(true)
    expect(skill?.alwaysOn).toBe(false)
  })
})

describe('severity — WARN today, BLOCK on promotion (#136)', () => {
  it('defaults to WARN', () => {
    expect(severityFromEnv({})).toBe('warn')
    expect(exitCodeFor({ findings: ['x'] }, 'warn')).toBe(0)
  })

  it('fails the run on findings once promoted', () => {
    expect(severityFromEnv({ LINT_SEVERITY: 'block' })).toBe('block')
    expect(exitCodeFor({ findings: ['x'] }, 'block')).toBe(1)
    expect(exitCodeFor({ findings: [] }, 'block')).toBe(0)
  })
})
