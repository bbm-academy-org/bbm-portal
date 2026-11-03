import {
  describeOrigin,
  type PathMapDocument,
  type PathMapOrigin,
  type PathMapSource,
} from './source'

/**
 * Short server-side cache of the remote map text (#533) — the same shape as
 * `src/lib/okr/cache.ts`: a module-level slot kept on `globalThis` (survives dev
 * HMR), one in-flight read shared by parallel requests, and on a failed refresh
 * the last good copy served with `stale: true` while retries are rate-limited
 * to one per TTL. The cache is a regenerable view of the repo, never a master.
 */

export const PATH_MAP_CACHE_TTL_MS = 60_000

export interface CachedDocument {
  doc: PathMapDocument
  /** When `doc` was read from the source (ISO). */
  asOf: string
  stale: boolean
}

interface CacheSlot {
  key: string | null
  doc: PathMapDocument | null
  readAt: number
  /** When the last attempt (success or failure) happened — the TTL clock. */
  checkedAt: number
  inflight: Promise<PathMapDocument> | null
}

const globalSlot = globalThis as typeof globalThis & { __pathMapCache?: CacheSlot }
const slot: CacheSlot = (globalSlot.__pathMapCache ??= {
  key: null,
  doc: null,
  readAt: 0,
  checkedAt: 0,
  inflight: null,
})

function keyOf(origin: PathMapOrigin): string {
  return `${origin.kind}:${describeOrigin(origin)}`
}

/** Read through the cache. Throws the source's error only when there is no copy to fall back to. */
export async function readCached(source: PathMapSource, now: Date): Promise<CachedDocument> {
  const key = keyOf(source.origin)
  if (slot.key !== key) {
    // Another repo/path/branch (config changed): the old copy is not this map.
    slot.key = key
    slot.doc = null
    slot.readAt = 0
    slot.checkedAt = 0
    slot.inflight = null
  }

  const t = now.getTime()
  if (slot.doc && t - slot.checkedAt < PATH_MAP_CACHE_TTL_MS) {
    return {
      doc: slot.doc,
      asOf: new Date(slot.readAt).toISOString(),
      stale: slot.checkedAt !== slot.readAt,
    }
  }

  if (!slot.inflight) {
    slot.inflight = source
      .read()
      .then((doc) => {
        if (slot.key === key) {
          slot.doc = doc
          slot.readAt = t
          slot.checkedAt = t
        }
        return doc
      })
      .finally(() => {
        if (slot.key === key) slot.inflight = null
      })
  }

  try {
    const doc = await slot.inflight
    return { doc, asOf: new Date(slot.readAt).toISOString(), stale: false }
  } catch (error) {
    if (slot.doc) {
      slot.checkedAt = t
      console.warn(
        `[path-map] read of ${describeOrigin(source.origin)} failed, serving the copy from ${new Date(slot.readAt).toISOString()}:`,
        error,
      )
      return { doc: slot.doc, asOf: new Date(slot.readAt).toISOString(), stale: true }
    }
    throw error
  }
}

/** Drop the cached copy — tests, and task D after its own write. */
export function resetPathMapCache(): void {
  slot.key = null
  slot.doc = null
  slot.readAt = 0
  slot.checkedAt = 0
  slot.inflight = null
}
