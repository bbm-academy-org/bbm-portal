import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AppTile, Button, Container, Eyebrow, PageHeader, Tag, TileGrid, TopBar } from '@/ui'

/**
 * Markup contract of the UI kit (#312). Every clause below traces to one of the
 * two vendored Stage-A sources — `design-source/p-launcher.html` (option
 * `launcher-a`) and `design-source/p-admin-shell.html` (option `admin-a`) — or
 * to a clause of `docs/specs/311-portal-workspace.md` that constrains what the
 * kit may render.
 *
 * The kit ships **presentation only** (`build-ui-from-design-system` rung 5):
 * no registry import, no data fetching, no auth gating. That half is machine-
 * enforced by the `ui-kit-must-not-import-src` boundary rule — see
 * `tests/unit/platform-boundaries.spec.ts`.
 *
 * `.spec.ts`, not `.spec.tsx`: the vitest include glob is
 * `tests/unit/**\/*.spec.ts` (vitest.config.mts), so the suite is written with
 * `React.createElement`, exactly as `tests/unit/okr-view-markup.spec.ts` is.
 */

const el = React.createElement

/**
 * The clause ids appear in COMMENTS here, never in a title. `ears-test` reads
 * an `it`/`describe` title as a claim that the clause is covered, and these
 * clauses are about the LAUNCHER and the CABINET — «render a top bar on every
 * /p/* page», «render one placeholder per not-yet-live app». The kit supplies
 * the element those clauses are satisfied WITH; satisfying them is #314's and
 * #315's, and their deferral entries name exactly those issues. EARS-458 is
 * the one clause this task closes outright, and it is titled as such in
 * tests/unit/platform-boundaries.spec.ts.
 */
describe('TopBar — the chrome every workspace page shares', () => {
  it('carries the workspace home link, the member and the caller’s action slot', () => {
    const html = renderToStaticMarkup(
      el(TopBar, {
        homeHref: '/p',
        appName: 'Часы',
        memberName: 'Анна Ковалёва',
        actions: el(Button, { variant: 'plain' }, 'Выйти'),
      }),
    )
    expect(html).toContain('href="/p"')
    expect(html).toContain('BBM · Портал')
    expect(html).toContain('Часы')
    expect(html).toContain('Анна Ковалёва')
    expect(html).toContain('Выйти')
  })

  it('names no current app while the member is on the home itself', () => {
    const html = renderToStaticMarkup(el(TopBar, { homeHref: '/p', memberName: 'Анна Ковалёва' }))
    expect(html).not.toContain('bbm-top-bar__app')
    expect(html).not.toContain('bbm-top-bar__sep')
  })

  it('renders the app switcher as a SLOT — the registry never reaches the kit', () => {
    const html = renderToStaticMarkup(
      el(TopBar, {
        homeHref: '/p',
        memberName: 'Анна Ковалёва',
        switcher: el(Button, null, 'Приложения ▾'),
      }),
    )
    expect(html).toContain('Приложения ▾')
  })

  it('offers the full-width inner box the cabinet shell uses', () => {
    const contained = renderToStaticMarkup(el(TopBar, { homeHref: '/p', memberName: 'А' }))
    const full = renderToStaticMarkup(
      el(TopBar, { homeHref: '/p', memberName: 'А', width: 'full' }),
    )
    expect(contained).toContain('bbm-top-bar__inner--contained')
    expect(full).not.toContain('bbm-top-bar__inner--contained')
  })
})

