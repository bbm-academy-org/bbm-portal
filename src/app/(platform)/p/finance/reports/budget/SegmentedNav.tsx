import Link from 'next/link'
import { useId } from 'react'

import { cn } from '@/ui/utils'

export type Segment = {
  key: string
  label: string
  href: string
  current: boolean
  /**
   * Why the segment cannot be chosen. It then renders as a focusable disabled
   * link whose reason is its accessible description (and its hover title), so a
   * keyboard or screen-reader user hears why, not only a mouse user.
   */
  disabledReason?: string | null
}

/**
 * The page's one-click segmented switch — the `.seg` / `.periods` control of
 * `design-source/finance/BudgetDashboard.html`. Each segment is a link to the
 * page's own URL (the URL stays the state source) with `scroll={false}`: a
 * switch re-renders the page in place instead of throwing it back to the top.
 */
export function SegmentedNav({
  label,
  segments,
  testId,
}: {
  label: string
  segments: Segment[]
  testId?: string
}) {
  const idBase = useId()
  return (
    <nav
      aria-label={label}
      className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-[3px]"
      data-testid={testId}
    >
      {segments.map((segment) =>
        segment.disabledReason ? (
          <span key={segment.key} className="contents">
            <span
              role="link"
              tabIndex={0}
              aria-disabled="true"
              aria-describedby={`${idBase}-${segment.key}-reason`}
              title={segment.disabledReason}
              className="cursor-not-allowed rounded-md px-2.5 py-1 text-xs text-muted-foreground opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {segment.label}
            </span>
            <span id={`${idBase}-${segment.key}-reason`} className="sr-only">
              {segment.disabledReason}
            </span>
          </span>
        ) : (
          <Link
            key={segment.key}
            href={segment.href}
            scroll={false}
            aria-current={segment.current ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              segment.current && 'bg-background font-medium text-foreground shadow-xs',
            )}
          >
            {segment.label}
          </Link>
        ),
      )}
    </nav>
  )
}
