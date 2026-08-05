import { describe, expect, it } from 'vitest'

import { checkCoverage } from '../guard-test-coverage-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * guard-test-coverage — the mechanical form of "a guard without a test does not
 * get merged" (issue #136, canon docs/ci-guardrails.md §5). BLOCK from day 0
 * under the canon's §3 class-1 mandate: its only input is the checked-out tree,
 * so it has no false-positive class to soak for.
 *
 * ds-platform keeps this rule as convention plus a hand-maintained coverage
 * list; here it is a guard, and the guard is itself covered by this spec.
 */

describe('checkCoverage', () => {
  it('pairs a guard with the spec whose name mirrors it', () => {
    const res = checkCoverage({
      guards: ['no-stub-lint.mjs', 'tdd-signal-lint.mjs'],
      specs: ['no-stub-lint.spec.ts', 'tdd-signal-lint.spec.ts'],
    })
    expect(res.missing).toEqual([])
    expect(res.orphans).toEqual([])
  })

  it('reports a guard that ships with no spec — the whole point of the guard', () => {
    const res = checkCoverage({
      guards: ['no-stub-lint.mjs', 'brand-new-lint.mjs'],
      specs: ['no-stub-lint.spec.ts'],
    })
    expect(res.missing).toEqual([
      {
        guard: 'tools/lint/brand-new-lint.mjs',
        spec: 'tools/lint/guard-tests/brand-new-lint.spec.ts',
      },
    ])
  })

  it('is extension-agnostic: a .ts guard needs the same spec name', () => {
    const res = checkCoverage({ guards: ['ported-lint.ts'], specs: [] })
    expect(res.missing[0].spec).toBe('tools/lint/guard-tests/ported-lint.spec.ts')
  })

  it('reports an orphaned spec — a deleted guard leaves a spec asserting nothing', () => {
    const res = checkCoverage({ guards: [], specs: ['removed-lint.spec.ts'] })
    expect(res.orphans).toEqual(['tools/lint/guard-tests/removed-lint.spec.ts'])
  })

  it('ignores non-guard files in both dirs — libs, harness and fixtures are not guards', () => {
    const res = checkCoverage({
      guards: ['README.md', 'notes.txt'],
      specs: ['run-guard.ts', 'helpers.ts'],
    })
    expect(res.missing).toEqual([])
    expect(res.orphans).toEqual([])
  })
})

describe('guard-test-coverage (spawned)', () => {
  it('exits 1 and names the missing spec', () => {
    const res = runGuard(
      'guard-test-coverage-lint.mjs',
      caseDir('guard-test-coverage', 'missing-spec'),
    )
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('orphan-lint.spec.ts')
  })

  it('exits 0 on a paired tree', () => {
    const res = runGuard('guard-test-coverage-lint.mjs', caseDir('guard-test-coverage', 'paired'))
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('1 guard')
  })

  it('exits 0 against the REAL repo tree — this repo satisfies its own rule', () => {
    const res = runGuard('guard-test-coverage-lint.mjs', null)
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
  })
})
