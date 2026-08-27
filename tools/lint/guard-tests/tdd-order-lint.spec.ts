import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  addedLines,
  barrelsFor,
  citesAtBoundary,
  evaluateStaged,
  findOrderViolations,
  hitsFileCap,
  isMergeCommit,
  isPlatformModule,
  MAX_FILE_PAGES,
  normaliseCommit,
  reexportEdges,
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
    expect(normaliseCommit({ sha: 'm1', parents: [{ sha: 'a' }, { sha: 'b' }] }).parentCount).toBe(
      2,
    )
    // A root commit, and a payload that omits `parents` entirely.
    expect(normaliseCommit({ sha: 'r0', parents: [] }).parentCount).toBe(0)
    expect(normaliseCommit({ sha: 'x0' }).parentCount).toBe(0)
  })
})

/**
 * REGRESSION (review of PR #394, blocker 2.2). `repos/{owner}/{repo}/commits/{sha}`
 * caps `files` at 300 HOWEVER you page it. A dropped test file loses its citation,
 * and if a later commit cites the module the verdict flips to a false `impl-first`
 * BLOCK. docs/ci-guardrails.md §8 already states the standing rule — "a guard
 * promoted to BLOCK on this input must page the API first" — so the guard pages,
 * and where paging cannot help (the hard cap) it must fail CLOSED rather than judge
 * order on a list it knows is incomplete.
 */
