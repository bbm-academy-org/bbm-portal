import { describe, expect, it } from 'vitest'

import { checkTokens, colorLiterals, declaredTokens, usedTokens } from '../ui-tokens-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * ui-tokens — the minimal-viable UI lint that ships with the kit (#312).
 *
 * Consolidation spec §11 parks «UI-линты и showcase» in the «Отложено» column
 * with one trigger: the start of `src/ui`. This guard is that trigger firing.
 * It checks the three things that make a token layer a token layer rather than
 * a stylesheet with nice variable names:
 *
 *   1. `hardcoded-color` — a colour literal in a kit stylesheet other than
 *      `src/ui/tokens.css`. That is the class the rule exists for: a value that
 *      escaped the palette is invisible to review and to the next redesign.
 *   2. `unknown-token` — a `var(--bbm-…)` anywhere under `src/**\/*.css` naming
 *      a token `tokens.css` does not declare. A typo in a custom property is
 *      silent at runtime: the declaration simply does nothing.
 *   3. `registry-drift` — `src/ui/tokens.ts` (the list the showcase renders)
 *      disagreeing with what `tokens.css` declares, in either direction.
 *
 * Deliberately NOT checked: raw `px` values. Component CSS legitimately carries
 * one-off geometry, and a px ban would be noise on day 0 — widening the rule is
 * a substantive change that restarts the promotion clock (canon §4).
 */

const GUARD = 'ui-tokens-lint.mjs'

describe('declaredTokens', () => {
  it('reads the custom properties out of a stylesheet, comments stripped', () => {
    const css = `/* --bbm-color-ghost: #000; */\n:root {\n  --bbm-color-surface: #ffffff;\n  --bbm-space-8: 8px;\n}\n`
    expect([...declaredTokens(css).entries()]).toEqual([
      ['--bbm-color-surface', '#ffffff'],
      ['--bbm-space-8', '8px'],
    ])
  })
})

describe('usedTokens', () => {
  it('collects every var(--bbm-…) reference', () => {
    const css = '.a { color: var(--bbm-color-text); padding: var(--bbm-space-8) }'
    expect([...usedTokens(css)].sort()).toEqual(['--bbm-color-text', '--bbm-space-8'])
  })

  it('ignores a non-bbm custom property — this repo is not the only author of CSS vars', () => {
    expect([...usedTokens('.a { color: var(--paper) }')]).toEqual([])
  })
})

describe('colorLiterals', () => {
  it('finds hex, rgb() and hsl() literals with their line numbers', () => {
    const css =
      '.a { color: #f2f2f2 }\n.b { background: rgb(0 0 0 / 20%) }\n.c { color: hsl(0 0% 0%) }'
    expect(colorLiterals(css).map((f) => `${f.line}:${f.text}`)).toEqual([
      '1:#f2f2f2',
      '2:rgb(',
      '3:hsl(',
    ])
  })

  it('does not see a colour in a comment — a comment may quote the source value', () => {
    expect(colorLiterals('/* derived from #bbb in p-launcher.html */\n.a { color: red }')).toEqual(
      [],
    )
  })

  it('does not see `transparent` / `currentColor` — those name no palette value', () => {
    expect(colorLiterals('.a { border-color: transparent; color: currentColor }')).toEqual([])
  })
})

describe('checkTokens — the whole verdict, as a pure seam', () => {
  const clean = {
    tokensCss: ':root { --bbm-color-surface: #ffffff; }',
    registry: ['--bbm-color-surface'],
    stylesheets: [
      { rel: 'src/ui/app-tile.css', text: '.t { background: var(--bbm-color-surface) }' },
    ],
  }

  it('passes a kit whose every value comes from the palette', () => {
    expect(checkTokens(clean).findings).toEqual([])
  })

  it('flags a colour literal that escaped the palette', () => {
    const res = checkTokens({
      ...clean,
      stylesheets: [{ rel: 'src/ui/app-tile.css', text: '.t { background: #fafafa }' }],
    })
    expect(res.findings.map((f) => f.kind)).toEqual(['hardcoded-color'])
    expect(res.findings[0].where).toBe('src/ui/app-tile.css:1')
  })

  it('leaves tokens.css itself alone — it is where the literals are SUPPOSED to be', () => {
    const res = checkTokens({
      ...clean,
      stylesheets: [{ rel: 'src/ui/tokens.css', text: ':root { --bbm-color-surface: #ffffff }' }],
    })
    expect(res.findings).toEqual([])
  })

  it('does not police module stylesheets outside the kit (EARS-429: no reskin in this epic)', () => {
    const res = checkTokens({
      ...clean,
      stylesheets: [{ rel: 'src/modules/okr/view/okr.css', text: '.o { color: #333 }' }],
    })
    expect(res.findings).toEqual([])
  })

  it('flags a var() naming a token nothing declares — silent at runtime otherwise', () => {
    const res = checkTokens({
      ...clean,
      stylesheets: [
        { rel: 'src/modules/okr/view/okr.css', text: '.o { color: var(--bbm-color-surfce) }' },
      ],
    })
    expect(res.findings.map((f) => f.kind)).toEqual(['unknown-token'])
  })

  it('flags registry drift in both directions', () => {
    expect(checkTokens({ ...clean, registry: [] }).findings.map((f) => f.kind)).toEqual([
      'registry-drift',
    ])
    expect(
      checkTokens({ ...clean, registry: ['--bbm-color-surface', '--bbm-color-gone'] }).findings.map(
        (f) => f.kind,
      ),
    ).toEqual(['registry-drift'])
  })

  it('reports a tree with no kit as nothing-to-check, not as a clean pass', () => {
    expect(checkTokens({ tokensCss: null, registry: null, stylesheets: [] }).skipped).toBe(true)
  })
})

describe('ui-tokens (spawned)', () => {
  it('exits 1 and names file:line of a hardcoded colour', () => {
    const res = runGuard(GUARD, caseDir('ui-tokens', 'dirty'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/ui/app-tile.css:2')
  })

  it('exits 0 on a kit that uses only tokens', () => {
    const res = runGuard(GUARD, caseDir('ui-tokens', 'clean'))
    expect(res.code).toBe(0)
  })

  it('exits 0 against the REAL repo tree — the guard lands with no live finding', () => {
    const res = runGuard(GUARD, null)
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
  })
})
