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

/**
 * How long after our own write a GitHub read of the version it replaced still
 * counts as lag (#541 re-review). Past it the read is the truth: a `git revert`
 * of the portal's commit restores exactly that blob, and readers must see it.
 */
export const OWN_WRITE_LAG_WINDOW_MS = 2 * PATH_MAP_CACHE_TTL_MS

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
  /**
   * The portal's own last write to this map (#541 review): its blob sha, the
   * sha it replaced, and the text. Kept apart from `doc` on purpose — a cached
   * READ with the member's base sha proves nothing about GitHub lagging; only
   * our own write does. Cleared with the key, by `resetPathMapCache`, and
   * once the lag window since `at` is over.
   */
  own: (OwnWrite & { at: number }) | null
}

export interface OwnWrite {
  sha: string
  /** The blob our write replaced — what a lagging GitHub read still returns. */
  parentSha: string
  content: string
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
  own: null,
})
// A slot created by an older build (dev HMR) has no `own` yet.
slot.own ??= null

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

/** Our own last write while its lag window is open; past the window it is forgotten. */
function liveOwn(t: number): (OwnWrite & { at: number }) | null {
  if (slot.own && t - slot.own.at > OWN_WRITE_LAG_WINDOW_MS) slot.own = null
  return slot.own
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
  if (slot.key !== key) {
    clear(key)
    slot.own = null
  }

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
          // GitHub's read may lag behind our own write for a moment and hand
          // back the version that write replaced: within the lag window never
          // roll the copy back to it; past the window it is the truth (a revert).
          const own = current() ? liveOwn(t) : null
          if (own && doc.sha === own.parentSha && slot.doc) {
            slot.readAt = t
            slot.checkedAt = t
            slot.error = undefined
            return slot.doc
          }
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

/** The cached text for `origin`, if any — no read, no TTL check. */
export function peekPathMapCache(origin: GithubPathMapOrigin): PathMapDocument | null {
  return slot.key === keyOf(origin) ? slot.doc : null
}

/**
 * Record a successful PUT by the portal (#539, #541 review): primes the cache
 * with the written text and remembers the write — its sha and the sha it
 * replaced — so the save can tell GitHub's read lag from a genuinely newer file.
 */
export function recordOwnWrite(
  origin: GithubPathMapOrigin,
  written: OwnWrite,
  now: Date = new Date(),
): void {
  primePathMapCache(origin, written, now)
  slot.own = {
    sha: written.sha,
    parentSha: written.parentSha,
    content: written.content,
    at: now.getTime(),
  }
}

/**
 * The portal's own last write to `origin`, if it is still the one on record and
 * its lag window (`OWN_WRITE_LAG_WINDOW_MS`) is still open.
 */
export function ownWriteOf(origin: GithubPathMapOrigin, now: Date = new Date()): OwnWrite | null {
  if (slot.key !== keyOf(origin)) return null
  const own = liveOwn(now.getTime())
  return own ? { sha: own.sha, parentSha: own.parentSha, content: own.content } : null
}

/** Drop the cached copy — tests, and anything that must force the next read to GitHub. */
export function resetPathMapCache(): void {
  clear(null)
  slot.own = null
}
