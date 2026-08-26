import type { ElementType, ReactNode } from 'react'

import { cx } from './classNames'
import './container.css'

export interface ContainerProps {
  children: ReactNode
  /** `contained` (default) holds the 1160px measure; `full` runs edge to edge. */
  width?: 'contained' | 'full'
  /** The element to render. Defaults to `div`; a page body passes `main`. */
  as?: ElementType
  className?: string
}

/** The horizontal measure every `/p` surface is laid out against. */
export function Container({
  children,
  width = 'contained',
  as: Element = 'div',
  className,
}: ContainerProps) {
  return (
    <Element className={cx('bbm-container', width === 'full' && 'bbm-container--full', className)}>
      {children}
    </Element>
  )
}
