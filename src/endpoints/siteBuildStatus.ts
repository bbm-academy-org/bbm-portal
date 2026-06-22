import { type Endpoint, type PayloadHandler, type PayloadRequest } from 'payload'

import { querySiteBuildStatus, SiteDispatchError } from '../lib/siteDispatch'

/**
 * `GET /api/site-build-status` (#16) — live build status for the admin UI.
 *
 * Proxies the GitHub Actions API for the LATEST `publish-site`
 * (`repository_dispatch`) run on the public site repo and returns a compact
 * `{ status, conclusion, html_url, startedAt }` payload that #17's admin UI
 * polls. Pairs with #15's `POST /api/publish-site` and REUSES its credential/repo
 * resolution (`src/lib/siteDispatch.ts`) — the SAME GitHub auth (App installation
 * token, needs `actions:read`, or the static `SITE_DISPATCH_TOKEN`) and
 * `SITE_DISPATCH_REPO`.
 *
 * Contract:
 *  - admin-only: no `req.user` → 403 (same convention as publishSite.ts);
 *  - no run yet (empty runs list) → 200 with an all-null payload, never a 500;
 *  - missing credentials → 500 (fail loudly, never a silent skip);
 *  - non-2xx from GitHub / network failure → propagated as a 502-class error.
 */

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/**
 * The endpoint handler — exported standalone for unit testing (the issue's
 * acceptance asserts against it directly via the getPayload harness).
 */
export const siteBuildStatusHandler: PayloadHandler = async (
  req: PayloadRequest,
): Promise<Response> => {
  // Admin-only. Same convention as publishSite: any authenticated user is staff.
  if (!req.user) {
    return json({ error: 'Forbidden' }, 403)
  }

  try {
    const status = await querySiteBuildStatus()
    return json(status, 200)
  } catch (err) {
    const status = err instanceof SiteDispatchError ? err.status : 500
    req.payload.logger.error({ err, msg: 'site-build-status: query failed' })
    return json(
      { error: err instanceof Error ? err.message : 'Failed to read the site build status.' },
      status,
    )
  }
}

/**
 * Registered in `src/payload.config.ts` via the `endpoints` array, which Payload
 * mounts under `/api`, giving `GET /api/site-build-status`.
 */
export const siteBuildStatusEndpoint: Endpoint = {
  path: '/site-build-status',
  method: 'get',
  handler: siteBuildStatusHandler,
}
