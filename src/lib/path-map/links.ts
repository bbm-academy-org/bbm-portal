import { BEACON_ID, type PathMap, type PathNode, type PathTrack } from './schema'

/**
 * Who leads to a block that is about to be deleted (#539, #541 review).
 *
 * Deleting a node — or a whole track — that other blocks `opens` would leave
 * their links pointing at an id that no longer exists: a «разрыв». The editor
 * names those blocks in the confirm and, by default, repoints them to what the
 * deleted block itself opened, so the road stays connected. Pure and free of
 * the YAML layer: the confirm dialog (client) and the edit command (server)
 * share it.
 */

export interface InboundLinks {
  /** Blocks outside the deleted set whose `opens` points into it, in file order. */
  referrers: Array<{ node: PathNode; track: PathTrack }>
  /**
   * Where the referrers would lead after the delete: what the deleted block
   * opened, followed through the deleted set (a whole track). `undefined` when
   * the chain ends inside the deleted set — the link then becomes a break.
   */
  target: string | undefined
}

function nodesById(map: PathMap): Map<string, PathNode> {
  return new Map(map.tracks.flatMap((t) => t.nodes.map((n) => [n.id, n] as const)))
}

/** Follow `opens` from `id` until it leaves the deleted set (cycle-safe). */
function resolveTarget(
  byId: Map<string, PathNode>,
  removed: Set<string>,
  id: string | undefined,
): string | undefined {
  const seen = new Set<string>()
  let current = id
  while (current && current !== BEACON_ID && removed.has(current)) {
    if (seen.has(current)) return undefined
    seen.add(current)
    current = byId.get(current)?.opens
  }
  return current
}

/** Where a referrer that opened `opened` (a deleted id) should now lead. */
export function repointTarget(
  map: PathMap,
  removedIds: Iterable<string>,
  opened: string,
): string | undefined {
  return resolveTarget(nodesById(map), new Set(removedIds), opened)
}

export function inboundLinks(map: PathMap, removedIds: Iterable<string>): InboundLinks {
  const removed = new Set(removedIds)
  const byId = nodesById(map)
  const referrers = map.tracks.flatMap((track) =>
    track.nodes
      .filter((n) => !removed.has(n.id) && n.opens !== undefined && removed.has(n.opens))
      .map((node) => ({ node, track })),
  )
  // One deleted node: what it opened. A deleted track: the first referrer's
  // chain decides the summary; each referrer is still resolved on its own.
  const first = referrers[0]?.node.opens ?? [...removed][0]
  return { referrers, target: resolveTarget(byId, removed, first) }
}
