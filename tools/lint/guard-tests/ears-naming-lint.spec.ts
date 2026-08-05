import { describe, expect, it } from 'vitest'

import {
  ATTEMPT_RE,
  CANONICAL_RE,
  TEST_FILE_RE,
  findMalformedTitles,
  stripJsComments,
} from '../ears-naming-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * ears-naming — the FORMAT half of the EARS↔test contract (#157, guard tranche
 * 2). Ported from ds-platform `tools/lint/ears-naming-lint.ts` and adapted to
 * this repo: `.mjs` on the shared `lib/guard.mjs` plumbing, this repo's test
 * layout (`tests/**`, `tools/lint/guard-tests/**`, colocated `src/**` specs).
 *
 * Scope discipline is the whole point: only a title that ATTEMPTS the EARS
 * prefix and gets it wrong is a finding. A plain unit test carrying no id is
 * legitimate — docs/specs/README.md makes the clause the unit of REQUIREMENT
 * testing, not of every test — so demanding an id everywhere would be the
 * "high code coverage, low requirements coverage" anti-pattern, and it is the
 * companion guard (`ears-test`) that catches a genuinely missing test.
 */

describe('TEST_FILE_RE', () => {
  it('matches the product test tiers', () => {
    expect(TEST_FILE_RE.test('tests/unit/hours-access.spec.ts')).toBe(true)
    expect(TEST_FILE_RE.test('tests/int/leads.int.spec.ts')).toBe(true)
    expect(TEST_FILE_RE.test('tests/e2e/admin.e2e.spec.ts')).toBe(true)
    expect(TEST_FILE_RE.test('src/lib/okr/rows.test.tsx')).toBe(true)
  })

  it('does not match production source or docs', () => {
    expect(TEST_FILE_RE.test('src/lib/okr/rows.ts')).toBe(false)
    expect(TEST_FILE_RE.test('docs/specs/081-hours-calculator.md')).toBe(false)
  })

  it('does not match the guard family own specs', () => {
    // A guard spec quotes malformed test titles as DATA — scanning it would
    // turn the guard's own test input into evidence about the repo, the class
    // `lib/guard.mjs`'s FIXTURES_PREFIX note exists for. Guards are tooling and
    // carry no EARS clause anyway.
    expect(TEST_FILE_RE.test('tools/lint/guard-tests/stage-b-lint.spec.ts')).toBe(false)
  })
})

describe('ATTEMPT_RE / CANONICAL_RE', () => {
  it('treats an EARS-looking prefix as an attempt', () => {
    expect(ATTEMPT_RE.test('EARS-3: freezes the period')).toBe(true)
    expect(ATTEMPT_RE.test('ears-3: freezes the period')).toBe(true)
    expect(ATTEMPT_RE.test('EARS 3: freezes the period')).toBe(true)
  })

  it('does not treat ordinary prose as an attempt', () => {
    expect(ATTEMPT_RE.test('renders the earshot banner')).toBe(false)
    expect(ATTEMPT_RE.test('freezes the period')).toBe(false)
  })

  it('accepts every canonical id shape the corpus uses', () => {
    expect(CANONICAL_RE.test('EARS-3: freezes the period')).toBe(true)
    expect(CANONICAL_RE.test('EARS-3.1: freezes the period')).toBe(true)
    expect(CANONICAL_RE.test('EARS-3/4: freezes both')).toBe(true)
    expect(CANONICAL_RE.test('EARS-3 (#157): freezes the period')).toBe(true)
  })

  it('rejects the four malformed shapes the rule exists for', () => {
    for (const bad of ['ears-3: x', 'EARS3: x', 'EARS-3 x', 'EARS 3: x']) {
      expect(CANONICAL_RE.test(bad)).toBe(false)
    }
  })
})

describe('stripJsComments', () => {
  it('drops a commented-out malformed example so it is not a finding', () => {
    const src = "// it('ears-9: old shape')\nit('EARS-9: new shape', () => {})"
    expect(findMalformedTitles(stripJsComments(src))).toEqual([])
  })
})

describe('findMalformedTitles', () => {
  it('flags a lowercase prefix', () => {
    expect(findMalformedTitles("it('ears-3: freezes', () => {})")).toEqual(['ears-3: freezes'])
  })

  it('flags a missing hyphen and a missing colon', () => {
    const src = "test('EARS3: a', () => {})\ndescribe('EARS-4 b', () => {})"
    expect(findMalformedTitles(src)).toEqual(['EARS3: a', 'EARS-4 b'])
  })

  it('leaves a canonical title alone', () => {
    expect(findMalformedTitles("it('EARS-3: freezes', () => {})")).toEqual([])
  })

  it('leaves a plain non-EARS unit test alone', () => {
    expect(findMalformedTitles("it('rounds the hourly rate', () => {})")).toEqual([])
  })

  it('reads titles only, never arbitrary file text', () => {
    expect(findMalformedTitles("const note = 'ears-3: not a title'")).toEqual([])
  })
})

describe('ears-naming (spawned)', () => {
  it('exits 1 and names the file and the malformed title', () => {
    const res = runGuard('ears-naming-lint.mjs', caseDir('ears-naming', 'malformed'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('tests/unit/hours-freeze.spec.ts')
    expect(res.stderr).toContain('ears-2: freezes the period')
  })

  it('exits 0 on a tree whose EARS titles are canonical', () => {
    const res = runGuard('ears-naming-lint.mjs', caseDir('ears-naming', 'clean'))
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('canonical')
  })

  it('honours a file-level opt-out carrying a reason', () => {
    const res = runGuard('ears-naming-lint.mjs', caseDir('ears-naming', 'suppressed'))
    expect(res.code).toBe(0)
  })

  it('exits 0 on the real repo tree — the guard must be green at merge', () => {
    const res = runGuard('ears-naming-lint.mjs', null, { realTree: true })
    expect(res.code).toBe(0)
  })
})
