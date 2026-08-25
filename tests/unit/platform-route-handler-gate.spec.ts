import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * The handler-side half of the claim gate (spec 311 EARS-461, EARS-462) on a
 * REAL route handler.
 *
 * A route handler does not run layouts, so the `(platform)/p/layout.tsx` gate
 * covers no `/p/*` route handler at all — `src/app/(platform)/p/hours/admin/export/route.ts`
 * is a live `/p/*` path outside it. `claimGateResponse` exists exactly for that
 * seam, and a helper with no call site proves nothing: this pins the boundary on
 * the one handler that lives under `/p` today. (EARS-421/EARS-452 retire this
 * handler with the hours cutover; until then it is gated by the claim, not only
 * by its own `HOURS_ADMIN_EMAILS` allowlist.)
 *
 * The hours data layer is mocked wholesale so the assertion is about the gate
 * and nothing else: `isHoursAdmin` always says yes here, so a 403 can only come
 * from the claim gate.
 */

const authState: { session: unknown } = { session: null }

vi.mock('@/auth', () => ({ auth: async () => authState.session }))
vi.mock('@/lib/hours', () => ({
  HoursDataError: class HoursDataError extends Error {},
  isHoursAdmin: () => true,
  sessionEmail: () => 'operator@bbm.local',
  readHoursDocument: async () => ({ participants: [], periods: [] }),
}))

async function get(session: unknown): Promise<Response> {
  authState.session = session
  const route = await import('@/app/(platform)/p/hours/admin/export/route')
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
