import { describe, expect, it } from 'vitest'

import {
  PLATFORM_ADMIN_ROLE,
  PLATFORM_USER_ROLE,
  ZITADEL_ROLES_CLAIM,
  claimGateResponse,
  hasClaim,
  normalizeRolesClaim,
  resolveClaimGate,
  rolesClaimStamped,
  sessionRoles,
} from '@/lib/platform/authGate'

/**
 * The claim gate of spec 311 §B — the server-side trust boundary over the
 * workspace and its cabinet.
 *
 * Covered clauses:
 *   EARS-414 — exactly two starting roles, `platform-user` and `platform-admin`.
 *   EARS-415 — they are read from the Zitadel roles claim
 *              `urn:zitadel:iam:org:project:roles`, surfaced on the session.
 *   EARS-416 — a session lacking `platform-user` is refused on every `/p` path.
 *   EARS-417 — `platform-admin` implies `platform-user`.
 *   EARS-418 — authenticated with neither role -> a bare 403, no chrome (D-5).
 *   EARS-460 — a granted role takes effect from the session that carries it,
 *              with no redeploy: the decision is a pure function of the claim.
 *   EARS-461/EARS-462 — the fail-closed re-check a module handler owes is a
 *              server-side helper returning a bare refusal, never a UI concern.
 *
 * The functions are pure so the boundary is asserted without a browser, a live
 * IdP or a rendered page — the same reason `resolvePlatformGate` is pure.
 */

const admin = { user: { email: 'a@bbm.local', roles: [PLATFORM_ADMIN_ROLE] } }
const member = { user: { email: 'm@bbm.local', roles: [PLATFORM_USER_ROLE] } }
const roleless = { user: { email: 'n@bbm.local', roles: [] } }

describe('the Zitadel roles claim (EARS-415)', () => {
  it('names the claim Zitadel actually emits', () => {
    expect(ZITADEL_ROLES_CLAIM).toBe('urn:zitadel:iam:org:project:roles')
  })

  it('reads the object form Zitadel emits — role key -> { orgId: orgDomain }', () => {
    expect(
      normalizeRolesClaim({
        [PLATFORM_ADMIN_ROLE]: { '123456789': 'bbm.localhost' },
        [PLATFORM_USER_ROLE]: { '123456789': 'bbm.localhost' },
      }),
    ).toEqual([PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE])
  })

  it('reads a plain array of role keys', () => {
    expect(normalizeRolesClaim([PLATFORM_USER_ROLE])).toEqual([PLATFORM_USER_ROLE])
  })

  it('yields no roles for an absent or unusable claim — fail closed, never throw', () => {
    expect(normalizeRolesClaim(undefined)).toEqual([])
    expect(normalizeRolesClaim(null)).toEqual([])
    expect(normalizeRolesClaim('platform-admin')).toEqual([])
    expect(normalizeRolesClaim(42)).toEqual([])
    expect(normalizeRolesClaim([1, 'platform-user', null])).toEqual([PLATFORM_USER_ROLE])
  })

  it('reads the roles off a session and never trusts a non-array shape', () => {
    expect(sessionRoles(admin)).toEqual([PLATFORM_ADMIN_ROLE])
    expect(sessionRoles({ user: { email: 'x' } })).toEqual([])
    expect(sessionRoles({ user: { roles: 'platform-admin' } })).toEqual([])
    expect(sessionRoles(null)).toEqual([])
  })
})

describe('hasClaim (EARS-414, EARS-417)', () => {
  it('admits a member for `platform-user`', () => {
    expect(hasClaim(member, PLATFORM_USER_ROLE)).toBe(true)
  })

  it('treats `platform-admin` as implying `platform-user` — one grant is enough', () => {
    expect(hasClaim(admin, PLATFORM_USER_ROLE)).toBe(true)
    expect(hasClaim(admin, PLATFORM_ADMIN_ROLE)).toBe(true)
  })

  it('does NOT let a plain member borrow the admin claim', () => {
    expect(hasClaim(member, PLATFORM_ADMIN_ROLE)).toBe(false)
  })

  it('refuses a session with neither role', () => {
    expect(hasClaim(roleless, PLATFORM_USER_ROLE)).toBe(false)
    expect(hasClaim(roleless, PLATFORM_ADMIN_ROLE)).toBe(false)
    expect(hasClaim(null, PLATFORM_USER_ROLE)).toBe(false)
  })
})

