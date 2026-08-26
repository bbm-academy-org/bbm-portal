import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cleanup, render } from '@testing-library/react'
import { createElement as h } from 'react'
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
// that clause — that the kit's arrival restyles nothing — and the clause's own
// subject is the top bar landing on /p/okr and /p/hours, which is #314's. A
// half-assertion that claims the id would drain a real deferral for a test that
// does not cover it.
describe('the theme entry is deliberately inert (the no-reskin half of spec 311 §C)', () => {
  const theme = readRepo('src/ui/theme.css')
  const code = theme.replace(/\/\*[\s\S]*?\*\//g, '')

  it('declares the neutral theme in :root and .dark', () => {
    expect(code).toContain(':root {')
    expect(code).toContain('.dark {')
    expect(code).toMatch(/--background:\s*oklch\(1 0 0\)/)
  })

  it('does not import Tailwind preflight — it would restyle /p/okr and /p/hours today', () => {
    expect(code).not.toContain('preflight')
    // `@import "tailwindcss"` is the bundle that CONTAINS preflight; the entry
    // imports the theme and utilities layers by name instead.
    expect(code).not.toMatch(/@import\s+['"]tailwindcss['"]/)
    expect(code).toContain('tailwindcss/utilities.css')
  })

  it('arms no document-level base layer', () => {
    expect(code).not.toMatch(/@layer\s+base\s*\{/)
  })
})
