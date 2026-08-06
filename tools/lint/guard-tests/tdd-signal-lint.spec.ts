import { describe, expect, it } from 'vitest'

import { classifyChanges, findUntested, isTestSource, needlesFor } from '../tdd-signal-lint.mjs'
import { caseDir, ghDir, runGuard } from './run-guard'

/**
 * tdd-signal — a PR that changes production code and ships no test, in a module
 * nothing tests either (canon docs/ci-guardrails.md §5, WARN since 2026-08-05).
 *
 * task-cycle stage 3 makes TDD a hard rule for platform-module code; this is the
 * signal that the rule was skipped, visible to the reviewer at review time.
 * Adapted from ds-platform: tests here live in a central `tests/` tree (plus
 * `tools/lint/guard-tests/`), not colocated, so "the module is already tested"
 * is decided by looking for the changed file's import path inside test sources,
 * not by globbing a sibling directory.
 */

describe('classifyChanges', () => {
  it('separates production source from tests and from exempt files', () => {
    const res = classifyChanges([
      'src/lib/okr/rollup.ts',
      'tools/gh/pr-land.mjs',
      'tests/unit/okr-rollup.spec.ts',
      'src/payload-types.ts',
      'src/migrations/20260101_init.ts',
      'docs/ci-guardrails.md',
      'next.config.ts',
    ])
    expect(res.prod).toEqual(['src/lib/okr/rollup.ts', 'tools/gh/pr-land.mjs'])
    expect(res.tests).toEqual(['tests/unit/okr-rollup.spec.ts'])
  })

  it('counts a guard spec as a test — guards are production tooling with tests', () => {
    const res = classifyChanges([
      'tools/lint/no-stub-lint.mjs',
      'tools/lint/guard-tests/no-stub-lint.spec.ts',
    ])
    expect(res.prod).toEqual(['tools/lint/no-stub-lint.mjs'])
    expect(res.tests).toEqual(['tools/lint/guard-tests/no-stub-lint.spec.ts'])
  })

  it('treats a fixture as neither production nor test — it is input under test', () => {
    const res = classifyChanges([
      'tools/lint/guard-tests/fixtures/tdd-signal/tested/tests/unit/leads-intake.spec.ts',
      'tools/lint/guard-tests/fixtures/no-stub/dirty/src/lib/config.ts',
    ])
    expect(res.prod).toEqual([])
    expect(res.tests).toEqual([])
  })
})

describe('isTestSource — the guard must not read its own fixtures as coverage', () => {
  it('counts real test sources', () => {
    expect(isTestSource('tests/unit/okr-rollup.spec.ts')).toBe(true)
    expect(isTestSource('tools/lint/guard-tests/no-stub-lint.spec.ts')).toBe(true)
  })

  it('does NOT count a fixture, even one shaped exactly like a spec', () => {
    expect(
      isTestSource('tools/lint/guard-tests/fixtures/tdd-signal/tested/tests/unit/x.spec.ts'),
    ).toBe(false)
  })
})

describe('needlesFor', () => {
  it('matches both the relative import and the @/ alias form', () => {
    expect(needlesFor('src/lib/okr/rollup.ts')).toEqual(['src/lib/okr/rollup', 'lib/okr/rollup'])
    expect(needlesFor('tools/gh/pr-land.mjs')).toEqual(['tools/gh/pr-land'])
  })
})

describe('findUntested', () => {
  const tests = [
    {
      path: 'tests/unit/okr-rollup.spec.ts',
      text: "import { roll } from '../../src/lib/okr/rollup'",
    },
    { path: 'tests/unit/hours-format.spec.ts', text: "import { fmt } from '@/lib/hours/format'" },
  ]

  it('is silent when the changeset itself ships a test', () => {
    expect(findUntested(['src/lib/okr/rollup.ts'], tests, true)).toEqual([])
  })

  it('accepts a change to a module an existing test already imports', () => {
    expect(findUntested(['src/lib/okr/rollup.ts'], tests, false)).toEqual([])
  })

  it('resolves the @/ alias form too', () => {
    expect(findUntested(['src/lib/hours/format.ts'], tests, false)).toEqual([])
  })

  it('flags a change no test in the tree reaches', () => {
    expect(findUntested(['src/lib/leads/intake.ts'], tests, false)).toEqual([
      'src/lib/leads/intake.ts',
    ])
  })
})

describe('tdd-signal (spawned)', () => {
  const env = (n: string) => ({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '7',
    LINT_GH_FIXTURE_DIR: ghDir('tdd-signal', n),
  })

  it('exits 1 naming the untested production file', () => {
    const res = runGuard('tdd-signal-lint.mjs', caseDir('tdd-signal', 'untested'), {
      env: env('untested'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/lib/leads/intake.ts')
  })

  it('exits 0 when the diff carries a test', () => {
    const res = runGuard('tdd-signal-lint.mjs', caseDir('tdd-signal', 'tested'), {
      env: env('tested'),
    })
    expect(res.code).toBe(0)
  })

  it('exits 0 outside a pull_request event — nothing to check, said out loud', () => {
    const res = runGuard('tdd-signal-lint.mjs', caseDir('tdd-signal', 'untested'))
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('not a pull_request event')
  })

  // REGRESSION (review of PR #154, blocker 2): the fixture tree below contains a
  // spec-shaped file under guard-tests/fixtures/ that imports the changed module.
  // Counting it as coverage let a genuinely untested module pass, and measured the
  // §4 promotion clock on evidence the guard's own fixtures manufactured.
  it('exits 1 even when a FIXTURE references the changed module', () => {
    const res = runGuard('tdd-signal-lint.mjs', caseDir('tdd-signal', 'fixture-only'), {
      env: env('fixture-only'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/lib/leads/intake.ts')
  })

  it('exits 1 when the PR metadata cannot be read — fail closed', () => {
    const res = runGuard('tdd-signal-lint.mjs', caseDir('tdd-signal', 'untested'), {
      env: { ...env('untested'), PR_NUMBER: '404' },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('could not fetch')
  })
})
