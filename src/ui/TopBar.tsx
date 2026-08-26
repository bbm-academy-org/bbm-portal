import type { ReactNode } from 'react'

import { cx } from './classNames'
import './top-bar.css'

export interface TopBarProps {
  /** Where the workspace home is. */
  homeHref: string
  /** The workspace's own name. The design's wording is the default. */
  homeLabel?: ReactNode
  /**
   * The app the member is currently in. OMITTED on `/p` itself — EARS-470: the
   * bar shows its home state there and names no current app.
   */
  appName?: ReactNode
  /** The signed-in member, as they should be addressed. */
  memberName: ReactNode
  /**
   * The app switcher. A SLOT, not a prop of entries: the switcher is fed by the
   * registry (EARS-425/427) and the registry may not reach the kit (EARS-458).
   */
  switcher?: ReactNode
  /** Sign-out, and anything else the frame puts at the end of the bar. */
  actions?: ReactNode
  /** `contained` (default) — the launcher's measure. `full` — the cabinet's. */
  width?: 'contained' | 'full'
  className?: string
}

/**
 * The thin bar every `/p/*` page carries (EARS-425), rendered by the platform
 * layout once rather than by each surface.
 *
 * A `<header>` with a `<nav>`-free flat structure, matching what the two
 * wireframes draw: a home link, the current app's name, the switcher, and the
 * member's identity with sign-out. Everything that requires knowing WHO is
 * signed in or WHICH apps are open arrives as text or as a slot.
 */
export function TopBar({
  homeHref,
  homeLabel = 'BBM · Портал',
  appName,
  memberName,
  switcher,
  actions,
  width = 'contained',
  className,
}: TopBarProps) {
  return (
    <header className={cx('bbm-top-bar', className)}>
      <div
        className={cx(
          'bbm-top-bar__inner',
          width === 'contained' && 'bbm-top-bar__inner--contained',
        )}
      >
        <a className="bbm-top-bar__home" href={homeHref}>
          {homeLabel}
        </a>
        {appName ? (
          <>
            <span className="bbm-top-bar__sep" aria-hidden="true">
              /
            </span>
            <span className="bbm-top-bar__app">{appName}</span>
          </>
        ) : null}
        {switcher ? <span className="bbm-top-bar__switcher">{switcher}</span> : null}
        <span className="bbm-top-bar__right">
          {/* The wireframe's avatar is an empty swatch — there is no member
              photo anywhere in this workspace yet. Decorative until there is,
              so it is hidden from assistive tech rather than announced as an
              image with nothing in it. */}
          <span className="bbm-top-bar__avatar" aria-hidden="true" />
          <span className="bbm-top-bar__member">{memberName}</span>
          {actions}
        </span>
      </div>
    </header>
  )
}