describe('AppTile — the four tile forms the launcher needs', () => {
  it('renders an internal entry as a link carrying its status line', () => {
    const html = renderToStaticMarkup(
      el(AppTile, {
        name: 'Часы',
        description: 'Самооценка часов',
        href: '/p/hours',
        status: 'Период «август 2026» открыт до 1 сентября',
      }),
    )
    expect(html).toContain('<a')
    expect(html).toContain('href="/p/hours"')
    expect(html).toContain('bbm-app-tile__status')
    expect(html).toContain('Период «август 2026» открыт до 1 сентября')
  })

  it('marks an external entry and opens it in a new tab, safely', () => {
    const html = renderToStaticMarkup(
      el(AppTile, {
        variant: 'external',
        name: 'Plane',
        description: 'Задачи и проекты',
        href: 'https://plane.bbm.academy',
      }),
    )
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('↗ внешний')
  })

  it('flags the admin entry as administrator-only', () => {
    const html = renderToStaticMarkup(
      el(AppTile, { variant: 'admin', name: 'Админка', href: '/p/admin' }),
    )
    expect(html).toContain('bbm-app-tile--admin')
    expect(html).toContain('только администратор')
  })

  it('a planned placeholder is inert — no link, no focus, no status', () => {
    const html = renderToStaticMarkup(
      el(AppTile, {
        variant: 'planned',
        name: 'Финансы',
        status: 'this must never be rendered',
      }),
    )
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
    expect(html).not.toContain('tabindex')
    expect(html).not.toContain('bbm-app-tile__status')
    expect(html).not.toContain('this must never be rendered')
    expect(html).toContain('портфель, позже')
  })

  it('renders no status element when the entry declares no status', () => {
    const html = renderToStaticMarkup(el(AppTile, { name: 'Колоды', href: '/p/decks' }))
    expect(html).not.toContain('bbm-app-tile__status')
  })

  it('lets the caller override the marker copy rather than freezing it in the kit', () => {
    const html = renderToStaticMarkup(
      el(AppTile, { variant: 'planned', name: 'CRM', plannedLabel: 'скоро' }),
    )
    expect(html).toContain('скоро')
    expect(html).not.toContain('портфель, позже')
  })
})

describe('TileGrid', () => {
  it('wraps its tiles in the launcher grid', () => {
    const html = renderToStaticMarkup(
      el(TileGrid, { children: el(AppTile, { name: 'Часы', href: '/p/hours' }) }),
    )
    expect(html).toContain('bbm-tile-grid')
    expect(html).toContain('Часы')
  })
})

describe('PageHeader', () => {
  it('renders the title as the page h1 and the subtitle beneath it', () => {
    const html = renderToStaticMarkup(
      el(PageHeader, {
        title: 'Рабочее пространство BBM',
        subtitle: 'Всё, что открыто для вас сегодня.',
      }),
    )
    expect(html).toContain('<h1')
    expect(html).toContain('Рабочее пространство BBM')
    expect(html).toContain('Всё, что открыто для вас сегодня.')
  })

  it('omits the subtitle element when there is no subtitle', () => {
    const html = renderToStaticMarkup(el(PageHeader, { title: 'Участники' }))
    expect(html).not.toContain('bbm-page-header__subtitle')
  })

  it('offers the cabinet’s smaller heading size', () => {
    const html = renderToStaticMarkup(el(PageHeader, { title: 'Участники', size: 'md' }))
    expect(html).toContain('bbm-page-header--md')
  })
})

describe('Button', () => {
  it('is a real button that never submits a form by accident', () => {
    expect(renderToStaticMarkup(el(Button, null, 'Добавить участника'))).toContain('type="button"')
  })

  it('carries the plain variant of the sign-out control', () => {
    expect(renderToStaticMarkup(el(Button, { variant: 'plain' }, 'Выйти'))).toContain(
      'bbm-button--plain',
    )
  })

  it('marks a disabled control as disabled, not merely greyed', () => {
    expect(renderToStaticMarkup(el(Button, { disabled: true }, 'Выйти'))).toContain('disabled')
  })
})

describe('Container', () => {
  it('holds the workspace measure, and renders the element the caller names', () => {
    const html = renderToStaticMarkup(el(Container, { as: 'main', children: 'содержимое' }))
    expect(html).toContain('<main')
    expect(html).toContain('bbm-container')
    expect(html).not.toContain('bbm-container--full')
  })

  it('runs full-bleed for the cabinet shell', () => {
    expect(renderToStaticMarkup(el(Container, { width: 'full', children: 'x' }))).toContain(
      'bbm-container--full',
    )
  })
})

describe('Tag and Eyebrow', () => {
  it('renders a tag, and its muted form for a deactivated row', () => {
    expect(renderToStaticMarkup(el(Tag, { children: 'активен' }))).toContain('bbm-tag')
    expect(renderToStaticMarkup(el(Tag, { muted: true, children: 'деактивирован' }))).toContain(
      'bbm-tag--muted',
    )
  })

  it('renders an eyebrow label in its two sizes', () => {
    expect(renderToStaticMarkup(el(Eyebrow, { children: 'Разделы' }))).toContain('bbm-eyebrow')
    expect(
      renderToStaticMarkup(el(Eyebrow, { size: 'xs', children: 'только администратор' })),
    ).toContain('bbm-eyebrow--xs')
  })
})
