// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The kit's COMPONENT stylesheets against the vendored designs (#312, review of
 * PR #353).
 *
 * `tests/unit/ui-tokens.spec.ts` already proves the palette is derived: every
 * colour the two wireframes paint has a token, and no token carries a colour
 * they never used. That check is blind in one direction, and both blockers of
 * the stage-4 review landed exactly there — a component may reach for a
 * perfectly valid token that was derived from a DIFFERENT element in a
 * DIFFERENT file, and nothing notices. `#a0a0a0` came from a sidebar group of
 * the cabinet and was painted on a launcher tile caption the design draws at
 * `#777`; the launcher's «↗ внешний» marker was rendered with the cabinet
 * `.tag`'s fill and padding.
 *
 * So this file asserts the other direction: for the elements the two designs
 * DO draw, what the component ends up painting must resolve — through the
 * token layer — to the very declarations the vendored file carries for that
 * element. `.claude/rules/design-process.md` §1: the file wins. Nothing here
 * hard-codes a hex; every expectation is read out of `design-source/` at run
 * time, so editing the design moves the expectation with it.
 */

const REPO_ROOT = join(__dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(REPO_ROOT, ...parts), 'utf8')

const LAUNCHER = read('design-source', 'p-launcher.html')
const TOKENS_CSS = read('src', 'ui', 'tokens.css')
const APP_TILE_CSS = read('src', 'ui', 'app-tile.css')
const TAG_CSS = read('src', 'ui', 'tag.css')

/** Blank comments so a quoted value in prose is never read as a declaration. */
const stripComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

/** The declarations of ONE rule, keyed by property, last one winning. */
function rule(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = stripComments(css).match(new RegExp(`(^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  if (!m) throw new Error(`no rule \`${selector}\` in the stylesheet`)
  const out = new Map<string, string>()
  for (const decl of m[2].split(';')) {
    const i = decl.indexOf(':')
    if (i === -1) continue
    out.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim())
  }
  return out
}

/** The cascade of several rules, applied in the order given. */
function cascade(sheets: [string, string][]): Map<string, string> {
  const out = new Map<string, string>()
  for (const [css, selector] of sheets) for (const [k, v] of rule(css, selector)) out.set(k, v)
  return out
}

const TOKENS = (() => {
  const out = new Map<string, string>()
  for (const m of stripComments(TOKENS_CSS).matchAll(/(--bbm-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim())
  }
  return out
})()

/** `var(--bbm-…)` resolved against the palette, so a value can be compared. */
function resolve(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value
    .replace(/var\(\s*(--bbm-[a-z0-9-]+)\s*\)/g, (_, name: string) => {
      const v = TOKENS.get(name)
      if (v === undefined) throw new Error(`tokens.css declares no ${name}`)
      return v
    })
    .trim()
}

/** `#abc` → `#aabbcc` everywhere in a value, so the two notations compare equal. */
const hex = (v: string | undefined) =>
  v?.replace(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g, (_, body: string) => {
    const b = body.toLowerCase()
    return b.length === 3 ? `#${b[0]}${b[0]}${b[1]}${b[1]}${b[2]}${b[2]}` : `#${b}`
  })

/**
 * The background a rule actually PAINTS. A design that declares none and a kit
 * rule that explicitly clears one are the same painted result, and that is what
 * has to match — `transparent` / `none` are «no fill», not a colour.
 */
const fill = (v: string | undefined) =>
  v === undefined || /^(transparent|none)$/.test(v) ? null : hex(v)

describe('the planned tile caption is painted from the launcher, not from the cabinet', () => {
  it('resolves to the colour `p-launcher.html` gives `.tile-desc`', () => {
    // The caption element is `.tile-desc` («портфель, позже»). `.ghost` sets
    // #999 on the tile, but `.tile-desc` is the more specific rule for THIS
    // element, so the vendored caption colour is the one below — read out of
    // the design rather than typed here.
    const expected = hex(rule(LAUNCHER, '.tile-desc').get('color'))

    const painted = hex(
      resolve(
        cascade([[APP_TILE_CSS, '.bbm-app-tile--planned .bbm-app-tile__description']]).get('color'),
      ),
    )

    expect(painted).toBe(expected)
  })

  it('keeps the placeholder NAME at the colour the design greys it to', () => {
    const expected = hex(rule(LAUNCHER, '.ghost .tile-name').get('color'))
    const painted = hex(
      resolve(cascade([[APP_TILE_CSS, '.bbm-app-tile--planned .bbm-app-tile__name']]).get('color')),
    )
    expect(painted).toBe(expected)
  })
})

describe('the «↗ внешний» marker is the launcher’s `.ext-mark`, not the cabinet’s `.tag`', () => {
  const design = rule(LAUNCHER, '.ext-mark')
  /** Everything the external marker ends up with, in cascade order. */
  const painted = () =>
    cascade([
      [TAG_CSS, '.bbm-tag'],
      [TAG_CSS, '.bbm-tag--mark'],
      [APP_TILE_CSS, '.bbm-app-tile__external-mark'],
    ])

  it('carries the marker’s own text colour, a step lighter than a cabinet tag', () => {
    expect(hex(resolve(painted().get('color')))).toBe(hex(design.get('color')))
  })

  it('carries no fill — the design gives the marker no background at all', () => {
    expect(fill(resolve(painted().get('background')))).toBe(fill(design.get('background')))
  })

  it('carries the marker’s own padding, not the tag’s wider one', () => {
    expect(resolve(painted().get('padding'))).toBe(design.get('padding'))
  })

  it('keeps the border and the size the two labels genuinely share', () => {
    expect(hex(resolve(painted().get('border')))).toBe(hex(design.get('border')))
    expect(resolve(painted().get('font-size'))).toBe(design.get('font-size'))
  })
})

describe('the cabinet tag keeps its own declarations', () => {
  it('still paints `.tag` of `p-admin-shell.html` exactly as that file draws it', () => {
    const cabinet = read('design-source', 'p-admin-shell.html')
    const design = rule(cabinet, '.tag')
    const base = rule(TAG_CSS, '.bbm-tag')
    expect(hex(resolve(base.get('color')))).toBe(hex(design.get('color')))
    expect(fill(resolve(base.get('background')))).toBe(fill(design.get('background')))
    expect(resolve(base.get('padding'))).toBe(design.get('padding'))
  })
})

describe('the empty status line the launcher draws on the admin tile', () => {
  it('has a form in the kit, and it resolves to `.pulse.none`', () => {
    const design = rule(LAUNCHER, '.pulse.none')
    const painted = cascade([
      [APP_TILE_CSS, '.bbm-app-tile__status'],
      [APP_TILE_CSS, '.bbm-app-tile__status--empty'],
    ])
    expect(hex(resolve(painted.get('color')))).toBe(hex(design.get('color')))
    expect(painted.get('font-style')).toBe(design.get('font-style'))
    expect(hex(resolve(painted.get('border-top-color')))).toBe(hex(design.get('border-top-color')))
  })
})
