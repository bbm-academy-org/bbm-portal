import { describe, expect, it } from 'vitest'

import {
  addedLines,
  findOrderViolations,
  isMergeCommit,
  isPlatformModule,
  normaliseCommit,
} from '../tdd-order-lint.mjs'
import { caseDir, ghDir, runGuard } from './run-guard'

/**
 * tdd-order — the ORDER half of the TDD contract (#355, canon
 * docs/ci-guardrails.md §5, BLOCK from day 0 under the §3 class-1 mandate).
 *
 * `test-presence` (the guard formerly called `tdd-signal`) answers «is there a
 * test at all?» — a question PR #354 answered YES while its implementation was
 * written first and its specs after, with no RED run per spec file. That is the
 * violation class this guard owns: for a NEW platform-module file, the PR's own
 * commit sequence must introduce a test referencing that module in a STRICTLY
 * EARLIER commit than the one introducing the implementation.
 *
 * The commit graph is a fact, not a heuristic — which is why the guard blocks
 * from day 0 rather than soaking (§3 class 1, the `design-fidelity` precedent).
 */

describe('isPlatformModule', () => {
  it('scopes to the platform-module paths', () => {
    expect(isPlatformModule('src/lib/leads/intake.ts')).toBe(true)
    expect(isPlatformModule('src/app/(platform)/p/finance/page.tsx')).toBe(true)
  })

  it('leaves everything outside those paths alone', () => {
    expect(isPlatformModule('tools/lint/tdd-order-lint.mjs')).toBe(false)
    expect(isPlatformModule('src/app/(payload)/admin/page.tsx')).toBe(false)
    expect(isPlatformModule('src/collections/Leads.ts')).toBe(false)
    expect(isPlatformModule('docs/specs/355-guard.md')).toBe(false)
  })

  it('is not armed by a test source, a fixture, or an exempt file', () => {
    expect(isPlatformModule('src/lib/leads/intake.spec.ts')).toBe(false)
    expect(isPlatformModule('tools/lint/guard-tests/fixtures/x/src/lib/a.ts')).toBe(false)
    expect(isPlatformModule('src/lib/platform/db/types.d.ts')).toBe(false)
  })
})

describe('addedLines', () => {
  it('reads only the ADDED side of a patch', () => {
    const patch = [
      '@@ -0,0 +1,3 @@',
      "+import { intake } from '@/lib/leads/intake'",
      "-import { gone } from '@/lib/leads/old'",
      ' unchanged',
    ].join('\n')
    expect(addedLines(patch)).toEqual(["import { intake } from '@/lib/leads/intake'"])
  })

  it('never mistakes the `+++` file header for content', () => {
    expect(addedLines('+++ b/tests/unit/x.spec.ts\n+real line')).toEqual(['real line'])
  })

  it('survives a commit file with no patch at all (binary, too large)', () => {
    expect(addedLines(undefined)).toEqual([])
  })
})

describe('normaliseCommit', () => {
  it('maps the GitHub commit shape onto the guard shape, parents included', () => {
    expect(
      normaliseCommit({
        sha: 'aaa1',
        parents: [{ sha: 'p0' }],
        files: [{ filename: 'src/lib/a.ts', status: 'added', patch: '+x' }],
      }),
    ).toEqual({
      sha: 'aaa1',
      parentCount: 1,
      files: [{ path: 'src/lib/a.ts', status: 'added', patch: '+x' }],
    })
  })

  it('carries the parent COUNT, because that is what tells a merge from a commit', () => {
    expect(normaliseCommit({ sha: 'm1', parents: [{ sha: 'a' }, { sha: 'b' }] }).parentCount).toBe(2)
    // A root commit, and a payload that omits `parents` entirely.
    expect(normaliseCommit({ sha: 'r0', parents: [] }).parentCount).toBe(0)
    expect(normaliseCommit({ sha: 'x0' }).parentCount).toBe(0)
  })
})

