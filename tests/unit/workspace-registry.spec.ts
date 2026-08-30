// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { hoursWorkspaceEntry } from '@/lib/hours'
import { memberWorkspaceEntry } from '@/lib/member'
import { okrWorkspaceEntry } from '@/lib/okr'
import type {
  ExternalWorkspaceEntry,
  InternalWorkspaceEntry,
  PlannedWorkspaceEntry,
  WorkspaceModule,
} from '@/lib/workspace/contract'
import { WORKSPACE_REGISTRY } from '@/lib/workspace/registry'

/**
 * The composition root and the contract it lists (spec 311 §A).
 *
 * Unlike `workspace-view.spec.ts`, these tests DO read the real registry — the
 * clauses here are about this workspace's actual inventory and about the
 * one-line registration staying mechanical rather than remembered.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(path)) out.push(path)
  }
  return out
}

describe('the module plug-in contract (spec 311 EARS-401, D-10, D-13a)', () => {
  it('EARS-401: an internal entry carries a slug, a name, a description, an /p href and an icon', () => {
    const internal = WORKSPACE_REGISTRY.filter(
      (e): e is InternalWorkspaceEntry => e.kind === 'internal',
    )
    expect(internal.length).toBeGreaterThan(0)
    for (const entry of internal) {
      expect(entry.slug).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.href.startsWith('/p')).toBe(true)
      expect(typeof entry.icon).toBe('string')
    }
  })

  it('EARS-401: an external entry carries an absolute url and NO status and NO admin section', () => {
    const external = WORKSPACE_REGISTRY.filter(
      (e): e is ExternalWorkspaceEntry => e.kind === 'external',
    )
    expect(external.length).toBeGreaterThan(0)
    for (const entry of external) {
      expect(entry.url).toMatch(/^https:\/\//)
      // D-10: the ABSENCE is a type error, so the runtime assertion is only the
      // second line of defence — but a declaration cast from JSON one day would
      // slip past the first.
      expect('status' in entry).toBe(false)
      expect('admin' in entry).toBe(false)
    }
  })

  it('EARS-401: a planned entry carries a name and a description and nothing else (D-13a)', () => {
    const planned = WORKSPACE_REGISTRY.filter(
      (e): e is PlannedWorkspaceEntry => e.kind === 'planned',
    )
    expect(planned.length).toBeGreaterThan(0)
    for (const entry of planned) {
      expect(Object.keys(entry).sort()).toEqual(['description', 'kind', 'name'])
    }
  })

  /**
   * EARS-413's evidence is that this COMPILES: one declaration per app of
   * consolidation §4 (revision -f), including a section-root href and an
   * external tool, against the one contract with no per-app frame concept. The
   * runtime body only keeps the constant alive for the linter.
   */
  it('EARS-413: the contract accommodates every app of the target portfolio', () => {
    // Every cabinet resource carries its module's own zod schema (EARS-436);
    // one stand-in is enough here, because what this test proves is that the
    // CONTRACT compiles for the whole portfolio, not what any app's records
    // look like.
    const portfolioSchema = z.object({ id: z.string() })
    const portfolio: WorkspaceModule[] = [
      {
        kind: 'internal',
        slug: 'hours',
        name: 'Часы',
        description: 'Часы',
        href: '/p/hours',
        icon: 'hours',
        status: async () => null,
        admin: {
          label: 'Часы',
          resources: [
            { name: 'periods', label: 'Периоды', operations: ['list'], schema: portfolioSchema },
          ],
        },
      },
      {
        kind: 'internal',
        slug: 'okr',
        name: 'OKR',
        description: 'Цели',
        href: '/p/okr',
        icon: 'okr',
        status: () => null,
        admin: {
          label: 'OKR',
          resources: [
            {
              name: 'config',
              label: 'Конфигурация',
              operations: ['list'],
              schema: portfolioSchema,
            },
          ],
        },
      },
      {
        kind: 'internal',
        slug: 'finance',
        name: 'Финансы',
        description: 'Учёт',
        href: '/p/finance',
        icon: 'finance',
        requiredClaim: 'finance-user',
        status: async () => null,
        admin: { label: 'Финансы', resources: [] },
      },
      // A SECTION ROOT rather than a leaf page — decks owns everything under it.
      {
        kind: 'internal',
        slug: 'decks',
        name: 'Колоды',
        description: 'Презентации',
        href: '/p/decks',
        icon: 'decks',
      },
      {
        kind: 'internal',
        slug: 'crm',
        name: 'CRM',
        description: 'Клиенты',
        href: '/p/crm',
        icon: 'crm',
        requiredClaim: 'crm-user',
        admin: { label: 'CRM', resources: [] },
      },
      {
        kind: 'internal',
        slug: 'tasks',
        name: 'Задачи',
        description: 'Управление задачами',
        href: '/p/tasks',
        icon: 'tasks',
      },
      {
        kind: 'internal',
        slug: 'recruiting',
        name: 'Поиск команды',
        description: 'Вакансии',
        href: '/p/recruiting',
        icon: 'recruiting',
        status: async () => null,
      },
      {
        kind: 'internal',
        slug: 'launch',
        name: 'Запуск проекта',
        description: 'Чек-листы',
        href: '/p/launch',
        icon: 'launch',
        admin: { label: 'Запуск', resources: [] },
      },
      {
        kind: 'internal',
        slug: 'calculators',
        name: 'Калькуляторы',
        description: 'Инструменты',
        href: '/p/calculators',
        icon: 'calculators',
      },
      {
        kind: 'external',
        slug: 'mattermost',
        name: 'Mattermost',
        description: 'Общение',
        url: 'https://example.invalid',
        icon: 'mattermost',
      },
    ]
    expect(portfolio).toHaveLength(10)
  })
})

