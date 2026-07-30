import { randomUUID } from 'crypto'

import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { siteBuildStatusHandler } from '@/endpoints/siteBuildStatus'

/**
 * `GET /api/site-build-status` (#16) — live build status for the admin UI.
 *
 * The endpoint proxies the GitHub Actions API for the LATEST `publish-site`
 * (`repository_dispatch`) run and returns `{ status, conclusion, html_url,
 * startedAt }`. These tests pin the contract (mirroring the #15 publish-site
 * suite — getPayload harness, `fetch` mocked, env saved/restored):
 *
 *  1. unauthenticated callers are rejected (403) and NOTHING is queried;
 *  2. a missing `SITE_DISPATCH_TOKEN` fails the request (500-class), never a
 *     silent skip;
 *  3. a returned run is mapped to the status payload correctly (incl. the
 *     `run_started_at` → `startedAt` rename and the GitHub query contract);
 *  4. an empty runs list ("no run yet") returns 200 with an all-null payload —
 *     never a 500.
 *
 * The GitHub API is mocked at `fetch`. Local-only (needs the dev DB to build a
 * real Payload via the getPayload harness).
 */

let payload: Payload

const ORIGINAL_TOKEN = process.env.SITE_DISPATCH_TOKEN
const ORIGINAL_REPO = process.env.SITE_DISPATCH_REPO

// #111 added a GitHub App auth path (preferred over the static token). This suite
// pins the STATIC-token path, so null any App credentials a dev .env might carry
// — otherwise the helper would prefer the App and ignore SITE_DISPATCH_TOKEN.
// Saved here and restored in afterEach.
const APP_ENV_KEYS = [
  'SITE_DISPATCH_APP_ID',
  'SITE_DISPATCH_APP_PRIVATE_KEY',
  'SITE_DISPATCH_APP_INSTALLATION_ID',
] as const
const ORIGINAL_APP_ENV = Object.fromEntries(APP_ENV_KEYS.map((k) => [k, process.env[k]]))

// A GitHub `actions/runs` 200 with a single run.
const runsResponse = (run: Record<string, unknown>) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ total_count: 1, workflow_runs: [run] }),
    text: async () => '',
  }) as unknown as Response

// A GitHub `actions/runs` 200 with no runs at all ("no run yet").
const emptyRunsResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ total_count: 0, workflow_runs: [] }),
    text: async () => '',
  }) as unknown as Response

// Build the minimal PayloadRequest the handler reads: `user` (auth gate) and
// `payload` (only for `logger` on the error path). Mirrors how Payload invokes a
// custom endpoint handler with an authenticated request.
const reqWith = (user: unknown): PayloadRequest => ({ user, payload }) as unknown as PayloadRequest

describe('GET /api/site-build-status (#16)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  beforeEach(() => {
    process.env.SITE_DISPATCH_TOKEN = 'test-token'
    process.env.SITE_DISPATCH_REPO = 'bbm-academy-org/bbm-public-website'
    for (const key of APP_ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (ORIGINAL_TOKEN === undefined) delete process.env.SITE_DISPATCH_TOKEN
    else process.env.SITE_DISPATCH_TOKEN = ORIGINAL_TOKEN
    if (ORIGINAL_REPO === undefined) delete process.env.SITE_DISPATCH_REPO
    else process.env.SITE_DISPATCH_REPO = ORIGINAL_REPO
    for (const key of APP_ENV_KEYS) {
      if (ORIGINAL_APP_ENV[key] === undefined) delete process.env[key]
      else process.env[key] = ORIGINAL_APP_ENV[key]
    }
  })

  afterAll(async () => {
    // This suite creates no DB rows, so there is nothing to clean up. (Left as a
    // hook to mirror the sibling suites' structure.)
  })

  it('rejects an unauthenticated caller with 403 and never queries GitHub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteBuildStatusHandler(reqWith(undefined))

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails the request when SITE_DISPATCH_TOKEN is missing (no silent skip)', async () => {
    delete process.env.SITE_DISPATCH_TOKEN
    const fetchMock = vi.fn().mockResolvedValue(emptyRunsResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteBuildStatusHandler(reqWith({ id: 'admin' }))

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps the latest run to the status payload and queries GitHub correctly', async () => {
    // Unique values so a passing assertion can only mean THIS run was mapped.
    const htmlUrl = `https://github.com/bbm-academy-org/bbm-public-website/actions/runs/${randomUUID()}`
    const startedAt = '2026-06-18T10:00:00Z'

    const fetchMock = vi.fn().mockResolvedValue(
      runsResponse({
        status: 'completed',
        conclusion: 'success',
        html_url: htmlUrl,
        run_started_at: startedAt,
        created_at: '2026-06-18T09:59:00Z',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteBuildStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)

    // Queried the runs API at the right repo, filtered to repository_dispatch,
    // one result, with the right auth + accept headers.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.github.com/repos/bbm-academy-org/bbm-public-website/actions/runs?event=repository_dispatch&per_page=1',
    )
    expect((init.method ?? 'GET').toUpperCase()).toBe('GET')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(headers.Accept).toBe('application/vnd.github+json')

    // Mapped run → status payload (run_started_at → startedAt).
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      status: 'completed',
      conclusion: 'success',
      html_url: htmlUrl,
      startedAt,
    })
  })

  it('falls back to created_at when run_started_at is absent', async () => {
    const createdAt = '2026-06-18T08:00:00Z'
    const fetchMock = vi.fn().mockResolvedValue(
      runsResponse({
        status: 'in_progress',
        conclusion: null,
        html_url: 'https://github.com/x/y/actions/runs/1',
        created_at: createdAt,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteBuildStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.startedAt).toBe(createdAt)
    expect(body.conclusion).toBeNull()
  })

  it('returns an all-null payload (200) when no build has run yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyRunsResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteBuildStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      status: null,
      conclusion: null,
      html_url: null,
      startedAt: null,
    })
  })

  it('propagates a non-2xx from GitHub as an error (not a 200)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'upstream down',
      json: async () => ({}),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteBuildStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
