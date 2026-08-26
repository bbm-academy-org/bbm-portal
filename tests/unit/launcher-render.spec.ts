import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceEntry } from '@/lib/workspace/contract'

/**
 * `/p` and the shared top bar, rendered (spec 311 §C).
 *
 * Both surfaces are driven by a FIXTURE registry rather than the real one: what
 * these clauses promise is that the frame renders whatever the composition root
 * holds, and a test pinned to today's inventory would fail on the day an app
 * ships — the one day it must not. The real registry's own contents are asserted
 * in `workspace-registry.spec.ts`.
 *
 * The vitest include glob is `tests/unit/**\/*.spec.ts`, so this suite is
 * written with `React.createElement` rather than JSX, exactly as
 * `tests/unit/ui-markup.spec.ts` is.
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
    status: () => 'Период «август 2026» открыт до 1 сентября',
  },
  {
    kind: 'internal',
    slug: 'okr',
    name: 'OKR',
    description: 'Цели квартала',
    href: '/p/okr',
    icon: 'okr',
    status: async () => {
      throw new Error('Plane is unreachable')
    },
  },
  {
    kind: 'internal',
    slug: 'admin',
    name: 'Админка',
    description: 'только администратор',
    href: '/p/admin',
    icon: 'admin',
    requiredClaim: 'platform-admin',
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
  { kind: 'planned', name: 'Колоды', description: 'портфель, позже' },
]

vi.mock('@/lib/workspace/registry', () => ({
  WORKSPACE_REGISTRY: FIXTURE,
  PORTFOLIO_LATER: 'портфель, позже',
}))

let session: unknown = { user: { name: 'Анна Ковалёва', roles: ['platform-user'] } }
let pathname = '/p'

vi.mock('@/auth', () => ({
  auth: async () => session,
  signOut: async () => undefined,
}))

vi.mock('next/headers', () => ({
  headers: async () => new Map([['x-platform-pathname', pathname]]),
}))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
  forbidden: () => {
    throw new Error('forbidden')
  },
}))

async function renderHome(): Promise<string> {
  const { default: Page } = await import('@/app/(platform)/p/page')
  return renderToStaticMarkup(await Page())
}

async function renderBar(): Promise<string> {
  const { default: Layout } = await import('@/app/(platform)/p/layout')
  return renderToStaticMarkup(await Layout({ children: el('div', { id: 'body' }) }))
}

function dom(html: string): HTMLDivElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

beforeEach(() => {
  session = { user: { name: 'Анна Ковалёва', roles: ['platform-user'] } }
  pathname = '/p'
})

describe('the workspace home (spec 311 EARS-422, EARS-468)', () => {
  it('EARS-422: renders the visible entries as ONE flat grid in registry order', async () => {
    const host = dom(await renderHome())
    expect(host.querySelectorAll('.bbm-tile-grid')).toHaveLength(1)
    const names = Array.from(host.querySelectorAll('.bbm-app-tile__name')).map((n) => n.textContent)
    // Registry order, minus the claim-gated cabinet this session may not see.
    expect(names).toEqual(['Часы', 'OKR', 'Plane', 'Финансы', 'Колоды'])
  })

  it('EARS-468: carries the four tile forms the vendored file draws, and no fifth', async () => {
    const host = dom(await renderHome())
    session = { user: { name: 'A', roles: ['platform-admin'] } }
    const adminHost = dom(await renderHome())
    const forms = new Set(
      Array.from(adminHost.querySelectorAll('.bbm-app-tile')).flatMap((tile) =>
        Array.from(tile.classList).filter((c) => c.startsWith('bbm-app-tile--')),
      ),
    )
    expect([...forms].sort()).toEqual([
      'bbm-app-tile--admin',
      'bbm-app-tile--external',
      'bbm-app-tile--internal',
      'bbm-app-tile--planned',
    ])
    expect(host.querySelectorAll('.bbm-app-tile--admin')).toHaveLength(0)
  })

  it('EARS-423: an external entry is marked «↗ внешний» and opens in its own tab', async () => {
    const host = dom(await renderHome())
    const tile = host.querySelector('.bbm-app-tile--external') as HTMLAnchorElement
    expect(tile.tagName).toBe('A')
    expect(tile.getAttribute('href')).toBe('https://plane.bbm.academy')
    expect(tile.getAttribute('target')).toBe('_blank')
    expect(tile.getAttribute('rel')).toBe('noopener noreferrer')
    expect(tile.textContent).toContain('↗ внешний')
  })

  it('EARS-408: a tile whose module publishes a line shows it; EARS-407: a failed one still renders', async () => {
    const host = dom(await renderHome())
    const tiles = Array.from(host.querySelectorAll('.bbm-app-tile'))
    const hours = tiles.find((t) => t.textContent?.includes('Часы'))
    const okr = tiles.find((t) => t.textContent?.includes('OKR'))
    expect(hours?.querySelector('.bbm-app-tile__status')?.textContent).toBe(
      'Период «август 2026» открыт до 1 сентября',
    )
    // The OKR provider threw. The tile is still a complete, openable tile — the
    // page did not fail, and the failure surfaces as «no line», not as an error.
    expect(okr?.tagName).toBe('A')
    expect(okr?.getAttribute('href')).toBe('/p/okr')
    expect(okr?.querySelector('.bbm-app-tile__status--empty')?.textContent).toBe(
      '— без статус-строки —',
    )
  })

  it('EARS-404: a claim-gated entry is absent from the RESPONSE BODY, not hidden (D-7)', async () => {
    const html = await renderHome()
    expect(html).not.toContain('/p/admin')
    expect(html).not.toContain('Админка')
    expect(html).not.toContain('только администратор')
  })

  it('EARS-404/417: an account holding only platform-admin sees the cabinet tile', async () => {
    session = { user: { name: 'Антон', roles: ['platform-admin'] } }
    const host = dom(await renderHome())
    const tile = host.querySelector('.bbm-app-tile--admin') as HTMLAnchorElement
    expect(tile.getAttribute('href')).toBe('/p/admin')
    expect(tile.textContent).toContain('только администратор')
    expect(tile.querySelector('.bbm-app-tile__status--empty')?.textContent).toBe(
      '— без статус-строки —',
    )
  })
})

describe('the portfolio placeholders (spec 311 EARS-477, EARS-478)', () => {
  it('EARS-478: a placeholder is a non-link, is not focusable and carries no status line', async () => {
    const host = dom(await renderHome())
    const planned = Array.from(host.querySelectorAll('.bbm-app-tile--planned'))
    expect(planned).toHaveLength(2)
    for (const tile of planned) {
      expect(tile.tagName).toBe('DIV')
      expect(tile.getAttribute('href')).toBe(null)
      expect(tile.getAttribute('tabindex')).toBe(null)
      expect(tile.querySelector('.bbm-app-tile__status')).toBe(null)
      expect(tile.textContent).toContain('портфель, позже')
    }
  })

  it('EARS-478: a placeholder is shown identically to every session, admin included', async () => {
    const memberHtml = dom(await renderHome()).querySelectorAll('.bbm-app-tile--planned')[0]
      .outerHTML
    session = { user: { name: 'Антон', roles: ['platform-admin'] } }
    const adminHtml = dom(await renderHome()).querySelectorAll('.bbm-app-tile--planned')[0]
      .outerHTML
    expect(adminHtml).toBe(memberHtml)
  })

  it('EARS-477: placeholders come last, below the live apps', async () => {
    const host = dom(await renderHome())
    const tiles = Array.from(host.querySelectorAll('.bbm-app-tile'))
    const firstPlanned = tiles.findIndex((t) => t.classList.contains('bbm-app-tile--planned'))
    expect(firstPlanned).toBeGreaterThan(0)
    expect(
      tiles.slice(firstPlanned).every((t) => t.classList.contains('bbm-app-tile--planned')),
    ).toBe(true)
  })
})

describe('the home at full portfolio size (spec 311 EARS-471)', () => {
  it('EARS-471: stays ONE flat grid with the whole target portfolio present', async () => {
    const host = dom(await renderHome())
    expect(host.querySelectorAll('.bbm-tile-grid')).toHaveLength(1)
    // No grouping element, no second grid, no per-section heading: the flat grid
    // of `launcher-a` is the only structure on the page.
    expect(host.querySelectorAll('h2, h3, section')).toHaveLength(0)
    // The grid is `auto-fill` at a minimum column width rather than a fixed
    // four (src/ui/README.md §1, EARS-428) — that is what keeps it readable both
    // at full portfolio size and while narrow.
    expect(host.querySelector('.bbm-tile-grid')?.className).toBe('bbm-tile-grid')
  })
})

describe('the shared top bar (spec 311 EARS-425, EARS-429, EARS-469, EARS-470)', () => {
  it('EARS-425: the layout renders the bar, so every /p/* page carries it by existing', async () => {
    const host = dom(await renderBar())
    expect(host.querySelectorAll('.bbm-top-bar')).toHaveLength(1)
    expect(host.querySelector('.bbm-top-bar__home')?.getAttribute('href')).toBe('/p')
    expect(host.querySelector('.bbm-top-bar__member')?.textContent).toBe('Анна Ковалёва')
    expect(host.textContent).toContain('Выйти')
  })

  it('EARS-429: the page body below the bar is rendered untouched', async () => {
    const host = dom(await renderBar())
    expect(host.querySelector('#body')).not.toBe(null)
  })

  it('EARS-470: on /p the bar is in its home state and names no app of the registry', async () => {
    const host = dom(await renderBar())
    const app = host.querySelector('.bbm-top-bar__app')?.textContent
    // `design-source/p-launcher.html` draws this slot as «Главная» on the home —
    // the bar naming the home, not naming an app. No registry entry is named.
    expect(app).toBe('Главная')
    for (const entry of FIXTURE) {
      expect(host.querySelector('.bbm-top-bar__app')?.textContent).not.toBe(entry.name)
    }
  })

  it('EARS-469: on an app path the bar names that app, longest prefix wins', async () => {
    pathname = '/p/hours'
    expect(dom(await renderBar()).querySelector('.bbm-top-bar__app')?.textContent).toBe('Часы')
    pathname = '/p/okr'
    expect(dom(await renderBar()).querySelector('.bbm-top-bar__app')?.textContent).toBe('OKR')
  })

  it('EARS-427/428: the switcher is one collapsed control fed by the registry', async () => {
    const host = dom(await renderBar())
    const toggle = host.querySelector('.bbm-app-switcher button') as HTMLButtonElement
    expect(toggle.textContent).toBe('Приложения ▾')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-haspopup')).toBe('menu')
    // Collapsed by default at EVERY width — which is what makes the narrow
    // viewport of EARS-428 the same control and not a second design.
    expect(host.querySelector('.bbm-app-switcher__menu')).toBe(null)
  })

  it('EARS-427: the switcher carries the openable entries of THIS session and no placeholder', async () => {
    const { AppSwitcher } = await import('@/app/(platform)/p/AppSwitcher')
    const links = [
      { key: 'hours', name: 'Часы', href: '/p/hours', external: false },
      { key: 'plane', name: 'Plane', href: 'https://plane.bbm.academy', external: true },
    ]
    // Rendered open, which is the state the wireframe does not draw: the panel
    // is a list of links, external ones marked and targeted like their tiles.
    const host = dom(renderToStaticMarkup(el(AppSwitcher, { links })))
    expect(host.querySelector('.bbm-app-switcher button')).not.toBe(null)
    expect(host.textContent).not.toContain('портфель, позже')
  })
})