describe('resolveClaimGate (EARS-416, EARS-417, EARS-418)', () => {
  it('bounces an unauthenticated request to sign-in, never to a 403', () => {
    expect(resolveClaimGate(null, '/p/admin', PLATFORM_ADMIN_ROLE)).toEqual({
      type: 'redirect',
      to: '/api/auth/signin?callbackUrl=%2Fp%2Fadmin',
    })
  })

  it('refuses an authenticated session carrying neither role — bare, no login loop', () => {
    expect(resolveClaimGate(roleless, '/p')).toEqual({ type: 'forbidden' })
    expect(resolveClaimGate(roleless, '/p/okr')).toEqual({ type: 'forbidden' })
  })

  it('lets a member into the workspace', () => {
    expect(resolveClaimGate(member, '/p/hours')).toEqual({ type: 'render' })
  })

  it('refuses a member at the cabinet and admits an admin', () => {
    expect(resolveClaimGate(member, '/p/admin', PLATFORM_ADMIN_ROLE)).toEqual({
      type: 'forbidden',
    })
    expect(resolveClaimGate(admin, '/p/admin', PLATFORM_ADMIN_ROLE)).toEqual({ type: 'render' })
  })

  it('admits an admin-only account to the member half too (EARS-417)', () => {
    expect(resolveClaimGate(admin, '/p/hours')).toEqual({ type: 'render' })
  })

  it('EARS-460: a grant takes effect from the claim alone — no redeploy, no allowlist', () => {
    // The SAME account, before and after the owner ticks the role in Zitadel.
    // Nothing else about the build differs between these two calls: there is no
    // list of permitted emails, no env var and no deploy artifact in the
    // decision, so granting the role IS the whole act of granting access.
    const before = { user: { email: 'p@bbm.local', roles: [] } }
    const after = { user: { email: 'p@bbm.local', roles: [PLATFORM_USER_ROLE] } }

    expect(resolveClaimGate(before, '/p')).toEqual({ type: 'forbidden' })
    expect(resolveClaimGate(after, '/p')).toEqual({ type: 'render' })
  })
})

describe('claimGateResponse — the handler-side boundary (EARS-461, EARS-462)', () => {
  it('answers a refused caller with a BARE 403 and no body (D-5)', async () => {
    const res = claimGateResponse(member, PLATFORM_ADMIN_ROLE)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.text()).toBe('')
  })

  it('refuses an anonymous caller too — a handler never redirects to a login page', () => {
    expect(claimGateResponse(null, PLATFORM_ADMIN_ROLE)?.status).toBe(403)
    expect(claimGateResponse(roleless)?.status).toBe(403)
  })

  it('returns null — "carry on" — for a caller holding the claim', () => {
    expect(claimGateResponse(admin, PLATFORM_ADMIN_ROLE)).toBeNull()
    expect(claimGateResponse(member)).toBeNull()
    expect(claimGateResponse(admin)).toBeNull()
  })

  it('is fail-closed for an unknown claim: no role set grants what was never provisioned', () => {
    expect(claimGateResponse(admin, 'cms-editor')?.status).toBe(403)
  })
})

describe('a session minted BEFORE the roles claim existed (deploy migration)', () => {
  /**
   * The gate ships onto a live workspace whose users already hold Auth.js JWT
   * session cookies (default strategy, 30-day maxAge, no adapter). Those tokens
   * were minted before `src/auth.ts` stamped any roles, so they carry no
   * `roles` field at all — and "the claim was never fetched" is NOT the same
   * fact as "the claim was fetched and came back empty". EARS-418 is about the
   * second; the first is a migration artefact the spec never asked to punish,
   * and treating it as a refusal strands every existing session in a bare 403
   * with no way back for up to 30 days.
   *
   * The recovery is ONE forced re-authentication: the sign-in pass always
   * stamps the field (to `[]` if the IdP grants nothing), so the redirect
   * cannot repeat — the second decision is a real EARS-418 refusal or a render.
   */
  const legacy = { user: { email: 'old@bbm.local', roles: [], rolesClaimAbsent: true } }
  const refused = { user: { email: 'n@bbm.local', roles: [], rolesClaimAbsent: false } }

  it('tells a token that never got the field apart from one stamped empty', () => {
    expect(rolesClaimStamped({ sub: 'x' })).toBe(false)
    expect(rolesClaimStamped({ sub: 'x', roles: [] })).toBe(true)
    expect(rolesClaimStamped({ sub: 'x', roles: [PLATFORM_USER_ROLE] })).toBe(true)
    expect(rolesClaimStamped(null)).toBe(false)
    expect(rolesClaimStamped(undefined)).toBe(false)
    expect(rolesClaimStamped('roles')).toBe(false)
  })

  it('sends a legacy session through sign-in once instead of into an inescapable 403', () => {
    expect(resolveClaimGate(legacy, '/p')).toEqual({
      type: 'redirect',
      to: '/api/auth/signin?callbackUrl=%2Fp',
    })
    expect(resolveClaimGate(legacy, '/p/admin', PLATFORM_ADMIN_ROLE)).toEqual({
      type: 'redirect',
      to: '/api/auth/signin?callbackUrl=%2Fp%2Fadmin',
    })
  })

  it('still refuses a session that DID carry the claim and holds no role (EARS-418)', () => {
    expect(resolveClaimGate(refused, '/p')).toEqual({ type: 'forbidden' })
    expect(resolveClaimGate(refused, '/p/admin', PLATFORM_ADMIN_ROLE)).toEqual({
      type: 'forbidden',
    })
  })

  it('cannot loop: a re-authenticated session decides on its claim, not on the marker', () => {
    const reauthed = { user: { email: 'old@bbm.local', roles: [PLATFORM_USER_ROLE] } }
    expect(resolveClaimGate(reauthed, '/p')).toEqual({ type: 'render' })
  })

  it('leaves a handler on the bare 403 — a route handler never redirects', () => {
    expect(claimGateResponse(legacy)?.status).toBe(403)
  })
})
