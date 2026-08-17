// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { normalizeAliasValue, normalizeMemberEmail, slugFromEmail } from '@/lib/member'

/**
 * The member module's pure half (spec 124 EARS-2, EARS-17, EARS-18).
 *
 * These three functions are the JS side of a contract the DATABASE also states:
 * `CHECK (email = lower(btrim(email)))` on `core.member`, and the unique index on
 * the expression (`kind`, `lower(btrim(value))`) on `core.member_alias`. The
 * DB-level half is exercised in `tests/int/platform/member.int.spec.ts`; this
 * file pins the normalization the module applies BEFORE it writes, so a legal
 * input never reaches the constraint as a violation.
 */

describe('normalizeAliasValue / normalizeMemberEmail', () => {
  it('EARS-18: lowercases and trims, matching lower(btrim(value)) exactly', () => {
    expect(normalizeAliasValue('  Dobroyar ')).toBe('dobroyar')
    expect(normalizeAliasValue('DOBROYAR')).toBe('dobroyar')
    expect(normalizeAliasValue('dobroyar')).toBe('dobroyar')
  })

  it('EARS-2: normalizes an email the same way the CHECK constraint demands', () => {
    expect(normalizeMemberEmail(' Anton@BBM.Academy ')).toBe('anton@bbm.academy')
  })
})

describe('slugFromEmail', () => {
  it('EARS-2: derives the slug from the email local part, lowercased', () => {
    expect(slugFromEmail('Anton@bbm.academy')).toBe('anton')
  })

  it('EARS-2: replaces every character outside [a-z0-9-] with a dash', () => {
    expect(slugFromEmail('anton.sidorov+hours@bbm.academy')).toBe('anton-sidorov-hours')
    expect(slugFromEmail('Игорь@bbm.academy')).toBe('-----')
  })

  it('EARS-2: falls back to a non-empty slug when the local part yields nothing', () => {
    expect(slugFromEmail('@bbm.academy')).toBe('member')
  })
})
