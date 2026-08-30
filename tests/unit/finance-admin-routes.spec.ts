import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

const state = vi.hoisted(() => ({
  session: null as unknown,
  actor: null as unknown,
}))

vi.mock('@/auth', () => ({ auth: async () => state.session }))

vi.mock('@/lib/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance')>()
  return {
    ...actual,
    listCategories: vi.fn(async () => []),
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
  vi.resetModules()
})

describe('finance reference HTTP surface (spec 338 EARS-326/330)', () => {
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
})
