'use client'

import React from 'react'

import type { DisplayCurrencyCode } from './request-board-contract'
import { DISPLAY_CURRENCY_STORAGE_KEY, parseStoredDisplayCurrency } from './request-queue-model'

/**
 * The viewer's display currency (EARS-549) as an external store — ONE choice
 * for the queue AND its details sheet, so switching ₽ → $ changes both at once
 * (#551). `localStorage` lives outside React and is absent on the server;
 * `useSyncExternalStore` reads it without a copy in state. The write notifies
 * this tab (a `storage` event fires only in the others).
 */
const listeners = new Set<() => void>()

function readStored(): string | null {
  try {
    return window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)
  } catch {
    return null
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const serverStored = () => null

export function writeDisplayCurrency(next: DisplayCurrencyCode): void {
  try {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, next)
  } catch {
    // The choice holds for this visit; only its memory is refused.
  }
  for (const listener of listeners) listener()
}

export function useDisplayCurrency(): DisplayCurrencyCode {
  return parseStoredDisplayCurrency(React.useSyncExternalStore(subscribe, readStored, serverStored))
}
