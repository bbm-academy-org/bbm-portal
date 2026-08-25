import { headers } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import React from 'react'

import { auth } from '@/auth'
import { PLATFORM_ADMIN_ROLE, resolveClaimGate } from '@/lib/platform/authGate'

/**
 * The cabinet's claim gate (spec 311 §B, D-4): `/p/admin` is the frame's own
 * registry entry and its declared `requiredClaim` is `platform-admin`.
 *
 * The enforcement is here, in a server component, and it is the REAL boundary
 * (EARS-405, scenario 7): a member holding only `platform-user` who TYPES the
 * URL is refused with the same bare 403 as anyone else, regardless of the
 * launcher having omitted the tile for them. Every handler and server action
 * behind the cabinet re-checks the claim for itself (EARS-462) — this layout
 * is not their gate, it is the shell's.
 *
 * #315 builds the Refine shell inside this layout; the gate is deliberately a
 * separate file from whatever that shell becomes, so the boundary survives a
 * rewrite of the surface it protects.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const requestHeaders = await headers()
  const currentPath = requestHeaders.get('x-platform-pathname') ?? '/p/admin'

  const decision = resolveClaimGate(session, currentPath, PLATFORM_ADMIN_ROLE)
  if (decision.type === 'redirect') redirect(decision.to)
  if (decision.type === 'forbidden') forbidden()

  return <>{children}</>
}
