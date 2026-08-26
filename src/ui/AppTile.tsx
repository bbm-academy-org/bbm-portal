import type { ReactNode } from 'react'

import { cx } from './classNames'
import { Eyebrow } from './Eyebrow'
import { Tag } from './Tag'
import './app-tile.css'

/** The four tile forms `p-launcher.html` draws, and the only four (EARS-468). */
export type AppTileVariant = 'internal' | 'external' | 'admin' | 'planned'

export interface AppTileProps {
  name: ReactNode
  /** What the app is for, in one phrase. */
  description?: ReactNode
  /** Where the tile goes. Absent — and ignored — for a `planned` placeholder. */
  href?: string
  variant?: AppTileVariant
  /**
   * The module's own one-line status («Период «август 2026» открыт до 1
   * сентября»). Omitted when the module publishes none — the tile then simply
   * has no status line. Never rendered for a `planned` placeholder (EARS-478).
   */
  status?: ReactNode
  /**
   * The launcher's `.pulse.none` — the entry publishes no status line and says
   * so, keeping the tile's foot rule («— без статус-строки —» on the admin
   * tile). Opt-in: a tile given neither `status` nor this renders no foot at
   * all, and a `planned` placeholder never renders one either (EARS-478).
   */
  emptyStatus?: ReactNode
  /** The icon swatch's content. Empty by default, as the wireframe draws it. */
  icon?: ReactNode
  /** Copy of the external marker. Overridable so the kit does not own wording. */
  externalLabel?: ReactNode
  /** Copy of the administrator-only flag. */
  adminLabel?: ReactNode
  /** Caption of a not-yet-live app. */
  plannedLabel?: ReactNode
  className?: string
}

/**
 * One entry on the `/p` home.
 *
 * PRESENTATION ONLY. The tile does not know what a registry is, which session
 * is looking, or whether the member holds a claim — it is handed a variant and
 * some text. Deciding which entries a session may see is the launcher's job
 * (EARS-402), and the boundary rule `ui-kit-must-not-import-src` keeps that
 * decision out of here mechanically.
 *
 * The marker copy below is the Russian the vendored design draws, carried as a
 * DEFAULT rather than as a constant: a caller that needs different wording
 * passes it, and a caller that does not gets the design's own words instead of
 * having to re-type them on every surface.
 */
export function AppTile({
  name,
  description,
  href,
  variant = 'internal',
  status,
  emptyStatus,
  icon,
  externalLabel = '↗ внешний',
  adminLabel = 'только администратор',
  plannedLabel = 'портфель, позже',
  className,
}: AppTileProps) {
  const planned = variant === 'planned'
  const classes = cx('bbm-app-tile', `bbm-app-tile--${variant}`, className)

  const body = (
    <>
      {variant === 'external' ? (
        <Tag mark className="bbm-app-tile__external-mark">
          {externalLabel}
        </Tag>
      ) : null}
      <span className="bbm-app-tile__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="bbm-app-tile__name">{name}</span>
      {description ? <span className="bbm-app-tile__description">{description}</span> : null}
      {variant === 'admin' ? (
        <span className="bbm-app-tile__description">
          <Eyebrow size="xs">{adminLabel}</Eyebrow>
        </span>
      ) : null}
      {planned ? <span className="bbm-app-tile__description">{plannedLabel}</span> : null}
      {!planned && status ? <span className="bbm-app-tile__status">{status}</span> : null}
      {!planned && !status && emptyStatus ? (
        <span className="bbm-app-tile__status bbm-app-tile__status--empty">{emptyStatus}</span>
      ) : null}
    </>
  )

  // EARS-478: a placeholder carries no link and no click target, and is not
  // reachable by keyboard focus. That is why it is a <div> with no tabIndex
  // rather than a disabled-looking anchor — an anchor with `aria-disabled`
  // still takes focus, and a `pointer-events: none` link is still in the tab
  // order. The element type IS the rule.
  if (planned || !href) {
    return <div className={classes}>{body}</div>
  }

  const external = variant === 'external'
  return (
    <a
      className={classes}
      href={href}
      // EARS-423: an external app opens in its own tab, so the member does not
      // lose the workspace; `noopener noreferrer` because the opened page must
      // not get a handle on ours.
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {body}
    </a>
  )
}
