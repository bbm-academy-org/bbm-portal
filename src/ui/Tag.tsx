import type { ReactNode } from 'react'

import { cx } from './classNames'
import './tag.css'

export interface TagProps {
  children: ReactNode
  /** A recorded-but-not-live state — `.tag.off` of the cabinet wireframe. */
  muted?: boolean
  className?: string
}

/** A bordered micro-label: a row's state, or an entry's «↗ внешний» marker. */
export function Tag({ children, muted = false, className }: TagProps) {
  return <span className={cx('bbm-tag', muted && 'bbm-tag--muted', className)}>{children}</span>
}
