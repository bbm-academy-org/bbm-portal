import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildMapView, parsePathMap } from '@/lib/path-map'
import type { PathMap } from '@/lib/path-map'
import {
  ANCHOR_IDS,
  beaconPassed,
  buildNavAnchors,
  layoutRail,
  nodeAnchorId,
  railThumb,
  scrollForAnchor,
  scrollForDrag,
} from '@/lib/path-map/nav'

/**
 * «Карта пути» v2 (#532) — the anchors of the left navigator and the
 * arithmetic of the rail, as pure functions. The anchors are derived from the
 * same `MapView` the map renders, so the navigator never points at a station
 * the map does not draw.
 */

const repoRoot = join(import.meta.dirname, '..', '..')
const parsed = parsePathMap(
  readFileSync(join(repoRoot, 'tests/fixtures/path-map/example.yaml'), 'utf8'),
)
if (!parsed.ok) throw new Error(`fixture does not parse: ${parsed.errors.join('; ')}`)
const example: PathMap = parsed.map

function mapWith(patch: Partial<PathMap>): PathMap {
  return { ...example, ...patch }
}

describe('buildNavAnchors — the navigator points, top → bottom', () => {
  const anchors = buildNavAnchors(buildMapView(example))

  it('starts at the beacon and ends at the start of the passed path', () => {
    expect(anchors[0]).toMatchObject({ kind: 'beacon', label: 'Маяк', target: ANCHOR_IDS.beacon })
    expect(anchors.at(-1)).toMatchObject({
      kind: 'start',
      label: 'Старт 6 окт',
      target: ANCHOR_IDS.start,
    })
  })

  it('lists every visible station of the focus road, and no roadside or collapsed one', () => {
    const stations = anchors.filter((a) => a.kind === 'station')
    expect(stations.map((a) => a.label).sort()).toEqual(
      [
        'Готов первый урок',
        'Курс из нескольких уроков',
        'Пилотный выпуск подкаста с экспертом',
        'Две поверхности платформы в проде',
      ].sort(),
    )
    // The station is reached through the DOM id the map card carries.
    const first = stations.find((a) => a.label === 'Готов первый урок')
    expect(first?.target).toBe(nodeAnchorId('first-lesson'))
    expect(first?.color).toBe('#F2B544')
    // Roadside station (no «потому что») and the roadside track stay off the rail.
    expect(anchors.some((a) => a.label === 'Мобильное приложение для врачей')).toBe(false)
    expect(anchors.some((a) => a.label === 'Первый фарма-партнёр подписал пилот')).toBe(false)
  })

  it('orders stations by their row from the top of the road', () => {
    const stations = anchors.filter((a) => a.kind === 'station').map((a) => a.label)
    // «Готов первый урок» is the lowest station on the board — the last before «Мы здесь».
    expect(stations.at(-1)).toBe('Готов первый урок')
  })

  it('puts «Мы здесь» between the road and the passed path', () => {
    const kinds = anchors.map((a) => a.kind)
    const here = kinds.indexOf('here')
    expect(anchors[here]).toMatchObject({ label: 'Мы здесь', target: ANCHOR_IDS.here })
    expect(kinds.slice(0, here).every((k) => k === 'beacon' || k === 'station')).toBe(true)
    expect(kinds.slice(here + 1).every((k) => k === 'month' || k === 'start')).toBe(true)
  })

  it('labels the passed path by month of the `done` dates, pointing at its topmost chip', () => {
    const months = anchors.filter((a) => a.kind === 'month')
    expect(months).toHaveLength(1)
    expect(months[0]).toMatchObject({
      short: 'окт',
      label: 'Октябрь 2026',
      // Both October chips sit in the top row; the tie goes to the first track.
      target: nodeAnchorId('first-lesson-script'),
    })
    expect(months[0].ariaLabel).toMatch(/2/)
  })

  it('keeps only Маяк, Мы здесь and Старт on the compact (≤640px) rail', () => {
    expect(anchors.filter((a) => a.compact).map((a) => a.kind)).toEqual(['beacon', 'here', 'start'])
  })

  it('every anchor has a unique key and an accessible name', () => {
    const keys = anchors.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const a of anchors) expect(a.ariaLabel.length).toBeGreaterThan(0)
  })

  it('orders months newest first (nearest «Мы здесь») and reads «Старт» without a date', () => {
    const map = mapWith({
      started: undefined,
      tracks: example.tracks.map((t) =>
        t.id === 'reach'
          ? {
              ...t,
              nodes: [
                {
                  id: 'old-barrier',
                  type: 'obstacle' as const,
                  title: 'Старый шлагбаум',
                  opens: 'podcast-pilot',
                  done: '2026-09-02',
                },
                ...t.nodes,
              ],
            }
          : t,
      ),
    })
    const list = buildNavAnchors(buildMapView(map))
    expect(list.filter((a) => a.kind === 'month').map((a) => a.short)).toEqual(['окт', 'сен'])
    expect(list.at(-1)?.label).toBe('Старт')
  })

  it('drops stations collapsed into the fog beyond `visible_stations`', () => {
    const map = mapWith({ limits: { ...example.limits, visible_stations: 1 } })
    const labels = buildNavAnchors(buildMapView(map)).map((a) => a.label)
    expect(labels).toContain('Готов первый урок')
    expect(labels).not.toContain('Курс из нескольких уроков')
  })

  it('a map without a passed path has no month points', () => {
    const map = mapWith({
      tracks: example.tracks.map((t) => ({
        ...t,
        nodes: t.nodes.filter((n) => !(n.type === 'obstacle' && n.done)),
      })),
    })
    expect(buildNavAnchors(buildMapView(map)).some((a) => a.kind === 'month')).toBe(false)
  })
})

