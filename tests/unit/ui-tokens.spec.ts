// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TOKEN_GROUPS, TOKEN_NAMES } from '@/ui/tokens'

/**
 * The token layer of the UI kit (#312; consolidation spec §10 «токены (цвета,
 * типографика, отступы)»).
 *
 * The kit has ONE source of truth for its values, and it is not this repo's
 * prose: `.claude/rules/design-process.md` §1 — «build to the file, not to
 * issue-body prose… where the two disagree, the file wins». The files are the
 * two owner-picked Stage-A wireframes vendored in `design-source/`.
 *
 * So the tokens are not asserted against a list somebody typed here. They are
 * asserted against the vendored bytes: every colour the two designs paint must
 * be reachable through a named token, and no token may carry a colour the
 * designs never used. That makes «derived from the design» a machine check
 * rather than a claim in a PR body.
 */

const REPO_ROOT = join(__dirname, '..', '..')
const TOKENS_CSS = join(REPO_ROOT, 'src', 'ui', 'tokens.css')
const DESIGN_SOURCES = [
  join(REPO_ROOT, 'design-source', 'p-launcher.html'),
  join(REPO_ROOT, 'design-source', 'p-admin-shell.html'),
]

/** `#abc` / `#aabbcc`, normalised to lower-case 6-digit form. */
function normaliseHex(raw: string): string {
  const body = raw.slice(1).toLowerCase()
  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
    : `#${body}`
}

/**
 * Every colour the vendored design actually PAINTS.
 *
 * The HTML comment block is stripped first, and that is not tidiness: both
 * wireframes carry a provenance header, and `p-admin-shell.html` names issue
 * `#313` in it. `#313` is a valid 3-digit hex literal, so an unstripped scan
 * would demand a `#331133` token for a GitHub issue number — the same class of
 * mistake `stripNonEvidence` exists for on the PR-body side.
 */
function designColors(): Set<string> {
  const out = new Set<string>()
  for (const file of DESIGN_SOURCES) {
    const css = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const m of css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
      out.add(normaliseHex(m[0]))
    }
  }
  return out
}

/** `--bbm-x: value` declarations of `src/ui/tokens.css`, comments stripped. */
function declaredTokens(): Map<string, string> {
  const css = readFileSync(TOKENS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map<string, string>()
  for (const m of css.matchAll(/(--bbm-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim())
  }
  return out
}

describe('the colour tokens are DERIVED from design-source/, not invented', () => {
  it('names every colour the two vendored Stage-A designs paint', () => {
    const declared = new Set(
      [...declaredTokens().values()].map((v) => (v.startsWith('#') ? normaliseHex(v) : v)),
    )
    const missing = [...designColors()].filter((c) => !declared.has(c)).sort()
    expect(missing).toEqual([])
  })

  it('carries no colour the designs never used — the kit invents no palette', () => {
    const used = designColors()
    const invented = [...declaredTokens().entries()]
      .filter(([, v]) => /^#[0-9a-fA-F]{3,6}$/.test(v))
      .filter(([, v]) => !used.has(normaliseHex(v)))
      .map(([name]) => name)
      .sort()
    expect(invented).toEqual([])
  })

  it('gives each design colour exactly one named home — no two tokens share a value', () => {
    const byValue = new Map<string, string[]>()
    for (const [name, value] of declaredTokens()) {
      if (!/^#[0-9a-fA-F]{3,6}$/.test(value)) continue
      const key = normaliseHex(value)
      byValue.set(key, [...(byValue.get(key) ?? []), name])
    }
    const duplicated = [...byValue.entries()].filter(([, names]) => names.length > 1)
    expect(duplicated).toEqual([])
  })
})

describe('the token registry consumed by the showcase', () => {
  it('lists exactly the tokens tokens.css declares', () => {
    expect([...TOKEN_NAMES].sort()).toEqual([...declaredTokens().keys()].sort())
  })

  it('lists each token once, under exactly one group', () => {
    expect(TOKEN_NAMES.length).toBe(new Set(TOKEN_NAMES).size)
    expect(TOKEN_GROUPS.every((g) => g.tokens.length > 0)).toBe(true)
  })

  it('marks the colour groups so the showcase can render swatches', () => {
    const colorTokens = TOKEN_GROUPS.filter((g) => g.kind === 'color').flatMap((g) => g.tokens)
    const declared = declaredTokens()
    expect(colorTokens.length).toBeGreaterThan(0)
    expect(colorTokens.every((t) => declared.get(t)?.startsWith('#'))).toBe(true)
  })
})

describe('the spacing scale is self-documenting', () => {
  it('names every space token after the pixel value it carries', () => {
    const wrong = [...declaredTokens().entries()]
      .filter(([name]) => name.startsWith('--bbm-space-'))
      .filter(([name, value]) => value !== `${name.replace('--bbm-space-', '')}px`)
    expect(wrong).toEqual([])
  })
})
