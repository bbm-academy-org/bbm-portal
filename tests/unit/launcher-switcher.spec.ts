import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppSwitcher } from '@/app/(platform)/p/AppSwitcher'
import type { WorkspaceEntry } from '@/lib/workspace/contract'

/**
 * The app switcher's OPEN menu, and the session-side mapping that feeds it
 * (spec 311 EARS-423, EARS-427).
 *
 * Why this file exists apart from `launcher-render.spec.ts`: that suite renders
 * the bar with `renderToStaticMarkup`, where `useState(false)` means the menu is
 * never in the markup at all — so nothing there constrains what the OPEN panel
 * puts on a link. An external app opened in the SAME tab loses the member's
 * workspace, which is the harm EARS-423 exists to prevent, and it loses
 * `noopener` on a cross-origin target as well. Here the control is actually
 * clicked open (jsdom + `@testing-library/react`), and the `external:` flag the
 * layout computes is read off the element tree it returns.
 *
 * The vitest include glob is `tests/unit/**\/*.spec.ts`, so this suite is
 * written with `React.createElement` rather than JSX, as the sibling suites are.
 */

const el = React.createElement

const FIXTURE: WorkspaceEntry[] = [
  {
    kind: 'internal',
    slug: 'hours',
    name: 'Часы',
    description: 'Самооценка часов',
    href: '/p/hours',
    icon: 'hours',
  },
  {
    kind: 'external',
    slug: 'plane',
    name: 'Plane',
    description: 'Задачи и проекты',
    url: 'https://plane.bbm.academy',
    icon: 'plane',
  },
  { kind: 'planned', name: 'Финансы', description: 'портфель, позже' },
]

vi.mock('@/lib/workspace/registry', () => ({
  WORKSPACE_REGISTRY: FIXTURE,
  PORTFOLIO_LATER: 'портфель, позже',
}))

let session: unknown = { user: { name: 'Анна Ковалёва', roles: ['platform-user'] } }

vi.mock('@/auth', () => ({
  auth: async () => session,
  signOut: async () => undefined,
}))

vi.mock('next/headers', () => ({
  headers: async () => new Map([['x-platform-pathname', '/p']]),
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
  forbidden: () => {
    throw new Error('forbidden')
  },
}))

interface SwitcherLink {
  key: string
  name: string
  href: string
  external: boolean
}

/**
 * The links the LAYOUT hands the switcher, read off the element tree rather than
 * off markup: the panel is closed in a server render, so the mapping would be
 * unobservable in HTML.
 */
async function switcherLinksFromLayout(): Promise<readonly SwitcherLink[]> {
  const { default: Layout } = await import('@/app/(platform)/p/layout')
  const tree = (await Layout({ children: el('div', { id: 'body' }) })) as React.ReactElement<{
    children: React.ReactNode
  }>
  for (const child of React.Children.toArray(tree.props.children)) {
    if (!React.isValidElement(child)) continue
    const props = child.props as { switcher?: React.ReactNode }
    if (props.switcher && React.isValidElement(props.switcher)) {
      return (props.switcher.props as { links: readonly SwitcherLink[] }).links
    }
  }
  throw new Error('the layout rendered no switcher')
}

beforeEach(() => {
  session = { user: { name: 'Анна Ковалёва', roles: ['platform-user'] } }
})

afterEach(() => {
  cleanup()
})

describe('the switcher panel, opened (spec 311 EARS-423, EARS-427)', () => {
  const links: SwitcherLink[] = [
    { key: 'hours', name: 'Часы', href: '/p/hours', external: false },
    { key: 'plane', name: 'Plane', href: 'https://plane.bbm.academy', external: true },
  ]

  it('EARS-423: an external item of the OPEN menu opens in its own tab, with noopener', () => {
    render(el(AppSwitcher, { links }))
    fireEvent.click(screen.getByRole('button'))

    const external = screen.getByRole('menuitem', { name: /Plane/ })
    expect(external.getAttribute('href')).toBe('https://plane.bbm.academy')
    expect(external.getAttribute('target')).toBe('_blank')
    // A cross-origin target reached without `noopener` hands the opened page a
    // live `window.opener` back into the workspace.
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')
    expect(external.textContent).toContain('↗')
  })

  it('EARS-423: an internal item carries NO target and NO rel, and no external mark', () => {
    render(el(AppSwitcher, { links }))
    fireEvent.click(screen.getByRole('button'))

    const internal = screen.getByRole('menuitem', { name: /Часы/ })
    expect(internal.getAttribute('href')).toBe('/p/hours')
    expect(internal.getAttribute('target')).toBe(null)
    expect(internal.getAttribute('rel')).toBe(null)
    expect(internal.textContent).not.toContain('↗')
  })
})

describe('what the layout hands the switcher (spec 311 EARS-427)', () => {
  it('EARS-427: an external registry entry reaches the switcher flagged external, at its url', async () => {
    // The flag is not cosmetic: it is the ONLY thing that decides `target`/`rel`
    // in the panel, so a mapping that forgets it is the same harm as a panel
    // that ignores it.
    const links = await switcherLinksFromLayout()
    expect(links.map((l) => l.key)).toEqual(['hours', 'plane'])
    expect(links.find((l) => l.key === 'plane')).toEqual({
      key: 'plane',
      name: 'Plane',
      href: 'https://plane.bbm.academy',
      external: true,
    })
    expect(links.find((l) => l.key === 'hours')?.external).toBe(false)
  })

  it('EARS-423: those very links, rendered open, target the external app at its own tab', async () => {
    render(el(AppSwitcher, { links: await switcherLinksFromLayout() }))
    fireEvent.click(screen.getByRole('button'))

    const external = screen.getByRole('menuitem', { name: /Plane/ })
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('menuitem', { name: /Часы/ }).getAttribute('target')).toBe(null)
  })
})
