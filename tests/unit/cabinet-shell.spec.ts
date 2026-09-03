import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cleanup, render } from '@testing-library/react'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  CABINET_ROOT,
  cabinetBreadcrumb,
  cabinetResources,
  cabinetSchemas,
} from '@/app/(platform)/p/admin/resources'
import type { WorkspaceEntry } from '@/lib/workspace/contract'

/**
 * The `/p/admin` cabinet shell (spec 311 §D).
 *
 * Driven by a FIXTURE registry, for the reason `launcher-render.spec.ts` gives:
 * these clauses promise that the shell renders whatever the composition root
 * holds, and a suite pinned to today's inventory would fail on the day an app
 * ships — the one day it must not.
 *
 * The vitest include glob is `tests/unit/**\/*.spec.ts`, so this suite is
 * written with `React.createElement` rather than JSX.
 */

const el = React.createElement
const root = resolve(import.meta.dirname, '../..')
const schema = z.object({ id: z.string() })

const HOURS: WorkspaceEntry = {
  kind: 'internal',
  slug: 'hours',
  name: 'Часы',
  description: 'Самооценка часов',
  href: '/p/hours',
  icon: 'hours',
  admin: {
    label: 'Часы',
    resources: [
      { name: 'periods', label: 'Периоды', operations: ['list', 'show', 'create', 'edit'], schema },
      { name: 'participants', label: 'Ставки и грейды', operations: ['list', 'edit'], schema },
    ],
  },
}

/** A module with NO admin section — the subject of EARS-410. */
const OKR_NO_SECTION: WorkspaceEntry = {
  kind: 'internal',
  slug: 'okr',
  name: 'OKR',
  description: 'Цели квартала',
  href: '/p/okr',
  icon: 'okr',
}

/** An external entry and a placeholder: neither may appear under `/p/admin`. */
const PLANE: WorkspaceEntry = {
  kind: 'external',
  slug: 'plane',
  name: 'Plane',
  description: 'Задачи',
  url: 'https://plane.bbm.academy',
  icon: 'plane',
}
const PLANNED: WorkspaceEntry = { kind: 'planned', name: 'Финансы', description: 'портфель, позже' }

describe('EARS-409: a module that declares an admin section becomes a navigation group', () => {
  it('EARS-409: the group is a real parent node and its resources are its children', () => {
    const resources = cabinetResources([HOURS])
    const parent = resources.find((r) => r.name === 'hours')
    expect(parent?.meta?.label).toBe('Часы')
    // A parent with no `list` is a GROUP, not a link — Refine renders it as an
    // expandable node, which is EARS-433's «a real parent node with indented
    // children» rather than a heading over a flat list.
    expect(parent?.list).toBeUndefined()

    const children = resources.filter((r) => r.meta?.parent === 'hours')
    expect(children.map((r) => r.meta?.label)).toEqual(['Периоды', 'Ставки и грейды'])
  })

  it('EARS-409: each resource is mounted at /p/admin/<slug>/<resource> (D-9)', () => {
    const resources = cabinetResources([HOURS])
    expect(resources.find((r) => r.name === 'hours.periods')?.list).toBe(
      `${CABINET_ROOT}/hours/periods`,
    )
  })

  it('EARS-409: the shell needs no edit to gain a module — the tree is derived, not written', () => {
    // The whole of D-2 on the cabinet's side: a second module in the registry
    // produces a second group, and the shell's own files are untouched.
    const second: WorkspaceEntry = {
      ...HOURS,
      slug: 'finance',
      admin: {
        label: 'Финансы',
        resources: [{ name: 'ledger', label: 'Реестр', operations: ['list'] as const, schema }],
      },
    }
    const names = cabinetResources([HOURS, second]).map((r) => r.name)
    expect(names).toContain('finance')
    expect(names).toContain('finance.ledger')
  })
})

describe('EARS-410: a module with no admin section has no presence under /p/admin', () => {
  it('EARS-410: no group, no item, no route — for an internal module, an external entry or a placeholder', () => {
    const resources = cabinetResources([HOURS, OKR_NO_SECTION, PLANE, PLANNED])
    const names = resources.map((r) => r.name)
    expect(names).not.toContain('okr')
    expect(names).not.toContain('plane')
    expect(JSON.stringify(resources)).not.toContain('Финансы')
    expect(JSON.stringify(resources)).not.toContain('OKR')
  })
})

