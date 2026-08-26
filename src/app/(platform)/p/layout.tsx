import { headers } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import React from 'react'

import { auth, signOut } from '@/auth'
import { hasClaim, PLATFORM_USER_ROLE, resolveClaimGate } from '@/lib/platform/authGate'
import { currentEntry, switcherEntries, WORKSPACE_REGISTRY } from '@/lib/workspace'
import { Button, TopBar } from '@/ui'

import { AppSwitcher } from './AppSwitcher'

// The UI kit's theme entry (#360). Imported HERE rather than in the (platform)
// root layout because `/p/*` is exactly the surface the kit is for: the CMS and
// the (frontend) group keep their own stylesheets untouched. The import carries
// no preflight — see the header of the file — so it changes nothing on screen
// today; it makes the theme variables and Tailwind's utilities available to the
// kit's components, which is what the re-skin slice builds on.
import '@/ui/theme.css'

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
 * SINCE #314 this layout also renders the SHARED TOP BAR (EARS-425), for the
 * same structural reason and with the same consequence: every `/p/*` page
 * carries the bar by existing, and the two surfaces that already existed gain it
 * and nothing else (EARS-429 — neither page body is touched, neither is
 * restyled, and this file names neither of them).
 *
 * What this layout does NOT cover: a ROUTE HANDLER. Next does not run layouts
 * for `route.ts`, so «every path under `/p`» (EARS-416) is true of pages and
 * server components only — a handler under `/p` is gated when it calls
 * `claimGateResponse` itself, and not before. The one such handler today
 * (`p/hours/admin/export/route.ts`) does; #315 inherits the obligation, not the
 * coverage.
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

  // Both readings of the bar come from the ONE registry (EARS-402, EARS-427):
  // the switcher's list and the name of the app the member is in. This layout
  // names no app itself.
  const current = currentEntry(WORKSPACE_REGISTRY, currentPath)
  const links = switcherEntries(WORKSPACE_REGISTRY, (claim) => hasClaim(session, claim)).map(
    (entry) => ({
      key: entry.slug,
      name: entry.name,
      href: entry.kind === 'internal' ? entry.href : entry.url,
      external: entry.kind === 'external',
    }),
  )

  const user = (session?.user ?? {}) as { name?: string | null; email?: string | null }

  return (
    <>
      <TopBar
        homeHref="/p"
        // EARS-470 / the vendored file: on `/p` the bar is in its HOME state and
        // names no app of the registry — `design-source/p-launcher.html` draws
        // that state as «BBM · Портал / Главная», which is the home naming
        // itself and not a current app. On any other `/p/*` path the slot holds
        // the app the pathname resolved to (EARS-469, longest prefix wins).
        appName={current ? current.name : 'Главная'}
        memberName={user.name ?? user.email ?? 'Участник'}
        switcher={<AppSwitcher links={links} />}
        actions={
          <form
            action={async () => {
              'use server'
              // Back to `/p`, which is gated — so the visible end of a sign-out
              // is the sign-in screen, not a 404 on a path this host does not
              // serve (ADR-003 §3(a) admits `/p`, `/p/*` and `/api/auth/*`).
              await signOut({ redirectTo: '/p' })
            }}
          >
            <Button type="submit" variant="plain">
              Выйти
            </Button>
          </form>
        }
      />
      {children}
    </>
  )
}
