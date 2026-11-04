import type { ReactNode } from 'react'

import type { EditCommand } from '@/lib/path-map/edit'
import { plural } from '@/lib/path-map/derive'
import type { PathMapEditOutcome } from '@/lib/path-map/save'
import {
  BEACON_ID,
  type Confidence,
  type PathMap,
  type PathNode,
  type PathTrack,
} from '@/lib/path-map/schema'

/**
 * What the page hands the editor (#539). `save` is the Server Action
 * (`src/app/(platform)/p/path/actions.ts`) passed down as a prop, so the view
 * never imports from `src/app` and the tests pass a stub. `sha` is the blob the
 * drawn map came from — the base every edit is checked against.
 */
export interface PathMapEditing {
  enabled: boolean
  /** Why editing is off — shown next to the disabled «Править». */
  reason?: string
  sha: string | null
  save: (input: { command: EditCommand; baseSha: string }) => Promise<PathMapEditOutcome>
}

/** A «+» slot on a road: where a new block would go (`index` in the track's `nodes`). */
export interface SlotAt {
  trackId: string
  trackTitle: string
  index: number
  /** The block just below the slot on the road, if any. */
  lower?: PathNode
  /** The block just above it, if any. */
  upper?: PathNode
}

/**
 * What edit mode overlays on the road map (#541 rework). The editor
 * (`PathMapEditor.tsx`) owns the state and hands the map these hooks; the map
 * (`PathMapScreen.tsx`) keeps its own layout and only asks where to put them.
 */
export interface RoadEdit {
  /** The node whose form is open in the panel. */
  selectedId: string | null
  onNode: (nodeId: string) => void
  /** The «+» slot — or, while its form is open, the placeholder card. */
  slot: (at: SlotAt) => ReactNode
  slotOpen: (trackId: string, index: number) => boolean
  /** The «⋯» menu next to a track label. */
  trackMenu: (trackId: string) => ReactNode
  /** «Править маяк» under the beacon. */
  beaconAction: ReactNode
  /** A node's position in its track's `nodes` (file order). */
  indexOf: (nodeId: string) => number
  /** How many nodes a track has in the file. */
  size: (trackId: string) => number
  /** The form Sheet covers the whole map (narrow screens): the map is `inert` meanwhile. */
  covered?: boolean
}

/** Runs one command through the editor's save loop (sha, refresh, toast, conflict). */
export type RunEdit = (command: EditCommand) => Promise<PathMapEditOutcome>

export const NODE_KIND: Record<PathNode['type'], string> = {
  station: 'Станция',
  obstacle: 'Шлагбаум',
  fog: 'Туман',
}

/** «Новая станция» / «Новый шлагбаум» / «Новый туман» — the eyebrow of a new block's form. */
export const NEW_NODE_KIND: Record<PathNode['type'], string> = {
  station: 'Новая станция',
  obstacle: 'Новый шлагбаум',
  fog: 'Новый туман',
}

/** The accusative for «Удалить …». */
export const NODE_ACCUSATIVE: Record<PathNode['type'], string> = {
  station: 'станцию',
  obstacle: 'шлагбаум',
  fog: 'туман',
}

/** What the map draws for a station's confidence (the legend's words). */
export const CONFIDENCE_WORD: Record<Confidence, string> = {
  known: 'знаем',
  hypothesis: 'гипотеза',
  unknown: 'не знаем',
}

/** A new block's form, mirrored by the placeholder card on the road. */
export interface NodeDraft {
  type: PathNode['type']
  title: string
  confidence: Confidence
}

/** The member's local calendar day, `YYYY-MM-DD` — what «Снят» and a ticked task record. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export interface OpensChoice {
  /** Nodes above the given position on the same track, nearest first. */
  above: PathNode[]
  /** Every other track's nodes — `opens` may cross tracks. */
  others: Array<{ track: PathTrack; nodes: PathNode[] }>
}

/**
 * The targets a node can lead to: the beacon, what lies above it on its own
 * road (nearest first), and any node of another track. `index` is the node's
 * position (an existing node) or the insertion point (a new one, which then
 * sits below everything from `index` up).
 */
export function opensChoices(
  map: PathMap,
  trackId: string,
  index: number,
  existing: boolean,
  selfId?: string,
): OpensChoice {
  const track = map.tracks.find((t) => t.id === trackId)
  const above = (track?.nodes ?? []).slice(existing ? index + 1 : index)
  return {
    above: above.filter((n) => n.id !== selfId),
    others: map.tracks
      .filter((t) => t.id !== trackId && t.nodes.length > 0)
      .map((t) => ({ track: t, nodes: t.nodes.filter((n) => n.id !== selfId) })),
  }
}

export function nodeExists(map: PathMap, id: string): boolean {
  return id === BEACON_ID || map.tracks.some((t) => t.nodes.some((n) => n.id === id))
}

/** One line under a focus track in the swap dialog: what leaving the road would stall. */
export function swapImpact(track: PathTrack): string {
  const open = track.nodes.filter((n) => n.type === 'obstacle' && !n.done)
  if (open.length === 0) return 'шлагбаумов в работе нет — ничего не встанет'
  const owners = [...new Set(open.map((n) => n.owner).filter(Boolean))]
  const count = `${open.length} ${plural(open.length, 'шлагбаум', 'шлагбаума', 'шлагбаумов')} в работе`
  return owners.length > 0 ? `${count} у ${owners.join(', ')}` : count
}

/** A short message for a non-ok outcome that the form shows itself (stale is the editor's). */
export function outcomeErrors(outcome: PathMapEditOutcome): string[] {
  switch (outcome.status) {
    case 'invalid':
      return outcome.errors
    case 'disabled':
      return [outcome.reason]
    case 'forbidden':
    case 'error':
      return [outcome.message]
    default:
      return []
  }
}