describe('EARS-437: an operation a resource does not support is absent, not disabled', () => {
  it('EARS-437: only the declared operations get an action route', () => {
    const resources = cabinetResources([HOURS])
    const periods = resources.find((r) => r.name === 'hours.periods')
    const participants = resources.find((r) => r.name === 'hours.participants')

    // Периоды support create; Ставки и грейды do not (the spec's CRUD table:
    // a participant is upserted by email, never created blind, and neither
    // resource supports delete).
    expect(periods?.create).toBe(`${CABINET_ROOT}/hours/periods/create`)
    expect(participants?.create).toBeUndefined()
    expect(periods?.show).toBe(`${CABINET_ROOT}/hours/periods/show/:id`)
    expect(participants?.show).toBeUndefined()
    // Nothing declares delete here, so nothing anywhere can link to one.
    expect(JSON.stringify(resources)).not.toContain('/delete')
  })

  it('EARS-437: the declared operations ride on the resource meta, so a screen can ask', () => {
    const periods = cabinetResources([HOURS]).find((r) => r.name === 'hours.periods')
    expect(periods?.meta?.operations).toEqual(['list', 'show', 'create', 'edit'])
  })
})

describe('EARS-435: every cabinet screen says whose data it is showing', () => {
  it('EARS-435: the breadcrumb is `Админка / <module> / <resource>`', () => {
    const crumbs = cabinetBreadcrumb([HOURS], `${CABINET_ROOT}/hours/periods`)
    expect(crumbs.map((c) => c.label)).toEqual(['Админка', 'Часы', 'Периоды'])
    expect(crumbs[0].href).toBe(CABINET_ROOT)
    expect(crumbs[2].href).toBe(`${CABINET_ROOT}/hours/periods`)
  })

  it('EARS-435: a deeper action keeps the resource crumb — `create` is not a fourth level', () => {
    const crumbs = cabinetBreadcrumb([HOURS], `${CABINET_ROOT}/hours/periods/create`)
    expect(crumbs.map((c) => c.label)).toEqual(['Админка', 'Часы', 'Периоды'])
  })

  it('EARS-435: on the index itself there is one crumb and no module is named', () => {
    expect(cabinetBreadcrumb([HOURS], CABINET_ROOT).map((c) => c.label)).toEqual(['Админка'])
  })

  it('EARS-435: an unknown path names the cabinet and invents nothing', () => {
    expect(cabinetBreadcrumb([HOURS], `${CABINET_ROOT}/nope/whatever`).map((c) => c.label)).toEqual(
      ['Админка'],
    )
  })
})

