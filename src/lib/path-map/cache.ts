import {
  describeOrigin,
  type GithubPathMapOrigin,
  type GithubPathMapSource,
  type PathMapDocument,
  type PathMapOrigin,
} from './source'

/**
 * Short server-side cache of the remote map text (#533) — the same shape as
 * `src/lib/okr/cache.ts`: a module-level slot kept on `globalThis` (survives dev
 * HMR), one in-flight read shared by parallel requests, and on a failed refresh
 * the last good copy served with `stale: true` and the error that made it
 * stale. Retries are one per TTL whether or not there is a copy: a failure
 * with nothing cached is remembered and rethrown until the TTL runs out, so a
 * revoked token or a rate limit does not turn every page view into a GitHub
 * call. The cache is a regenerable view of the repo, never a master.
 */

export const PATH_MAP_CACHE_TTL_MS = 60_000

export interface CachedDocument {
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
  /** The last refresh's error; cleared by a successful read or a prime. */
  error: unknown
  inflight: Promise<PathMapDocument> | null
  /** Bumped by every prime/reset: a read started before it must not write its older text. */
  generation: number
}

const globalSlot = globalThis as typeof globalThis & { __pathMapCache?: CacheSlot }
const slot: CacheSlot = (globalSlot.__pathMapCache ??= {
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

function snapshot(doc: PathMapDocument): CachedDocument {
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
export async function readCached(source: GithubPathMapSource, now: Date): Promise<CachedDocument> {
  const key = keyOf(source.origin)
  // Another repo/path/branch (config changed): the old copy is not this map.
  if (slot.key !== key) clear(key)

  const t = now.getTime()
  if (slot.checkedAt && t - slot.checkedAt < PATH_MAP_CACHE_TTL_MS) {
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
    const doc = await slot.inflight
    // A prime may have landed while this read was in flight: serve the newer copy.
    return slot.doc && slot.doc !== doc ? snapshot(slot.doc) : snapshot(doc)
  } catch (error) {
    if (slot.doc) {
      console.warn(
        `[path-map] read of ${describeOrigin(source.origin)} failed, serving the copy from ${new Date(slot.readAt).toISOString()}:`,
        error,
      )
      return snapshot(slot.doc)
    }
    throw error
  }
}

/**
 * Put text the portal itself just wrote into the cache — task D calls this
 * after a successful PUT with the response's new blob sha, so the next read is
 * its own write (no GET), and a later failed refresh falls back to the written
 * copy, not the pre-write one. Clears any remembered failure and supersedes a
 * read already in flight.
 */
export function primePathMapCache(
  origin: GithubPathMapOrigin,
  written: { content: string; sha: string },
  now: Date = new Date(),
): void {
  clear(keyOf(origin))
  const t = now.getTime()
  slot.doc = { content: written.content, sha: written.sha, origin }
  slot.readAt = t
  slot.checkedAt = t
}

/** Drop the cached copy — tests, and anything that must force the next read to GitHub. */
export function resetPathMapCache(): void {
  clear(null)
}
