/**
 * Public-site GitHub dispatch helper (#15, pairs with #16).
 *
 * Centralises everything about talking to the public site's repo on
 * api.github.com: resolving the credentials, resolving the target repo, and
 * firing the `repository_dispatch`. #16 (`GET /api/site-build-status`) reads the
 * SAME credentials + repo to query the Actions API, so these resolvers live here
 * to be shared — keep the auth contract in one place.
 *
 * Auth (bbm-public-website#111): two modes, App preferred.
 *   1. GitHub App (PRODUCTION) — when `SITE_DISPATCH_APP_ID`,
 *      `SITE_DISPATCH_APP_PRIVATE_KEY` and `SITE_DISPATCH_APP_INSTALLATION_ID`
 *      are all set, mint a short-lived installation token via `@octokit/auth-app`.
 *      No personal-account token lives in prod (#111 acceptance). The App is
 *      installed on the site repo with `contents:write` (repository_dispatch) +
 *      `actions:read` (run status).
 *   2. Static token (dev / CI / back-compat) — falls back to `SITE_DISPATCH_TOKEN`
 *      (a PAT or fine-grained token) when no App credentials are configured.
 * If NEITHER is configured we fail loudly (500) — never a silent skip, which
 * would leave "promoted in CMS, build never started".
 */
import { createAppAuth } from '@octokit/auth-app'

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

/** The three env vars that together enable the GitHub App auth path. */
type AppCredentials = { appId: string; privateKey: string; installationId: string }

/**
 * A PEM stored as a single-line env value keeps its newlines as the literal
 * two-character sequence `\n`; `@octokit/auth-app` needs a real multi-line PEM,
 * so expand them back. A PEM that already has real newlines is returned as-is.
 */
const normalizePrivateKey = (raw: string): string =>
  raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw

/**
 * Read the GitHub App credentials, or `null` when the App path is not configured
 * at all (so the caller can fall back to the static token). A PARTIAL App config
 * is a misconfiguration, not a fallback trigger, so it throws (500).
 */
const readAppCredentials = (): AppCredentials | null => {
  const appId = (process.env.SITE_DISPATCH_APP_ID ?? '').trim()
  const privateKey = (process.env.SITE_DISPATCH_APP_PRIVATE_KEY ?? '').trim()
  const installationId = (process.env.SITE_DISPATCH_APP_INSTALLATION_ID ?? '').trim()

  if (!appId && !privateKey && !installationId) return null // App path not configured

  if (!appId || !privateKey || !installationId) {
    throw new SiteDispatchError(
      'GitHub App dispatch credentials are only partially set — SITE_DISPATCH_APP_ID, ' +
        'SITE_DISPATCH_APP_PRIVATE_KEY and SITE_DISPATCH_APP_INSTALLATION_ID must all be ' +
        'set together (or all unset to use SITE_DISPATCH_TOKEN).',
      500,
    )
  }

  return { appId, privateKey: normalizePrivateKey(privateKey), installationId }
}

/**
 * Memoised `@octokit/auth-app` instance, keyed on the credential tuple. The auth
 * function caches the installation token internally and refreshes it shortly
 * before expiry, so reusing the instance across requests means the frequently
 * polled status endpoint does not mint a fresh token (JWT + token round-trip) on
 * every call. A credential change (rotation) rebuilds it.
 */
let cachedAppAuth: { key: string; auth: ReturnType<typeof createAppAuth> } | null = null

/** Mint (or reuse a cached) GitHub App installation token. */
const mintInstallationToken = async (creds: AppCredentials): Promise<string> => {
  const key = `${creds.appId}:${creds.installationId}:${creds.privateKey}`
  if (!cachedAppAuth || cachedAppAuth.key !== key) {
    cachedAppAuth = {
      key,
      auth: createAppAuth({
        appId: creds.appId,
        privateKey: creds.privateKey,
        installationId: creds.installationId,
      }),
    }
  }

  try {
    const { token } = await cachedAppAuth.auth({ type: 'installation' })
    return token
  } catch (err) {
    throw new SiteDispatchError(
      `Failed to mint a GitHub App installation token: ${(err as Error).message}`,
      502,
    )
  }
}

