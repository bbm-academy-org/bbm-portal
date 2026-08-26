'use client'

import React from 'react'

import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'

/**
 * The top bar's app switcher (spec 311 EARS-425, EARS-427, EARS-428).
 *
 * It is handed a plain list of links. It does NOT read the registry: the
 * registry is resolved on the server, for this session, before this component
 * exists (D-7) — so an entry the member may not open never reaches the browser,
 * and a `planned` placeholder is not here at all, because a switcher is a
 * navigation control and a placeholder has nowhere to switch to (EARS-478).
 *
 * NO LONGER BESPOKE (#360). Until the re-skin this panel was a hand-written
 * `<ul role="menu">` with its own stylesheet, justified at rung 3 of the reuse
 * ladder because the kit of the day had no menu component and the wireframe drew
 * the control closed. The kit adopted on #360 publishes `dropdown-menu`, so the
 * ladder now resolves one rung higher: the control is the kit's `Button`, the
 * panel is the kit's `DropdownMenu`, and `app-switcher.css` is deleted rather
 * than ported. Nothing on this surface is bespoke any more, which is why
 * `docs/design/ui-whitelist.md` records no justification for it.
 *
 * Escape, click-outside, focus return and roving focus are Radix's, not ours —
 * that is most of what the hand-written panel had to implement by hand.
 */

export interface AppSwitcherLink {
  key: string
  name: string
  href: string
  external: boolean
}

export function AppSwitcher({
  links,
  label = 'Приложения',
}: {
  links: readonly AppSwitcherLink[]
  label?: string
}) {
  if (links.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-app-switcher variant="outline" size="sm">
          {label}
        </Button>
      </DropdownMenuTrigger>
      {/* `data-bbm-ui` again, and it is load-bearing: Radix portals the panel to
          `document.body`, outside the bar's own subtree, so the scoped base
          layer of `src/ui/theme.css` would not otherwise reach it. */}
      <DropdownMenuContent data-bbm-ui data-app-switcher-menu align="start" className="w-56">
        {links.map((link) => (
          <DropdownMenuItem key={link.key} asChild>
            <a
              href={link.href}
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              <span>{link.name}</span>
              {link.external ? (
                <span className="ml-auto text-xs text-muted-foreground" aria-hidden="true">
                  ↗
                </span>
              ) : null}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
