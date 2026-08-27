import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * EARS-430 — «every new screen this spec introduces shall be built from
 * `src/ui` … hand-rolled styles are a review stop-factor» — given a
 * machine-checkable form (spec 311 §C).
 *
 * WHY THIS FILE EXISTS. The clause landed with no assertion behind it and was
 * carried in `tools/lint/ears-test-lint.mjs` as a #314 deferral, with the note
 * that choosing between retiring it and giving it a test belonged to the re-skin
 * slice. It is not retired: it is the clause the 2026-08-26 incident violated,
 * and «a reviewer will notice» is what did not happen. It is checkable, because
 * «built from the kit» has a mechanical shadow — a surface that hand-rolls its
 * look writes colour values and ships a stylesheet, and a surface built from the
 * kit imports the kit and writes neither.
 *
 * WHAT IT DOES NOT COVER, so the coverage is not overclaimed: the cabinet shell
 * and its resource screens are also subjects of EARS-430 and do not exist yet
 * (#315). This suite scans the surfaces that DO exist, and the list below grows
 * with them — a new file under the surface is picked up automatically, which is
 * the property that keeps this from decaying into a snapshot of 2026-08-26.
 */

const root = resolve(import.meta.dirname, '../..')
const SURFACE = 'src/app/(platform)/p'

/** Every source file of the `/p` surface itself — not its sub-routes' bodies. */
function surfaceFiles(): string[] {
  return readdirSync(resolve(root, SURFACE), { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort()
}

const read = (name: string) => readFileSync(resolve(root, SURFACE, name), 'utf8')

describe('EARS-430: the /p surface is built from the kit, not hand-rolled', () => {
  it('EARS-430: the surface ships no stylesheet of its own', () => {
    // A `.css` next to a route file is the shape every hand-rolled look in this
    // repo has taken, `app-switcher.css` included — it was deleted when the kit
    // gained `dropdown-menu`. The kit's own theme entry is imported from
    // `@/ui`, which is the whole point: one place declares the look.
    expect(surfaceFiles().filter((f) => f.endsWith('.css'))).toEqual([])
    for (const file of surfaceFiles()) {
      const imports = [...read(file).matchAll(/import\s+'([^']+\.css)'/g)].map((m) => m[1])
      expect(imports.filter((i) => !i.startsWith('@/ui/'))).toEqual([])
    }
  })

  it('EARS-430: no file of the surface writes a colour, and none writes an inline style', () => {
    // Under Tailwind a value escapes the theme through `className`, not through
    // a stylesheet — `bg-[#fafafa]` is the modern form of the same mistake.
    for (const file of surfaceFiles()) {
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(source, `${file} writes a colour literal`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|color-mix)\(/,
      )
      expect(source, `${file} carries an arbitrary colour value`).not.toMatch(
        /-\[(#|rgb|hsl|oklch|oklab)/,
      )
      expect(source, `${file} sets an inline style`).not.toMatch(/\bstyle=\{/)
    }
  })

  it('EARS-430: the tile and its marks ARE kit components, imported from @/ui', () => {
    // The launcher's two element classes. Replace either with a hand-written
    // `<div className="rounded-xl border …">` and this goes red — which is the
    // regression the clause is about, in the exact form it took on #312.
    const page = read('page.tsx')
    expect(page).toMatch(/from '@\/ui\/card'/)
    expect(page).toMatch(/from '@\/ui\/badge'/)
    expect(page).toContain('<Card')
    expect(page).toContain('<Badge')

    // The bar and the switcher, likewise: avatar and separator for the bar,
    // button and dropdown-menu for the switcher.
    const bar = read('TopBar.tsx')
    expect(bar).toMatch(/from '@\/ui\/avatar'/)
    expect(bar).toMatch(/from '@\/ui\/separator'/)

    const switcher = read('AppSwitcher.tsx')
    expect(switcher).toMatch(/from '@\/ui\/button'/)
    expect(switcher).toMatch(/from '@\/ui\/dropdown-menu'/)
    expect(switcher).toContain('<DropdownMenu')
  })

  it('EARS-430: the surface takes its LAYOUT from the wireframe and its LOOK from the kit, and says so', () => {
    // The two halves come from two different rows of `design-source/README.md`
    // and the clause is explicit that it matters which. A file that documents
    // only one of them is how the #312 reading («the wireframe is the design»)
    // got written down as if it were the decision.
    const page = read('page.tsx')
    expect(page).toContain('design-source/p-launcher.html')
    expect(page).toContain('fidelity: wireframe')
    expect(page).toContain('fidelity: visual')
  })
})