describe('isMergeCommit', () => {
  it('is true for a commit with more than one parent', () => {
    expect(isMergeCommit({ parentCount: 2 })).toBe(true)
  })

  it('is false for an ordinary commit and for a root commit', () => {
    expect(isMergeCommit({ parentCount: 1 })).toBe(false)
    expect(isMergeCommit({ parentCount: 0 })).toBe(false)
  })
})

describe('findOrderViolations', () => {
  const impl = (status = 'added') => ({
    path: 'src/lib/leads/intake.ts',
    status,
    patch: '+export function intake() {}',
  })
  const test = () => ({
    path: 'tests/unit/leads-intake.spec.ts',
    status: 'added',
    patch: "+import { intake } from '@/lib/leads/intake'",
  })

  it('is silent when the test lands in an EARLIER commit — the whole point', () => {
    expect(
      findOrderViolations([
        { sha: 'aaa1', files: [test()] },
        { sha: 'bbb2', files: [impl()] },
      ]),
    ).toEqual([])
  })

  it('flags a single commit carrying test and implementation together (the #354 shape)', () => {
    const res = findOrderViolations([{ sha: 'aaa1', files: [test(), impl()] }])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      path: 'src/lib/leads/intake.ts',
      kind: 'same-commit',
      implSha: 'aaa1',
      testSha: 'aaa1',
    })
  })

  it('flags implementation first, test after', () => {
    const res = findOrderViolations([
      { sha: 'aaa1', files: [impl()] },
      { sha: 'bbb2', files: [test()] },
    ])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ kind: 'impl-first', implSha: 'aaa1', testSha: 'bbb2' })
  })

  it('leaves a module with NO test anywhere in the PR to test-presence — not a second finding', () => {
    expect(findOrderViolations([{ sha: 'aaa1', files: [impl()] }])).toEqual([])
  })

  it('resolves the relative import form as well as the @/ alias', () => {
    const relativeTest = {
      path: 'tests/unit/leads-intake.spec.ts',
      status: 'added',
      patch: "+import { intake } from '../../src/lib/leads/intake'",
    }
    expect(
      findOrderViolations([
        { sha: 'aaa1', files: [relativeTest] },
        { sha: 'bbb2', files: [impl()] },
      ]),
    ).toEqual([])
  })

  it('does not treat a git RENAME of a tracked file as a new module', () => {
    expect(
      findOrderViolations([{ sha: 'aaa1', files: [{ ...impl('renamed'), patch: '' }] }]),
    ).toEqual([])
  })

  it('does not treat a MODIFIED existing file as a new module (v1 blind spot)', () => {
    expect(findOrderViolations([{ sha: 'aaa1', files: [impl('modified')] }])).toEqual([])
  })

  it('judges newness by the EARLIEST commit that touched the path', () => {
    // Added in commit 1, touched again in commit 2 — still one new module, and the
    // test in commit 3 does not rescue it.
    const res = findOrderViolations([
      { sha: 'aaa1', files: [impl()] },
      { sha: 'bbb2', files: [impl('modified')] },
      { sha: 'ccc3', files: [test()] },
    ])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ implSha: 'aaa1', testSha: 'ccc3', kind: 'impl-first' })
  })

  it('does not read a test that references a DIFFERENT module as coverage', () => {
    const otherTest = {
      path: 'tests/unit/hours-format.spec.ts',
      status: 'added',
      patch: "+import { fmt } from '@/lib/hours/format'",
    }
    const res = findOrderViolations([
      { sha: 'aaa1', files: [otherTest] },
      { sha: 'bbb2', files: [impl()] },
    ])
    expect(res).toEqual([])
    // No test cites leads/intake at all -> test-presence's jurisdiction, silent here.
  })

  // REGRESSION (review of PR #394, blocker 2.1): `repos/{owner}/{repo}/commits/{sha}`
  // reports a MERGE commit's files as the diff against its FIRST PARENT. A branch
  // that merges `origin/main` in rather than rebasing therefore sees every platform
  // module main landed since the branch point as `status: "added"` inside that merge —
  // code this PR never wrote. Blocking a PR for someone else's module is a false BLOCK,
  // and under canon §4 the first one demotes the guard.
  it('ignores a MERGE commit — its file list is a first-parent diff, not this PR authoring code', () => {
    const merged = {
      path: 'src/lib/other/landed-on-main.ts',
      status: 'added',
      patch: '+export const landedElsewhere = true',
    }
    const citingTest = {
      path: 'tests/unit/other-landed.spec.ts',
      status: 'added',
      patch: "+import { landedElsewhere } from '@/lib/other/landed-on-main'",
    }
    expect(
      findOrderViolations([
        { sha: 'mmm0', parentCount: 2, files: [merged] },
        { sha: 'bbb2', parentCount: 1, files: [citingTest] },
      ]),
    ).toEqual([])
  })

  it('still flags a real violation that sits AFTER a merge commit in the sequence', () => {
    const res = findOrderViolations([
      { sha: 'mmm0', parentCount: 2, files: [{ path: 'src/lib/x/from-main.ts', status: 'added' }] },
      { sha: 'bbb2', parentCount: 1, files: [test(), impl()] },
    ])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ path: 'src/lib/leads/intake.ts', kind: 'same-commit' })
  })

  it('does not let a test that exists ONLY inside a merge commit rescue the order', () => {
    const res = findOrderViolations([
      { sha: 'mmm0', parentCount: 2, files: [test()] },
      { sha: 'bbb2', parentCount: 1, files: [impl()] },
    ])
    // The merge contributes nothing in either direction, so nothing cites the module
    // and this is test-presence's question again — silent, not a finding.
    expect(res).toEqual([])
  })

  it('counts a guard spec as a test source too', () => {
    expect(
      findOrderViolations([
        {
          sha: 'aaa1',
          files: [
            {
              path: 'tools/lint/guard-tests/x-lint.spec.ts',
              status: 'added',
              patch: "+from '@/lib/leads/intake'",
            },
          ],
        },
        { sha: 'bbb2', files: [impl()] },
      ]),
    ).toEqual([])
  })
})

