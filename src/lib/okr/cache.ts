import { GOAL_TITLE, OFF_TREE_NOTES, OKR_PERIOD, cacheTtlMs } from './config'
import { mapOkrTree } from './mapper'
import { loadMetrics } from './metrics'
import { fetchOkrSource } from './planeClient'
import type { OkrTree } from './types'

/**
 * TTL snapshot of the OKR tree (FR-6/FR-7). The cache is a regenerable view
 * (Master Copy Policy: consumer, not mirror) — it can be dropped at any time
 * and rebuilt from Plane. On a failed refresh the previous snapshot is served
 * with `stale: true` so the dashboard shows data age instead of an error.
 */

interface CacheSlot {
  tree: OkrTree | null
  fetchedAt: number
  /** Collapses a thundering herd of parallel requests into one Plane fetch. */
  inflight: Promise<OkrTree> | null
}

// globalThis keeps the snapshot across Next.js dev HMR module reloads.
const globalSlot = globalThis as typeof globalThis & { __okrCache?: CacheSlot }
const slot: CacheSlot = (globalSlot.__okrCache ??= { tree: null, fetchedAt: 0, inflight: null })

export class OkrUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Plane недоступен и кэша ещё нет — дерево OKR построить не из чего')
    this.name = 'OkrUnavailableError'
    this.cause = cause
  }
}

async function refresh(now: Date): Promise<OkrTree> {
  const [source, metrics] = await Promise.all([fetchOkrSource(), loadMetrics()])
  const { objectives, pct, warnings } = mapOkrTree({ source, metrics, now })

  const tree: OkrTree = {
    goalTitle: GOAL_TITLE,
    period: OKR_PERIOD,
    asOf: now.toISOString(),
    stale: false,
    pct,
    objectives,
    offTreeNotes: OFF_TREE_NOTES,
    warnings,
  }

  // FR-7: refresh log — how much was read, what came out undefined.
  const krs = objectives.flatMap((o) => o.krs)
  const issueCount = krs.reduce((s, k) => s + (k.counts?.total ?? 0), 0)
  const undefinedKrs = krs.filter((k) => k.pct == null && !k.q4).map((k) => k.krId)
  console.info(
    `[okr] snapshot refreshed: ${objectives.length} objectives, ${krs.length} KR, ${issueCount} tasks; ` +
      `undefined KR: ${undefinedKrs.length ? undefinedKrs.join(', ') : 'none'}` +
      (warnings.length ? `; warnings: ${warnings.join(' | ')}` : ''),
  )
  return tree
}

export async function getOkrTree(now = new Date()): Promise<OkrTree> {
  if (slot.tree && now.getTime() - slot.fetchedAt < cacheTtlMs()) {
    return slot.tree
  }
  if (!slot.inflight) {
    slot.inflight = refresh(now)
      .then((tree) => {
        slot.tree = tree
        slot.fetchedAt = now.getTime()
        return tree
      })
      .finally(() => {
        slot.inflight = null
      })
  }
  try {
    return await slot.inflight
  } catch (err) {
    if (slot.tree) {
      // FR-7: Plane is down — serve the last snapshot with a data-age flag.
      console.warn(`[okr] refresh failed, serving stale snapshot from ${slot.tree.asOf}:`, err)
      return { ...slot.tree, stale: true }
    }
    throw new OkrUnavailableError(err)
  }
}

/** Test-only: reset the module-level snapshot. */
export function __resetOkrCache(): void {
  slot.tree = null
  slot.fetchedAt = 0
  slot.inflight = null
}
