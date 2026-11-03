'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A right panel's `.pm-aside-inner` scrolls on its own when its content is
 * taller than the viewport (#536 sticky panels). A scroll container with no
 * focusable content cannot be scrolled from the keyboard (axe
 * `scrollable-region-focusable`), so while — and only while — it overflows it
 * becomes a labelled tab stop. The check reruns when the wrapper or any of its
 * direct children resizes (a task row expanding, a check answer arriving).
 */
export function useScrollRegion(label: string) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scrolls, setScrolls] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setScrolls(el.scrollHeight > el.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    const mutations = new MutationObserver(() => {
      observer.disconnect()
      observer.observe(el)
      for (const child of Array.from(el.children)) observer.observe(child)
      measure()
    })
    mutations.observe(el, { childList: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [])

  return {
    ref,
    ...(scrolls ? { tabIndex: 0, role: 'region', 'aria-label': label } : {}),
  } as const
}
