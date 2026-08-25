import { headers } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import React from 'react'

import { auth } from '@/auth'
import { PLATFORM_USER_ROLE, resolveClaimGate } from '@/lib/platform/authGate'

/**
 * The workspace membership gate (spec 311 EARS-416): WHILE a session lacks
 * `platform-user`, every path under `/p` is refused. It lives in a layout so a
 * new page inherits it BY EXISTING — a page author cannot forget to add it, and
 * a page added by a future task is gated before its first line runs.
 *
 * Why here and not in the (platform) root layout: `forbidden()` unwinds to the
 * nearest `forbidden.tsx` boundary ABOVE the segment that threw. The root
 * layout is where <html>/<body> come from, so a refusal thrown there would have
 * no layout left to render the boundary in. `/p` is the first segment that has
 * one, and it covers the whole workspace surface — the root layout's own
 * sign-in gate (spec 059) is unchanged and still runs first.
 *
 * The trust boundary is this server component and the handler-side
 * `claimGateResponse` (EARS-461, EARS-462) — never the UI. A tile the launcher
 * omits is a convenience, not a gate.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const requestHeaders = await headers()
  const currentPath = requestHeaders.get('x-platform-pathname') ?? '/p'

  const decision = resolveClaimGate(session, currentPath, PLATFORM_USER_ROLE)
  if (decision.type === 'redirect') redirect(decision.to)
  if (decision.type === 'forbidden') forbidden()

  return <>{children}</>
}
