import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PATH_MAP_FILE, parsePathMap } from '@/lib/path-map'
import { ANCHOR_IDS, nodeAnchorId } from '@/lib/path-map/nav'
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
    expect(names.some((n) => /Октябрь 2026/.test(n))).toBe(true)
    expect(names.at(-1)).toBe('Старт 6 окт')
  })

  it('every point the navigator names exists on the map', () => {
    const { container } = renderShipped()
    for (const id of [
      ANCHOR_IDS.beacon,
      ANCHOR_IDS.here,
      ANCHOR_IDS.start,
      nodeAnchorId('first-lesson'),
      nodeAnchorId('two-surfaces'),
      nodeAnchorId('first-lesson-script'),
    ]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull()
    }
  })

  it('clicking a point scrolls the page to it', () => {
    renderShipped()
    fireEvent.click(within(navigator()).getByRole('button', { name: 'Мы здесь' }))
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: expect.any(Number) })
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
