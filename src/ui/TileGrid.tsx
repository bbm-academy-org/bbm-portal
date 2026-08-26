import type { ReactNode } from 'react'

import { cx } from './classNames'
import './tile-grid.css'

export interface TileGridProps {
  children: ReactNode
  className?: string
}

/**
 * The launcher's one flat grid of app tiles (EARS-422: order is registry
 * order — the grid does no sorting and no grouping, in v1 by decision).
 */
export function TileGrid({ children, className }: TileGridProps) {
  return <div className={cx('bbm-tile-grid', className)}>{children}</div>
}
