import {
  BEACON_ID,
  type Confidence,
  type PathMap,
  type PathNode,
  type PathObstacle,
} from './schema'

/**
 * Everything the map SHOWS that the file does not state outright (#530) — pure
 * functions over a parsed map, so every rule is unit-tested without a browser.
 *
 *   - `checkPath` — follow `opens` from a node up to the beacon: the chain, did
 *     it get there, and where it broke (unknown target, a station without
 *     «потому что», a cycle, a node that opens nothing, fog without `opens`);
 *     a fog card WITH `opens` is passable but drops the confidence to `unknown`;
 *   - `buildMapView` — per focus track: the passed path below «Мы здесь» (done
 *     obstacles), the road above it, the fog collapse beyond
 *     `limits.visible_stations`, the «разбей станцию» hint; plus the roadside
 *     (roadside tracks, stations without «потому что») and the focus counter.
 */

export interface ChainLink {
  id: string
  node: PathNode
  trackId: string
  trackTitle: string
}

export type PathBreak =
  /** `at` names the node whose `opens` points nowhere; `null` when the START id is unknown. */
  | { kind: 'unknown-target'; at: string | null; target: string }
  | { kind: 'missing-because'; at: string }
  | { kind: 'cycle'; at: string; target: string }
  | { kind: 'no-opens'; at: string }
  | { kind: 'fog'; at: string }

export interface PathCheck {
  start: string
  /** From the start node upward, in the order the road is travelled. */
  chain: ChainLink[]
  reached: boolean
  break: PathBreak | null
  /**
   * The weakest confidence along the chain — «по грунтовке» when `hypothesis`,
   * «через туман» when `unknown` (an unknown station or any fog card on the way).
   */
  confidence: Confidence
}

const CONFIDENCE_RANK: Record<Confidence, number> = { known: 2, hypothesis: 1, unknown: 0 }

type NodeIndex = Map<string, { node: PathNode; trackId: string; trackTitle: string }>

// TODO(Антон): nodes of `status: roadside` tracks are indexed too, so a focus
// road whose `opens` hops through a parked track's station still counts as
// reached — and nothing on the map draws that hop (roadside tracks have no
// column). Pending the owner's call on whether depending on a parked track is a
// break; behaviour pinned in tests/unit/path-map-derive.spec.ts.
function indexNodes(map: PathMap): NodeIndex {
  const index: NodeIndex = new Map()
  for (const track of map.tracks) {
    for (const node of track.nodes) {
      index.set(node.id, { node, trackId: track.id, trackTitle: track.title })
    }
  }
  return index
}

function isRoadsideStation(node: PathNode): boolean {
  return node.type === 'station' && !node.because
}

export function checkPath(map: PathMap, startId: string, index = indexNodes(map)): PathCheck {
  const chain: ChainLink[] = []
  let confidence: Confidence = 'known'
  const done = (reached: boolean, brk: PathBreak | null): PathCheck => ({
    start: startId,
    chain,
    reached,
    break: brk,
    confidence,
  })

  let current = index.get(startId)
  if (!current) return done(false, { kind: 'unknown-target', at: null, target: startId })

  const visited = new Set<string>()
  for (;;) {
    const { node } = current
    chain.push({ id: node.id, ...current })
    visited.add(node.id)

    if (node.type === 'station') {
      if (CONFIDENCE_RANK[node.confidence] < CONFIDENCE_RANK[confidence]) {
        confidence = node.confidence
      }
      if (!node.because) return done(false, { kind: 'missing-because', at: node.id })
    }
    // Fog is always a break of certainty: without `opens` the road ends here
    // (below); with `opens` it goes on, but «через туман» — never plain «доходит».
    if (node.type === 'fog') confidence = 'unknown'
    if (!node.opens) {
      return done(
        false,
        node.type === 'fog' ? { kind: 'fog', at: node.id } : { kind: 'no-opens', at: node.id },
      )
    }
    if (node.opens === BEACON_ID) return done(true, null)
    if (visited.has(node.opens)) {
      return done(false, { kind: 'cycle', at: node.id, target: node.opens })
    }
    const next = index.get(node.opens)
    if (!next) return done(false, { kind: 'unknown-target', at: node.id, target: node.opens })
    current = next
  }
}

// ── the track layout ──────────────────────────────────────────────────────────

/** How a node is drawn: known = asphalt, hypothesis = dirt road, unknown = fog. */
export type NodeLook = 'asphalt' | 'dirt' | 'fog' | 'barrier'

export type UpcomingItem =
  | {
      kind: 'node'
      node: PathNode
      look: NodeLook
      /** Title of what this node opens («маяк» for the beacon); `null` when the target is missing. */
      opensTitle: string | null
      /** Open (not done) obstacles anywhere on the map that open this node. */
      openObstacles: number
      /** `openObstacles` exceeds `limits.obstacles_per_station` → «разбей станцию». */
      overloaded: boolean
    }
  | {
      /** Everything beyond `limits.visible_stations` upcoming stations, bottom → top. */
      kind: 'collapsed'
      nodes: PathNode[]
    }

