import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * The handler-side half of the claim gate (spec 311 EARS-461, EARS-462) on a
 * REAL route handler.
 *
 * A route handler does not run layouts, so the `(platform)/p/layout.tsx` gate
 * covers no `/api/p/*` route handler. This pins the boundary on the hours export
 * action after the cabinet cutover (EARS-449, EARS-462).
 */

const authState: { session: unknown } = { session: null }

vi.mock('@/auth', () => ({ auth: async () => authState.session }))
vi.mock('@/lib/hours/store-core', () => ({
  readHoursDocument: async () => ({ participants: [], periods: [] }),
}))

async function get(session: unknown): Promise<Response> {
  authState.session = session
  const route = await import('@/app/(platform)/api/p/hours/admin/export/route')
  return route.GET()
}

describe('a route handler under /p re-checks the claim itself (EARS-461, EARS-462)', () => {
  beforeEach(() => {
    authState.session = null
  })

  it('refuses an anonymous caller with a bare 403 — no redirect, no body', async () => {
    const res = await get(null)
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('')
  })

  it('refuses a member holding only `platform-user` — the cabinet claim is required', async () => {
    const res = await get({ user: { email: 'm@bbm.local', roles: [PLATFORM_USER_ROLE] } })
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('')
  })

  it('refuses a session whose token predates the roles claim', async () => {
    const res = await get({ user: { email: 'old@bbm.local', roles: [], rolesClaimAbsent: true } })
    expect(res.status).toBe(403)
  })

  it('serves an admin holding `platform-admin`', async () => {
    const res = await get({ user: { email: 'a@bbm.local', roles: [PLATFORM_ADMIN_ROLE] } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