describe('tdd-order (spawned)', () => {
  const env = (n: string) => ({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '7',
    LINT_GH_FIXTURE_DIR: ghDir('tdd-order', n),
  })

  it('exits 0 when the test commit precedes the implementation commit', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'test-first'), {
      env: env('test-first'),
    })
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('PASS')
  })

  it('exits 1 naming the module introduced together with its test', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'same-commit'), {
      env: env('same-commit'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/lib/leads/intake.ts')
    expect(res.stderr).toContain('same commit')
  })

  it('exits 1 when the implementation commit came first', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'impl-first'), {
      env: env('impl-first'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/lib/leads/intake.ts')
  })

  it('exits 0 when nothing tests the module — that is test-presence, not a duplicate', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'no-test'), {
      env: env('no-test'),
    })
    expect(res.code).toBe(0)
  })

  it('exits 0 outside a pull_request event — nothing to check, said out loud', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'test-first'))
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('not a pull_request event')
  })

  // REGRESSION (review of PR #394, blocker 2.1) at the CLI level: the fixture is a
  // branch that merged `origin/main` in, and the merge's first-parent diff carries a
  // module main landed. Before the fix this exited 1 against code the PR never wrote.
  it('exits 0 on a branch that merged main in — a merge introduces nothing', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'merged-main'), {
      env: env('merged-main'),
    })
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('PASS')
  })

  it('exits 1 when the PR commit list cannot be read — fail closed', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'test-first'), {
      env: { ...env('test-first'), PR_NUMBER: '404' },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('could not fetch')
  })

  it('exits 1 when one commit of the list cannot be read — fail closed, not a silent pass', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'broken-commit'), {
      env: env('broken-commit'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('could not fetch')
  })
})
