/**
 * Full host→surface allowlist (ADR-003 §1/§2 Layer 1, spec 060 req.3/5 —
 * default-deny on EVERY host, over ALL paths).
 *
 * One Next.js process is fronted by Caddy for several hostnames; an App Router
 * route answers on EVERY host by default, so the host→surface split must be
 * expressed in code or a route leaks across hosts (the /okr near-leak, issue
 * #63). These pure functions are the single source of that decision; the
 * middleware (src/middleware.ts) is a thin wrapper over `evaluateRequest`.
 * Caddy stays coarse (host-level only) — this table is the sole enforcement
 * (spec 060 req.2).
 *
 * The table (positive allowlists — anything not listed 404s):
 *
 *   cms.bbm.academy   → CMS surface: /admin*, Payload REST/GraphQL under
 *                       /api/* (EXCEPT /api/auth/* — Auth.js is platform
 *                       plumbing, the more specific rule wins), media via
 *                       /api/media/*, the (frontend) static-backend routes
 *                       (today only `/`), framework infra.
 *   app (internal)    → CMS surface. The `preview` container fetches drafts
 *                       server-to-server from http://app:3000 over the compose
 *                       network (deploy/docker-compose.prod.yml) — full
 *                       default-deny on unknown hosts would break live
 *                       preview, so the internal service name is allowlisted
 *                       explicitly. Unreachable from outside: Caddy only
 *                       proxies its own site blocks and port 3000 is not
 *                       published. (No container healthcheck hits the app over
 *                       HTTP — nothing else to allow; verified 2026-07-27.)
 *   portal.bbm.academy→ Platform surface: /p, /p/*, /api/auth/* (Auth.js),
 *                       framework infra.
 *   localhost/127.0.0.1 → BOTH surfaces, but ONLY in development mode (dev
 *                       ergonomics: admin + /p/okr on one origin). In
 *                       production they are NOT hosts of either surface
 *                       (spec 060 req.5 prod-hardening).
 *   anything else / missing Host → 404 for everything (default-deny).
 *
 * Mode is passed explicitly into the pure core so prod vs dev behavior is
 * unit-testable; the middleware wires it from NODE_ENV at the edge.
 */

export type AllowlistMode = 'production' | 'development'

/** NODE_ENV → allowlist mode: strict host sets only for a real prod build. */
export function modeFromNodeEnv(nodeEnv: string | undefined): AllowlistMode {
  return nodeEnv === 'production' ? 'production' : 'development'
}

/** Hosts whose surface is the platform (portal). */
const PLATFORM_HOSTS = new Set(['portal.bbm.academy'])

/** Hosts whose surface is the CMS. `app` = internal compose service name (see header). */
const CMS_HOSTS = new Set(['cms.bbm.academy', 'app'])

/** The dev origin serves BOTH surfaces — development mode only (spec 060 req.5). */
const DEV_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1'])

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
export function isPlatformSurfaceHost(
  host: string | null | undefined,
  mode: AllowlistMode,
): boolean {
  const hostname = normalizeHost(host)
  if (hostname === null) return false
  if (PLATFORM_HOSTS.has(hostname)) return true
  return mode === 'development' && DEV_ORIGIN_HOSTS.has(hostname)
}

/** Is this host allowed to serve the CMS surface? (default-deny) */
export function isCmsSurfaceHost(host: string | null | undefined, mode: AllowlistMode): boolean {
  const hostname = normalizeHost(host)
  if (hostname === null) return false
  if (CMS_HOSTS.has(hostname)) return true
  return mode === 'development' && DEV_ORIGIN_HOSTS.has(hostname)
}

/** Auth.js (next-auth) plumbing — platform surface, NEVER served on the CMS host. */
function isAuthPath(pathname: string): boolean {
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/')
}

/**
 * Framework infrastructure that both surfaces need: /_next/* (static chunks,
 * image optimizer, RSC/HMR plumbing) and the favicon. Forgetting these is the
 * named pitfall of spec 060 req.3 — a broken admin AND a broken dashboard.
 * They pass on any KNOWN host; on unknown hosts default-deny still applies.
 * Development additionally needs the error-overlay/devtools endpoints
 * (`/__nextjs...`).
 */
function isFrameworkPath(pathname: string, mode: AllowlistMode): boolean {
  if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') return true
  return mode === 'development' && pathname.startsWith('/__nextjs')
}

/** Platform-surface allowlist: the O(1) /p/* rule (ADR-003 §3(a)) + Auth.js. */
function isPlatformSurfacePath(pathname: string): boolean {
  return isPlatformPath(pathname) || isAuthPath(pathname)
}

/**
 * CMS-surface allowlist: Payload admin, Payload REST/GraphQL (/api/[...slug],
 * /api/graphql, /api/graphql-playground, media under /api/media/*) — with the
 * more specific /api/auth/* DENY carved out — plus the (frontend)
 * static-backend routes. Today that group serves ONLY `/`; a new (frontend)
 * page must be added here or it 404s (fails closed — the ADR-003 trade).
 */
function isCmsSurfacePath(pathname: string): boolean {
  if (pathname === '/') return true
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true
  if (isAuthPath(pathname)) return false
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * The middleware decision for a request: which surfaces may this host serve,
 * and is the pathname on one of their allowlists? Unknown/missing Host serves
 * nothing. A host serving both surfaces (dev origin) passes the union.
 */
export function evaluateRequest(
  host: string | null | undefined,
  pathname: string,
  mode: AllowlistMode,
): 'pass' | 'not-found' {
  const platform = isPlatformSurfaceHost(host, mode)
  const cms = isCmsSurfaceHost(host, mode)
  if (!platform && !cms) return 'not-found'
  if (isFrameworkPath(pathname, mode)) return 'pass'
  if (platform && isPlatformSurfacePath(pathname)) return 'pass'
  if (cms && isCmsSurfacePath(pathname)) return 'pass'
  return 'not-found'
}
