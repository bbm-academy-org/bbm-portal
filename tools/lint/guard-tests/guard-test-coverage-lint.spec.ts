import { describe, expect, it } from 'vitest'

import { checkCoverage, findStrays } from '../guard-test-coverage-lint.mjs'
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
      guards: ['no-stub-lint.mjs', 'test-presence-lint.mjs'],
      specs: ['no-stub-lint.spec.ts', 'test-presence-lint.spec.ts'],
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

  /**
   * Review of PR #154, finding 1: the pairing was keyed on TOP-LEVEL entries
   * matching `-lint.*`, so a guard evaded the BLOCK by living in a subdir or by
   * dropping the suffix — and `workflow-auth` derives its gh-consumer set with
   * the same shape, so one misplaced file was invisible to both meta-guards at
   * once. "Mechanical, not conventional" (canon §7) has to include the naming
   * convention itself, so the layout is now enforced rather than assumed.
   */
  it('flags a guard hiding in a subdirectory', () => {
    const res = checkCoverage({
      guards: ['no-stub-lint.mjs'],
      specs: ['no-stub-lint.spec.ts'],
      strays: [{ path: 'tools/lint/pr/foo-lint.mjs', reason: 'nested' }],
    })
    expect(res.strays).toEqual([{ path: 'tools/lint/pr/foo-lint.mjs', reason: 'nested' }])
  })

  it('flags a guard-shaped file that dropped the -lint suffix', () => {
    const res = checkCoverage({
      guards: ['no-stub-lint.mjs'],
      specs: ['no-stub-lint.spec.ts'],
      strays: [{ path: 'tools/lint/foo.mjs', reason: 'unsuffixed' }],
    })
    expect(res.strays).toHaveLength(1)
  })
})

describe('findStrays — a guard is anything importing lib/guard.mjs', () => {
  it('accepts the sanctioned flat layout and the shared libs', () => {
    expect(
      findStrays([
        { rel: 'tools/lint/no-stub-lint.mjs', text: "import { reporter } from './lib/guard.mjs'" },
        { rel: 'tools/lint/lib/guard.mjs', text: 'export function reporter() {}' },
        { rel: 'tools/lint/guard-tests/run-guard.ts', text: 'export function runGuard() {}' },
      ]),
    ).toEqual([])
  })

  it('reports a nested guard and an unsuffixed one', () => {
    expect(
      findStrays([
        { rel: 'tools/lint/pr/foo-lint.mjs', text: "import { reporter } from '../lib/guard.mjs'" },
        { rel: 'tools/lint/foo.mjs', text: "import { reporter } from './lib/guard.mjs'" },
      ]),
    ).toEqual([
      { path: 'tools/lint/pr/foo-lint.mjs', reason: 'nested' },
      { path: 'tools/lint/foo.mjs', reason: 'unsuffixed' },
    ])
  })

  it('does not mistake a spec that merely NAMES the lib path for a guard', () => {
    expect(
      findStrays([
        {
          rel: 'tools/lint/guard-tests/guard-test-coverage-lint.spec.ts',
          text: "const files = [{ rel: 'tools/lint/lib/guard.mjs', text: 'x' }]",
        },
      ]),
    ).toEqual([])
  })

  it('never reports a fixture — fixtures are input under test', () => {
    expect(
      findStrays([
        {
          rel: 'tools/lint/guard-tests/fixtures/x/tools/lint/deep/foo-lint.mjs',
          text: "import './lib/guard.mjs'",
        },
      ]),
    ).toEqual([])
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
