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
 * Derived:
 *  - `inSync` = nothing has ever been published, OR the last successful build is
 *    at-or-after the last publish (the site reflects the latest publish);
 *  - `building` = the current run is `queued` / `in_progress`.
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

export type SiteSyncStatus = {
  pendingCount: number
  lastPublishedAt: string | null
  lastSuccessfulBuildAt: string | null
  currentRun: SiteBuildStatus | null
  inSync: boolean
  building: boolean
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

    const inSync =
      lastPublishedAt == null ||
      (lastSuccessfulBuildAt != null &&
        new Date(lastSuccessfulBuildAt).getTime() >= new Date(lastPublishedAt).getTime())

    const building =
      currentRun?.status === 'queued' || currentRun?.status === 'in_progress'

    const payload: SiteSyncStatus = {
      pendingCount,
      lastPublishedAt,
      lastSuccessfulBuildAt,
      currentRun,
      inSync,
      building,
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
