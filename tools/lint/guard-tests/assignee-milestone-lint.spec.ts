import { describe, expect, it } from 'vitest'

import { missingFields } from '../assignee-milestone-lint.mjs'
import { caseDir, ghDir, runGuard } from './run-guard'

/**
 * assignee-milestone — an open PR row nobody can triage (canon
 * docs/ci-guardrails.md §5, WARN since 2026-08-05).
 *
 * Ported from ds-platform WITH wiring: there the script and its spec exist while
 * no workflow job and no package script reference them (canon §7 deviation 1).
 */

describe('missingFields', () => {
  it('is silent on a fully fielded PR', () => {
    expect(missingFields({ assignees: [{ login: 'a' }], milestone: { title: 'M' } })).toEqual([])
  })

  it('names an empty assignee list', () => {
    expect(missingFields({ assignees: [], milestone: { title: 'M' } })).toEqual(['assignee'])
  })

  it('names a null milestone', () => {
    expect(missingFields({ assignees: [{ login: 'a' }], milestone: null })).toEqual(['milestone'])
  })

  it('names both when both are absent', () => {
    expect(missingFields({})).toEqual(['assignee', 'milestone'])
  })

  it('does not accept a milestone object with no title', () => {
    expect(missingFields({ assignees: [{ login: 'a' }], milestone: {} })).toEqual(['milestone'])
  })
})

describe('assignee-milestone (spawned)', () => {
  const env = (n: string) => ({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '7',
    LINT_GH_FIXTURE_DIR: ghDir('assignee-milestone', n),
  })

  it('exits 1 and prints the one-line fix', () => {
    const res = runGuard('assignee-milestone-lint.mjs', caseDir('assignee-milestone', 'bare'), {
      env: env('bare'),
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('gh pr edit 7 --add-assignee @me')
  })

  it('exits 0 on a fielded PR', () => {
    const res = runGuard('assignee-milestone-lint.mjs', caseDir('assignee-milestone', 'fielded'), {
      env: env('fielded'),
    })
    expect(res.code).toBe(0)
  })

  it('exits 1 when the PR cannot be read — an unreadable PR is not a cleared PR', () => {
    const res = runGuard('assignee-milestone-lint.mjs', caseDir('assignee-milestone', 'bare'), {
      env: { ...env('bare'), PR_NUMBER: '404' },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('could not fetch')
  })
})
