'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

import {
  ANCHOR_IDS,
  beaconPassed,
  layoutRail,
  railThumb,
  scrollForAnchor,
  scrollForDrag,
  type NavAnchor,
} from '@/lib/path-map/nav'

import { LighthouseIcon } from './icons'

/**
 * «Карта пути» v2 (#532) — the sticky beacon bar and the left navigator rail.
 *
 * No artboard draws either: both were asked for in the owner's feedback of
 * 2026-11-03 and are composed here in the canvas' own visual language (tokens
 * of `path-map.css`). The anchors arrive precomputed from
 * `src/lib/path-map/nav.ts`; this file only measures where their DOM ids landed
 * and does the scrolling. One scroll/resize listener (rAF-throttled) drives
 * both the bar and the rail.
 */

/** Height of the sticky beacon bar, px — kept in step with `.pm-sticky` in path-map.css. */
const STICKY_HEIGHT = 48
/** Breathing room between the chrome and a jumped-to element. */
const JUMP_MARGIN = 16
/** The narrowest gap two rail points may have, px. */
const MIN_GAP = 18
const COMPACT_QUERY = '(max-width: 640px)'

function prefersStill(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function isCompact(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches
}

function scrollToTop(top: number) {
  window.scrollTo({ top, behavior: prefersStill() ? 'auto' : 'smooth' })
}

/** Bottom edge of the portal's own sticky top bar (`/p/TopBar.tsx`), 0 when absent. */
function portalHeaderBottom(): number {
  const bar = document.querySelector('[data-top-bar]')
  return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0
}

interface Measured {
  /** The portal header's bottom edge — where the sticky bar is pinned. */
  top: number
  stuck: boolean
  /** Point positions on the rail, px, by anchor key. */
  points: Record<string, number>
  /** Keys of the points inside the visible window. */
  inView: string[]
  thumb: { top: number; size: number }
  /** The rail track's height, px (0 until measured). */
  rail: number
}

const INITIAL: Measured = {
  top: 0,
  stuck: false,
  points: {},
  inView: [],
  thumb: { top: 0, size: 0 },
  rail: 0,
}

/**
 * Measures the page on every scroll/resize frame. `pageRef` is the `.pm-page`
 * element (the range the rail stands for), `railRef` the rail's track.
 */
function useMapScroll(
  anchors: NavAnchor[],
  pageRef: React.RefObject<HTMLElement | null>,
  railRef: React.RefObject<HTMLElement | null>,
): Measured {
  const [measured, setMeasured] = useState<Measured>(INITIAL)

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const page = pageRef.current
      if (!page) return
      const top = portalHeaderBottom()
      const scrollY = window.scrollY
      const beacon = document.getElementById(ANCHOR_IDS.beacon)
      const stuck =
        scrollY > 0 && beacon ? beaconPassed(beacon.getBoundingClientRect().bottom, top) : false

      const pageRect = page.getBoundingClientRect()
      const geometry = {
        pageTop: pageRect.top + scrollY,
        pageHeight: pageRect.height,
        scrollY,
        viewportHeight: window.innerHeight,
        topOffset: top + STICKY_HEIGHT,
      }
      const thumb = railThumb(geometry)
      const railHeight = railRef.current?.clientHeight ?? 0

      const compact = isCompact()
      const shown = anchors.filter((a) => !compact || a.compact)
      const located = shown
        .map((a) => {
          const target = document.getElementById(a.target)
          if (!target || geometry.pageHeight <= 0) return null
          const y = target.getBoundingClientRect().top + scrollY - geometry.pageTop
          return { key: a.key, fraction: Math.min(Math.max(y / geometry.pageHeight, 0), 1) }
        })
        .filter((x): x is { key: string; fraction: number } => x !== null)
        .sort((a, b) => a.fraction - b.fraction)
      const laid = layoutRail(
        located.map((l) => l.fraction * railHeight),
        railHeight,
        compact ? MIN_GAP * 1.5 : MIN_GAP,
      )
      const points: Record<string, number> = {}
      located.forEach((l, i) => (points[l.key] = laid[i]))
      const inView = located
        .filter((l) => l.fraction >= thumb.top && l.fraction <= thumb.top + thumb.size)
        .map((l) => l.key)

      setMeasured({ top, stuck, points, inView, thumb, rail: railHeight })
    }
    const schedule = () => {
      if (frame) return
      frame =
        typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame(measure)
          : (setTimeout(measure, 16) as unknown as number)
    }
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const observer =
      typeof ResizeObserver === 'function' && pageRef.current ? new ResizeObserver(schedule) : null
    if (observer && pageRef.current) observer.observe(pageRef.current)
    // Fonts swap in late and move every anchor.
    void document.fonts?.ready.then(schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [anchors, pageRef, railRef])

  return measured
}