describe('EARS-436: the resource schema the provider parses with is the module’s own', () => {
  it('EARS-436: `cabinetSchemas` keys the module schemas by the same resource name', () => {
    const schemas = cabinetSchemas([HOURS])
    expect(Object.keys(schemas)).toEqual(['hours.periods', 'hours.participants'])
    expect(schemas['hours.periods']).toBe(schema)
  })

  it('EARS-402/436: validation derives the module’s own schema from the composition root', async () => {
    const [{ okrParametersSchema }, { WORKSPACE_REGISTRY }] = await Promise.all([
      import('@/lib/okr/contract'),
      import('@/lib/workspace'),
    ])
    const fromRegistry = cabinetSchemas(WORKSPACE_REGISTRY)
    expect(fromRegistry['okr.parameters']).toBe(okrParametersSchema)

    const frameFiles = [
      'src/app/(platform)/p/admin/actions.ts',
      'src/app/(platform)/p/admin/CabinetShell.tsx',
      'src/app/(platform)/p/admin/CabinetSidebar.tsx',
      'src/app/(platform)/p/admin/layout.tsx',
      'src/app/(platform)/p/admin/page.tsx',
      'src/app/(platform)/p/admin/resources.ts',
      'src/app/(platform)/p/admin/schemas.ts',
      'src/app/(platform)/p/admin/validation.ts',
    ]
      .map((file) => resolve(root, file))
      .filter(existsSync)

    for (const file of frameFiles) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} imports a module contract`).not.toMatch(
        /from ['"]@\/lib\/(?!workspace(?:\/|['"])|platform(?:\/|['"]))[^'"]+\/contract['"]/,
      )
      expect(source, `${file} owns a second module list`).not.toContain('CABINET_SECTIONS')
    }
  })
})

describe('EARS-474: the navigation stays usable at the full target portfolio', () => {
  it('EARS-474: ten modules produce ten groups and no flattening', () => {
    // consolidation §4's ten apps, each with an admin section — the fixture
    // `315-product.md` names as the evidence for this clause.
    const ten: WorkspaceEntry[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'internal',
      slug: `m${i}`,
      name: `Модуль ${i}`,
      description: 'x',
      href: `/p/m${i}`,
      icon: 'x',
      admin: {
        label: `Модуль ${i}`,
        resources: [{ name: 'items', label: 'Записи', operations: ['list'], schema }],
      },
    }))
    const resources = cabinetResources(ten)
    const groups = resources.filter((r) => !r.meta?.parent)
    expect(groups).toHaveLength(10)
    // Every child names its parent: a ten-group sidebar that lost the parent
    // links would render as one flat list of thirty items.
    expect(resources.filter((r) => r.meta?.parent)).toHaveLength(10)
  })
})

describe('EARS-433: the sidebar renders the nesting visibly, not as a heading over a flat list', () => {
  it('EARS-433: a group node carries its children in a nested list, indented', async () => {
    const { CabinetSidebar } = await import('@/app/(platform)/p/admin/CabinetSidebar')
    const html = renderToStaticMarkup(
      el(CabinetSidebar, {
        selectedKey: 'hours.periods',
        items: [
          {
            key: 'hours',
            name: 'hours',
            label: 'Часы',
            children: [
              {
                key: 'hours.periods',
                name: 'hours.periods',
                label: 'Периоды',
                route: '/p/admin/hours/periods',
                children: [],
              },
              {
                key: 'hours.participants',
                name: 'hours.participants',
                label: 'Ставки и грейды',
                route: '/p/admin/hours/participants',
                children: [],
              },
            ],
          },
        ],
      }),
    )
    // A real parent node with a nested child list — the owner amendment (a) of
    // 2026-08-25 asked for nesting that is VISIBLY explicit.
    expect(html).toContain('data-nav-group="hours"')
    expect(html).toContain('data-nav-children')
    expect(html).toContain('data-nav-item="hours.periods"')
    // The selected item is marked, so «which screen am I on» is answered by the
    // sidebar and not only by the breadcrumb.
    expect(html).toMatch(/data-nav-item="hours\.periods"[^>]*aria-current="page"/)
    // A group with children is not itself a link: there is no screen behind it.
    expect(html).not.toMatch(/<a[^>]*data-nav-group/)
  })

  it('EARS-433: an empty cabinet says so rather than rendering an empty box', () => {
    // The wireframe does not depict the empty state; its header lists it as one
    // of the states it does not show. A member who somehow reaches a cabinet
    // with no sections must not see a blank column.
    return import('@/app/(platform)/p/admin/CabinetSidebar').then(({ CabinetSidebar }) => {
      const html = renderToStaticMarkup(el(CabinetSidebar, { selectedKey: '', items: [] }))
      expect(html).toContain('Разделов пока нет')
    })
  })
})

describe('EARS-432: the navigation is a persistent left sidebar grouped by module', () => {
  it('EARS-432: one group per module that declares a section, in registry order', async () => {
    const { CabinetSidebar } = await import('@/app/(platform)/p/admin/CabinetSidebar')
    const second: WorkspaceEntry = {
      ...HOURS,
      slug: 'members',
      admin: {
        label: 'Участники',
        resources: [{ name: 'members', label: 'Участники', operations: ['list'] as const, schema }],
      },
    }
    // The menu tree Refine builds from `meta.parent`, mirrored here in the
    // shape `useMenu()` returns it.
    const tree = cabinetResources([HOURS, second])
      .filter((r) => !r.meta?.parent)
      .map((group) => ({
        key: group.name,
        name: group.name,
        label: String(group.meta?.label),
        children: cabinetResources([HOURS, second])
          .filter((r) => r.meta?.parent === group.name)
          .map((child) => ({
            key: child.name,
            name: child.name,
            label: String(child.meta?.label),
            route: child.list as string,
            children: [],
          })),
      }))

    const html = renderToStaticMarkup(el(CabinetSidebar, { items: tree, selectedKey: '' }))
    expect(html.indexOf('data-nav-group="hours"')).toBeGreaterThan(-1)
    expect(html.indexOf('data-nav-group="members"')).toBeGreaterThan(
      html.indexOf('data-nav-group="hours"'),
    )
    // «Persistent» is the shell's business: the nav is a column of the cabinet
    // grid, not something a screen renders, so every screen has it by existing.
    const shell = readFileSync(resolve(root, 'src/app/(platform)/p/admin/CabinetShell.tsx'), 'utf8')
    expect(shell).toContain('<CabinetSidebar')
    expect(shell).toMatch(/grid-cols-\[248px_minmax\(0,1fr\)\]/)
  })
})

/**
 * The shell's Toaster is a SIBLING of the cabinet grid, never a cell in it
 * (#434 acceptance defect, fixed in `a8d5634`; review blocker 1).
 *
 * Sonner renders where it is placed instead of portalling, and its outer
 * element is a plain `<section>`. Dropped between the sidebar and `<main>` it
 * therefore takes the second cell of `md:grid-cols-[248px_minmax(0,1fr)]` and
 * pushes the whole work area onto its own row at the sidebar's 248px — on
 * EVERY cabinet screen at once. Nothing caught it: the unit suite and both e2e
 * specs query by role and never look at width. This is the invariant that
 * would have, and it is structural rather than a width measurement.
 */
describe('#434: the cabinet Toaster is a sibling of the grid, not a cell in it', () => {
  afterEach(cleanup)

  it('#434: nothing but the sidebar and <main> is a child of [data-cabinet]', async () => {
    vi.resetModules()
    // Refine's provider tree and its router binding are not the subject here —
    // the frame's DOM is. `useMenu` is mocked at the shape the real one returns.
    vi.doMock('@refinedev/core', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@refinedev/core')>()),
      Refine: ({ children }: { children: React.ReactNode }) => children,
      useMenu: () => ({ menuItems: [], selectedKey: '' }),
    }))
    vi.doMock('next/navigation', () => ({ usePathname: () => `${CABINET_ROOT}/hours/periods` }))
    // The Server Function the shell hands its data provider pulls `@/auth`
    // (and next-auth's server entry) into the module graph. It is never called
    // here: no screen under test issues a request.
    vi.doMock('@/app/(platform)/p/admin/actions', () => ({
      validateCabinetResponse: async () => ({ ok: true as const, data: null }),
    }))

    const { CabinetShell } = await import('@/app/(platform)/p/admin/CabinetShell')
    const { container } = render(
      el(CabinetShell, {
        resources: cabinetResources([HOURS]),
        children: el('div', null, 'экран'),
      }),
    )

    const grid = container.querySelector('[data-cabinet]')
    expect(grid).not.toBeNull()
    // The feedback channel is rendered at all — this test must fail if the
    // Toaster is deleted, not only if it moves back inside the columns.
    const toaster = container.querySelector('[aria-label^="Notifications"]')
    expect(toaster).not.toBeNull()

    expect(grid?.contains(toaster ?? null)).toBe(false)
    // Two columns, two children. A third child is a third grid cell, whatever
    // it is, and that is exactly how the defect arrived.
    expect(grid?.children).toHaveLength(2)

    vi.doUnmock('@refinedev/core')
    vi.doUnmock('next/navigation')
    vi.doUnmock('@/app/(platform)/p/admin/actions')
    vi.resetModules()
  })
})

describe('EARS-434: /p/admin opens on an index of sections', () => {
  it('EARS-434: it lists the sections and their items — not a dashboard, not a jump into the first resource', async () => {
    vi.resetModules()
    vi.doMock('@/lib/workspace', () => ({ WORKSPACE_REGISTRY: [HOURS, OKR_NO_SECTION, PLANNED] }))
    const { default: AdminIndexPage } = await import('@/app/(platform)/p/admin/page')
    const html = renderToStaticMarkup(el(AdminIndexPage))

    expect(html).toContain('data-section="hours"')
    expect(html).toContain('data-section-item="hours.periods"')
    // EARS-410 again, on this screen: a module with no section is not listed.
    expect(html).not.toContain('data-section="okr"')
    // A dashboard would put numbers here and a redirect would put nothing —
    // both were rejected by the clause. What is here is the list of sections.
    expect(html).toContain('Админка')
    vi.doUnmock('@/lib/workspace')
    vi.resetModules()
  })

  it('EARS-434: a cabinet with no declared section says so rather than showing a blank page', async () => {
    vi.resetModules()
    vi.doMock('@/lib/workspace', () => ({ WORKSPACE_REGISTRY: [OKR_NO_SECTION] }))
    const { default: AdminIndexPage } = await import('@/app/(platform)/p/admin/page')
    expect(renderToStaticMarkup(el(AdminIndexPage))).toContain('Ни один модуль пока не объявил')
    vi.doUnmock('@/lib/workspace')
    vi.resetModules()
  })
})

describe('EARS-431: the cabinet is `@refinedev/core` plus a router binding, and nothing else', () => {
  it('EARS-431: no Refine auth, data or UI package is installed', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const refine = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) =>
      d.startsWith('@refinedev/'),
    )
    // `@refinedev/react-table` joined the list on #434 and does NOT widen the
    // clause. EARS-431 excludes Refine's AUTH and DATA packages — the hand-written
    // provider over `/api/p/<slug>/admin/*` is still the only data path — and its
    // note excludes the UI packages, which is why `ThemedLayoutV2` was not used.
    // `react-table` is neither: it ships no component, no style and no provider,
    // only the `useTable` hook binding Refine's own `useList` to a headless
    // tanstack table. It is what the adopted `data-table` block consumes.
    expect(refine.sort()).toEqual([
      '@refinedev/core',
      '@refinedev/nextjs-router',
      '@refinedev/react-table',
    ])
  })

  it('EARS-431: the data provider is this repo’s own file, not a Refine package', () => {
    const shell = readFileSync(resolve(root, 'src/app/(platform)/p/admin/CabinetShell.tsx'), 'utf8')
    expect(shell).toContain('@/lib/platform/cabinet')
    expect(shell).not.toMatch(/@refinedev\/(simple-rest|nestjsx|antd|mui|chakra|mantine)/)
  })

  it('EARS-440: the cabinet renders no top bar of its own — it inherits the workspace’s', () => {
    // EARS-425's bar comes from `(platform)/p/layout.tsx`, which the cabinet is
    // inside. A second bar here would be the frame naming an app twice.
    const shell = readFileSync(resolve(root, 'src/app/(platform)/p/admin/CabinetShell.tsx'), 'utf8')
    expect(shell).not.toContain('TopBar')
  })
})

describe('EARS-430: the cabinet is built from the kit, not hand-rolled', () => {
  const files = [
    'src/app/(platform)/p/admin/CabinetShell.tsx',
    'src/app/(platform)/p/admin/CabinetSidebar.tsx',
    'src/app/(platform)/p/admin/page.tsx',
    'src/app/(platform)/p/admin/okr/parameters/page.tsx',
  ]

  it('EARS-430: no cabinet file writes a colour or an inline style', () => {
    for (const rel of files) {
      const source = readFileSync(resolve(root, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(source, `${rel} writes a colour literal`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|color-mix)\(/,
      )
      expect(source, `${rel} sets an inline style`).not.toMatch(/\bstyle=\{/)
    }
  })

  it('EARS-430: the cabinet ships no stylesheet of its own', () => {
    for (const rel of files) {
      const imports = [
        ...readFileSync(resolve(root, rel), 'utf8').matchAll(/import\s+'([^']+\.css)'/g),
      ]
      expect(imports.map((m) => m[1]).filter((i) => !i.startsWith('@/ui/'))).toEqual([])
    }
  })

  it('EARS-430: it names both of its sources, and which half each licenses', () => {
    const shell = readFileSync(resolve(root, 'src/app/(platform)/p/admin/CabinetShell.tsx'), 'utf8')
    expect(shell).toContain('design-source/p-admin-shell.html')
    expect(shell).toContain('fidelity: wireframe')
    expect(shell).toContain('fidelity: visual')
  })
})
