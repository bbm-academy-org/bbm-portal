import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cleanup, render, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it } from 'vitest'

import { Avatar, AvatarFallback } from '@/ui/avatar'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Separator } from '@/ui/separator'
import { Toaster } from '@/ui/sonner'
import { cn } from '@/ui/utils'

/**
 * The UI kit as adopted in #360: Tailwind v4 plus the copied shadcn/ui
 * primitives on the default neutral theme (owner Stage-A decision, Антон,
 * 2026-08-26).
 *
 * What is worth asserting about a COPIED kit is not what the components look
 * like — that is upstream's business and the point of standing on a standard
 * system. It is the three things WE decided, each of which a later edit could
 * undo silently:
 *
 *   1. the copied source actually runs here (React 19 + the Radix version this
 *      repo pins) — an import-and-render smoke over every primitive;
 *   2. `components.json` keeps every generated path inside the kit, which is
 *      what makes the §10 boundary survive the NEXT `npx shadcn add`;
 *   3. the theme entry stays inert — preflight and the document-level base
 *      layer are deliberately not armed while EARS-429 holds.
 */

const root = resolve(import.meta.dirname, '../..')
const readRepo = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

describe('the copied primitives run in this repo', () => {
  // This repo's vitest setup does not wire testing-library's auto-cleanup, so
  // without this every render stacks in the same document.body and a
  // `getByRole('button')` in a later test finds the earlier test's button too.
  afterEach(cleanup)

  it('renders a button, a badge and a separator', () => {
    const { container, getByRole } = render(
      h('div', null, h(Button, null, 'Открыть'), h(Badge, null, 'внешний'), h(Separator, null)),
    )
    expect(getByRole('button').textContent).toBe('Открыть')
    expect(container.textContent).toContain('внешний')
  })

  it('renders a card with its header and content slots', () => {
    const { container } = render(
      h(
        Card,
        null,
        h(CardHeader, null, h(CardTitle, null, 'Часы')),
        h(CardContent, null, 'учёт рабочего времени'),
      ),
    )
    expect(container.textContent).toContain('Часы')
    expect(container.textContent).toContain('учёт рабочего времени')
  })

  it('renders an avatar fallback (no image source in the workspace top bar today)', () => {
    const { container } = render(h(Avatar, null, h(AvatarFallback, null, 'AS')))
    expect(container.textContent).toBe('AS')
  })

  it('renders a dropdown menu closed, with the trigger wired for a menu', () => {
    const { getByRole, queryByText } = render(
      h(
        DropdownMenu,
        null,
        h(DropdownMenuTrigger, null, 'Приложения'),
        h(DropdownMenuContent, null, h(DropdownMenuItem, null, 'OKR')),
      ),
    )
    const trigger = getByRole('button')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // Radix keeps the content unmounted until the menu opens — the closed state
    // is the one the launcher renders on first paint.
    expect(queryByText('OKR')).toBeNull()
  })

  it('cn() resolves conflicting Tailwind utilities last-wins, not by concatenation', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('bg-background', false && 'bg-card', 'text-foreground')).toBe(
      'bg-background text-foreground',
    )
  })
})

/**
 * The feedback channel follows the workspace theme (#434, review blocker 2).
 *
 * `src/ui/sonner.tsx` came from upstream reading `useTheme()` of `next-themes`,
 * a provider this repo does not run and deliberately does not want (see
 * `src/ui/README.md`): the hook then answered `'system'`, sonner asked the OS,
 * and a light toast landed on a `.dark` screen — visible in
 * `docs/evidence/434/06-save-toast-desktop-dark.png`. This repo's dark theme is
 * the `.dark` class of `src/ui/theme.css`, so that is what the Toaster reads.
 *
 * The assertions are on sonner's own `data-sonner-theme`, the attribute that
 * selects its dark palette (`richColors` included) — not on our wrapper's
 * internals.
 */
describe('the kit Toaster follows the workspace theme (#434)', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.classList.remove('dark')
  })

  /** Sonner renders its `<ol>` only once a toast exists. */
  async function toasterList(): Promise<HTMLElement> {
    toast.success('готово')
    return waitFor(() => {
      const list = document.querySelector<HTMLElement>('[data-sonner-toaster]')
      if (!list) throw new Error('the toaster list has not rendered yet')
      return list
    })
  }

  it('#434: under the theme’s own `.dark` root the toast is dark', async () => {
    document.documentElement.classList.add('dark')
    render(h(Toaster, { position: 'bottom-right', richColors: true }))
    expect((await toasterList()).getAttribute('data-sonner-theme')).toBe('dark')
  })

  it('#434: with no `.dark` root the toast is light — and never `system`', async () => {
    render(h(Toaster, { position: 'bottom-right', richColors: true }))
    expect((await toasterList()).getAttribute('data-sonner-theme')).toBe('light')
  })

  it('#434: the class going on AFTER mount re-themes the toaster', async () => {
    // The workspace ships no theme switch today, so this is the clause that
    // keeps the read live rather than a mount-time snapshot — and it is what a
    // future switch will rely on.
    render(h(Toaster, { position: 'bottom-right', richColors: true }))
    const list = await toasterList()
    expect(list.getAttribute('data-sonner-theme')).toBe('light')
    document.documentElement.classList.add('dark')
    await waitFor(() => {
      expect(
        document.querySelector('[data-sonner-toaster]')?.getAttribute('data-sonner-theme'),
      ).toBe('dark')
    })
  })
})

