import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { evaluateRequest, isPlatformPath, modeFromNodeEnv } from '@/lib/platform/hostAllowlist'

/**
 * Host-allowlist middleware — the authoritative host→surface enforcement
 * (ADR-003 §2 Layer 1, spec 060 req.2/3). The decision itself is the pure
 * `evaluateRequest` (unit-tested matrix); this is only the wiring. P3 expands
 * the matcher from /p/* to ALL paths, so every request on every host is
 * checked against a positive per-host allowlist: CMS surface on
 * cms.bbm.academy (+ the internal `app` host for preview S2S), platform
 * surface on portal.bbm.academy, both on localhost in dev, 404 anywhere else.
 *
 * /_next/static and /_next/image are excluded in the matcher (below) purely to
 * keep middleware off the hot asset path — build-fingerprinted, public-by-
 * design assets. The allowlist ALSO passes /_next/* on known hosts, so
 * behavior stays identical if the matcher exclusion is ever changed; the pure
 * function remains the complete, testable table.
 *
 * Two independent layers: this decides *what is routable on this host*; the
 * (platform) layout's Auth.js gate then decides *who may see it* (spec 059).
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  const mode = modeFromNodeEnv(process.env.NODE_ENV)
  if (evaluateRequest(req.headers.get('host'), pathname, mode) === 'not-found') {
    return new NextResponse(null, { status: 404 })
  }
  if (isPlatformPath(pathname)) {
    // Forward the visible pathname so the (platform) layout can build an
    // accurate post-login callbackUrl without re-parsing the URL.
    const headers = new Headers(req.headers)
    headers.set('x-platform-pathname', pathname)
    return NextResponse.next({ request: { headers } })
  }
  return NextResponse.next()
}

export const config = {
  // Everything EXCEPT /_next/static and /_next/image (see header comment) —
  // the allowlist must see every routable path, incl. /, /admin, /api, /p.
  matcher: ['/((?!_next/static|_next/image).*)'],
}
