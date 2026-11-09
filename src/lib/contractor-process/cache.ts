import {
  describeOrigin,
  type GithubPathMapSource,
  type PathMapDocument,
  type PathMapOrigin,
} from '@/lib/path-map'

/**
 * Short server-side cache of the remote process text (#545).
 *
 * Its OWN slot, not the path map's: `src/lib/path-map/cache.ts` keeps a single
 * slot that clears itself when another file comes through, so reading this
 * file through it would evict the map's copy on every page view (and the
 * map's own-write bookkeeping is no business of a read-only page). The slot
 * lives on `globalThis.__contractorProcessCache` — a key the path map never
 * touches — and keeps the same discipline: one in-flight read shared by
 * parallel requests, one attempt per TTL whether or not there is a copy, and
 * on a failed refresh the last good copy served with `stale: true` and the
 * error that made it stale. A regenerable view of the repo, never a master.
 */

export const CONTRACTOR_PROCESS_CACHE_TTL_MS = 60_000

export interface CachedProcessDocument {
  doc: PathMapDocument
  /** When `doc` was read from the source (ISO). */
  asOf: string
  stale: boolean
  /** Why the copy is stale — the error of the last failed refresh. Absent when fresh. */
  error?: unknown
}

interface CacheSlot {
  key: string | null
  doc: PathMapDocument | null
  readAt: number
  /** When the last attempt (success or failure) happened — the TTL clock. */
  checkedAt: number
  /** The last refresh's error; cleared by a successful read. */
  error: unknown
  inflight: Promise<PathMapDocument> | null
  /** Bumped by every reset: a read started before it must not write into the new slot. */
  generation: number
}

const globalSlot = globalThis as typeof globalThis & { __contractorProcessCache?: CacheSlot }
const slot: CacheSlot = (globalSlot.__contractorProcessCache ??= {
  key: null,
  doc: null,
  readAt: 0,
  checkedAt: 0,
  error: undefined,
  inflight: null,
  generation: 0,
})

function keyOf(origin: PathMapOrigin): string {
  return `${origin.kind}:${describeOrigin(origin)}`
}

function clear(key: string | null): void {
  slot.key = key
  slot.doc = null
  slot.readAt = 0
  slot.checkedAt = 0
  slot.error = undefined
  slot.inflight = null
  slot.generation += 1
}

function snapshot(doc: PathMapDocument): CachedProcessDocument {
  const stale = slot.error !== undefined
  return {
    doc,
    asOf: new Date(slot.readAt).toISOString(),
    stale,
    ...(stale ? { error: slot.error } : {}),
  }
}

/**
 * Read through the cache. Throws the source's error only when there is no copy
 * to fall back to (and keeps throwing that same error, without a new request,
 * until the TTL runs out).
 */
export async function readCachedProcess(
  source: GithubPathMapSource,
  now: Date,
): Promise<CachedProcessDocument> {
  const key = keyOf(source.origin)
  // Another repo/branch (config changed): the old copy is not this file.
  if (slot.key !== key) clear(key)

  const t = now.getTime()
  if (slot.checkedAt && t - slot.checkedAt < CONTRACTOR_PROCESS_CACHE_TTL_MS) {
    if (slot.doc) return snapshot(slot.doc)
    if (slot.error !== undefined) throw slot.error
  }

  if (!slot.inflight) {
    const generation = slot.generation
    const current = () => slot.key === key && slot.generation === generation
    slot.inflight = source
      .read()
      .then(
        (doc) => {
          if (current()) {
            slot.doc = doc
            slot.readAt = t
            slot.checkedAt = t
            slot.error = undefined
          }
          return doc
        },
        (error: unknown) => {
          if (current()) {
            slot.checkedAt = t
            slot.error = error
          }
          throw error
        },
      )
      .finally(() => {
        if (current()) slot.inflight = null
      })
  }

  try {
    return snapshot(await slot.inflight)
  } catch (error) {
    if (slot.doc) {
      console.warn(
        `[contractor-process] read of ${describeOrigin(source.origin)} failed, serving the copy from ${new Date(slot.readAt).toISOString()}:`,
        error,
      )
      return snapshot(slot.doc)
    }
    throw error
  }
}

/** Drop the cached copy — tests, and anything that must force the next read to GitHub. */
export function resetContractorProcessCache(): void {
  clear(null)
}
