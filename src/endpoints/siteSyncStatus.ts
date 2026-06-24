import { type Endpoint, type PayloadHandler, type PayloadRequest } from 'payload'

import {
  NO_BUILD_STATUS,
  queryLastSuccessfulBuild,
  querySiteBuildStatus,
  SiteDispatchError,
  type SiteBuildStatus,
} from '../lib/siteDispatch'
import { countPendingDrafts } from './pendingChanges'

/**
 * `GET /api/site-sync-status` (#44) — one consolidated drift read.
 *
 * A single endpoint that powers the whole publish admin panel (next task) so the
 * UI is always current with ONE fetch. It joins three sources into one payload:
 *
 *  - `pendingCount` — drafts-derived (latest version === 'draft'), via the SAME
 *    derivation `/api/pending-changes` uses (`countPendingDrafts`, shared, not
 *    duplicated);
 *  - `lastPublishedAt` — from the `siteBuildState` global (the publish-side TRUTH
 *    stamped by the publish-rebuild hook / batch endpoint);
 *  - `lastSuccessfulBuildAt` + `currentRun` — read off the GitHub Actions API
 *    (`queryLastSuccessfulBuild` / `querySiteBuildStatus`).
 *
 * Derived (#52) — ONE authoritative `syncState` enum replaces the old overloaded
 * `inSync`/`building` booleans. It is computed from ground truth
 * (`lastPublishedAt`, `lastSuccessfulBuildAt`, `currentRun.{status,conclusion,startedAt}`)
 * by this precedence (order matters):
 *
 *  1. `lastPublishedAt == null` OR `lastSuccessfulBuildAt >= lastPublishedAt`
 *        → 'in-sync'  (never published, or the live site reflects the last publish)
 *  2. `currentRun.status` ∈ `queued` / `in_progress`
 *        → 'building' (a build is actively running)
 *  3. `currentRun` failed (a non-null conclusion that isn't `success`) AND
 *     `currentRun.startedAt >= lastPublishedAt`
 *        → 'failed'   (a terminal failed run that belongs to THIS publish)
 *  4. else
 *        → 'building' (published, no successful build yet, no failed run for this
 *                      publish → the dispatched run is not yet visible — the
 *                      registration gap; transient, NOT a failure)
 *
 * Why this matters (the #52 bug): `publishSite` stamps `lastPublishedAt` only
 * after the build dispatch returns 204, so `published > built` almost always
 * means "a build is in flight / about to register", NOT "behind/failed". The old
 * `inSync === false` rendered that transient gap as a red ⚠️ flash. Step 4 maps
 * it to 'building'; step 3's `startedAt >= lastPublishedAt` scopes a failure to
 * the CURRENT publish, so re-publishing over an older failed run reads as
 * 'building' (new run pending), not a stale red. The enum is stateless /
 * reload-safe — it does not depend on the client optimistic flag.
 *
 * Contract (matches siteBuildStatus.ts exactly):
 *  - admin-only: no `req.user` → 403;
 *  - missing GitHub credentials → 500 (fail loudly, never a silent skip);
 *  - non-2xx from GitHub / network failure → propagated as a 502-class error;
 *  - "no run yet" / "no successful build" / "never published" → a well-formed 200
 *    with nulls (currentRun null, lastSuccessfulBuildAt null), NEVER a 500.
 *
 * Read-only: no transaction, no writes.
 */

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export type SyncState = 'in-sync' | 'building' | 'failed'

export type SiteSyncStatus = {
  pendingCount: number
  lastPublishedAt: string | null
  lastSuccessfulBuildAt: string | null
  currentRun: SiteBuildStatus | null
  syncState: SyncState
}

/**
 * Compute the authoritative `syncState` enum by the #52 precedence (see the file
 * header). A failed conclusion = any non-null conclusion that isn't `'success'`
 * (matches the `runFailed` helper in PublishPanel.tsx — keep them consistent).
 */
const computeSyncState = (args: {
  lastPublishedAt: string | null
  lastSuccessfulBuildAt: string | null
  currentRun: SiteBuildStatus | null
}): SyncState => {
  const { lastPublishedAt, lastSuccessfulBuildAt, currentRun } = args

  // 1 — never published, or the live site already reflects the last publish.
  if (
    lastPublishedAt == null ||
    (lastSuccessfulBuildAt != null &&
      new Date(lastSuccessfulBuildAt).getTime() >= new Date(lastPublishedAt).getTime())
  ) {
    return 'in-sync'
  }

  // 2 — a build is actively running.
  if (currentRun?.status === 'queued' || currentRun?.status === 'in_progress') {
    return 'building'
  }

  // 3 — a terminal failed run that belongs to THIS publish (started at-or-after it).
  if (
    currentRun != null &&
    currentRun.conclusion != null &&
    currentRun.conclusion !== 'success' &&
    currentRun.startedAt != null &&
    new Date(currentRun.startedAt).getTime() >= new Date(lastPublishedAt).getTime()
  ) {
    return 'failed'
  }

  // 4 — published, no successful build yet, no failed run for this publish: the
  // dispatched run is not yet visible (the registration gap). Transient, not red.
  return 'building'
}

/** `querySiteBuildStatus` returns an all-null shape when no run exists; map it to null. */
const isNoRun = (status: SiteBuildStatus): boolean =>
  status.status === NO_BUILD_STATUS.status &&
  status.conclusion === NO_BUILD_STATUS.conclusion &&
  status.html_url === NO_BUILD_STATUS.html_url &&
  status.startedAt === NO_BUILD_STATUS.startedAt

/** Read the publish-side truth: `siteBuildState.lastPublishedAt` (ISO or null). */
const readLastPublishedAt = async (req: PayloadRequest): Promise<string | null> => {
  const state = (await req.payload.findGlobal({ slug: 'siteBuildState', depth: 0 })) as {
    lastPublishedAt?: string | null
  }
  return state.lastPublishedAt ?? null
}

/**
 * The endpoint handler — exported standalone for unit testing (asserted directly
 * via the getPayload harness, mirroring siteBuildStatusHandler).
 */
export const siteSyncStatusHandler: PayloadHandler = async (
  req: PayloadRequest,
): Promise<Response> => {
  // Admin-only. Same convention as publishSite: any authenticated user is staff.
  if (!req.user) {
    return json({ error: 'Forbidden' }, 403)
  }

  try {
    const [pendingCount, lastPublishedAt, currentRunRaw, lastSuccessfulBuildAt] = await Promise.all(
      [
        countPendingDrafts(req),
        readLastPublishedAt(req),
        querySiteBuildStatus(),
        queryLastSuccessfulBuild(),
      ],
    )

    const currentRun = isNoRun(currentRunRaw) ? null : currentRunRaw

    const syncState = computeSyncState({ lastPublishedAt, lastSuccessfulBuildAt, currentRun })

    const payload: SiteSyncStatus = {
      pendingCount,
      lastPublishedAt,
      lastSuccessfulBuildAt,
      currentRun,
      syncState,
    }
    return json(payload, 200)
  } catch (err) {
    const status = err instanceof SiteDispatchError ? err.status : 500
    req.payload.logger.error({ err, msg: 'site-sync-status: query failed' })
    return json(
      { error: err instanceof Error ? err.message : 'Failed to read the site sync status.' },
      status,
    )
  }
}

/**
 * Registered in `src/payload.config.ts` via the `endpoints` array, which Payload
 * mounts under `/api`, giving `GET /api/site-sync-status`.
 */
export const siteSyncStatusEndpoint: Endpoint = {
  path: '/site-sync-status',
  method: 'get',
  handler: siteSyncStatusHandler,
}
