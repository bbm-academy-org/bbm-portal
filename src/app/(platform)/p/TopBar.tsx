import React from 'react'

import { Avatar, AvatarFallback } from '@/ui/avatar'
import { Separator } from '@/ui/separator'

/**
 * The shared workspace top bar (spec 311 EARS-425), rendered by
 * `src/app/(platform)/p/layout.tsx` so every `/p/*` page carries it by existing.
 *
 * WHY IT LIVES HERE AND NOT IN `src/ui`. The kit is the copied shadcn/ui
 * neutral theme (#360, owner Stage-A decision by Антон, 2026-08-26) — six
 * primitives and no application chrome. A workspace top bar is not an element
 * class the system publishes; it is a COMPOSITION of primitives that belongs to
 * one surface. `src/ui/README.md` names exactly that split, and lists the
 * avatar/separator/button/dropdown-menu it was copied in for. Putting a `TopBar`
 * back into the kit would be re-inventing the element class the kit deliberately
 * does not have — the #312 mistake in a new package.
 *
 * So: LAYOUT from `design-source/p-launcher.html` (`fidelity: wireframe` — a
 * thin bar, home link on the left, the current app beside it, the switcher next
 * to it, the member and sign-out on the right, wrapping while narrow); LOOK from
 * the kit's primitives on the adopted theme (`system:` row, `fidelity: visual`).
 * That is EARS-430's two halves, from the two rows they each come from.
 *
 * BRANDING: the text logo «Платформа BBM». The owner's Stage-A decision on #360
 * is a text logo and no custom palette — the wireframe's «BBM · Портал» wordmark
 * was scaffolding, not a brand decision.
 */

/** The member's initials — one or two letters, from a name or an email local part. */
export function initials(label: string): string {
  const words = label
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (words.length === 0) return '—'
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? '')
  return letters.join('').toLocaleUpperCase('ru-RU')
}

export function TopBar({
  homeHref,
  appName,
  memberName,
  switcher,
  actions,
}: {
  homeHref: string
  appName: string
  memberName: string
  switcher?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header
      data-bbm-ui
      data-top-bar
      className="sticky top-0 z-20 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
        <a
          data-top-bar-home
          href={homeHref}
          className="rounded-md text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Платформа BBM
        </a>

        <Separator orientation="vertical" className="h-4" />

        {/* EARS-469 / EARS-470: the app the pathname resolved to, or the home's
            own name on `/p`. The bar never names an app itself — the string
            arrives from the registry via the layout. */}
        <span data-top-bar-app className="text-sm text-muted-foreground">
          {appName}
        </span>

        {switcher}

        <div className="ml-auto flex items-center gap-2">
          <Avatar size="sm">
            <AvatarFallback>{initials(memberName)}</AvatarFallback>
          </Avatar>
          <span data-top-bar-member className="hidden text-sm text-muted-foreground sm:inline">
            {memberName}
          </span>
          {actions}
        </div>
      </div>
    </header>
  )
}