function StickyBeacon({ title, top }: { title: string; top: number }) {
  return (
    <div className="pm-sticky" style={{ top }}>
      <button
        type="button"
        className="pm-sticky-btn"
        aria-label={`К маяку: ${title}`}
        onClick={() => scrollToTop(0)}
      >
        <LighthouseIcon />
        <span className="pm-sticky-eyebrow" aria-hidden="true">
          Маяк
        </span>
        <span className="pm-sticky-title">{title}</span>
      </button>
    </div>
  )
}

function Point({
  anchor,
  y,
  inView,
  onJump,
}: {
  anchor: NavAnchor
  y: number | undefined
  inView: boolean
  onJump: (anchor: NavAnchor) => void
}) {
  return (
    <button
      type="button"
      className="pm-nav-point"
      data-kind={anchor.kind}
      data-compact={anchor.compact || undefined}
      data-placed={y === undefined ? undefined : ''}
      data-in-view={inView || undefined}
      aria-label={anchor.ariaLabel}
      style={
        {
          top: y === undefined ? undefined : `${y}px`,
          '--pm-point': anchor.color,
        } as React.CSSProperties
      }
      onClick={() => onJump(anchor)}
    >
      {anchor.kind === 'beacon' ? (
        <LighthouseIcon />
      ) : (
        <span className="pm-nav-mark" aria-hidden="true" />
      )}
      {/* Visible text comes from CSS `attr()`: the button's name is its aria-label,
          and the map's own text stays the only DOM copy of every title. */}
      {anchor.short ? (
        <span className="pm-nav-short" data-text={anchor.short} aria-hidden="true" />
      ) : null}
      <span className="pm-nav-tip" data-text={anchor.label} aria-hidden="true" />
    </button>
  )
}

/**
 * The sticky beacon bar + the left rail. Rendered inside `.pm-main` (the rail's
 * gutter is that column's left padding); `pageRef` is the whole `.pm-page`.
 */
export function PathMapNav({
  anchors,
  beaconTitle,
  pageRef,
}: {
  anchors: NavAnchor[]
  beaconTitle: string
  pageRef: React.RefObject<HTMLElement | null>
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const measured = useMapScroll(anchors, pageRef, railRef)
  const drag = useRef<{ y: number; scroll: number } | null>(null)

  const chromeTop = measured.top + STICKY_HEIGHT + JUMP_MARGIN

  const onJump = useCallback(
    (anchor: NavAnchor) => {
      if (anchor.kind === 'beacon') return scrollToTop(0)
      const target = document.getElementById(anchor.target)
      const top = target ? target.getBoundingClientRect().top + window.scrollY : 0
      scrollToTop(scrollForAnchor(top, chromeTop))
    },
    [chromeTop],
  )

  const pageHeight = () => pageRef.current?.getBoundingClientRect().height ?? 0
  const railHeight = () => railRef.current?.clientHeight ?? 0

  const onThumbDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { y: e.clientY, scroll: window.scrollY }
  }
  const onThumbMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return
    window.scrollTo({
      top: scrollForDrag({
        startScroll: drag.current.scroll,
        dy: e.clientY - drag.current.y,
        railHeight: railHeight(),
        pageHeight: pageHeight(),
      }),
      behavior: 'auto',
    })
  }
  const onThumbUp = () => {
    drag.current = null
  }

  /** A click on the bare track jumps there, like a scrollbar's. */
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !pageRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0
    const pageTop = pageRef.current.getBoundingClientRect().top + window.scrollY
    scrollToTop(scrollForAnchor(pageTop + fraction * pageHeight(), chromeTop))
  }

  const inView = new Set(measured.inView)
  const rail = measured.rail

  return (
    <>
      {measured.stuck ? <StickyBeacon title={beaconTitle} top={measured.top} /> : null}
      <div className="pm-nav-gutter">
        <nav
          aria-label="Навигатор по карте"
          className="pm-nav"
          style={
            { '--pm-nav-top': `${measured.top + STICKY_HEIGHT + 12}px` } as React.CSSProperties
          }
        >
          {/* The track is a pointer convenience; every point is a keyboard button. */}
          <div ref={railRef} className="pm-nav-track" onClick={onTrackClick}>
            <span className="pm-nav-line" aria-hidden="true" />
            {rail > 0 ? (
              <span
                className="pm-nav-thumb"
                aria-hidden="true"
                style={{
                  top: `${measured.thumb.top * 100}%`,
                  height: `${measured.thumb.size * 100}%`,
                }}
                onPointerDown={onThumbDown}
                onPointerMove={onThumbMove}
                onPointerUp={onThumbUp}
                onPointerCancel={onThumbUp}
              />
            ) : null}
            {anchors.map((anchor) => (
              <Point
                key={anchor.key}
                anchor={anchor}
                y={measured.points[anchor.key]}
                inView={inView.has(anchor.key)}
                onJump={onJump}
              />
            ))}
          </div>
        </nav>
      </div>
    </>
  )
}
