import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { classifyChanges, findUntested, isTestSource, needlesFor } from '../test-presence-lint.mjs'
import { caseDir, ghDir, runGuard } from './run-guard'

/**
 * test-presence — a PR that changes production code and ships no test, in a
 * module nothing tests either (canon docs/ci-guardrails.md §5, WARN since
 * 2026-08-05; renamed from `tdd-signal` on 2026-08-27 by #355, rule unchanged).
 *
 * The name is the point of the rename: this guard checks that a test EXISTS, not
 * that one was written first. The order question belongs to `tdd-order-lint.mjs`
 * and its spec next door — see this guard's header for the #354 incident that
 * separated them.
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
      'tools/lint/guard-tests/fixtures/test-presence/tested/tests/unit/leads-intake.spec.ts',
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
      isTestSource('tools/lint/guard-tests/fixtures/test-presence/tested/tests/unit/x.spec.ts'),
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

describe('test-presence (spawned)', () => {
  const env = (n: string) => ({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '7',
    LINT_GH_FIXTURE_DIR: ghDir('test-presence', n),
  })

  it('exits 1 naming the untested production file', () => {
    const res = runGuard('test-presence-lint.mjs', caseDir('test-presence', 'untested'), {
      env: env('untested'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/lib/leads/intake.ts')
  })

  it('exits 0 when the diff carries a test', () => {
    const res = runGuard('test-presence-lint.mjs', caseDir('test-presence', 'tested'), {
      env: env('tested'),
    })
    expect(res.code).toBe(0)
  })

  it('exits 0 outside a pull_request event — nothing to check, said out loud', () => {
    const res = runGuard('test-presence-lint.mjs', caseDir('test-presence', 'untested'))
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('not a pull_request event')
  })

  // REGRESSION (review of PR #154, blocker 2): the fixture tree below contains a
  // spec-shaped file under guard-tests/fixtures/ that imports the changed module.
  // Counting it as coverage let a genuinely untested module pass, and measured the
  // §4 promotion clock on evidence the guard's own fixtures manufactured.
  it('exits 1 even when a FIXTURE references the changed module', () => {
    const res = runGuard('test-presence-lint.mjs', caseDir('test-presence', 'fixture-only'), {
      env: env('fixture-only'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/lib/leads/intake.ts')
  })

  it('exits 1 when the PR metadata cannot be read — fail closed', () => {
    const res = runGuard('test-presence-lint.mjs', caseDir('test-presence', 'untested'), {
      env: { ...env('untested'), PR_NUMBER: '404' },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('could not fetch')
  })
})

describe('test-presence: the changed-file list is PAGED (canon §8)', () => {
  /**
   * RED before the paging fix: `gh pr view --json files` stops at 100 entries,
   * so a PR whose only production file is the 101st read as «changes no
   * production source» and exited 0 — a BLOCK guard going green on a diff it
   * never saw. The fixture models both surfaces: the truncated view AND the
   * paged endpoint, so the guard is judged on which one it reads.
   */
  function pagedFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'test-presence-paged-'))
    const gh = join(dir, 'gh')
    const root = join(dir, 'root')
    mkdirSync(gh, { recursive: true })
    mkdirSync(join(root, 'src', 'lib', 'paged'), { recursive: true })
    mkdirSync(join(root, 'tests', 'unit'), { recursive: true })
    writeFileSync(join(root, 'src', 'lib', 'paged', 'thing.ts'), 'export const thing = 1')
    writeFileSync(join(root, 'tests', 'unit', 'other.spec.ts'), "import '@/lib/hours/format'")

    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      filename: `docs/notes/note-${i}.md`,
      additions: 1,
      deletions: 0,
      status: 'modified',
    }))
    // What `gh pr view --json files` would return: page 1 only, silently.
    writeFileSync(
      join(gh, 'pr-view-7.json'),
      JSON.stringify({ number: 7, files: firstPage.map((f) => ({ path: f.filename })) }),
    )
    writeFileSync(join(gh, 'pr-files-7.json'), JSON.stringify(firstPage))
    writeFileSync(
      join(gh, 'pr-files-7-page2.json'),
      JSON.stringify([
        { filename: 'src/lib/paged/thing.ts', additions: 12, deletions: 0, status: 'modified' },
      ]),
    )
    return { gh, root }
  }

  it('flags an untested production file that falls on the SECOND page', () => {
    const { gh, root } = pagedFixture()
    const res = runGuard('test-presence-lint.mjs', root, {
      env: { GITHUB_EVENT_NAME: 'pull_request', PR_NUMBER: '7', LINT_GH_FIXTURE_DIR: gh },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/lib/paged/thing.ts')
  })
})
