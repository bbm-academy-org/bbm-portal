import { Skeleton } from '@/ui/skeleton'

import { REQUEST_BOARD_COLUMNS } from './request-board-model'
import type { RequestsView } from './request-table-model'

/**
 * THE SHAPE `/p/finance/requests` HOLDS WHILE IT READS (#388 defect C, eyes-on
 * matrix of 2026-09-16).
 *
 * A skeleton is a promise about the layout that is coming. This one used to
 * promise the KANBAN — four columns in `lg:grid-cols-4` — in both the route's
 * `loading.tsx` and the screen's own `isLoading` branch, while the view that
 * actually arrived has been the TABLE since decision 35 (Антон, 2026-09-14).
 * The route therefore painted four grey columns and then swapped the whole
 * layout; at 390 px that is four stacked 256-px blocks, over 1000 px of grey,
 * for a view the reader was never going to be shown.
 *
 * ONE COMPONENT, TWO CALLERS, because the two grey frames a reader may see back
 * to back — the route's and the screen's — must not disagree about what is
 * loading. The route can only ever promise the DEFAULT (it has no browser to
 * ask); the screen asks the browser through `requestsLoadingView`.
 *
 * The table skeleton is deliberately NOT a `<table>`: the register's markup is
 * the whitelist block's, and a placeholder that hand-builds table markup beside
 * the block is exactly what `pnpm lint:whitelist-blocks` exists to catch. What
 * it draws is the block's CHROME — one bordered, rounded register box with a
 * head band and a few row bands.
 */
export function RequestsSkeleton({ view }: { view: RequestsView }) {
  return (
    <div aria-label="Загружаем заявки" className="space-y-6">
      <Skeleton className="h-8 w-40" />
      {/* The toolbar row: the scope toggle at the left edge, the view toggle at
          the right — the composition the loaded screen keeps. */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
      </div>
      {view === 'board' ? (
        <div className="grid gap-3 lg:grid-cols-4">
          {REQUEST_BOARD_COLUMNS.map((column) => (
            <Skeleton key={column.status} className="h-64 w-full" />
          ))}
        </div>
      ) : (
        <div className="rounded-md border">
          <div className="border-b p-3">
            <Skeleton className="h-5 w-full" />
          </div>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="border-b p-3 last:border-b-0">
              <Skeleton className="h-6 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
