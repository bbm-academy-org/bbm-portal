import { describe, expect, it, vi } from 'vitest'

import type {
  ExternalWorkspaceEntry,
  InternalWorkspaceEntry,
  PlannedWorkspaceEntry,
  WorkspaceEntry,
} from '@/lib/workspace/contract'
import {
  buildLauncherView,
  currentEntry,
  resolveStatus,
  STATUS_DEADLINE_MS,
  switcherEntries,
  tileForm,
  visibleEntries,
} from '@/lib/workspace/view'

/**
 * The launcher's view model (spec 311 §A/§C).
 *
 * Every test here runs against a FIXTURE registry, never the real composition
 * root: what these clauses promise is a property of the mechanism, and a test
 * that read the real registry would start failing the day someone ships Финансы
 * — which is precisely the day it should stay green.
 */

const hours: InternalWorkspaceEntry = {
  kind: 'internal',
  slug: 'hours',
  name: 'Часы',
  description: 'Самооценка часов',
  href: '/p/hours',
  icon: 'hours',
  status: () => 'Период «август 2026» открыт до 1 сентября',
}

const okr: InternalWorkspaceEntry = {
  kind: 'internal',
  slug: 'okr',
  name: 'OKR',
  description: 'Цели квартала',
  href: '/p/okr',
  icon: 'okr',
  status: async () => 'Цели квартала: 4 из 7 с оценкой',
}

const cabinet: InternalWorkspaceEntry = {
  kind: 'internal',
  slug: 'admin',
  name: 'Админка',
  description: 'только администратор',
  href: '/p/admin',
  icon: 'admin',
  requiredClaim: 'platform-admin',
}

const plane: ExternalWorkspaceEntry = {
  kind: 'external',
  slug: 'plane',
  name: 'Plane',
  description: 'Задачи и проекты',
  url: 'https://plane.bbm.academy',
  icon: 'plane',
}

const finance: PlannedWorkspaceEntry = {
  kind: 'planned',
  name: 'Финансы',
  description: 'портфель, позже',
}

const FIXTURE = [hours, okr, cabinet, plane, finance] as const

const member = (claim: string) => claim === 'platform-user'
const admin = (claim: string) => claim === 'platform-user' || claim === 'platform-admin'

describe('claim filtering (spec 311 EARS-404, D-7)', () => {
  it('EARS-404: omits a claim-gated entry from the view model of a session without the claim', async () => {
    const tiles = await buildLauncherView(FIXTURE, member)
    expect(tiles.map((t) => t.name)).not.toContain('Админка')
    // Absence is the WHOLE treatment: not greyed, not disabled, not a placeholder.
    expect(tiles.every((t) => t.form !== 'admin')).toBe(true)
  })

  it('EARS-404: includes it for a session that holds the claim', () => {
    expect(visibleEntries(FIXTURE, admin).map((e) => e.name)).toContain('Админка')
  })

  it('EARS-478: never filters a placeholder — it is shown identically to every session', () => {
    for (const predicate of [member, admin, () => false]) {
      expect(visibleEntries(FIXTURE, predicate).map((e) => e.name)).toContain('Финансы')
    }
  })

  it('EARS-466: a claim introduced later is filtered by the same code, with no edit here', () => {
    const finance2: InternalWorkspaceEntry = {
      kind: 'internal',
      slug: 'finance',
      name: 'Финансы',
      description: 'Учёт',
      href: '/p/finance',
      icon: 'finance',
      requiredClaim: 'finance-user',
    }
    const entries = [...FIXTURE, finance2]
    expect(visibleEntries(entries, admin).map((e) => e.slug)).not.toContain('finance')
    expect(
      visibleEntries(entries, (c) => admin(c) || c === 'finance-user').map((e) => e.slug),
    ).toContain('finance')
  })
})

