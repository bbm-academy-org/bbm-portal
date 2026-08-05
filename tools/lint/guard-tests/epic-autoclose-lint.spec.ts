import { describe, expect, it } from 'vitest'

import { closesTargets, openChildren } from '../epic-autoclose-lint.mjs'
import { caseDir, ghDir, runGuard } from './run-guard'

/**
 * epic-autoclose — merging a child PR must not close a live epic (canon
 * docs/ci-guardrails.md §5, WARN since 2026-08-05).
 *
 * GitHub honours `Closes #N` without ever looking at the native sub-issue graph,
 * so a mistyped target silently closes the umbrella that was coordinating the
 * remaining children.
 */

describe('closesTargets', () => {
  it('collects every GitHub closing keyword form', () => {
    expect(closesTargets('Closes #136\nfixes #12\nResolved #7')).toEqual([136, 12, 7])
  })

  it('ignores a bare mention — a reference is not a closure', () => {
    expect(closesTargets('Related to #117, see also #99')).toEqual([])
  })

  it('ignores a keyword that lives inside the template comment', () => {
    expect(closesTargets('<!-- Closes #999 -->\nCloses #136')).toEqual([136])
  })

  it('deduplicates repeats', () => {
    expect(closesTargets('Closes #5 and closes #5')).toEqual([5])
  })
})

describe('openChildren', () => {
  it('keeps only the open sub-issues, case-insensitively', () => {
    expect(
      openChildren([
        { number: 1, state: 'closed' },
        { number: 2, state: 'OPEN' },
      ]),
    ).toEqual([{ number: 2, state: 'OPEN' }])
  })

  it('treats an empty graph as nothing to report', () => {
    expect(openChildren([])).toEqual([])
    expect(openChildren(undefined)).toEqual([])
  })
})

describe('epic-autoclose (spawned)', () => {
  const env = (n: string) => ({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '7',
    LINT_GH_FIXTURE_DIR: ghDir('epic-autoclose', n),
  })

  it('exits 1 naming the epic and its open children', () => {
    const res = runGuard('epic-autoclose-lint.mjs', caseDir('epic-autoclose', 'epic'), {
      env: env('epic'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('#117')
    expect(res.stderr).toContain('#136')
  })

  it('exits 0 when the closed issue is a leaf', () => {
    const res = runGuard('epic-autoclose-lint.mjs', caseDir('epic-autoclose', 'leaf'), {
      env: env('leaf'),
    })
    expect(res.code).toBe(0)
  })

  it('exits 0 outside a pull_request event', () => {
    const res = runGuard('epic-autoclose-lint.mjs', caseDir('epic-autoclose', 'epic'))
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('nothing to check')
  })
})
