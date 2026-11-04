'use client'

import { useEffect } from 'react'

/**
 * Puts the page's font-variable classes on `<body>` while «Карта пути» is
 * mounted (#541 v2): Radix portals (the editor's Sheet, dialogs, menus) render
 * as children of `<body>`, outside `.pm-root`, and would otherwise lose
 * `--font-manrope`. Removed again on unmount, so no other page keeps them.
 */
export function BodyFontVars({ className }: { className: string }) {
  useEffect(() => {
    const names = className.split(/\s+/).filter(Boolean)
    document.body.classList.add(...names)
    return () => document.body.classList.remove(...names)
  }, [className])
  return null
}
