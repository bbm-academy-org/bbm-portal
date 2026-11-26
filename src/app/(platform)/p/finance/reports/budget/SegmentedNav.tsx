import Link from 'next/link'

import { cn } from '@/ui/utils'

export type Segment = {
  key: string
  label: string
  href: string
  current: boolean
  /** Why the segment cannot be chosen; it then renders inert, the reason as its title. */
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
  return (
    <nav
      aria-label={label}
      className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-[3px]"
      data-testid={testId}
    >
      {segments.map((segment) =>
        segment.disabledReason ? (
          <span
            key={segment.key}
            aria-disabled="true"
            title={segment.disabledReason}
            className="cursor-not-allowed rounded-md px-2.5 py-1 text-xs text-muted-foreground opacity-50"
          >
            {segment.label}
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
