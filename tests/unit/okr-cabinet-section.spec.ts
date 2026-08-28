import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * The OKR cabinet section (spec 311 §G — EARS-453, EARS-455, EARS-475,
 * EARS-476).
 *
 * The section exists by an OWNER AMENDMENT of 2026-08-25 that reversed the
 * earlier exclusion: «источник данных не аргумент для выноса из админки». What
 * it shows is deploy-time configuration plus the module's current read state,
 * and every write operation is unsupported — so it is also the first exercise
 * of EARS-437, on a resource that supports exactly one thing.
 */

const authState: { session: unknown } = { session: null }
vi.mock('@/auth', () => ({ auth: async () => authState.session }))

const treeState: { result: unknown; error: unknown } = { result: null, error: null }
vi.mock('@/lib/okr/cache', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getOkrTree: async () => {
      if (treeState.error) throw treeState.error
      return treeState.result
    },
  }
})

const admin = { user: { email: 'admin@bbm.local', roles: [PLATFORM_ADMIN_ROLE] } }

beforeEach(() => {
  authState.session = null
  treeState.result = { objectives: [] }
  treeState.error = null
  vi.resetModules()
})

describe('EARS-475: the module publishes its effective configuration through its own door', () => {
  it('EARS-475: `getOkrParameters()` is exported from src/lib/okr/index.ts', async () => {
    const okr = await import('@/lib/okr')
    expect(typeof okr.getOkrParameters).toBe('function')
  })

  it('EARS-475: it names the workspace, the projects, the period and the mapping the dashboard applies', async () => {
    const { getOkrParameters } = await import('@/lib/okr')
    const params = getOkrParameters()

    expect(params.workspace).toBe('doctor-school')
    expect(params.period).toEqual({ start: '2026-07-01', end: '2026-09-01' })
    expect(params.planeWebBaseUrl).toMatch(/^https?:\/\//)
    // The project → mission/order mapping is exactly the thing that is NOT
    // derivable from Plane (the module's own FR-1), which is why an admin
    // asking «what is this dashboard reading» has to be shown it.
    expect(params.projects.length).toBeGreaterThan(0)
    for (const project of params.projects) {
      expect(project).toMatchObject({
        ident: expect.any(String),
        mission: expect.any(String),
        order: expect.any(Number),
      })
    }
  })

  it('EARS-475: nothing else in the OKR module opened up — no config file is read from outside', async () => {
    // «Nothing else changes, and no caller reaches past index.ts.» The accessor
    // is the whole of the widening, so the raw constants stay unexported.
    const okr = (await import('@/lib/okr')) as Record<string, unknown>
    expect(okr.OKR_WORKSPACE).toBeUndefined()
    expect(okr.OKR_PROJECTS).toBeUndefined()
  })
})

describe('EARS-453/455: the section is one read-only resource', () => {
  it('EARS-453: the OKR entry declares an admin section with exactly one resource', async () => {
    const { okrWorkspaceEntry } = await import('@/lib/okr')
    expect(okrWorkspaceEntry.kind).toBe('internal')
    const section = okrWorkspaceEntry.kind === 'internal' ? okrWorkspaceEntry.admin : undefined
    expect(section?.label).toBe('OKR')
    expect(section?.resources.map((r) => r.label)).toEqual(['Источник и параметры'])
  })

  it('EARS-455: create, update and delete are all unsupported — the resource declares only `list`', async () => {
    const { okrWorkspaceEntry } = await import('@/lib/okr')
    const section = okrWorkspaceEntry.kind === 'internal' ? okrWorkspaceEntry.admin : undefined
    // EARS-437 is the mechanism: an operation absent from this array gets no
    // route and therefore no control that could fail on click.
    expect(section?.resources[0].operations).toEqual(['list'])
  })
})

describe('EARS-476: the page shows the module’s current read state and when it was obtained', () => {
  async function get(session: unknown) {
    authState.session = session
    const route = await import('@/app/(platform)/api/p/okr/admin/parameters/route')
    return route.GET(new Request('https://portal.bbm.academy/api/p/okr/admin/parameters'))
  }

  it('EARS-462: the handler re-checks `platform-admin` — the shell is not its gate', async () => {
    expect((await get(null)).status).toBe(403)
    expect(
      (await get({ user: { email: 'm@bbm.local', roles: [PLATFORM_USER_ROLE] } })).status,
    ).toBe(403)
  })

  it('EARS-476: a successful read reports `ok` and the moment it was obtained', async () => {
    const before = Date.now()
    const res = await get(admin)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { read: { state: string; at: string; message?: string } }
    }
    expect(body.data.read.state).toBe('ok')
    expect(Date.parse(body.data.read.at)).toBeGreaterThanOrEqual(before - 1000)
    // The result itself is NOT stored anywhere — which is why §G needs no
    // read-health store (EARS-455, Out of scope).
    expect(body.data.read.message).toBeUndefined()
  })

  it('EARS-476: a failed read reports the error the module raised, and the page still answers 200', async () => {
    const { OkrUnavailableError } = await import('@/lib/okr')
    treeState.error = new OkrUnavailableError(new Error('Plane ответил 502'))
    const res = await get(admin)
    // The READ failed; the settings page did not. Answering 503 here would make
    // the admin unable to see the configuration precisely when they came to
    // check why the dashboard is empty.
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { read: { state: string; message: string } } }
    expect(body.data.read.state).toBe('error')
    // BOTH halves: the module's own readable line, and the cause it carries.
    // `OkrUnavailableError`'s message is fixed («Plane недоступен и кэша ещё
    // нет») and the real failure rides in `cause` — showing only the first
    // would leave an admin unable to tell an expired token from a dead host.
    expect(body.data.read.message).toContain('Plane недоступен')
    expect(body.data.read.message).toContain('Plane ответил 502')
  })

  it('EARS-476: the answer carries the configuration alongside the read state', async () => {
    const body = (await (await get(admin)).json()) as {
      data: { workspace: string; projects: unknown[] }
    }
    expect(body.data.workspace).toBe('doctor-school')
    expect(body.data.projects.length).toBeGreaterThan(0)
  })
})
