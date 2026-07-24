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

export type GateDecision = { type: 'render' } | { type: 'redirect'; to: string }

/** Resolve the gate for a request at `currentPath` given its session (if any). */
export function resolvePlatformGate(
  session: SessionLike | null | undefined,
  currentPath: string,
): GateDecision {
  if (requiresSignIn(session)) return { type: 'redirect', to: signInRedirect(currentPath) }
  return { type: 'render' }
}