/**
 * Resolve a bearer token for the GitHub REST calls: a short-lived GitHub App
 * installation token in prod, else the static `SITE_DISPATCH_TOKEN` (dev / CI /
 * back-compat). Throws a 500-class error when NEITHER is configured — the
 * publish/status must fail loudly, never silently skip the build trigger (which
 * would leave "promoted in CMS, build never started").
 */
export const getSiteDispatchToken = async (): Promise<string> => {
  const appCredentials = readAppCredentials()
  if (appCredentials) return mintInstallationToken(appCredentials)

  const token = (process.env.SITE_DISPATCH_TOKEN ?? '').trim()
  if (token) return token

  throw new SiteDispatchError(
    'No GitHub dispatch credentials configured — set the SITE_DISPATCH_APP_* GitHub App ' +
      'credentials (preferred in prod) or SITE_DISPATCH_TOKEN. Cannot trigger or read the ' +
      'public site build.',
    500,
  )
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
  const token = await getSiteDispatchToken()
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
  /** Completion time of the run (set once the run finishes). */
  updated_at?: string | null
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
 * (never a 500). Uses the SAME credentials (App installation token, needs
 * `actions:read`, or `SITE_DISPATCH_TOKEN`) and `SITE_DISPATCH_REPO` as the
 * dispatch — missing credentials fail loudly (500). Network failure → 502; any
 * non-2xx from GitHub → propagated as a 502-class `SiteDispatchError`. The token
 * is never logged.
 */
export const querySiteBuildStatus = async (): Promise<SiteBuildStatus> => {
  const token = await getSiteDispatchToken()
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

/**
 * Query the GitHub Actions API for the COMPLETION time of the latest SUCCESSFUL
 * `repository_dispatch` run on the site repo, or `null` when none has ever
 * succeeded. This is the "build-side truth" the drift indicator (#44) compares
 * against `siteBuildState.lastPublishedAt`: the site reflects a publish only once
 * a build started after it has COMPLETED successfully.
 *
 * The runs API `status` filter accepts a terminal conclusion, so
 * `status=success` returns only successfully-completed runs; `per_page=1` takes
 * the most recent. The completion time is `run.updated_at` (set when the run
 * finishes), falling back to `run_started_at`/`created_at`. Reuses the SAME
 * credentials (App installation token, needs `actions:read`, or
 * `SITE_DISPATCH_TOKEN`) and `SITE_DISPATCH_REPO` as the dispatch. Mirrors
 * {@link querySiteBuildStatus}'s error semantics: missing credentials fail loudly
 * (500); network failure → 502; any non-2xx → 502-class `SiteDispatchError`; an
 * empty list → `null` (NOT a throw). The token is never logged.
 */
export const queryLastSuccessfulBuild = async (): Promise<string | null> => {
  const token = await getSiteDispatchToken()
  const repo = resolveSiteRepo()

  let res: Response
  try {
    res = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs?event=repository_dispatch&status=success&per_page=1`,
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
      `Failed to reach GitHub to read the last successful site build: ${(err as Error).message}`,
      502,
    )
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new SiteDispatchError(
      `GitHub rejected the last-successful-build query (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
      502,
    )
  }

  const body = (await res.json().catch(() => ({}))) as GitHubRunsResponse
  const runs = body.workflow_runs ?? []

  // No successful run yet — return null (NOT a throw), so the drift indicator can
  // render "never built / not yet successful" rather than failing the panel.
  if ((body.total_count ?? runs.length) === 0 || runs.length === 0) {
    return null
  }

  const run = runs[0]
  return run.updated_at ?? run.run_started_at ?? run.created_at ?? null
}
