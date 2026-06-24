/**
 * Publish-rebuild `afterChange` hook (#42) — the idiomatic Payload
 * "publish hook → downstream deploy hook". Registered on EVERY drafts-enabled
 * surface so a native in-page "Publish changes" both publishes AND triggers a
 * whole-site rebuild of the public site.
 *
 * `maybeRebuildOnPublish` is the shared core; the two exported adapters are the
 * thin collection / global `afterChange` shapes that delegate to it (both hook
 * arg shapes carry `doc` / `previousDoc` / `req` / `context`, so one core
 * serves both).
 *
 * A rebuild is triggered iff ALL THREE hold:
 *   1. `doc._status === 'published'`, AND
 *   2. `previousDoc?._status !== 'published'` — a REAL draft→published
 *      transition, NOT a re-save of already-published content (which would fire a
 *      redundant build on every autosave/edit of a live doc), AND
 *   3. `context?.skipSiteDispatch !== true` — lets a batch publish endpoint (a
 *      later task) suppress per-surface dispatch and fire ONE build itself.
 *
 * On trigger it stamps `siteBuildState.lastPublishedAt`, then fires
 * `dispatchSiteBuild()` BEST-EFFORT. `siteBuildState` is versionless /
 * drafts-disabled (see SiteBuildState.ts) so writing it here does NOT re-enter
 * this hook — no rebuild loop.
 *
 * `dispatchSiteBuild` is a NAMED import (not re-fetching GitHub here) so the int
 * suite can `vi.mock` it.
 */
import type { CollectionAfterChangeHook, GlobalAfterChangeHook, PayloadRequest } from 'payload'

import { dispatchSiteBuild } from './siteDispatch'

/** The args the shared core needs — the common subset of both hook shapes. */
type MaybeRebuildArgs = {
  doc: { _status?: string | null } & Record<string, unknown>
  previousDoc?: ({ _status?: string | null } & Record<string, unknown>) | null
  req: PayloadRequest
  context?: { skipSiteDispatch?: boolean } & Record<string, unknown>
}

/** Persist a partial `siteBuildState` write (machine-side; no hook → no recurse). */
const writeBuildState = (req: PayloadRequest, data: Record<string, unknown>): Promise<unknown> =>
  req.payload.updateGlobal({ slug: 'siteBuildState', data, req })

/**
 * Trigger a public-site rebuild on a real draft→published transition, recording
 * the outcome on `siteBuildState`. Shared by the collection + global adapters.
 *
 * The dispatch is BEST-EFFORT and `await`ed (one quick GitHub call): on failure
 * it logs and records `lastDispatchError`, but NEVER re-throws — a dispatch
 * failure must not fail or roll back the publish. The publish already happened;
 * the drift indicator + manual rebuild are the safety net.
 */
export const maybeRebuildOnPublish = async ({
  doc,
  previousDoc,
  req,
  context,
}: MaybeRebuildArgs): Promise<void> => {
  const isPublishTransition =
    doc?._status === 'published' && previousDoc?._status !== 'published'

  // The batch endpoint (next task) sets this to fire a single build itself.
  if (!isPublishTransition || context?.skipSiteDispatch === true) return

  // The ENTIRE best-effort body is guarded — this runs in afterChange, so ANY
  // escaping rejection (a state write AND the dispatch) would roll back the user's
  // publish, which is exactly what this hook must never do. The publish already
  // happened; the drift indicator + manual rebuild are the safety net.
  try {
    // Stamp the publish first — true regardless of whether the build trigger
    // succeeds, and what the drift indicator compares against.
    await writeBuildState(req, { lastPublishedAt: new Date() })
    await dispatchSiteBuild()
    await writeBuildState(req, { lastDispatchAt: new Date() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    req.payload.logger.error(`Site build dispatch failed after publish: ${message}`)
    // Persist the error so the drift indicator can surface "publish OK, build not
    // triggered" and offer a manual rebuild. This recording write is ITSELF guarded
    // — at the moment we most want to record the error, a failing write must not be
    // the thing that converts a successful publish into a rolled-back one.
    try {
      await writeBuildState(req, { lastDispatchError: message })
    } catch (writeErr) {
      const writeMessage = writeErr instanceof Error ? writeErr.message : String(writeErr)
      req.payload.logger.error(`Failed to record lastDispatchError after publish: ${writeMessage}`)
    }
  }
}

/** Collection `afterChange` adapter — delegates to the shared core. */
export const siteRebuildCollectionAfterChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  context,
}) => {
  await maybeRebuildOnPublish({ doc, previousDoc, req, context })
  return doc
}

/** Global `afterChange` adapter — delegates to the shared core. */
export const siteRebuildGlobalAfterChange: GlobalAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  context,
}) => {
  await maybeRebuildOnPublish({ doc, previousDoc, req, context })
  return doc
}
