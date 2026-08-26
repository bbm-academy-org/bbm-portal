import type { ReactNode } from 'react'

import { cx } from './classNames'
import './eyebrow.css'

export interface EyebrowProps {
  children: ReactNode
  /** `sm` (default) — a region label. `xs` — the flag inside a tile. */
  size?: 'sm' | 'xs'
  className?: string
}

/**
 * An uppercase micro-label naming a region without heading it.
 *
 * A `<span>`, never a heading element: an eyebrow that renders as `<h2>` puts
 * a word like «РАЗДЕЛЫ» into the document outline a screen-reader user
 * navigates by. When the label really is the region's heading, the caller
 * wraps it — the kit does not guess the document structure of a page it
 * cannot see.
 */
export function Eyebrow({ children, size = 'sm', className }: EyebrowProps) {
  return (
    <span className={cx('bbm-eyebrow', size === 'xs' && 'bbm-eyebrow--xs', className)}>
      {children}
    </span>
  )
}
