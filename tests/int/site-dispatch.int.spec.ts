import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/lib/siteDispatch.ts` — GitHub auth contract (#111).
 *
 * The publish (#15) and status (#16) endpoints share this helper to talk to the
 * site repo on api.github.com. #111 swaps the single static PAT for two modes,
 * App preferred:
 *
 *  1. GitHub App (PRODUCTION) — when SITE_DISPATCH_APP_ID /
 *     SITE_DISPATCH_APP_PRIVATE_KEY / SITE_DISPATCH_APP_INSTALLATION_ID are all
 *     set, a short-lived installation token is minted via @octokit/auth-app and
 *     sent as the bearer. No personal-account token in prod.
 *  2. Static token (dev / CI / back-compat) — falls back to SITE_DISPATCH_TOKEN
 *     when no App credentials are present.
 *  3. NEITHER configured → fail loudly (500), never a silent skip; a PARTIAL App
 *     config is a misconfiguration and also fails (500).
 *
 * This suite drives the lib functions directly (no Payload / DB), mocking both
 * `fetch` and `@octokit/auth-app`. Located under tests/int to share the dotenv
 * setup; it creates no rows and needs no database.
 */

// @octokit/auth-app is mocked: createAppAuth(opts) -> auth; auth({type:'installation'})
// -> { token }. Hoisted so the factory can reference the spies (vi.mock is hoisted).
const { createAppAuthMock, installationAuthMock } = vi.hoisted(() => {
  const installationAuthMock = vi.fn(async () => ({ token: 'app-installation-token' }))
  const createAppAuthMock = vi.fn(() => installationAuthMock)
  return { createAppAuthMock, installationAuthMock }
})
vi.mock('@octokit/auth-app', () => ({ createAppAuth: createAppAuthMock }))

import {
  dispatchSiteBuild,
  getSiteDispatchToken,
  querySiteBuildStatus,
} from '@/lib/siteDispatch'

const CANONICAL_REPO = 'bbm-academy-org/bbm-public-website'

// The env vars this helper reads — saved once and restored after every test so a
// dev .env (loaded by vitest.setup) never leaks into, or out of, a case.
const ENV_KEYS = [
  'SITE_DISPATCH_APP_ID',
  'SITE_DISPATCH_APP_PRIVATE_KEY',
  'SITE_DISPATCH_APP_INSTALLATION_ID',
  'SITE_DISPATCH_TOKEN',
  'SITE_DISPATCH_REPO',
] as const
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

// A 204 No Content — the GitHub repository_dispatch success contract.
const dispatchAccepted = () => ({ ok: true, status: 204, text: async () => '' }) as Response
// A GitHub `actions/runs` 200 with a single run.
const runsResponse = (run: Record<string, unknown>) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ total_count: 1, workflow_runs: [run] }),
    text: async () => '',
  }) as unknown as Response

// Read the Authorization header off the (single) recorded fetch call.
const authHeaderOf = (fetchMock: ReturnType<typeof vi.fn>): string => {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return (init.headers as Record<string, string>).Authorization
}

describe('siteDispatch GitHub auth (#111)', () => {
  beforeEach(() => {
    // Clean slate: every case opts in to exactly the credentials it needs. With
    // no SITE_DISPATCH_REPO set, resolveSiteRepo falls back to the canonical repo.
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key]
      else process.env[key] = ORIGINAL_ENV[key]
    }
  })

  it('mints a GitHub App installation token and dispatches with it', async () => {
    process.env.SITE_DISPATCH_APP_ID = '123456'
    // Single-line PEM with literal \n — must be expanded to real newlines.
    process.env.SITE_DISPATCH_APP_PRIVATE_KEY =
      '-----BEGIN RSA PRIVATE KEY-----\\nMIIabc\\n-----END RSA PRIVATE KEY-----'
    process.env.SITE_DISPATCH_APP_INSTALLATION_ID = 'inst-dispatch'

    const fetchMock = vi.fn().mockResolvedValue(dispatchAccepted())
    vi.stubGlobal('fetch', fetchMock)

    const result = await dispatchSiteBuild()

    // The bearer is the minted installation token, not any static value.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authHeaderOf(fetchMock)).toBe('Bearer app-installation-token')
    expect(result).toMatchObject({ event_type: 'publish-site', repo: CANONICAL_REPO })

    // The App was constructed with the credentials, and the PEM newlines expanded.
    expect(createAppAuthMock).toHaveBeenCalledTimes(1)
    expect(createAppAuthMock).toHaveBeenCalledWith({
      appId: '123456',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
      installationId: 'inst-dispatch',
    })
    expect(installationAuthMock).toHaveBeenCalledWith({ type: 'installation' })
  })

  it('reads build status with the App installation token', async () => {
    process.env.SITE_DISPATCH_APP_ID = '123456'
    process.env.SITE_DISPATCH_APP_PRIVATE_KEY = 'pem'
    process.env.SITE_DISPATCH_APP_INSTALLATION_ID = 'inst-status'

    const fetchMock = vi.fn().mockResolvedValue(
      runsResponse({
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/x/y/actions/runs/1',
        run_started_at: '2026-06-20T10:00:00Z',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const status = await querySiteBuildStatus()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authHeaderOf(fetchMock)).toBe('Bearer app-installation-token')
    expect(status.conclusion).toBe('success')
    expect(createAppAuthMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to SITE_DISPATCH_TOKEN when no App credentials are set', async () => {
    process.env.SITE_DISPATCH_TOKEN = 'static-pat'

    const fetchMock = vi.fn().mockResolvedValue(dispatchAccepted())
    vi.stubGlobal('fetch', fetchMock)

    await dispatchSiteBuild()

    expect(authHeaderOf(fetchMock)).toBe('Bearer static-pat')
    expect(createAppAuthMock).not.toHaveBeenCalled()
  })

  it('prefers the App over a static token when both are configured', async () => {
    process.env.SITE_DISPATCH_APP_ID = '123456'
    process.env.SITE_DISPATCH_APP_PRIVATE_KEY = 'pem'
    process.env.SITE_DISPATCH_APP_INSTALLATION_ID = 'inst-both'
    process.env.SITE_DISPATCH_TOKEN = 'static-pat-should-be-ignored'

    const fetchMock = vi.fn().mockResolvedValue(dispatchAccepted())
    vi.stubGlobal('fetch', fetchMock)

    await dispatchSiteBuild()

    expect(authHeaderOf(fetchMock)).toBe('Bearer app-installation-token')
    expect(createAppAuthMock).toHaveBeenCalledTimes(1)
  })

  it('reuses one @octokit/auth-app instance across calls with the same credentials', async () => {
    process.env.SITE_DISPATCH_APP_ID = '123456'
    process.env.SITE_DISPATCH_APP_PRIVATE_KEY = 'pem'
    process.env.SITE_DISPATCH_APP_INSTALLATION_ID = 'inst-cache'

    const fetchMock = vi.fn().mockResolvedValue(dispatchAccepted())
    vi.stubGlobal('fetch', fetchMock)

    await dispatchSiteBuild()
    await dispatchSiteBuild()

    // The App is memoised on the credential tuple: constructed once, while the
    // token mint repeats per call (octokit caches the actual token internally).
    // A regression that re-built the App on every poll would call it twice.
    expect(createAppAuthMock).toHaveBeenCalledTimes(1)
    expect(installationAuthMock).toHaveBeenCalledTimes(2)
  })

  it('returns the static token from getSiteDispatchToken directly', async () => {
    process.env.SITE_DISPATCH_TOKEN = 'static-pat'
    await expect(getSiteDispatchToken()).resolves.toBe('static-pat')
  })

  it('fails loudly (500) and never calls fetch when App credentials are partial', async () => {
    // App id present but key + installation id missing, and no static fallback.
    process.env.SITE_DISPATCH_APP_ID = '123456'

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(dispatchSiteBuild()).rejects.toMatchObject({
      name: 'SiteDispatchError',
      status: 500,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createAppAuthMock).not.toHaveBeenCalled()
  })

  it('fails loudly (500) and never calls fetch when no credentials at all', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(dispatchSiteBuild()).rejects.toMatchObject({
      name: 'SiteDispatchError',
      status: 500,
    })
    await expect(querySiteBuildStatus()).rejects.toMatchObject({
      name: 'SiteDispatchError',
      status: 500,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
