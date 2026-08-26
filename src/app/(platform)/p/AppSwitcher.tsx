'use client'

import React from 'react'

import { Button } from '@/ui'

import './app-switcher.css'

/**
 * The top bar's app switcher (spec 311 EARS-425, EARS-427, EARS-428).
 *
 * It is handed a plain list of links. It does NOT read the registry: the
 * registry is resolved on the server, for this session, before this component
 * exists (D-7) — so an entry the member may not open never reaches the browser,
 * and a `planned` placeholder is not here at all, because a switcher is a
 * navigation control and a placeholder has nowhere to switch to (EARS-478).
 *
 * WHY IT IS BESPOKE, and what «bespoke» covers here
 * (`build-ui-from-design-system`, reuse ladder step 3):
 * the vendored `design-source/p-launcher.html` draws the switcher CLOSED — one
 * control, `.bar-switch`, which IS the kit's `Button` and is used as such below.
 * The OPEN menu is a state the wireframe explicitly lists under NOT SHOWN, so
 * there is no design to build it from and no kit component that covers it.
 * Adding one to `src/ui` would be putting an element class into the kit with no
 * Stage A behind it, which is the thing `.claude/rules/design-process.md` §1
 * forbids. So the panel is local to this surface, is drawn only from palette
 * tokens (no literal ever enters `app-switcher.css`), and stays a candidate for
 * the kit when a menu is designed rather than a settled element class today.
 */

export interface AppSwitcherLink {
  key: string
  name: string
  href: string
  external: boolean
}

export function AppSwitcher({
  links,
  label = 'Приложения ▾',
}: {
  links: readonly AppSwitcherLink[]
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLSpanElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    // Two ways out that a member expects from any menu and that the wireframe
    // could not draw: Escape, and a click anywhere else. Without them the panel
    // is a trap on touch, where there is no Escape key and no obvious close.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  if (links.length === 0) return null

  return (
    <span className="bbm-app-switcher" ref={root}>
      <Button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        {label}
      </Button>
      {open ? (
        <ul className="bbm-app-switcher__menu" role="menu">
          {links.map((link) => (
            <li key={link.key} role="none">
              <a
                className="bbm-app-switcher__item"
                role="menuitem"
                href={link.href}
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {link.name}
                {link.external ? (
                  <span className="bbm-app-switcher__mark" aria-hidden="true">
                    ↗
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  )
}
