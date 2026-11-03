import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React, { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PATH_MAP_FILE, parsePathMap } from '@/lib/path-map'
import { buildMapView } from '@/lib/path-map/derive'
import { ANCHOR_IDS, buildNavAnchors, scrollForAnchor } from '@/lib/path-map/nav'
import { PathMapView } from '@/modules/path-map/view/PathMapView'

/**
 * «Карта пути» v2 (#532) — the sticky beacon and the left navigator, rendered
 * over the example map fixture. jsdom has no layout, so the scroll geometry is
 * stubbed where a clause needs it; the arithmetic itself is pinned in
 * `path-map-nav.spec.ts`.
 *
 * Written with `React.createElement`: the vitest include glob is `*.spec.ts`.
 */

const el = React.createElement
const repoRoot = join(import.meta.dirname, '..', '..')
const shipped = parsePathMap(
  readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8'),
)
if (!shipped.ok) throw new Error('the example map fixture must parse')
const shippedAnchors = buildNavAnchors(buildMapView(shipped.map))
const css = readFileSync(join(repoRoot, 'src/modules/path-map/view/path-map.css'), 'utf8')

function rect(top: number, height = 0): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** The portal TopBar the sticky bar pins under; its bottom edge is `bottom` px. */
function mountTopBar(bottom = 56) {
  const bar = document.createElement('div')
  bar.setAttribute('data-top-bar', '')
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(0, bottom))
  document.body.prepend(bar)
  return bar
}

/** Gives the rail and the page a size, so the navigator can place its points. */
function giveLayout(container: HTMLElement) {
  const track = container.querySelector('.pm-nav-track') as HTMLElement
  Object.defineProperty(track, 'clientHeight', { configurable: true, value: 600 })
  const page = container.querySelector('.pm-page') as HTMLElement
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(rect(0, 3000))
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

const flushFrames = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40))
  })

let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrollTo = vi.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderShipped() {
  return render(el(PathMapView, { result: shipped, file: PATH_MAP_FILE }))
}

const navigator = () => screen.getByRole('navigation', { name: 'Навигатор по карте' })

describe('left navigator', () => {
  it('offers Маяк, the stations, «Мы здесь», the months of the passed path and «Старт»', () => {
    renderShipped()
    const nav = navigator()
    const names = within(nav)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')
    expect(names[0]).toMatch(/^Маяк/)
    expect(names.some((n) => /Станция «Готов первый урок»/.test(n))).toBe(true)
    expect(names.some((n) => /Станция «Две поверхности платформы в проде»/.test(n))).toBe(true)
    expect(names.some((n) => n === 'Мы здесь')).toBe(true)
    expect(names.some((n) => /в октябре 2026/.test(n))).toBe(true)
    expect(names.at(-1)).toBe('Старт 6 окт')
  })

  it('every point the navigator names exists on the map', () => {
    const { container } = renderShipped()
    expect(shippedAnchors.length).toBeGreaterThan(5)
    for (const anchor of shippedAnchors) {
      expect(container.querySelector(`#${anchor.target}`), anchor.key).not.toBeNull()
    }
    // And the rail renders exactly those anchors, one button each.
    expect(within(navigator()).getAllByRole('button')).toHaveLength(shippedAnchors.length)
  })

  it('clicking a point scrolls its target to just under the portal bar and the sticky bar', async () => {
    mountTopBar(56)
    const { container } = renderShipped()
    await flushFrames()
    const here = container.querySelector(`#${ANCHOR_IDS.here}`) as HTMLElement
    vi.spyOn(here, 'getBoundingClientRect').mockReturnValue(rect(1400, 40))
    window.scrollY = 200
    fireEvent.click(within(navigator()).getByRole('button', { name: 'Мы здесь' }))
    expect(scrollTo).toHaveBeenCalledTimes(1)
    // Document top 200 + 1400; chrome = TopBar 56 + sticky bar 48 + margin 16.
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: scrollForAnchor(1600, 56 + 48 + 16) })
    expect(scrollTo.mock.calls[0][0].top).toBe(1480)
  })

  it('clicking Маяк goes back to the top of the page', () => {
    renderShipped()
    fireEvent.click(within(navigator()).getByRole('button', { name: /^Маяк/ }))
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 0 })
  })

  it('stays in check mode too, with the same points', () => {
    renderShipped()
    fireEvent.click(screen.getByRole('button', { name: /Проверить путь/ }))
    expect(within(navigator()).getByRole('button', { name: 'Мы здесь' })).toBeTruthy()
  })
})

