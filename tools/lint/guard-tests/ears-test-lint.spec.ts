import { describe, expect, it } from 'vitest'

import {
  SPEC_FILE_RE,
  evaluateTraceability,
  matches,
  requirementsSection,
  specEarsIds,
  titleEarsIds,
} from '../ears-test-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * ears-test — the COVERAGE half of the EARS↔test contract (#157, guard tranche
 * 2). Ported from ds-platform `tools/lint/ears-test-lint.ts`; two adaptations
 * this repo's canon forces:
 *
 *   1. Ids are read from the spec's `## Requirements` SECTION, not from the
 *      whole document. Our template (docs/specs/README.md) puts the clauses
 *      there and nowhere else, so a prose cross-reference elsewhere in a spec —
 *      or the template example in the README — is background, not a declaration.
 *   2. ds's spec-scoped deferral machinery reads a `NNN EARS-…` title prefix
 *      that this repo has no convention for (our canon is a bare
 *      `it('EARS-3: …')`), so it is dropped rather than ported dead. Deferrals
 *      stay: flat keys, empty by default, `LINT_EARS_DEFERRALS` as the seam.
 */

describe('SPEC_FILE_RE', () => {
  it('matches the two spec trees', () => {
    expect(SPEC_FILE_RE.test('docs/specs/081-hours-calculator.md')).toBe(true)
    expect(
      SPEC_FILE_RE.test('docs/superpowers/specs/2026-08-04-platform-consolidation-design.md'),
    ).toBe(true)
  })

  it('never matches a README — an index is not a spec', () => {
    expect(SPEC_FILE_RE.test('docs/specs/README.md')).toBe(false)
    expect(SPEC_FILE_RE.test('docs/ci-guardrails.md')).toBe(false)
  })
})

describe('requirementsSection', () => {
  const spec = [
    '---',
    'status: In dev',
    '---',
    '',
    '# Thing — spec',
    '',
    '## Why',
    '',
    'Mentions EARS-99 in prose, which is not a declaration.',
    '',
    '## Requirements',
    '',
    '- **EARS-1.** The system shall do the thing.',
    '- **EARS-2.** WHEN x, the system shall do y.',
    '',
    '## Out of scope',
    '',
    'EARS-50 is deliberately not here.',
  ].join('\n')

  it('returns only the Requirements section', () => {
    const section = requirementsSection(spec)
    expect(section).toContain('EARS-1')
    expect(section).toContain('EARS-2')
    expect(section).not.toContain('EARS-99')
    expect(section).not.toContain('EARS-50')
  })

  it('returns an empty string when a spec declares no Requirements section', () => {
    expect(requirementsSection('# Old spec\n\nProse only, EARS-7 mentioned.\n')).toBe('')
  })

  it('reads ids only from that section', () => {
    expect([...specEarsIds(spec)]).toEqual(['EARS-1', 'EARS-2'])
  })
})

describe('titleEarsIds', () => {
  it('reads ids from test titles only', () => {
    const src = ["it('EARS-3: freezes the period', () => {})", "const s = 'EARS-88'"].join('\n')
    expect([...titleEarsIds(src)]).toEqual(['EARS-3'])
  })

  it('expands the compound form into its component ids', () => {
    expect([...titleEarsIds("it('EARS-3/4: covers both', () => {})")]).toEqual(['EARS-3', 'EARS-4'])
  })

  it('keeps a nested id nested', () => {
    expect([...titleEarsIds("it('EARS-3.2: emits', () => {})")]).toEqual(['EARS-3.2'])
  })
})

describe('matches (dotted-prefix ancestry)', () => {
  it('folds a nested test id into its flat requirement', () => {
    expect(matches('EARS-18', 'EARS-18.1')).toBe(true)
  })

  it('folds a flat test id onto its nested requirements', () => {
    expect(matches('EARS-1.2', 'EARS-1')).toBe(true)
  })

  it('never folds siblings together — that would hide a real gap', () => {
    expect(matches('EARS-3.1', 'EARS-3.2')).toBe(false)
  })

  it('compares components, so EARS-1 never folds into EARS-18', () => {
    expect(matches('EARS-1', 'EARS-18')).toBe(false)
  })
})

describe('evaluateTraceability', () => {
  const specIds = (entries: [string, string[]][]) => new Map(entries)

  it('passes when every clause has a test and no test is an orphan', () => {
    const verdict = evaluateTraceability({
      specIds: specIds([['EARS-1', ['docs/specs/010-x.md']]]),
      testIds: specIds([['EARS-1', ['tests/unit/x.spec.ts']]]),
    })
    expect(verdict.findings).toBe(0)
    expect(verdict.uncovered).toEqual([])
    expect(verdict.orphans).toEqual([])
  })

  it('reports a clause no test references', () => {
    const verdict = evaluateTraceability({
      specIds: specIds([['EARS-2', ['docs/specs/010-x.md']]]),
      testIds: specIds([]),
    })
    expect(verdict.findings).toBe(1)
    expect(verdict.uncovered.map((u) => u.id)).toEqual(['EARS-2'])
  })

  it('reports a test citing a clause that no spec declares', () => {
    const verdict = evaluateTraceability({
      specIds: specIds([]),
      testIds: specIds([['EARS-9', ['tests/unit/x.spec.ts']]]),
    })
    expect(verdict.findings).toBe(1)
    expect(verdict.orphans.map((o) => o.id)).toEqual(['EARS-9'])
  })

  it('turns a tracked deferral into a note instead of a finding', () => {
    const verdict = evaluateTraceability({
      specIds: specIds([['EARS-4', ['docs/specs/010-x.md']]]),
      testIds: specIds([]),
      deferrals: { 'EARS-4': { issue: 157, reason: 'needs a live stand' } },
    })
    expect(verdict.findings).toBe(0)
    expect(verdict.deferred.map((d) => d.id)).toEqual(['EARS-4'])
  })

  it('flags a deferral that a test now covers, so the allowlist only shrinks', () => {
    const verdict = evaluateTraceability({
      specIds: specIds([['EARS-4', ['docs/specs/010-x.md']]]),
      testIds: specIds([['EARS-4', ['tests/unit/x.spec.ts']]]),
      deferrals: { 'EARS-4': { issue: 157, reason: 'needs a live stand' } },
    })
    expect(verdict.findings).toBe(1)
    expect(verdict.stale.map((s) => s.id)).toEqual(['EARS-4'])
  })

  it('is clean on the on-touch migration state: no clauses declared anywhere yet', () => {
    const verdict = evaluateTraceability({ specIds: specIds([]), testIds: specIds([]) })
    expect(verdict.findings).toBe(0)
    expect(verdict.empty).toBe(true)
  })
})

describe('ears-test (spawned)', () => {
  it('exits 1 and names the uncovered clause', () => {
    const res = runGuard('ears-test-lint.mjs', caseDir('ears-test', 'uncovered'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('EARS-2')
    expect(res.stderr).toContain('docs/specs/010-thing.md')
  })

  it('exits 1 and names the orphan reference', () => {
    const res = runGuard('ears-test-lint.mjs', caseDir('ears-test', 'orphan'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('EARS-7')
  })

  it('exits 0 when every clause is covered', () => {
    const res = runGuard('ears-test-lint.mjs', caseDir('ears-test', 'covered'))
    expect(res.code).toBe(0)
  })

  it('exits 0 on the real repo tree — the guard must be green at merge', () => {
    const res = runGuard('ears-test-lint.mjs', null, { realTree: true })
    expect(res.code).toBe(0)
  })
})
