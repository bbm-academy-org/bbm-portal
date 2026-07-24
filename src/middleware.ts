import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { evaluatePlatformRequest } from '@/lib/platform/hostAllowlist'

/**
 * Host-allowlist middleware for the platform surface (ADR-003 §2, default-deny).
 * The decision itself is the pure `evaluatePlatformRequest` (unit-tested); this
 * is only the wiring. The matcher scopes middleware to `/p/*`, so CMS routes
 * (`/admin`, `/api`, the static-site frontend, …) never reach it — they stay
 * untouched on every host in P2b (the CMS-host positive allowlist is P3, #60).
 *
 * Two independent layers: this decides *what is routable on this host*; the
 * (platform) layout's Auth.js gate then decides *who may see it* (spec 059).
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  if (evaluatePlatformRequest(req.headers.get('host'), pathname) === 'not-found') {
    return new NextResponse(null, { status: 404 })
  }
  // Forward the visible pathname so the (platform) layout can build an accurate
  // post-login callbackUrl without re-parsing the URL.
  const headers = new Headers(req.headers)
  headers.set('x-platform-pathname', pathname)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/p', '/p/:path*'],
}