export interface PassedItem {
  node: PathObstacle & { done: string }
}

export interface TrackView {
  id: string
  title: string
  /** The narrow-layout tab label: the track's `short`, else its `title`. */
  short: string
  color: string
  /** The road above «Мы здесь», ordered bottom → top. */
  upcoming: UpcomingItem[]
  /** Done obstacles — the passed path below «Мы здесь», bottom → top. */
  passed: PassedItem[]
}

export interface RoadsideTrackView {
  id: string
  title: string
  summary: string
}

export interface RoadsideStationView {
  node: PathNode
  trackId: string
  trackTitle: string
}

export interface MapView {
  title: string
  started: string | undefined
  beacon: PathMap['beacon']
  empty: boolean
  focus: TrackView[]
  roadsideTracks: RoadsideTrackView[]
  roadsideStations: RoadsideStationView[]
  focusCount: number
  focusLimit: number
  focusOverflow: boolean
  /** One check per focus track, from its lowest open node; `null` for a track with no road. */
  trackChecks: { trackId: string; result: PathCheck | null }[]
}

/** Track dot colours from the canvas, assigned by focus order. */
export const TRACK_COLORS = ['#F2B544', '#8FD3C1', '#B9A6F5', '#F4A3A3', '#9EC5FF'] as const

function lookOf(node: PathNode): NodeLook {
  if (node.type === 'obstacle') return 'barrier'
  if (node.type === 'fog') return 'fog'
  return node.confidence === 'known' ? 'asphalt' : node.confidence === 'hypothesis' ? 'dirt' : 'fog'
}

/** Russian plural: 1 станция, 2 станции, 5 станций. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function roadsideSummary(nodes: PathNode[]): string {
  const stations = nodes.filter((n) => n.type === 'station').length
  const head =
    stations === 0
      ? 'пока без станций'
      : `${stations} ${plural(stations, 'станция', 'станции', 'станций')}`
  const foggy = nodes.length === 0 || nodes.some((n) => n.type === 'fog')
  return foggy ? `${head} · дальше туман` : head
}

export function buildMapView(map: PathMap): MapView {
  const index = indexNodes(map)
  const { visible_stations, obstacles_per_station, focus_tracks } = map.limits

  const openObstaclesFor = new Map<string, number>()
  for (const { node } of index.values()) {
    if (node.type === 'obstacle' && !node.done && node.opens) {
      openObstaclesFor.set(node.opens, (openObstaclesFor.get(node.opens) ?? 0) + 1)
    }
  }

  const opensTitleOf = (node: PathNode): string | null => {
    if (!node.opens) return null
    if (node.opens === BEACON_ID) return 'маяк'
    return index.get(node.opens)?.node.title ?? null
  }

  const focusTracks = map.tracks.filter((t) => t.status === 'focus')

  const focus: TrackView[] = focusTracks.map((track, i) => {
    const passed: PassedItem[] = []
    const upcoming: UpcomingItem[] = []
    let stations = 0
    let collapsed: PathNode[] | null = null

    for (const node of track.nodes) {
      if (node.type === 'obstacle' && node.done) {
        passed.push({ node: node as PathObstacle & { done: string } })
        continue
      }
      if (isRoadsideStation(node)) continue
      if (collapsed) {
        collapsed.push(node)
        continue
      }
      if (node.type === 'station') {
        stations += 1
        if (stations > visible_stations) {
          collapsed = [node]
          continue
        }
      }
      const openObstacles = openObstaclesFor.get(node.id) ?? 0
      upcoming.push({
        kind: 'node',
        node,
        look: lookOf(node),
        opensTitle: opensTitleOf(node),
        openObstacles,
        overloaded: openObstacles > obstacles_per_station,
      })
    }
    if (collapsed) upcoming.push({ kind: 'collapsed', nodes: collapsed })

    return {
      id: track.id,
      title: track.title,
      short: track.short ?? track.title,
      color: TRACK_COLORS[i % TRACK_COLORS.length],
      upcoming,
      passed,
    }
  })

  const roadsideStations: RoadsideStationView[] = map.tracks.flatMap((track) =>
    track.nodes
      .filter(isRoadsideStation)
      .map((node) => ({ node, trackId: track.id, trackTitle: track.title })),
  )

  const roadsideTracks: RoadsideTrackView[] = map.tracks
    .filter((t) => t.status === 'roadside')
    .map((t) => ({ id: t.id, title: t.title, summary: roadsideSummary(t.nodes) }))

  const trackChecks = focus.map((track) => {
    const first = track.upcoming.find((item) => item.kind === 'node')
    return {
      trackId: track.id,
      result: first?.kind === 'node' ? checkPath(map, first.node.id, index) : null,
    }
  })

  return {
    title: map.title,
    started: map.started,
    beacon: map.beacon,
    empty: map.tracks.length === 0,
    focus,
    roadsideTracks,
    roadsideStations,
    focusCount: focusTracks.length,
    focusLimit: focus_tracks,
    focusOverflow: focusTracks.length > focus_tracks,
    trackChecks,
  }
}
