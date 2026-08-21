// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { assertSplitWhereMandatory } from '../int/platform/privilege-helpers'

/**
 * Where a skip is allowed and where it is a failure (#278, EARS-30; review of
 * PR #308).
 *
 * `audit-privileges.int.spec.ts` skips on a database that was never split — a
 * developer's un-provisioned branch DB has nothing to deny, and asserting
 * `permission denied` there would assert the absence of a cluster. But ADR-004 A1
 * and spec 201 both claim the privilege echelon «is asserted on every PR», and
 * that claim rests on ONE tier: the CI job that provisions the split itself. If
 * that provisioning ever stops happening, the suite must go red rather than
 * green-by-skip. This is the pure half of that rule, so it is testable without a
 * cluster.
 */
describe('assertSplitWhereMandatory', () => {
  const notSplit = { split: false, reason: 'platform_app/platform_migrator do not exist' }

  it('passes a split database anywhere', () => {
    expect(assertSplitWhereMandatory({ split: true, reason: 'application role app' }, {})).toBe(
      true,
    )
    expect(
      assertSplitWhereMandatory({ split: true, reason: 'application role app' }, { CI: 'true' }),
    ).toBe(true)
  })

  it('allows the skip on a developer machine', () => {
    expect(assertSplitWhereMandatory(notSplit, {})).toBe(false)
  })

  it('FAILS in CI, naming the reason — the split is provisioned there by its own job', () => {
    expect(() => assertSplitWhereMandatory(notSplit, { CI: 'true' })).toThrow(
      /platform_app\/platform_migrator do not exist/,
    )
    expect(() => assertSplitWhereMandatory(notSplit, { CI: 'true' })).toThrow(/EARS-30/)
  })

  it('treats CI=false as not CI rather than as "the variable is set"', () => {
    expect(assertSplitWhereMandatory(notSplit, { CI: 'false' })).toBe(false)
  })
})
