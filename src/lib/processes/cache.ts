import type { Idef0Model } from './model'
import { assembleModel } from './parse'
import { describeProcessOrigin, type GithubProcessSource, ProcessSourceError } from './source'

/**
 * Short server-side cache of a process model read from GitHub (#553, spec 553
 * EARS-604..607) — the shape of `src/lib/path-map/cache.ts` (#533): slots kept
 * on `globalThis` (survive dev HMR), one in-flight read shared by parallel
 * requests, the last good model served with `stale: true` and the error that
 * made it stale when a refresh fails, and ONE attempt per TTL whether or not
 * there is a copy — a failure with nothing cached is remembered and rethrown
 * until the TTL runs out, so an outage or a rate limit does not turn every page
 * view into GitHub traffic. A new revision that does not parse counts as a
 * failed refresh: the last good model stays on screen (in bbm-kb a broken model
 * failed the build, so the old page stayed live — the closest equivalent).
 *
 * The cache holds the PARSED model, not the files: an unchanged revision (a 304
 * on the revision check) costs no download and no parse.
 */

export const PROCESS_MODEL_CACHE_TTL_MS = 60_000

export interface CachedModel {
  model: Idef0Model
  /** The commit the model was read at; `null` when read at the branch (no token). */
  revision: string | null
  /** When `model` was read (ISO). */
  asOf: string
  stale: boolean
  /** Why the copy is stale — the last refresh's error. Absent when fresh. */
  error?: unknown
}

interface Slot {
  model: Idef0Model | null
  revision: string | null
  etag: string | null
  readAt: number
  /** The last attempt (success or failure) — the TTL clock. */
  checkedAt: number
  error: unknown
  inflight: Promise<void> | null
}

const store = globalThis as typeof globalThis & { __processModelCache?: Map<string, Slot> }
const slots: Map<string, Slot> = (store.__processModelCache ??= new Map())

function slotFor(key: string): Slot {
  let slot = slots.get(key)
  if (!slot) {
    slot = {
      model: null,
      revision: null,
      etag: null,
      readAt: 0,
      checkedAt: 0,
      error: undefined,
      inflight: null,
    }
    slots.set(key, slot)
  }
  return slot
}

function snapshot(slot: Slot & { model: Idef0Model }): CachedModel {
  const stale = slot.error !== undefined
  return {
    model: slot.model,
    revision: slot.revision,
    asOf: new Date(slot.readAt).toISOString(),
    stale,
    ...(stale ? { error: slot.error } : {}),
  }
}

async function refresh(source: GithubProcessSource, slot: Slot, t: number): Promise<void> {
  const where = describeProcessOrigin(source.origin)
  let ref = source.origin.ref
  let probed: { sha: string; etag: string | null } | null = null

  if (source.authenticated) {
    try {
      const revision = await source.revision(slot.model ? slot.etag : null)
      if (revision === null || (revision.sha === slot.revision && slot.model)) {
        // Unchanged: the copy is fresh again, nothing is downloaded.
        if (revision) slot.etag = revision.etag
        slot.checkedAt = t
        slot.readAt = t
        slot.error = undefined
        return
      }
      probed = revision
      ref = revision.sha
    } catch (error) {
      // The check is an optimisation, not the source: read the files at the branch.
      console.warn(`[processes] revision check of ${where} failed, reading the branch:`, error)
    }
  }

  const files = await source.read(ref)
  const assembled = assembleModel(files)
  if (!assembled.ok) {
    throw new ProcessSourceError(
      `модель ${where} не разобрана: ${assembled.errors.join('; ')}`,
      'invalid',
    )
  }
  slot.model = assembled.model
  slot.revision = probed?.sha ?? null
  slot.etag = probed?.etag ?? null
  slot.readAt = t
  slot.checkedAt = t
  slot.error = undefined
}

/**
 * Read through the cache. Throws the source's error only when there is no good
 * copy to fall back to (and keeps throwing it, without a new request, until the
 * TTL runs out).
 */
export async function readModelCached(
  source: GithubProcessSource,
  now: Date,
): Promise<CachedModel> {
  const key = describeProcessOrigin(source.origin)
  const slot = slotFor(key)
  const t = now.getTime()

  if (slot.checkedAt && t - slot.checkedAt < PROCESS_MODEL_CACHE_TTL_MS) {
    if (slot.model) return snapshot(slot as Slot & { model: Idef0Model })
    if (slot.error !== undefined) throw slot.error
  }

  if (!slot.inflight) {
    slot.inflight = refresh(source, slot, t)
      .catch((error: unknown) => {
        slot.checkedAt = t
        slot.error = error
      })
      .finally(() => {
        slot.inflight = null
      })
  }
  await slot.inflight

  if (slot.model) {
    if (slot.error !== undefined) {
      console.warn(
        `[processes] read of ${key} failed, serving the copy from ${new Date(slot.readAt).toISOString()}:`,
        slot.error,
      )
    }
    return snapshot(slot as Slot & { model: Idef0Model })
  }
  throw slot.error
}

/** Drop every cached model — tests, and anything that must force the next read to GitHub. */
export function resetProcessModelCache(): void {
  slots.clear()
}
