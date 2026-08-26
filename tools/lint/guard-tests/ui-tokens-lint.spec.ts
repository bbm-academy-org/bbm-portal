import { describe, expect, it } from 'vitest'

import { checkKit, colorLiterals, declaredVariables, usedVariables } from '../ui-tokens-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * ui-tokens — the UI kit has ONE place where a colour value is written, and
 * that place is the theme entry.
 *
 * Rewritten for the kit of #360 (Tailwind v4 + the shadcn/ui neutral theme).
 * The guard's SUBJECT changed with the kit: it used to read
 * `src/ui/tokens.css` + `src/ui/tokens.ts` — a hand-written `--bbm-…` palette
 * derived from two wireframes, plus the list the `/p/ui-kit` showcase
 * rendered — and all three of those files were deleted on 2026-08-26 (PR-1a of
 * #360). The subject is now `src/ui/theme.css`, the shadcn theme entry, and the
 * `registry-drift` rule is retired outright: there is no registry and no
 * showcase left for it to be about, and a rule kept alive past its subject is
 * a check that cannot fail.
 *
 * What survived is the rule that mattered, widened where the new kit needs it:
 *
 *   1. `hardcoded-color` — a colour literal ANYWHERE under `src/ui/**` other
 *      than the theme entry, in `.css` AND in `.tsx`. The `.tsx` half is the
 *      new half and it is the point: with Tailwind, the way a value escapes the
 *      theme is not a stylesheet any more, it is `className="bg-[#fafafa]"` or
 *      an inline `style`. Scanning only CSS would leave the kit's real failure
 *      mode unguarded.
 *   2. `unknown-variable` — a `var(--…)` in a kit stylesheet naming a variable
 *      the theme entry does not declare. Silent at runtime: the declaration
 *      using it is simply dropped.
 *
 * Still deliberately NOT checked: raw `px` / spacing values, and stylesheets
 * outside the kit. EARS-429 keeps `/p/okr` and `/p/hours` unreskinned until
 * each surface's own first substantive touch, so policing their stylesheets
 * would be this guard fighting a spec clause.
 */

const GUARD = 'ui-tokens-lint.mjs'

describe('declaredVariables', () => {
  it('reads the custom properties out of the theme entry, comments stripped', () => {
    const css = `/* --ghost: #000; */\n:root {\n  --background: oklch(1 0 0);\n  --radius: 0.625rem;\n}\n`
    expect([...declaredVariables(css).entries()]).toEqual([
      ['--background', 'oklch(1 0 0)'],
      ['--radius', '0.625rem'],
    ])
  })
})

describe('usedVariables', () => {
  it('collects every var(--…) reference', () => {
    const css = '.a { color: var(--foreground); border-radius: var(--radius-lg) }'
    expect([...usedVariables(css)].sort()).toEqual(['--foreground', '--radius-lg'])
  })
})

describe('colorLiterals', () => {
  it('finds hex, rgb(), hsl() and oklch() literals with their line numbers', () => {
    const css =
      '.a { color: #f2f2f2 }\n.b { background: rgb(0 0 0 / 20%) }\n.c { color: hsl(0 0% 0%) }\n.d { color: oklch(0.5 0 0) }'
    expect(colorLiterals(css).map((f) => `${f.line}:${f.text}`)).toEqual([
      '1:#f2f2f2',
      '2:rgb(',
      '3:hsl(',
      '4:oklch(',
    ])
  })

  it('finds a Tailwind arbitrary colour value in JSX — the new kit escapes through className, not CSS', () => {
    const tsx = 'export const A = () => <div className="bg-[#fafafa] text-foreground" />\n'
    expect(colorLiterals(tsx).map((f) => f.text)).toEqual(['#fafafa'])
  })

  it('does not see a colour in a comment — a comment may quote the theme value', () => {
    expect(colorLiterals('/* the theme paints this #bbb */\n.a { color: red }')).toEqual([])
    expect(colorLiterals('// swatch is #bbb upstream\nexport const A = 1\n')).toEqual([])
  })

  it('does not see `transparent` / `currentColor` — those name no theme value', () => {
    expect(colorLiterals('.a { border-color: transparent; color: currentColor }')).toEqual([])
  })
})

describe('checkKit — the whole verdict, as a pure seam', () => {
  const clean = {
    themeCss: ':root { --background: oklch(1 0 0); }',
    files: [
      { rel: 'src/ui/card.tsx', text: 'export const C = () => <div className="bg-background" />' },
    ],
  }

  it('passes a kit whose every value comes from the theme', () => {
    expect(checkKit(clean).findings).toEqual([])
  })

  it('flags a colour literal that escaped the theme, in a component', () => {
    const res = checkKit({
      ...clean,
      files: [
        { rel: 'src/ui/card.tsx', text: 'export const C = () => <div className="bg-[#fafafa]" />' },
      ],
    })
    expect(res.findings.map((f) => f.kind)).toEqual(['hardcoded-color'])
    expect(res.findings[0].where).toBe('src/ui/card.tsx:1')
  })

  it('leaves the theme entry itself alone — it is where the literals are SUPPOSED to be', () => {
    const res = checkKit({
      ...clean,
      files: [{ rel: 'src/ui/theme.css', text: ':root { --background: oklch(1 0 0) }' }],
    })
    expect(res.findings).toEqual([])
  })

  it('does not police stylesheets outside the kit (EARS-429: no reskin in this epic)', () => {
    const res = checkKit({
      ...clean,
      files: [{ rel: 'src/modules/okr/view/okr.css', text: '.o { color: #333 }' }],
    })
    expect(res.findings).toEqual([])
  })

  it('flags a var() naming a variable the theme does not declare — silent at runtime otherwise', () => {
    const res = checkKit({
      ...clean,
      files: [{ rel: 'src/ui/extra.css', text: '.o { color: var(--backgruond) }' }],
    })
    expect(res.findings.map((f) => f.kind)).toEqual(['unknown-variable'])
  })

  it('reports a tree with no theme entry as nothing-to-check, not as a clean pass', () => {
    expect(checkKit({ themeCss: null, files: [] }).skipped).toBe(true)
  })
})

describe('ui-tokens (spawned)', () => {
  it('exits 1 and names file:line of a hardcoded colour', () => {
    const res = runGuard(GUARD, caseDir('ui-tokens', 'dirty'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('src/ui/card.tsx:2')
  })

  it('exits 0 on a kit that uses only theme values', () => {
    const res = runGuard(GUARD, caseDir('ui-tokens', 'clean'))
    expect(res.code).toBe(0)
  })

  it('exits 0 against the REAL repo tree — the guard lands with no live finding', () => {
    const res = runGuard(GUARD, null)
    expect(res.stderr).toBe('')
    expect(res.code).toBe(0)
  })
})