describe('sticky beacon', () => {
  it('is not shown while the beacon block itself is in view', () => {
    renderShipped()
    expect(screen.queryByRole('button', { name: /^К маяку/ })).toBeNull()
  })

  it('appears once the beacon has scrolled past, and scrolls back to the top on click', async () => {
    const { container } = renderShipped()
    const beacon = container.querySelector(`#${ANCHOR_IDS.beacon}`) as HTMLElement
    vi.spyOn(beacon, 'getBoundingClientRect').mockReturnValue({
      top: -400,
      bottom: -120,
      left: 0,
      right: 0,
      width: 0,
      height: 280,
      x: 0,
      y: -400,
      toJSON: () => ({}),
    })
    window.scrollY = 900
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    const bar = await waitFor(() => screen.getByRole('button', { name: /^К маяку/ }))
    expect(bar.textContent).toMatch(/врачи учатся бесплатно/)
    fireEvent.click(bar)
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  })
})

describe('review fixes (#535)', () => {
  afterEach(() => {
    document.querySelectorAll('[data-top-bar]').forEach((n) => n.remove())
  })

  it('pre-existing scroll targets clear the sticky bar: the page carries the chrome height', async () => {
    mountTopBar(56)
    const { container } = renderShipped()
    await flushFrames()
    const page = container.querySelector('.pm-page') as HTMLElement
    expect(page.style.getPropertyValue('--pm-chrome-top')).toBe('56px')
    // The check panel (scrollIntoView on ≤640px) and `#pm-roadside` land below the chrome.
    expect(css).toMatch(
      /\.pm-page \[id\],\s*\.pm-aside\s*\{[^}]*scroll-margin-top:\s*calc\(var\(--pm-chrome-top, 0px\) \+ 48px \+ 16px\)/,
    )
  })

  it('the ResizeObserver watches the rail as well as the page', () => {
    const observed: Element[] = []
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      observe(target: Element) {
        observed.push(target)
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    try {
      const { container } = renderShipped()
      expect(observed).toContain(container.querySelector('.pm-page'))
      expect(observed).toContain(container.querySelector('.pm-nav-track'))
    } finally {
      globalThis.ResizeObserver = original
    }
  })

  it('an unplaced point is hidden and out of the tab order; a placed one is reachable', async () => {
    const { container } = renderShipped()
    await flushFrames()
    // jsdom has no layout: nothing is placed yet.
    for (const p of container.querySelectorAll<HTMLElement>('.pm-nav-point')) {
      expect(p.hasAttribute('data-placed'), p.getAttribute('aria-label') ?? '').toBe(false)
      expect(p.tabIndex, p.getAttribute('aria-label') ?? '').toBe(-1)
    }
    expect(css).toMatch(/\.pm-nav-point\s*\{[^}]*visibility:\s*hidden/)
    expect(css).toMatch(/\.pm-nav-point\[data-placed\]\s*\{[^}]*visibility:\s*visible/)

    giveLayout(container)
    await flushFrames()
    const beacon = within(navigator()).getByRole('button', { name: /^Маяк/ })
    expect(beacon.hasAttribute('data-placed')).toBe(true)
    expect(beacon.tabIndex).toBe(0)
  })

  it('keyboard reaches the whole map before the navigator', () => {
    const { container } = renderShipped()
    const nav = navigator()
    const start = container.querySelector(`#${ANCHOR_IDS.start}`) as HTMLElement
    expect(start.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // No map button sits after the first navigator point in DOM (= tab) order.
    const buttons = Array.from(container.querySelectorAll('.pm-main button'))
    const firstNav = buttons.findIndex((b) => nav.contains(b))
    const mapAfterNav = buttons.slice(firstNav).filter((b) => !nav.contains(b))
    expect(mapAfterNav.map((b) => b.textContent)).toEqual([])
  })

  it('does not re-render on a scroll frame that changed nothing', async () => {
    let commits = 0
    render(
      el(
        Profiler,
        { id: 'map', onRender: () => void commits++ },
        el(PathMapView, { result: shipped, file: PATH_MAP_FILE }),
      ),
    )
    await flushFrames()
    const settled = commits
    for (let i = 0; i < 3; i++) {
      act(() => {
        window.dispatchEvent(new Event('scroll'))
      })
      await flushFrames()
    }
    expect(commits).toBe(settled)
  })

  it('≤640px: every rail point is at least 24px wide', () => {
    const narrow = css.slice(css.indexOf('/* ≤640px: a thin rail'))
    const block = /\.pm-nav-point\s*\{([^}]*)\}/.exec(narrow)?.[1] ?? ''
    const width = Number(/(?:^|[\s;])width:\s*(\d+)px/.exec(block)?.[1] ?? 0)
    expect(width).toBeGreaterThanOrEqual(24)
  })

  it('≤640px: the edge thumb is a passive indicator — no drag inside the iOS back-swipe zone', async () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({
      matches: q === '(max-width: 640px)',
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia
    try {
      const { container } = renderShipped()
      giveLayout(container)
      await flushFrames()
      const thumb = container.querySelector('.pm-nav-thumb') as HTMLElement
      expect(thumb).not.toBeNull()
      expect(thumb.hasAttribute('data-passive')).toBe(true)
      fireEvent.pointerDown(thumb, { clientY: 100, pointerId: 1 })
      fireEvent.pointerMove(thumb, { clientY: 300, pointerId: 1 })
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      window.matchMedia = original
    }
  })
})
