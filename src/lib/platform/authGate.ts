/**
 * Auth-decision logic for the (platform) route-group gate (spec 059 req.2).
 *
 * Kept as pure functions, separate from the Auth.js wiring (src/auth.ts) and the
 * `(platform)/layout.tsx` that calls them, so the "unauthenticated → sign-in,
 * authenticated → render, never render data to anonymous" contract is
 * unit-testable without a browser or a live IdP.
 */

/** Auth.js base path (next-auth default). The sign-in route lives under it. */
const AUTH_BASE_PATH = '/api/auth'

/** A minimal view of an Auth.js session — enough for the gate decision. */
export interface SessionLike {
  user?: unknown
}

/** True when the request must be bounced to sign-in (no session, or no user). */
export function requiresSignIn(session: SessionLike | null | undefined): boolean {
  return !session || session.user == null
}

/**
 * The Auth.js sign-in URL that returns the user to `callbackPath` after login.
 * With a single provider (Zitadel) the sign-in route forwards to the Zitadel
 * login; the visible hop the owner sees is Zitadel's login page (spec 059
 * scenario 1).
 */
export function signInRedirect(callbackPath: string): string {
  return `${AUTH_BASE_PATH}/signin?callbackUrl=${encodeURIComponent(callbackPath)}`
}

export type GateDecision =
  { type: 'render' } | { type: 'redirect'; to: string } | { type: 'forbidden' }

/** Resolve the gate for a request at `currentPath` given its session (if any). */
export function resolvePlatformGate(
  session: SessionLike | null | undefined,
  currentPath: string,
): GateDecision {
  if (requiresSignIn(session)) return { type: 'redirect', to: signInRedirect(currentPath) }
  return { type: 'render' }
}

// ── the claim gate (spec 311 §B) ─────────────────────────────────────────────

/**
 * The Zitadel roles claim. Zitadel emits it only when the project carries
 * `projectRoleAssertion:true` — `infra/dev-stand/idp/provision.sh` sets it, and
 * the prod path is documented in `infra/dev-stand/idp/bootstrap.md` §5a.
 * (EARS-415)
 */
export const ZITADEL_ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles'

/** The two starting roles of the workspace — and no others (EARS-414). */
export const PLATFORM_USER_ROLE = 'platform-user'
export const PLATFORM_ADMIN_ROLE = 'platform-admin'
export const PLATFORM_ROLES = [PLATFORM_USER_ROLE, PLATFORM_ADMIN_ROLE] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]

/**
 * Zitadel emits the claim as an OBJECT keyed by role — `{ "platform-admin":
 * { "<orgId>": "<orgDomain>" } }` — not as an array. Both shapes are read so a
 * flat `roles: [...]` (what a mapped claim or a test fixture carries) is not a
 * silent lock-out, and anything else yields NO roles: an unreadable claim is
 * an absent grant, never a granted one.
 */
export function normalizeRolesClaim(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.filter((role): role is string => typeof role === 'string')
  if (claim !== null && typeof claim === 'object') return Object.keys(claim as object)
  return []
}

/** The roles Auth.js put on the session (src/auth.ts). Fail-closed on any other shape. */
export function sessionRoles(session: SessionLike | null | undefined): string[] {
  const user = session?.user
  if (user === null || typeof user !== 'object') return []
  const roles = (user as { roles?: unknown }).roles
  return Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === 'string')
    : []
}

/**
 * Does this session carry `required`?
 *
 * `platform-admin` implies `platform-user` (EARS-417): one grant lets an admin
 * account into both the member half and the cabinet. The implication is
 * deliberately one-directional and hard-coded to the two starting roles — a
 * further claim introduced later (EARS-466) grants nothing but itself.
 */
export function hasClaim(session: SessionLike | null | undefined, required: string): boolean {
  const roles = sessionRoles(session)
  if (roles.includes(required)) return true
  return required === PLATFORM_USER_ROLE && roles.includes(PLATFORM_ADMIN_ROLE)
}

/**
 * The gate for any surface under `/p`, for server components and layouts.
 *
 * `platform-user` is required by EVERY path (EARS-416); `requiredClaim` is the
 * extra claim a particular surface declares (EARS-401), e.g. `platform-admin`
 * over the cabinet. An unauthenticated caller is bounced to sign-in — an
 * authenticated one who lacks the role is refused BARE (EARS-418, D-5), with
 * no login loop: signing in again would grant nothing.
 */
export function resolveClaimGate(
  session: SessionLike | null | undefined,
  currentPath: string,
  requiredClaim?: string | null,
): GateDecision {
  if (requiresSignIn(session)) return { type: 'redirect', to: signInRedirect(currentPath) }
  if (!hasClaim(session, PLATFORM_USER_ROLE)) return { type: 'forbidden' }
  if (requiredClaim && !hasClaim(session, requiredClaim)) return { type: 'forbidden' }
  return { type: 'render' }
}

/**
 * The same boundary for a route handler (EARS-461, EARS-462): returns the
 * refusal to return, or `null` meaning "carry on".
 *
 * A handler never redirects — an API caller gets the bare 403 in every refused
 * case, anonymous included, so the trust boundary is the handler itself and not
 * the shell that rendered a link to it. A handler that relies on the launcher
 * having omitted the tile, or on the cabinet shell having checked, is a defect.
 */
export function claimGateResponse(
  session: SessionLike | null | undefined,
  requiredClaim?: string | null,
): Response | null {
  if (requiresSignIn(session)) return new Response(null, { status: 403 })
  if (!hasClaim(session, PLATFORM_USER_ROLE)) return new Response(null, { status: 403 })
  if (requiredClaim && !hasClaim(session, requiredClaim)) return new Response(null, { status: 403 })
  return null
}
