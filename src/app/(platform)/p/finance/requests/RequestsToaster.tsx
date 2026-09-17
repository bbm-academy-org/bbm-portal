'use client'

import { Toaster } from '@/ui/sonner'

import { toasterOffset, useSheetOverlayOpen } from './sheet-overlay'

/**
 * The surface's ONE notification channel (#434), placed so it never covers the
 * ONE overlay's footer (#473 item 1 — the reasoning lives in
 * `sheet-overlay.ts`).
 *
 * It carries `data-bbm-ui` of its own: sonner renders in place instead of
 * portalling, and inside a grid it would take a cell (the defect the #434
 * acceptance stand showed).
 */
export function RequestsToaster() {
  const sheetOpen = useSheetOverlayOpen()

  return (
    <div data-bbm-ui>
      <Toaster position="bottom-right" richColors closeButton offset={toasterOffset(sheetOpen)} />
    </div>
  )
}
