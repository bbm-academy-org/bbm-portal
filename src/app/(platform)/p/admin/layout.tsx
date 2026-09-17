import { headers } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import React from 'react'

import { auth } from '@/auth'
import { hasAnyClaim, resolveClaimGate } from '@/lib/platform/authGate'
import { WORKSPACE_REGISTRY } from '@/lib/workspace'

import { CabinetShell } from './CabinetShell'
import { cabinetClaimsForPath, cabinetResources, cabinetSectionClaims } from './resources'

/**
 * The cabinet's claim gate (spec 311 §B, D-4): `/p/admin` is the frame's own
 * registry entry and its declared `requiredClaim` is `platform-admin`.
 *
 * SINCE 2026-09-16 the gate is asked PER SECTION (#479, owner decision 34).
 * `platform-admin` still admits everywhere; a section may declare further
 * administering claims (`WorkspaceAdminSection.additionalClaims`, EARS-466),
 * and the finance catalogues declare `finance-entry`. The claim set comes from
 * the composition root through `cabinetClaimsForPath` — this file names no
 * module and no role, so widening a section costs nothing here. The SAME
 * predicate then trims the shell's resource tree: a section the viewer cannot
 * enter is not offered in the sidebar, rather than offered and refused on
 * click (EARS-437).
 *
 * The enforcement is here, in a server component, and it is the REAL boundary
 * (EARS-405, scenario 7): a member holding only `platform-user` who TYPES the
 * URL is refused with the same bare 403 as anyone else, regardless of the
 * launcher having omitted the tile for them. Every handler and server action
 * behind the cabinet re-checks the claim for itself (EARS-462) — this layout
 * is not their gate, it is the shell's.
 *
 * SINCE #315 this layout also mounts the Refine shell (EARS-431) — but the gate
 * above it is deliberately still the first thing that runs, and lives in its
 * own file from the shell it protects, so the boundary survives a rewrite of
 * the surface. The shell is given the resource tree DERIVED here from the
 * composition root (EARS-402, EARS-409, EARS-410): reading the registry is a
 * server-side act (EARS-457, and the declarations reach the data layer), and
 * `ResourceProps[]` is plain data, so it is what crosses into the client.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const requestHeaders = await headers()
  const currentPath = requestHeaders.get('x-platform-pathname') ?? '/p/admin'

  const decision = resolveClaimGate(
    session,
    currentPath,
    cabinetClaimsForPath(WORKSPACE_REGISTRY, currentPath),
  )
  if (decision.type === 'redirect') redirect(decision.to)
  if (decision.type === 'forbidden') forbidden()

  const admits = (slug: string) =>
    hasAnyClaim(session, cabinetSectionClaims(WORKSPACE_REGISTRY, slug))

  return (
    <CabinetShell resources={cabinetResources(WORKSPACE_REGISTRY, admits)}>{children}</CabinetShell>
  )
}
