/**
 * Host-allowlist decision for the platform surface (ADR-003 §2, default-deny).
 *
 * One Next.js process is fronted by Caddy for several hostnames; an App Router
 * route answers on EVERY host by default, so the host→surface split must be
 * expressed in code or a platform path leaks across hosts (the /okr near-leak,
 * issue #63). These pure functions are the single source of that decision; the
 * middleware (src/middleware.ts) is a thin wrapper over `evaluatePlatformRequest`.
 *
 * Scope for P2b: the allowlist governs ONLY the `/p/*` platform surface. CMS
 * routes (`/admin`, `/api`, the static-site frontend, …) stay untouched on every
 * host for now — the CMS-host positive allowlist (ADR-003 §2 Layer 1 full form)
 * lands with the portal host at P3 (#60). Default-deny still holds for `/p/*`:
 * it is reachable ONLY on a known platform host, 404 everywhere else.
 */

/** Hosts whose surface is the platform: the dev origin + the future portal host. */
const PLATFORM_SURFACE_HOSTS = new Set(['localhost', '127.0.0.1', 'portal.bbm.academy'])

/**
 * Normalize a raw `Host` header to a bare hostname: lowercase, trimmed, port
 * stripped, and a single trailing FQDN dot removed so an absolute-FQDN Host
 * (`cms.bbm.academy.`) cannot bypass an exact match (the PR #64 bypass class,
 * preserved as a known pitfall). Returns `null` for a missing/empty header.
 */
export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  const hostname = host.split(':', 1)[0].trim().toLowerCase().replace(/\.$/, '')
  return hostname === '' ? null : hostname
}

/**
 * Is this visible pathname part of the platform surface? True for `/p` and
 * anything under `/p/` — but NOT lookalikes like `/players` that merely share
 * the `/p` prefix.
 */
export function isPlatformPath(pathname: string): boolean {
  return pathname === '/p' || pathname.startsWith('/p/')
}

/** Is this host allowed to serve the platform surface? (default-deny) */
export function isPlatformSurfaceHost(host: string | null | undefined): boolean {
  const hostname = normalizeHost(host)
  return hostname !== null && PLATFORM_SURFACE_HOSTS.has(hostname)
}

/**
 * The middleware decision for a request. A platform path is served only on a
 * platform host; on any other host (the CMS host, an unknown host, a missing
 * Host) it 404s. Non-platform paths always pass — the allowlist does not govern
 * CMS routes in P2b.
 */
export function evaluatePlatformRequest(
  host: string | null | undefined,
  pathname: string,
): 'pass' | 'not-found' {
  if (!isPlatformPath(pathname)) return 'pass'
  return isPlatformSurfaceHost(host) ? 'pass' : 'not-found'
}
