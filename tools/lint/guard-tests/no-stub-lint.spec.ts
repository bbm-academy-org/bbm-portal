import { describe, expect, it } from 'vitest'

import { RENDER_SURFACE_RE, scanLine } from '../no-stub-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * no-stub — the "no workarounds / stubs / placeholders" rule, fired at the
 * decision point instead of living as prose (canon docs/ci-guardrails.md §5,
 * WARN since 2026-08-05).
 *
 * Ported from ds-platform and re-scoped for this repo: the scan covers the
 * user-facing render surface only (`src/**` .tsx/.css), not every source file.
 * A TODO in `src/lib/**` is engineering debt with a home in DEBT.md; a TODO or a
 * "set this env var" note on the render surface is something a user sees.
 */

describe('scanLine', () => {
  it('flags a user-facing dev placeholder telling the user to set an env var', () => {
    expect(scanLine('  <p>Set the PAYLOAD_SECRET environment variable to continue</p>')).toBe(
      'user-facing-env-placeholder',
    )
  })

  it('does not flag ordinary product copy that merely says "configure"', () => {
    expect(scanLine('  <button>Configure your profile</button>')).toBeNull()
  })

  it('flags a stub marker with no tracked issue', () => {
    expect(scanLine('  // TODO: render the real table')).toBe('untracked-stub-marker')
  })

  it('accepts a stub marker that cites a tracked issue', () => {
    expect(scanLine('  // TODO(#136): promote once the canon clock matures')).toBeNull()
  })

  it('ignores the lowercase React placeholder prop — it is a real attribute', () => {
    expect(scanLine('  <input placeholder="Имя" />')).toBeNull()
  })

  it('honours an explicit suppression carrying a reason', () => {
    expect(scanLine('  // TODO: local scratch // no-stub-ok: fixture text, not shipped')).toBeNull()
  })

  it('scopes the scan to the render surface', () => {
    expect(RENDER_SURFACE_RE.test('src/app/(payload)/page.tsx')).toBe(true)
    expect(RENDER_SURFACE_RE.test('src/styles/hours.css')).toBe(true)
    expect(RENDER_SURFACE_RE.test('src/lib/okr/config.ts')).toBe(false)
    expect(RENDER_SURFACE_RE.test('tests/unit/hours-view-markup.spec.ts')).toBe(false)
  })
})

describe('no-stub (spawned)', () => {
  it('exits 1 and names file:line of a banned pattern', () => {
    const res = runGuard('no-stub-lint.mjs', caseDir('no-stub', 'dirty'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/app/page.tsx:2')
  })

  it('exits 0 on a clean render surface', () => {
    const res = runGuard('no-stub-lint.mjs', caseDir('no-stub', 'clean'))
    expect(res.code).toBe(0)
  })

  it('exits 0 against the REAL repo tree — the guard lands with no live finding', () => {
    const res = runGuard('no-stub-lint.mjs', null)
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
  })
})
