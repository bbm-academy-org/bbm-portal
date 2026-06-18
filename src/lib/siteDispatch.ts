/**
 * Public-site GitHub dispatch helper (#15, pairs with #16).
 *
 * Centralises everything about talking to the public site's repo on
 * api.github.com: reading the token, resolving the target repo, and firing the
 * `repository_dispatch`. #16 (`GET /api/site-build-status`) reads the SAME token
 * + repo to query the Actions API, so these resolvers live here to be shared —
 * keep the env-var contract in one place.
 *
 * Token provenance: `SITE_DISPATCH_TOKEN` is provisioned in prod by
 * bbm-public-website#111 (a GitHub App / PAT scoped to `contents:write` /
 * `actions` on the public site repo).
 */

/** The `repository_dispatch` event the public site's build workflow listens for. */
export const PUBLISH_SITE_EVENT_TYPE = 'publish-site'

/** Default target repo; overridable via `SITE_DISPATCH_REPO` for forks/staging. */
const DEFAULT_REPO = 'bbm-academy-org/bbm-public-website'

/** Thrown when the dispatch cannot be performed or GitHub did not accept it. */
export class SiteDispatchError extends Error {
  /** HTTP status the endpoint should surface (500-class). */
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'SiteDispatchError'
    this.status = status
  }
}

/** Resolve the target `owner/repo`, falling back to the public site default. */
export const resolveSiteRepo = (): string =>
  (process.env.SITE_DISPATCH_REPO ?? '').trim() || DEFAULT_REPO

/**
 * Read the dispatch token, or throw a 500-class error.
 *
 * A MISSING token must fail the whole publish loudly — never silently skip the
 * build trigger (that would leave "promoted in CMS, build never started").
 */
export const requireSiteDispatchToken = (): string => {
  const token = (process.env.SITE_DISPATCH_TOKEN ?? '').trim()
  if (!token) {
    throw new SiteDispatchError(
      'SITE_DISPATCH_TOKEN is not set — cannot trigger the public site build ' +
        '(token comes from bbm-public-website#111).',
      500,
    )
  }
  return token
}

export type SiteDispatchResult = {
  event_type: string
  repo: string
  /** ISO timestamp the dispatch was accepted (no run id — that is #16's job). */
  at: string
}

/**
 * Fire the `publish-site` `repository_dispatch` and verify GitHub accepted it.
 *
 * Success is HTTP 204 (no body). Any other status — or a network failure —
 * throws `SiteDispatchError` so the caller can roll back its promotes.
 * `repository_dispatch` returns no run id, so the result only echoes what we
 * legitimately know; resolving the actual run is #16.
 */
export const dispatchSiteBuild = async (): Promise<SiteDispatchResult> => {
  const token = requireSiteDispatchToken()
  const repo = resolveSiteRepo()

  let res: Response
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: PUBLISH_SITE_EVENT_TYPE }),
    })
  } catch (err) {
    throw new SiteDispatchError(
      `Failed to reach GitHub to trigger the site build: ${(err as Error).message}`,
      502,
    )
  }

  // GitHub's repository_dispatch success contract is exactly 204 No Content.
  if (res.status !== 204) {
    const detail = await res.text().catch(() => '')
    throw new SiteDispatchError(
      `GitHub rejected the site build dispatch (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
      502,
    )
  }

  return { event_type: PUBLISH_SITE_EVENT_TYPE, repo, at: new Date().toISOString() }
}

/**
 * The build-status shape returned by `querySiteBuildStatus` and surfaced by
 * `GET /api/site-build-status` (#16). All four fields are `null` when no build
 * has run yet — see {@link NO_BUILD_STATUS}.
 */
export type SiteBuildStatus = {
  /** GitHub run lifecycle: `queued` | `in_progress` | `completed` (or null). */
  status: string | null
  /** Terminal result: `success` | `failure` | `cancelled` | … (or null while running / no run). */
  conclusion: string | null
  /** Link to the run on github.com, or null when no run exists. */
  html_url: string | null
  /** ISO timestamp the run started, or null when no run exists. */
  startedAt: string | null
}

/**
 * The "no build has run yet" payload. We deliberately return a well-formed
 * all-null shape (NOT a 500 and NOT a `{ status: 'none' }` sentinel) so the #17
 * admin UI can render "never built" uniformly with a real run — it just sees
 * null fields. Documented + asserted by the int suite.
 */
export const NO_BUILD_STATUS: SiteBuildStatus = {
  status: null,
  conclusion: null,
  html_url: null,
  startedAt: null,
}

/** Minimal shape of a GitHub Actions workflow run we read. */
type GitHubWorkflowRun = {
  status?: string | null
  conclusion?: string | null
  html_url?: string | null
  run_started_at?: string | null
  created_at?: string | null
}

type GitHubRunsResponse = {
  total_count?: number
  workflow_runs?: GitHubWorkflowRun[]
}

/**
 * Query the GitHub Actions API for the LATEST `repository_dispatch` run on the
 * site repo and map it to a {@link SiteBuildStatus}.
 *
 * `publish-site` is triggered via `repository_dispatch`; the runs API has no
 * per-`event_type` filter, so we filter `event=repository_dispatch` and take the
 * single most recent run (`per_page=1`). Empty list → {@link NO_BUILD_STATUS}
 * (never a 500). Uses the SAME `SITE_DISPATCH_TOKEN` (needs `actions:read`) and
 * `SITE_DISPATCH_REPO` as the dispatch — a missing token fails loudly (500).
 * Network failure → 502; any non-2xx from GitHub → propagated as a 502-class
 * `SiteDispatchError`. The token is never logged.
 */
export const querySiteBuildStatus = async (): Promise<SiteBuildStatus> => {
  const token = requireSiteDispatchToken()
  const repo = resolveSiteRepo()

  let res: Response
  try {
    res = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs?event=repository_dispatch&per_page=1`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    )
  } catch (err) {
    throw new SiteDispatchError(
      `Failed to reach GitHub to read the site build status: ${(err as Error).message}`,
      502,
    )
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new SiteDispatchError(
      `GitHub rejected the build-status query (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
      502,
    )
  }

  const body = (await res.json().catch(() => ({}))) as GitHubRunsResponse
  const runs = body.workflow_runs ?? []

  // "No run yet" — empty list (or total_count 0). Well-formed all-null payload.
  if ((body.total_count ?? runs.length) === 0 || runs.length === 0) {
    return { ...NO_BUILD_STATUS }
  }

  const run = runs[0]
  return {
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    html_url: run.html_url ?? null,
    startedAt: run.run_started_at ?? run.created_at ?? null,
  }
}
