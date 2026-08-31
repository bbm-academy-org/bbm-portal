import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'
import { scanHandlerFile } from '../../tools/lint/endpoint-authz-lint.mjs'

type CategoryRow = { id: number; name: string; allocable: boolean; retiredAt: Date | null }

const state = vi.hoisted(() => ({
  session: null as unknown,
  actor: null as unknown,
  categories: [] as Array<{ id: number; name: string; allocable: boolean; retiredAt: Date | null }>,
}))

vi.mock('@/auth', () => ({ auth: async () => state.session }))

vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return {
    ...actual,
    listCategories: vi.fn(async () => state.categories),
    createCurrency: vi.fn(async (actor: unknown, input: Record<string, unknown>) => {
      state.actor = actor
      return { ...input, retiredAt: null }
    }),
  }
})

const admin = { user: { email: ' ADMIN@bbm.local ', roles: [PLATFORM_ADMIN_ROLE] } }
const member = { user: { email: 'member@bbm.local', roles: [PLATFORM_USER_ROLE] } }

function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://portal.bbm.academy${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  })
}

const segment = (params: Record<string, string>) => ({ params: Promise.resolve(params) })

beforeEach(() => {
  state.session = admin
  state.actor = null
  state.categories = []
  vi.resetModules()
})

describe('finance reference HTTP surface (spec 338 EARS-326/330)', () => {
  it('EARS-462: exports every admin method through the sanctioned adminRoute factory', () => {
    const routes = [
      'src/app/(platform)/api/p/finance/admin/[resource]/route.ts',
      'src/app/(platform)/api/p/finance/admin/[resource]/[id]/route.ts',
    ]

    for (const route of routes) {
      expect(scanHandlerFile(route, readFileSync(resolve(route), 'utf8')), route).toEqual([])
    }
  })

  it('EARS-330: refuses unauthenticated and non-admin sessions in the handler', async () => {
    const { GET } = await import('@/app/(platform)/api/p/finance/admin/[resource]/route')
    state.session = null
    expect(
      (await GET(request('/api/p/finance/admin/categories'), segment({ resource: 'categories' })))
        .status,
    ).toBe(403)
    state.session = member
    expect(
      (await GET(request('/api/p/finance/admin/categories'), segment({ resource: 'categories' })))
        .status,
    ).toBe(403)
  })

  it('EARS-307/326: returns the intentional empty categories list', async () => {
    const { GET } = await import('@/app/(platform)/api/p/finance/admin/[resource]/route')
    const response = await GET(
      request('/api/p/finance/admin/categories'),
      segment({ resource: 'categories' }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [], total: 0 })
  })

  it('EARS-302/326: validates a currency and passes the signed-in actor to the module write', async () => {
    const { POST } = await import('@/app/(platform)/api/p/finance/admin/[resource]/route')
    const invalid = await POST(
      request('/api/p/finance/admin/currencies', 'POST', {
        code: 'THB',
        name: 'Тайский бат',
        precision: -1,
      }),
      segment({ resource: 'currencies' }),
    )
    expect(invalid.status).toBe(400)

    const response = await POST(
      request('/api/p/finance/admin/currencies', 'POST', {
        code: 'THB',
        name: 'Тайский бат',
        precision: 2,
      }),
      segment({ resource: 'currencies' }),
    )
    expect(response.status).toBe(200)
    expect(state.actor).toEqual({ email: 'admin@bbm.local', roles: [PLATFORM_ADMIN_ROLE] })
  })

  /**
   * The search box searches the NAMES an admin can see, not the serialization.
   * Matching `JSON.stringify(row)` makes every field name searchable, so `q=id`,
   * `q=name` or `q=true` silently returns the whole table as if it matched.
   */
  it('EARS-326: searches display fields only — a field-name query matches nothing', async () => {
    const rows: CategoryRow[] = [
      { id: 1, name: 'Инфраструктура', allocable: false, retiredAt: null },
      { id: 2, name: 'Продакшн', allocable: true, retiredAt: null },
    ]
    state.categories = rows
    const { GET } = await import('@/app/(platform)/api/p/finance/admin/[resource]/route')

    const noise = await GET(
      request('/api/p/finance/admin/categories?q=id'),
      segment({ resource: 'categories' }),
    )
    expect(await noise.json()).toEqual({ data: [], total: 0 })

    const hit = await GET(
      request('/api/p/finance/admin/categories?q=продакшн'),
      segment({ resource: 'categories' }),
    )
    expect(await hit.json()).toEqual({
      data: [{ id: 2, name: 'Продакшн', allocable: true, retiredAt: null }],
      total: 1,
    })
  })

  it('EARS-326: answers 404 for a prototype key in the resource segment', async () => {
    const { GET } = await import('@/app/(platform)/api/p/finance/admin/[resource]/route')
    const response = await GET(
      request('/api/p/finance/admin/toString'),
      segment({ resource: 'toString' }),
    )
    expect(response.status).toBe(404)
  })

  it('EARS-326: refuses a non-object PATCH body with a readable 400, not a TypeError', async () => {
    const { PATCH } = await import('@/app/(platform)/api/p/finance/admin/[resource]/[id]/route')
    const response = await PATCH(
      request('/api/p/finance/admin/categories/1', 'PATCH', null),
      segment({ resource: 'categories', id: '1' }),
    )
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toMatch(/объект/i)
  })
})
