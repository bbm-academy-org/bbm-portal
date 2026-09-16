import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * #388 defect F — the register draws no row separators.
 *
 * The kit's table (`src/ui/table.tsx`) asks for them the way shadcn/ui does:
 * `border-b` on every `<tr>`, `[&_tr]:border-b` on the header. Measured live on
 * the stand those declarations RESOLVE — the body row computes
 * `border-bottom: 1px solid <--border>` — and still nothing paints.
 *
 * The reason is the borders MODEL, not the declaration. A border set on a
 * `<tr>`, a `<thead>` or a `<tfoot>` is **ignored outright** in the separate
 * borders model (CSS 2.2 §17.6.1: in that model "borders set on rows, row
 * groups, columns and column groups are ignored"); only cells have borders
 * there, and they are spaced by `border-spacing`. Upstream Tailwind never hits
 * this because its preflight carries
 *
 *     table { text-indent: 0; border-color: inherit; border-collapse: collapse }
 *
 * — the third declaration is exactly what puts the table into the collapsed
 * model where a row border is a real edge. `src/ui/theme.css` transcribes
 * preflight BY HAND (it must: an `@import` cannot be scoped to `[data-bbm-ui]`,
 * see that file's header), and the `table` rule was not among the rules
 * transcribed. So the UA default `border-collapse: separate` / `border-spacing:
 * 2px` stood, and every row rule in the kit silently became a no-op.
 *
 * Measured on the live stand at head `a4322d9`, `/p/finance/requests` under
 * «Все»: `border-collapse: separate`, `border-spacing: 2px`, while the row's own
 * `border-bottom-width` was already `1px` and its colour the `--border` token.
 * That is why this spec pins the MODEL and not a class name — the class was
 * never missing.
 */

const root = resolve(import.meta.dirname, '../..')
const readRepo = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const theme = readRepo('src/ui/theme.css')
const themeCode = theme.replace(/\/\*[\s\S]*?\*\//g, '')
const table = readRepo('src/ui/table.tsx')

describe('#388 defect F: the kit table renders in the COLLAPSED borders model', () => {
  it('the kit still asks for row separators — the promise this spec protects', () => {
    // If a later edit moves the kit to cell borders instead, this assertion is
    // the one to revisit FIRST: the collapse rule below exists to make these
    // two declarations paint, and means nothing without them.
    expect(table).toMatch(/className=\{cn\(\s*'border-b transition-colors/)
    expect(table).toContain("'[&_tr]:border-b'")
  })

  it('the scoped preflight subset carries `border-collapse: collapse` for a table', () => {
    const rule = baseLayerRules(themeCode).find(({ selector }) =>
      /(^|\W)table(\W|$)/.test(selector),
    )
    expect(
      rule,
      'no rule in theme.css `@layer base` targets `table` — the hand-transcribed ' +
        'preflight subset is missing upstream’s `table { … border-collapse: collapse }`, ' +
        'so the UA’s separate model stands and `border-b` on a <tr> is ignored',
    ).toBeDefined()
    expect(rule!.body).toMatch(/border-collapse:\s*collapse/)
  })

  it('and that rule stays inside an opted-in subtree, like every other base rule', () => {
    // EARS-429: /p/okr and /p/hours must stay unreskinned. `hours.css` sets its
    // own `border-collapse: collapse`; an unscoped rule here would reach it.
    const rule = baseLayerRules(themeCode).find(({ selector }) =>
      /(^|\W)table(\W|$)/.test(selector),
    )
    expect(rule, 'no `table` rule in the base layer at all').toBeDefined()
    for (const one of rule!.selector.split(',')) {
      expect(one.trim(), `"${one.trim()}" can match outside an opted-in subtree`).toMatch(
        /^\[data-bbm-ui\]/,
      )
    }
  })

  it('does not reach for `border-spacing` instead — spacing is not a separator', () => {
    // The separate model can be made to LOOK ruled with a background showing
    // through the spacing gaps. That is the symptom patch, not the fix, and it
    // is what produced the vertical seams seen in the footer band of frame 42.
    expect(themeCode).not.toMatch(/border-spacing:/)
  })
})

/** The `{ selector, body }` of every rule inside the file's `@layer base` block. */
function baseLayerRules(css: string): { selector: string; body: string }[] {
  const start = css.indexOf('@layer base {')
  if (start === -1) return []
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const rules: { selector: string; body: string }[] = []
  const body = css.slice(open + 1, end)
  let selectorStart = 0
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '{') continue
    let inner = 1
    let j = i + 1
    for (; j < body.length && inner > 0; j += 1) {
      if (body[j] === '{') inner += 1
      else if (body[j] === '}') inner -= 1
    }
    const selector = body.slice(selectorStart, i).trim()
    if (selector && !selector.startsWith('@')) {
      rules.push({ selector, body: body.slice(i + 1, j - 1) })
    }
    selectorStart = j
    i = j - 1
  }
  return rules
}
