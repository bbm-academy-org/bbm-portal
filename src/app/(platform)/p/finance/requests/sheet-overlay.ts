'use client'

import React from 'react'

/**
 * WHERE THE TOAST GOES WHILE A SHEET IS OPEN (#473 item 1).
 *
 * This surface has ONE notification channel (#434, sonner at the bottom right)
 * and ONE overlay shape (#388, the sheet, whose acts live in its footer). Both
 * own the bottom of the screen, and they collide exactly where it hurts: after
 * an act that leaves the sheet OPEN — attaching a document — the success toast
 * covered the footer for its whole lifetime, and «Провести», the act the
 * attachment had just unlocked, was underneath it. On 390 px the sheet is the
 * full width, so no left/right position saves the corner: the channel has to
 * step up, and only while there is something to step over.
 *
 * It is a module store rather than context because the Toaster deliberately
 * sits OUTSIDE the screen's subtree (`RequestsShell`) — sonner renders in
 * place, and inside a grid it takes a cell. The same `useSyncExternalStore`
 * shape the chosen view already uses on this screen: state that lives outside
 * React, read through the hook React has for it, with no copy to keep in step.
 */

/**
 * The room a sheet footer needs, measured against its own box: `p-4` (16 px
 * twice) around controls that are 32 px tall and wrap to two rows at 390 px —
 * 104 px — plus the toast's own breathing room.
 */
export const SHEET_FOOTER_CLEARANCE = '7rem'

/** Sonner's resting distance from the edge, named so the closed state is ours too. */
export const TOASTER_RESTING_OFFSET = '1.5rem'

let openSheets = 0
const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of listeners) listener()
}

/** One open sheet. The returned function releases it; counting survives StrictMode. */
export function markSheetOpen(): () => void {
  openSheets += 1
  announce()
  let released = false
  return () => {
    if (released) return
    released = true
    openSheets = Math.max(0, openSheets - 1)
    announce()
  }
}

export function subscribeSheetOverlay(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readSheetOverlayOpen(): boolean {
  return openSheets > 0
}

/** The server renders no overlay: a sheet is opened by a click that has not happened. */
export function serverSheetOverlayOpen(): boolean {
  return false
}

/** Where the notification channel sits, given whether an overlay is on screen. */
export function toasterOffset(sheetOpen: boolean): { bottom: string } {
  return { bottom: sheetOpen ? SHEET_FOOTER_CLEARANCE : TOASTER_RESTING_OFFSET }
}

/** Mounted inside a sheet: says «an overlay owns the bottom of the screen now». */
export function useSheetOverlayMark(): void {
  React.useEffect(() => markSheetOpen(), [])
}

/** Read by the Toaster, which lives outside the screen's subtree. */
export function useSheetOverlayOpen(): boolean {
  return React.useSyncExternalStore(
    subscribeSheetOverlay,
    readSheetOverlayOpen,
    serverSheetOverlayOpen,
  )
}
