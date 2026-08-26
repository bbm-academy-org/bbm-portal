import type { ReactNode } from 'react'

import { cx } from './classNames'
import './tag.css'

export interface TagProps {
  children: ReactNode
  /** A recorded-but-not-live state — `.tag.off` of the cabinet wireframe. */
  muted?: boolean
  /**
   * The launcher's `.ext-mark` form: unfilled, a step lighter and tighter. A
   * marker placed ON another element, as opposed to the filled tag that states
   * a row's own state.
   */
  mark?: boolean
  className?: string
}

/** A bordered micro-label: a row's state, or an entry's «↗ внешний» marker. */
export function Tag({ children, muted = false, mark = false, className }: TagProps) {
  return (
    <span className={cx('bbm-tag', mark && 'bbm-tag--mark', muted && 'bbm-tag--muted', className)}>
      {children}
    </span>
  )
}
