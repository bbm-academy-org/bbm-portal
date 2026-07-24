import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isOkrBlockedOnHost } from '@/lib/platform/hostGuard'

// Host guard: the /okr platform module must not be exposed on the CMS host
// (see src/lib/platform/hostGuard.ts, issue #63). Matcher is scoped to /okr
// paths only, so Payload admin and everything else never hit this middleware.
export function middleware(req: NextRequest): NextResponse {
  if (isOkrBlockedOnHost(req.headers.get('host'), req.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/okr', '/okr/:path*'],
}