describe('status providers (spec 311 EARS-406/407/408, D-6)', () => {
  it('EARS-406: invokes every declared provider CONCURRENTLY, not one after another', async () => {
    const slow = (line: string) => async () => {
      await new Promise((r) => setTimeout(r, 120))
      return line
    }
    const entries: WorkspaceEntry[] = [
      { ...hours, status: slow('a') },
      { ...okr, status: slow('b') },
    ]
    const started = Date.now()
    const tiles = await buildLauncherView(entries, member)
    // Sequential would be ≥240ms. The margin is wide on purpose: this asserts
    // «not serialised», not a stopwatch reading.
    expect(Date.now() - started).toBeLessThan(240)
    expect(tiles.map((t) => t.status)).toEqual(['a', 'b'])
  })

  it('EARS-406: gives each provider a one-second deadline', () => {
    expect(STATUS_DEADLINE_MS).toBe(1000)
  })

  it('EARS-407: a provider that REJECTS yields no line and takes nothing else down', async () => {
    const broken: InternalWorkspaceEntry = {
      ...hours,
      status: async () => {
        throw new Error('hours storage is down')
      },
    }
    const tiles = await buildLauncherView([broken, okr, plane, finance], member)
    expect(tiles.find((t) => t.name === 'Часы')?.status).toBe(null)
    expect(tiles.find((t) => t.name === 'Часы')?.href).toBe('/p/hours')
    expect(tiles.find((t) => t.name === 'OKR')?.status).toBe('Цели квартала: 4 из 7 с оценкой')
    expect(tiles).toHaveLength(4)
  })

  it('EARS-407: a provider that THROWS synchronously is absorbed the same way', async () => {
    const broken: InternalWorkspaceEntry = {
      ...hours,
      status: () => {
        throw new Error('boom')
      },
    }
    const [tile] = await buildLauncherView([broken], member)
    expect(tile.status).toBe(null)
  })

  it('EARS-407: a provider that exceeds its deadline yields no line and does not hang the home', async () => {
    vi.useFakeTimers()
    try {
      const hanging = () => new Promise<string>(() => {})
      const promise = resolveStatus(hanging, 1000)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await promise).toBe(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('EARS-408: an entry declaring NO provider is a complete, openable tile', async () => {
    const tiles = await buildLauncherView([cabinet], admin)
    expect(tiles[0]).toMatchObject({ name: 'Админка', href: '/p/admin', status: null })
  })
})

describe('tile forms (spec 311 EARS-468)', () => {
  it('EARS-468: the grid carries exactly four forms and no other per-entry variation', () => {
    expect(FIXTURE.map(tileForm)).toEqual(['internal', 'internal', 'admin', 'external', 'planned'])
  })

  it('EARS-466: the admin form keys on HAVING a claim, not on the literal platform-admin', () => {
    expect(tileForm({ ...cabinet, requiredClaim: 'finance-admin' })).toBe('admin')
  })
})

describe('the switcher and the launcher (spec 311 EARS-427, EARS-478)', () => {
  it('EARS-427: both read one list, so they never disagree about what is open to the session', async () => {
    const tiles = await buildLauncherView(FIXTURE, admin)
    const openableTiles = tiles.filter((t) => t.href).map((t) => t.name)
    expect(switcherEntries(FIXTURE, admin).map((e) => e.name)).toEqual(openableTiles)
  })

  it('EARS-478: the switcher carries no placeholder — there is nowhere to switch to', () => {
    expect(switcherEntries(FIXTURE, admin).map((e) => e.name)).not.toContain('Финансы')
  })

  it('EARS-412: removing a declaration removes it from BOTH renderings, with nothing else edited', async () => {
    const without = FIXTURE.filter((e) => e !== okr)
    expect(switcherEntries(without, admin).map((e) => e.name)).not.toContain('OKR')
    expect((await buildLauncherView(without, admin)).map((t) => t.name)).not.toContain('OKR')
  })
})

describe('the current app (spec 311 EARS-469, EARS-470)', () => {
  it('EARS-469: resolves the current app by registry href, longest prefix wins', () => {
    expect(currentEntry(FIXTURE, '/p/hours')?.name).toBe('Часы')
    expect(currentEntry(FIXTURE, '/p/hours/admin/export')?.name).toBe('Часы')
    expect(currentEntry([...FIXTURE], '/p/admin/members')?.name).toBe('Админка')
  })

  it('EARS-470: `/p` itself resolves to no app — the home is not one', () => {
    expect(currentEntry(FIXTURE, '/p')).toBe(null)
  })

  it('EARS-469: never matches a partial segment', () => {
    expect(currentEntry(FIXTURE, '/p/hoursomething')).toBe(null)
  })
})