describe('the composition root (spec 311 EARS-402, EARS-403, D-2)', () => {
  it('EARS-403: every workspace declaration a module exports is listed in the registry', () => {
    const roots = [join(REPO_ROOT, 'src', 'lib'), join(REPO_ROOT, 'src', 'modules')]
    const registrySource = readFileSync(
      join(REPO_ROOT, 'src', 'lib', 'workspace', 'registry.ts'),
      'utf8',
    )

    const declared: { file: string; name: string }[] = []
    for (const root of roots) {
      for (const file of walk(root)) {
        if (file.includes(`${join('lib', 'workspace')}`)) continue
        const source = readFileSync(file, 'utf8')
        for (const m of source.matchAll(
          /export const (\w+)\s*(?::\s*(?:WorkspaceModule|CabinetWorkspaceEntry)|satisfies WorkspaceModule)/g,
        )) {
          declared.push({ file, name: m[1] })
        }
      }
    }

    // The scan is the point of the clause: it must actually find something, or
    // a rename of the type would turn this test into a silent pass.
    expect(declared.map((d) => d.name).sort()).toEqual([
      'hoursWorkspaceEntry',
      'memberWorkspaceEntry',
      'okrWorkspaceEntry',
    ])

    const unregistered = declared.filter((d) => !registrySource.includes(d.name))
    expect(
      unregistered.map((d) => `${d.name} (${d.file})`),
      'a module declares a workspace entry the composition root does not list',
    ).toEqual([])
  })

  it('EARS-403: the registry lists the module’s OWN declaration object, not a copy of it', () => {
    expect(WORKSPACE_REGISTRY).toContain(hoursWorkspaceEntry)
    expect(WORKSPACE_REGISTRY).toContain(memberWorkspaceEntry)
    expect(WORKSPACE_REGISTRY).toContain(okrWorkspaceEntry)
  })

  it('EARS-402: the launcher, the top bar and the switcher hold no list of apps of their own', () => {
    const frame = [
      join(REPO_ROOT, 'src', 'app', '(platform)', 'p', 'page.tsx'),
      join(REPO_ROOT, 'src', 'app', '(platform)', 'p', 'layout.tsx'),
      join(REPO_ROOT, 'src', 'app', '(platform)', 'p', 'AppSwitcher.tsx'),
    ].map((file) => ({ file, source: readFileSync(file, 'utf8') }))

    const appNames = WORKSPACE_REGISTRY.map((e) => e.name)
    const hrefs = WORKSPACE_REGISTRY.flatMap((e) =>
      e.kind === 'internal' ? [e.href] : e.kind === 'external' ? [e.url] : [],
    ).filter((href) => href !== '/p')

    for (const { file, source } of frame) {
      for (const name of appNames) {
        expect(source, `${file} names the app «${name}»`).not.toContain(name)
      }
      for (const href of hrefs) {
        expect(source, `${file} hard-codes the target ${href}`).not.toContain(href)
      }
    }
  })
})

describe('display order and the portfolio placeholders (spec 311 EARS-422, EARS-477)', () => {
  it('EARS-422: registry order is one order over all entries, placeholders LAST', () => {
    const firstPlanned = WORKSPACE_REGISTRY.findIndex((e) => e.kind === 'planned')
    expect(firstPlanned).toBeGreaterThan(0)
    expect(WORKSPACE_REGISTRY.slice(firstPlanned).every((e) => e.kind === 'planned')).toBe(true)
  })

  it('EARS-477: one placeholder per not-yet-live portfolio app that no entry already represents', () => {
    // Consolidation §4 (revision -f). This is the SOURCE; the wireframe's six
    // tiles are its illustration. The exclusions are what the clause asserts:
    // hours/OKR/finance are live internal entries, Mattermost is a live external
    // one, and управление задачами is served today by the Plane entry.
    const portfolio = [
      'учёт часов',
      'OKR',
      'финансы',
      'внутренние презентации',
      'CRM',
      'управление задачами',
      'поиск и подбор команды',
      'запуск проектов',
      'калькуляторы и рабочие инструменты',
      'связка с внутренней коммуникацией',
    ]
    const live = [
      'учёт часов',
      'OKR',
      'финансы',
      'связка с внутренней коммуникацией',
      'управление задачами',
    ]
    const expectedPlaceholders = portfolio.filter((app) => !live.includes(app))

    const planned = WORKSPACE_REGISTRY.filter((e) => e.kind === 'planned')
    expect(planned).toHaveLength(expectedPlaceholders.length)
    expect(planned.map((e) => e.name)).toEqual([
      'Колоды',
      'CRM',
      'Поиск команды',
      'Запуск проекта',
      'Калькуляторы',
    ])
  })

  it('EARS-477: управление задачами carries no placeholder — the Plane entry represents it', () => {
    expect(WORKSPACE_REGISTRY.some((e) => e.kind === 'external' && e.slug === 'plane')).toBe(true)
    expect(WORKSPACE_REGISTRY.some((e) => e.kind === 'planned' && /задач/i.test(e.name))).toBe(
      false,
    )
  })

  it('EARS-404: the cabinet is a registry entry with its own requiredClaim (D-4)', () => {
    const cabinet = WORKSPACE_REGISTRY.find((e) => e.kind === 'internal' && e.href === '/p/admin')
    expect(cabinet).toBeDefined()
    expect((cabinet as InternalWorkspaceEntry).requiredClaim).toBe('platform-admin')
  })
})