describe('components.json keeps the kit self-contained', () => {
  const config = JSON.parse(readRepo('components.json')) as {
    aliases: Record<string, string>
    tailwind: { css: string; baseColor: string; cssVariables: boolean }
  }

  it('EARS-458: every generated path aliases into src/ui, so the next `shadcn add` cannot land outside the kit', () => {
    const outside = Object.entries(config.aliases).filter(([, t]) => !t.startsWith('@/ui'))
    expect(outside).toEqual([])
    expect(Object.keys(config.aliases).sort()).toEqual([
      'components',
      'hooks',
      'lib',
      'ui',
      'utils',
    ])
  })

  it('names the kit theme entry and the neutral base colour the owner adopted', () => {
    expect(config.tailwind.css).toBe('src/ui/theme.css')
    expect(config.tailwind.baseColor).toBe('neutral')
    expect(config.tailwind.cssVariables).toBe(true)
  })
})

// Deliberately NOT titled with the EARS-429 id. This suite asserts one half of
// that clause — that the kit restyles nothing that did not ask to be restyled —
// and the clause's own subject is the top bar landing on /p/okr and /p/hours,
// which is #314's. A half-assertion that claims the id would drain a real
// deferral for a test that does not cover it.
describe('the theme entry restyles only what opted in (the no-reskin half of spec 311 §C)', () => {
  const theme = readRepo('src/ui/theme.css')
  const code = theme.replace(/\/\*[\s\S]*?\*\//g, '')

  it('declares the neutral theme in :root and .dark', () => {
    expect(code).toContain(':root {')
    expect(code).toContain('.dark {')
    expect(code).toMatch(/--background:\s*oklch\(1 0 0\)/)
  })

  it('does not import Tailwind preflight — an @import cannot be scoped, and unscoped it would restyle /p/okr and /p/hours', () => {
    expect(code).not.toContain('preflight')
    // `@import "tailwindcss"` is the bundle that CONTAINS preflight; the entry
    // imports the theme and utilities layers by name instead.
    expect(code).not.toMatch(/@import\s+['"]tailwindcss['"]/)
    expect(code).toContain('tailwindcss/utilities.css')
  })

  it('arms a base layer, and EVERY selector in it is confined to a [data-bbm-ui] subtree', () => {
    // The base layer is armed since the re-skin of #360, which is why this test
    // replaced «arms no base layer». What keeps it legal while EARS-429 holds is
    // the scoping, so the scoping is what is asserted — not the presence of the
    // block. Drop the `[data-bbm-ui]` prefix from any one selector below and the
    // rule reaches /p/okr and /p/hours, and this test goes red.
    const selectors = baseLayerSelectors(code)
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) {
      expect(selector, `"${selector}" can match outside an opted-in subtree`).toMatch(
        /^\[data-bbm-ui\]/,
      )
    }
  })

  it('paints no page-level element — no html, body or bare * rule survives anywhere in the file', () => {
    // Belt and braces for the rule above: a document-level painter added OUTSIDE
    // `@layer base` would escape `baseLayerSelectors` entirely.
    for (const selector of topLevelSelectors(code)) {
      expect(selector, `"${selector}" is a document-level selector`).not.toMatch(
        /^(\*|html|body|:root\s|:host)/,
      )
    }
  })
})

/**
 * The comma-separated selectors of every rule inside the file's `@layer base`
 * block. Nesting inside the block is one level deep by construction (plain rules
 * only), which is what makes this a scan rather than a parser.
 */
function baseLayerSelectors(css: string): string[] {
  const start = css.indexOf('@layer base {')
  if (start === -1) return []
  let depth = 0
  let end = start
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = css.slice(css.indexOf('{', start) + 1, end)
  return ruleSelectors(body)
}

/** Selectors of the rules at the top level of a CSS body, `@…` blocks excluded. */
function ruleSelectors(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let head = ''
  for (const ch of body) {
    if (ch === '{') {
      depth += 1
      if (depth === 1) {
        const selector = head.trim()
        if (selector && !selector.startsWith('@')) {
          out.push(...splitSelectorList(selector))
        }
        head = ''
        continue
      }
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) head = ''
      continue
    }
    if (depth === 0) head += ch
  }
  return out.filter(Boolean)
}

/**
 * Split a selector list on its TOP-LEVEL commas only — `:is(h1, h2, h3)` is one
 * selector, and splitting inside the parens would report `h2` as an unscoped
 * rule that does not exist.
 */
function splitSelectorList(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of list) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  out.push(current.trim())
  return out.filter(Boolean)
}

/** Selectors of the rules written at the top level of the FILE (outside @layer). */
function topLevelSelectors(css: string): string[] {
  return ruleSelectors(css).filter((s) => s !== ':root' && s !== '.dark')
}
