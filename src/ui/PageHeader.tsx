import type { ReactNode } from 'react'

import { cx } from './classNames'
import './page-header.css'

export interface PageHeaderProps {
  title: ReactNode
  /** One line under the title: what this screen is for, or its current state. */
  subtitle?: ReactNode
  /** `lg` (default) — the launcher's heading. `md` — the cabinet's. */
  size?: 'lg' | 'md'
  className?: string
}

/**
 * The `h1` of a `/p` screen, with its optional one-line subtitle.
 *
 * Always an `h1`: every screen either of the vendored designs draws has exactly
 * one, and a kit that let the level be passed in would let a page ship with two
 * or with none. A screen needing a second level of heading writes it directly.
 */
export function PageHeader({ title, subtitle, size = 'lg', className }: PageHeaderProps) {
  return (
    <header className={cx('bbm-page-header', size === 'md' && 'bbm-page-header--md', className)}>
      <h1 className="bbm-page-header__title">{title}</h1>
      {subtitle ? <p className="bbm-page-header__subtitle">{subtitle}</p> : null}
    </header>
  )
}
