import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
        resources: [{ name: 'ledger', label: 'Реестр', operations: ['list'], schema }],
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

describe('EARS-431: the cabinet is `@refinedev/core` plus a router binding, and nothing else', () => {
  it('EARS-431: no Refine auth, data or UI package is installed', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const refine = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) =>
      d.startsWith('@refinedev/'),
    )
    expect(refine.sort()).toEqual(['@refinedev/core', '@refinedev/nextjs-router'])
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