describe('layoutRail — points never overlap on the rail', () => {
  it('leaves well-spaced points where they are', () => {
    expect(layoutRail([0, 40, 80], 100, 10)).toEqual([0, 40, 80])
  })

  it('pushes crowded points down by the minimum gap', () => {
    expect(layoutRail([0, 5, 6, 100], 100, 10)).toEqual([0, 10, 20, 100])
  })

  it('pushes back up from the bottom edge', () => {
    expect(layoutRail([95, 98, 100], 100, 10)).toEqual([80, 90, 100])
  })

  it('spreads evenly when the rail is too short for the gap', () => {
    expect(layoutRail([0, 0, 0, 0, 0], 20, 10)).toEqual([0, 5, 10, 15, 20])
  })

  it('handles an empty or single-point rail', () => {
    expect(layoutRail([], 100, 10)).toEqual([])
    expect(layoutRail([140], 100, 10)).toEqual([100])
  })
})

describe('rail arithmetic — thumb, jumps and drag', () => {
  it('the thumb is the visible window of the page, as fractions of the page height', () => {
    const thumb = railThumb({
      pageTop: 100,
      pageHeight: 2000,
      scrollY: 500,
      viewportHeight: 900,
      topOffset: 100,
    })
    expect(thumb.top).toBeCloseTo(0.25)
    expect(thumb.size).toBeCloseTo(0.4)
  })

  it('the thumb is clamped to the page', () => {
    const thumb = railThumb({
      pageTop: 0,
      pageHeight: 1000,
      scrollY: 900,
      viewportHeight: 800,
      topOffset: 0,
    })
    expect(thumb.top).toBeCloseTo(0.9)
    expect(thumb.top + thumb.size).toBeCloseTo(1)
  })

  it('a jump brings the anchor just under the sticky chrome, never above the page top', () => {
    expect(scrollForAnchor(1500, 120)).toBe(1380)
    expect(scrollForAnchor(40, 120)).toBe(0)
  })

  it('dragging the thumb scrolls the page in proportion to the rail', () => {
    expect(scrollForDrag({ startScroll: 200, dy: 50, railHeight: 500, pageHeight: 4000 })).toBe(600)
    expect(scrollForDrag({ startScroll: 100, dy: -50, railHeight: 500, pageHeight: 4000 })).toBe(0)
  })

  it('the sticky beacon appears once the beacon block has scrolled under the portal header', () => {
    expect(beaconPassed(200, 56)).toBe(false)
    expect(beaconPassed(56, 56)).toBe(true)
    expect(beaconPassed(-300, 56)).toBe(true)
  })
})