describe('hitsFileCap', () => {
  it('is false while pages are still available', () => {
    expect(hitsFileCap(1, 100, 100)).toBe(false)
    expect(hitsFileCap(2, 100, 100)).toBe(false)
  })

  it('is false when the last page came back SHORT — the list is complete', () => {
    expect(hitsFileCap(MAX_FILE_PAGES, 99, 100)).toBe(false)
    expect(hitsFileCap(1, 0, 100)).toBe(false)
  })

  it('is true when the FINAL allowed page is still full — the API cap was hit', () => {
    expect(hitsFileCap(MAX_FILE_PAGES, 100, 100)).toBe(true)
  })

  it('caps at the endpoint 300-file ceiling', () => {
    expect(MAX_FILE_PAGES * 100).toBe(300)
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

/**
 * REGRESSION (#398) in `tools/lint/tdd-order-lint.mjs` — the first confirmed
 * false positive of the CI plane's soak (PR #396, 2026-08-27). The tests-only commit cited the new module
 * `src/lib/finance/intake/sources.ts` through its PUBLIC BARREL `@/lib/finance`
 * — which is what ADR-002 module isolation prescribes for a test of the public
 * API — while `needlesFor` only ever matched the literal path. The guard saw no
 * citation until a later commit switched the import to the literal path, and the
 * verdict flipped to `impl-first` on a PR whose TDD order was genuinely honest.
 *
 * The fix reads the PR's OWN patches for the re-export edges: a module that is
 * NEW in this PR can only become reachable through a barrel if some commit of
 * this PR adds the re-export line, so the evidence never needs a tree read or a
 * second API call.
 */
describe('reexportEdges', () => {
  const barrelCommit = (patch: string) => [
    { sha: 'aaa1', files: [{ path: 'src/lib/finance/index.ts', status: 'modified', patch }] },
  ]

  it('reads a NAMED re-export line and maps the target back to its barrel', () => {
    const edges = reexportEdges(barrelCommit("+export { listSources } from './intake/sources'"))
    expect([...(edges.get('src/lib/finance/intake/sources') ?? [])]).toEqual(['src/lib/finance'])
  })

  it('reads a star re-export and a type-only re-export too', () => {
    const edges = reexportEdges(
      barrelCommit(
        "+export * from './intake/sources'\n+export type { Source } from './core/money'",
      ),
    )
    expect(edges.has('src/lib/finance/intake/sources')).toBe(true)
    expect(edges.has('src/lib/finance/core/money')).toBe(true)
  })

  it('normalises an explicit extension and a parent-relative specifier', () => {
    const edges = reexportEdges([
      {
        sha: 'aaa1',
        files: [
          {
            path: 'src/lib/finance/intake/index.ts',
            status: 'added',
            patch: "+export * from './sources.js'\n+export * from '../core/money'",
          },
        ],
      },
    ])
    expect([...(edges.get('src/lib/finance/intake/sources') ?? [])]).toEqual([
      'src/lib/finance/intake',
    ])
    expect([...(edges.get('src/lib/finance/core/money') ?? [])]).toEqual(['src/lib/finance/intake'])
  })

  it('reads only INDEX files — an ordinary module re-exporting something is not a barrel', () => {
    const edges = reexportEdges([
      {
        sha: 'aaa1',
        files: [
          {
            path: 'src/lib/finance/operations.ts',
            status: 'modified',
            patch: "+export { listSources } from './intake/sources'",
          },
        ],
      },
    ])
    expect(edges.size).toBe(0)
  })

  it('ignores a plain IMPORT and a bare-specifier re-export', () => {
    const edges = reexportEdges(
      barrelCommit("+import { x } from './intake/sources'\n+export { y } from 'drizzle-orm'"),
    )
    expect(edges.size).toBe(0)
  })

  it('never reads a merge commit — same rule as everywhere else in this guard', () => {
    const edges = reexportEdges([
      {
        sha: 'mmm0',
        parentCount: 2,
        files: [
          {
            path: 'src/lib/finance/index.ts',
            status: 'modified',
            patch: "+export * from './intake/sources'",
          },
        ],
      },
    ])
    expect(edges.size).toBe(0)
  })
})

/**
 * The false-PASS half of the #398 fix. Review of PR #400 [MINOR]: the doc comment
 * claimed «only a citation of the barrel ITSELF counts» while only the RIGHT
 * boundary was tested, so `@/xlib/finance` matched the needle `lib/finance`. The
 * code moved rather than the claim — both sides are checked now, and they are
 * NOT the same class: `/` continues a path to the right but is exactly what
 * precedes the needle in the `@/lib/finance` form the matcher must accept.
 */
describe('citesAtBoundary', () => {
  const N = 'lib/finance'

  it('accepts the citation forms a test actually writes', () => {
    expect(citesAtBoundary("import { x } from '@/lib/finance'", N)).toBe(true)
    expect(citesAtBoundary("import { x } from '../../src/lib/finance'", N)).toBe(true)
    expect(citesAtBoundary('lib/finance', N)).toBe(true)
  })

  it('rejects a DEEPER path — the needle was only a prefix', () => {
    expect(citesAtBoundary("import { x } from '@/lib/finance/core/money'", N)).toBe(false)
    expect(citesAtBoundary("import { x } from '@/lib/finance-legacy'", N)).toBe(false)
  })

  it('rejects a LONGER segment to the LEFT — the needle was only a suffix', () => {
    expect(citesAtBoundary("import { x } from '@/xlib/finance'", N)).toBe(false)
    expect(citesAtBoundary("import { x } from '@/my-lib/finance'", N)).toBe(false)
  })

  it('still finds the citation when an earlier occurrence on the line is not one', () => {
    expect(citesAtBoundary("// see @/xlib/finance, use '@/lib/finance'", N)).toBe(true)
  })
})

describe('barrelsFor', () => {
  const edgesOf = (files: { path: string; status: string; patch: string }[]) =>
    reexportEdges([{ sha: 'aaa1', files }])

  it('resolves the direct barrel of a module', () => {
    const edges = edgesOf([
      {
        path: 'src/lib/finance/index.ts',
        status: 'modified',
        patch: "+export { listSources } from './intake/sources'",
      },
    ])
    expect(barrelsFor('src/lib/finance/intake/sources.ts', edges)).toEqual(['src/lib/finance'])
  })

  it('walks a CHAIN of barrels when this PR adds both hops', () => {
    const edges = edgesOf([
      { path: 'src/lib/finance/index.ts', status: 'modified', patch: "+export * from './intake'" },
      {
        path: 'src/lib/finance/intake/index.ts',
        status: 'added',
        patch: "+export * from './sources'",
      },
    ])
    expect(barrelsFor('src/lib/finance/intake/sources.ts', edges).sort()).toEqual([
      'src/lib/finance',
      'src/lib/finance/intake',
    ])
  })

  it('terminates on a cyclic re-export rather than spinning', () => {
    const edges = edgesOf([
      { path: 'src/lib/a/index.ts', status: 'added', patch: "+export * from '../b'" },
      {
        path: 'src/lib/b/index.ts',
        status: 'added',
        patch: "+export * from '../a'\n+export * from './thing'",
      },
    ])
    expect(barrelsFor('src/lib/b/thing.ts', edges).sort()).toEqual(['src/lib/a', 'src/lib/b'])
  })

  it('returns nothing for a module no barrel in this PR re-exports', () => {
    expect(barrelsFor('src/lib/finance/intake/sources.ts', new Map())).toEqual([])
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

  // REGRESSION (#398) — the PR #396 shape, end to end in the decision seam: a
  // tests-only commit citing the module through the barrel, then the module plus
  // the barrel's re-export line, then a later commit switching the import to the
  // literal path. Honest TDD order; the guard used to call it `impl-first`.
  it('accepts a BARREL citation for the module that barrel re-exports (#396 shape)', () => {
    const barrelTest = {
      path: 'tests/unit/finance-intake-sources.spec.ts',
      status: 'added',
      patch: "+import { listSources } from '@/lib/finance'",
    }
    const newModule = {
      path: 'src/lib/finance/intake/sources.ts',
      status: 'added',
      patch: '+export const listSources = () => []',
    }
    const barrel = {
      path: 'src/lib/finance/index.ts',
      status: 'modified',
      patch: "+export { listSources } from './intake/sources'",
    }
    const literalLater = {
      path: 'tests/unit/finance-intake-sources.spec.ts',
      status: 'modified',
      patch: "+import { listSources } from '@/lib/finance/intake/sources'",
    }
    expect(
      findOrderViolations([
        { sha: 'aaa1', files: [barrelTest] },
        { sha: 'bbb2', files: [newModule, barrel] },
        { sha: 'ccc3', files: [literalLater] },
      ]),
    ).toEqual([])
  })

  // The other half of the tension: a barrel citation must NOT blanket-satisfy
  // TDD for every module behind that barrel. Only the modules that barrel
  // actually re-exports are covered.
  it('does not let a barrel citation cover a module that barrel does not re-export', () => {
    const barrelTest = {
      path: 'tests/unit/finance-money.spec.ts',
      status: 'added',
      patch: "+import { convert } from '@/lib/finance'",
    }
    const uncovered = {
      path: 'src/lib/finance/intake/sources.ts',
      status: 'added',
      patch: '+export const listSources = () => []',
    }
    const barrel = {
      path: 'src/lib/finance/index.ts',
      status: 'modified',
      patch: "+export { convert } from './core/money'",
    }
    // Nothing cites sources.ts -> test-presence's question, silent here. The
    // point is that the barrel citation does not rescue it either.
    expect(findOrderViolations([{ sha: 'aaa1', files: [barrelTest, uncovered, barrel] }])).toEqual(
      [],
    )
  })

  it('still flags impl-first when the barrel citation lands AFTER the module', () => {
    const res = findOrderViolations([
      {
        sha: 'aaa1',
        files: [
          {
            path: 'src/lib/finance/intake/sources.ts',
            status: 'added',
            patch: '+export const listSources = () => []',
          },
          {
            path: 'src/lib/finance/index.ts',
            status: 'modified',
            patch: "+export { listSources } from './intake/sources'",
          },
        ],
      },
      {
        sha: 'bbb2',
        files: [
          {
            path: 'tests/unit/finance-intake-sources.spec.ts',
            status: 'added',
            patch: "+import { listSources } from '@/lib/finance'",
          },
        ],
      },
    ])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ path: 'src/lib/finance/intake/sources.ts', kind: 'impl-first' })
  })

  it('still flags same-commit when the barrel-citing test rides along', () => {
    const res = findOrderViolations([
      {
        sha: 'aaa1',
        files: [
          {
            path: 'src/lib/finance/intake/sources.ts',
            status: 'added',
            patch: '+export const listSources = () => []',
          },
          {
            path: 'src/lib/finance/index.ts',
            status: 'modified',
            patch: "+export { listSources } from './intake/sources'",
          },
          {
            path: 'tests/unit/finance-intake-sources.spec.ts',
            status: 'added',
            patch: "+import { listSources } from '@/lib/finance'",
          },
        ],
      },
    ])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ kind: 'same-commit' })
  })

  it('does not read a DEEPER sibling import as a citation of the barrel', () => {
    // `@/lib/finance/core/money` contains the barrel needle `lib/finance` as a
    // substring; boundary matching is what keeps it from covering sources.ts.
    const res = findOrderViolations([
      {
        sha: 'aaa1',
        files: [
          {
            path: 'tests/unit/finance-money.spec.ts',
            status: 'added',
            patch: "+import { convert } from '@/lib/finance/core/money'",
          },
        ],
      },
      {
        sha: 'bbb2',
        files: [
          {
            path: 'src/lib/finance/intake/sources.ts',
            status: 'added',
            patch: '+export const listSources = () => []',
          },
          {
            path: 'src/lib/finance/index.ts',
            status: 'modified',
            patch: "+export { listSources } from './intake/sources'",
          },
        ],
      },
    ])
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

  // REGRESSION (review of PR #394, blocker 2.2), CLI level. The page-size seam puts
  // the cap at MAX_FILE_PAGES x 2 files so a fixture can reach it without 300 entries.
  it('pages the commit file list — the implementation on page 2 is still seen', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'paged'), {
      env: { ...env('paged'), LINT_TDD_ORDER_PAGE_SIZE: '2' },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/lib/leads/intake.ts')
  })

  it('fails CLOSED when the file list is truncated — never judges order on a partial list', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'truncated'), {
      env: { ...env('truncated'), LINT_TDD_ORDER_PAGE_SIZE: '2' },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('truncated')
    expect(res.stderr).toContain('big1')
  })

  // REGRESSION (round-2 review, non-blocking finding): `findOrderViolations`
  // skips merges, but `main()` was still READING them first — so a merge of
  // `origin/main` carrying more than 300 files hit the paging cap and failed
  // closed on a commit whose contents the guard then discarded anyway. The
  // fixture proves the read no longer happens: the merge entry carries
  // `parents: 2` and has NO `commit-<sha>.json` detail file at all, so any
  // attempt to read it fails.
  it('never reads a merge commit — skipped before the paging path, not after', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'merge-unreadable'), {
      env: env('merge-unreadable'),
    })
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('PASS')
    expect(res.stderr).not.toContain('could not fetch')
  })

  // REGRESSION (#398), CLI level: the PR #396 commit shape exactly — a tests-only
  // commit citing through the barrel, then the implementation together with the
  // barrel's re-export line, then a later commit moving the import to the literal
  // path. Before the fix this exited 1 with `implementation first`.
  it('exits 0 when the earlier test cited the module through its public barrel', () => {
    const res = runGuard('tdd-order-lint.mjs', caseDir('tdd-order', 'barrel-citation'), {
      env: env('barrel-citation'),
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

/**
 * The PRE-COMMIT half (#355, owner feedback on PR #394: the CI guard fires too
 * late — the retro comment mandated a "pre-commit/PR check", and the PR half
 * alone lets a developer discover the violation only after pushing).
 *
 * Same rule, different plane, and the plane changes one thing deliberately: at
 * pre-commit there is no `test-presence` counterpart running, so a new module
 * with NO test anywhere is rejected here, where CI stays silent and leaves it to
 * that guard. The rest is the CI rule read against the index instead of a
 * commit graph.
 */
/**
 * MIXED-ONLY blocking (round-2 review of PR #394, BLOCKER).
 *
 * The staged plane originally also REJECTED a new module that no test cites.
 * That rule ran `needlesFor` — a substring matcher — in the REJECTING direction,
 * so every miss of the heuristic was a false BLOCK, and the class was measured
 * at 41 of 78 files on `main` (53%): barrels (`src/lib/hours/index.ts` is
 * structurally uncitable — a test importing `@/lib/hours` never contains the
 * string `lib/hours/index`), route-group `layout.tsx`, Drizzle schema tables.
 * A gate whose correct-usage answer is «reach for `--no-verify`» is the dead end
 * §3 clause 3(d) forbids.
 *
 * So the blocking rule is now MIXED only — a new module staged together with a
 * staged test citing it. That direction's misses are false PASSes (the CI half
 * catches them), so its false-BLOCK class is genuinely empty and the day-1 local
 * BLOCK stands under §3 class 1. It is also the #355 retro mandate's literal
 * wording: «rejecting a single commit that introduces a NEW module's
 * implementation and its tests together».
 *
 * The uncited-module case survives as a NON-blocking advisory at exit 0.
 */
describe('evaluateStaged', () => {
  it('is silent for a new module whose test is already in HEAD — the RED-first path', () => {
    expect(
      evaluateStaged([
        { path: 'src/lib/leads/intake.ts', headTests: ['tests/unit/x.spec.ts'], indexTests: [] },
      ]),
    ).toEqual({ mixed: [], advisory: [] })
  })

  it('BLOCKS a MIXED commit — module and its test staged together', () => {
    expect(
      evaluateStaged([
        {
          path: 'src/lib/leads/intake.ts',
          headTests: [],
          indexTests: ['tests/unit/leads-intake.spec.ts'],
        },
      ]),
    ).toEqual({
      mixed: [{ path: 'src/lib/leads/intake.ts', tests: ['tests/unit/leads-intake.spec.ts'] }],
      advisory: [],
    })
  })

  it('only ADVISES on a new module nothing cites — never blocks it', () => {
    expect(
      evaluateStaged([{ path: 'src/lib/hours/index.ts', headTests: [], indexTests: [] }]),
    ).toEqual({ mixed: [], advisory: [{ path: 'src/lib/hours/index.ts' }] })
  })

  it('does not block a barrel, a layout or a schema table — the 41-of-78 class', () => {
    const uncitable = [
      'src/lib/hours/index.ts',
      'src/app/(platform)/p/layout.tsx',
      'src/lib/platform/db/schema/finance/accounts.ts',
      'src/lib/finance/core/money.ts',
    ].map((path) => ({ path, headTests: [], indexTests: [] }))
    const res = evaluateStaged(uncitable)
    expect(res.mixed).toEqual([])
    expect(res.advisory).toHaveLength(4)
  })

  it('a test in HEAD wins even when one is also staged — the obligation was already met', () => {
    expect(
      evaluateStaged([
        {
          path: 'src/lib/leads/intake.ts',
          headTests: ['tests/unit/x.spec.ts'],
          indexTests: ['tests/unit/x.spec.ts'],
        },
      ]),
    ).toEqual({ mixed: [], advisory: [] })
  })

  it('separates the two directions across several modules', () => {
    const res = evaluateStaged([
      { path: 'src/lib/a/one.ts', headTests: [], indexTests: [] },
      { path: 'src/lib/b/two.ts', headTests: [], indexTests: ['tests/unit/two.spec.ts'] },
    ])
    expect(res.mixed.map((m) => m.path)).toEqual(['src/lib/b/two.ts'])
    expect(res.advisory.map((a) => a.path)).toEqual(['src/lib/a/one.ts'])
  })
})

describe('tdd-order --staged (spawned against a real git index)', () => {
  const repos: string[] = []
  afterAll(() => {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true })
  })

  const git = (cwd: string, ...args: string[]) => {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`)
    return res.stdout
  }

  const put = (root: string, rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }

  /** A throwaway repo with a real index — the plumbing under test is the real one. */
  const repo = (build: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'tdd-order-staged-'))
    repos.push(root)
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'guard@test.local')
    git(root, 'config', 'user.name', 'guard test')
    put(root, 'README.md', '# fixture repo\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'base')
    build(root)
    return root
  }

  const staged = (root: string) => runGuard('tdd-order-lint.mjs', root, { extraArgs: ['--staged'] })

  const MODULE = 'src/lib/leads/intake.ts'
  const TEST = 'tests/unit/leads-intake.spec.ts'
  const testBody = "import { intake } from '@/lib/leads/intake'\nit('reds', () => intake())\n"

  it('exits 0 when the failing test is already committed — the ritual followed', () => {
    const root = repo((r) => {
      put(r, TEST, testBody)
      git(r, 'add', '.')
      git(r, 'commit', '-qm', 'test(leads): RED')
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', MODULE)
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('PASS')
  })

  it('ADVISES but exits 0 when a new module is staged with no test anywhere', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', MODULE)
    })
    const res = staged(root)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain(MODULE)
    expect(res.stdout).toContain('commit the failing test first')
    // The advisory hands the developer on to the plane that CAN judge order.
    expect(res.stdout).toContain('tdd-order')
  })

  // REGRESSION (round-2 review, BLOCKER): 41 of 78 platform files on `main` are
  // not name-cited by any test — barrels are structurally uncitable, and a route
  // layout or a Drizzle table is not imported by path in a test. None is a TDD
  // violation, and blocking them would make `--no-verify` the correct usage.
  it('exits 0 for a barrel, a layout and a schema table staged alone', () => {
    const root = repo((r) => {
      put(r, 'src/lib/hours/index.ts', "export * from './format'\n")
      put(r, 'src/app/(platform)/p/layout.tsx', 'export default function L() {}\n')
      put(r, 'src/lib/platform/db/schema/finance/accounts.ts', 'export const accounts = {}\n')
      git(r, 'add', '.')
    })
    expect(staged(root).code).toBe(0)
  })

  it('exits 1 on a MIXED commit and explains the two-commit order', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      put(r, TEST, testBody)
      git(r, 'add', '.')
    })
    const res = staged(root)
    expect(res.code).toBe(1)
    expect(res.stderr).toContain(MODULE)
    expect(res.stderr).toContain(TEST)
  })

  it('exits 0 when nothing new lands under the platform-module scope', () => {
    const root = repo((r) => {
      put(r, 'docs/notes.md', 'prose\n')
      put(r, 'tools/lint/whatever.mjs', 'export const x = 1\n')
      git(r, 'add', '.')
    })
    const res = staged(root)
    expect(res.code).toBe(0)
  })

  it('exits 0 for a MODIFIED existing module — v1 scope is new files', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', '.')
      git(r, 'commit', '-qm', 'feat: module')
      put(r, MODULE, 'export const intake = () => false\n')
      git(r, 'add', MODULE)
    })
    expect(staged(root).code).toBe(0)
  })

  it('exits 0 for a RENAME of a tracked module — moving code re-opens no obligation', () => {
    const root = repo((r) => {
      put(r, MODULE, 'export const intake = () => true\n')
      git(r, 'add', '.')
      git(r, 'commit', '-qm', 'feat: module')
      git(r, 'mv', MODULE, 'src/lib/leads/renamed.ts')
    })
    expect(staged(root).code).toBe(0)
  })

  it('exits 0 with nothing staged at all', () => {
    const root = repo(() => {})
    const res = staged(root)
    expect(res.code).toBe(0)
  })
})
