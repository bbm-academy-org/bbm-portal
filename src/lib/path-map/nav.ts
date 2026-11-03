import type { MapView } from './derive'

/**
 * «Карта пути» v2 (#532) — the left navigator and the sticky beacon, as pure
 * functions. The anchors are derived from the SAME `MapView` the map renders
 * (`buildMapView`), so the rail never names a station the map does not draw;
 * the client half (`src/modules/path-map/view/PathMapNav.tsx`) only measures
 * where those DOM ids landed and feeds the numbers back in here.
 *
 *   - `buildNavAnchors` — the points top → bottom: Маяк, every visible station,
 *     «Мы здесь», one label per month of the passed path, «Старт»;
 *   - `layoutRail` — de-overlaps the measured points on the rail;
 *   - `railThumb` / `scrollForAnchor` / `scrollForDrag` / `beaconPassed` — the
 *     scroll arithmetic of the thumb, the jumps and the sticky bar.
 */

/** DOM ids the map carries for the navigator (the station/chip ids: `nodeAnchorId`). */
export const ANCHOR_IDS = {
  beacon: 'pm-beacon',
  here: 'pm-here',
  start: 'pm-start',
} as const

export function nodeAnchorId(nodeId: string): string {
  return `pm-node-${nodeId}`
}

export type NavAnchorKind = 'beacon' | 'station' | 'here' | 'month' | 'start'

export interface NavAnchor {
  key: string
  kind: NavAnchorKind
  /** The point's name as the tooltip shows it. */
  label: string
  /** The always-visible tick text on the rail (months, «старт»), when there is one. */
  short?: string
  /** The accessible name of the point's button. */
  ariaLabel: string
  /** The DOM id the point scrolls to. */
  target: string
  /** Track colour of a station dot. */
  color?: string
  /** Kept on the compact (≤640px) rail. */
  compact: boolean
}

const MONTHS_GENITIVE = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]
const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]
const MONTHS_FULL = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]
/** «в октябре» — the prepositional month for the accessible name. */
const MONTHS_PREPOSITIONAL = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
]

/** `2026-10-21` → «21 окт». */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS_GENITIVE[month - 1] ?? ''}`.trim()
}

function blocksWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'шлагбаум'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'шлагбаума'
  return 'шлагбаумов'
}

export function buildNavAnchors(view: MapView): NavAnchor[] {
  const anchors: NavAnchor[] = [
    {
      key: 'beacon',
      kind: 'beacon',
      label: 'Маяк',
      ariaLabel: `Маяк: ${view.beacon.title}`,
      target: ANCHOR_IDS.beacon,
      compact: true,
    },
  ]

  // Stations: each track's road is drawn top-down (`upcoming` reversed), all
  // columns from the same top line — a station's row is its index from the top.
  const stations: { row: number; track: number; anchor: NavAnchor }[] = []
  view.focus.forEach((track, t) => {
    const topDown = [...track.upcoming].reverse()
    topDown.forEach((item, row) => {
      if (item.kind !== 'node' || item.node.type !== 'station') return
      stations.push({
        row,
        track: t,
        anchor: {
          key: `station:${item.node.id}`,
          kind: 'station',
          label: item.node.title,
          ariaLabel: `Станция «${item.node.title}» · ${track.title}`,
          target: nodeAnchorId(item.node.id),
          color: track.color,
          compact: false,
        },
      })
    })
  })
  stations.sort((a, b) => a.row - b.row || a.track - b.track)
  anchors.push(...stations.map((s) => s.anchor))

  anchors.push({
    key: 'here',
    kind: 'here',
    label: 'Мы здесь',
    ariaLabel: 'Мы здесь',
    target: ANCHOR_IDS.here,
    compact: true,
  })

  // Months of the passed path: the passed column is drawn top-down too (the
  // newest removal nearest «Мы здесь»); a month points at its topmost chip.
  const months = new Map<string, { row: number; track: number; nodeId: string; count: number }>()
  view.focus.forEach((track, t) => {
    const topDown = [...track.passed].reverse()
    topDown.forEach(({ node }, row) => {
      const key = node.done.slice(0, 7)
      const seen = months.get(key)
      if (!seen) {
        months.set(key, { row, track: t, nodeId: node.id, count: 1 })
        return
      }
      seen.count += 1
      if (row < seen.row || (row === seen.row && t < seen.track)) {
        Object.assign(seen, { row, track: t, nodeId: node.id })
      }
    })
  })
  for (const [key, month] of [...months.entries()].sort(([a], [b]) => (a < b ? 1 : -1))) {
    const [year, m] = key.split('-').map(Number)
    anchors.push({
      key: `month:${key}`,
      kind: 'month',
      label: `${MONTHS_FULL[m - 1]} ${year}`,
      short: MONTHS_SHORT[m - 1],
      ariaLabel: `Пройдено в ${MONTHS_PREPOSITIONAL[m - 1]} ${year}: ${month.count} ${blocksWord(month.count)}`,
      target: nodeAnchorId(month.nodeId),
      compact: false,
    })
  }

  const start = view.started ? `Старт ${shortDate(view.started)}` : 'Старт'
  anchors.push({
    key: 'start',
    kind: 'start',
    label: start,
    short: 'старт',
    ariaLabel: start,
    target: ANCHOR_IDS.start,
    compact: true,
  })
  return anchors
}

/**
 * Points (px from the rail top, sorted ascending) moved apart so that no two
 * are closer than `minGap`, all inside `[0, height]`. A forward pass pushes
 * crowded points down, a backward pass pushes the overflow back up from the
 * bottom edge; a rail too short for the gap spreads the points evenly.
 */
export function layoutRail(points: number[], height: number, minGap: number): number[] {
  const n = points.length
  if (n === 0) return []
  if (n > 1 && (n - 1) * minGap > height) {
    return points.map((_, i) => (i * height) / (n - 1))
  }
  const out = points.map((p) => Math.min(Math.max(p, 0), height))
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + minGap)
  if (out[n - 1] > height) out[n - 1] = height
  for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - minGap)
  return out
}

export interface ScrollGeometry {
  /** The page's top, in document coordinates. */
  pageTop: number
  pageHeight: number
  scrollY: number
  viewportHeight: number
  /** Height of the fixed chrome over the page (portal header + sticky beacon). */
  topOffset: number
}

/** The visible window of the page, as fractions of the page height (0…1). */
export function railThumb(g: ScrollGeometry): { top: number; size: number } {
  if (g.pageHeight <= 0) return { top: 0, size: 1 }
  const clamp = (x: number) => Math.min(Math.max(x, 0), 1)
  const top = clamp((g.scrollY + g.topOffset - g.pageTop) / g.pageHeight)
  const bottom = clamp((g.scrollY + g.viewportHeight - g.pageTop) / g.pageHeight)
  return { top, size: Math.max(bottom - top, 0) }
}

/** The scroll position that puts an element (document top `elementTop`) just under the chrome. */
export function scrollForAnchor(elementTop: number, topOffset: number): number {
  return Math.max(0, Math.round(elementTop - topOffset))
}

/** Dragging the thumb by `dy` rail pixels scrolls the page by the same share of its height. */
export function scrollForDrag(d: {
  startScroll: number
  dy: number
  railHeight: number
  pageHeight: number
}): number {
  if (d.railHeight <= 0) return d.startScroll
  return Math.max(0, Math.round(d.startScroll + (d.dy * d.pageHeight) / d.railHeight))
}

/** The beacon block has gone under the portal header: its bottom is at or above the header's. */
export function beaconPassed(beaconBottom: number, topOffset: number): boolean {
  return beaconBottom <= topOffset
}
