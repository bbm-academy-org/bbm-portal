import { randomUUID } from 'crypto'

import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { siteSyncStatusHandler } from '@/endpoints/siteSyncStatus'
import { pendingChangesHandler } from '@/endpoints/pendingChanges'

/**
 * `GET /api/site-sync-status` (#44, #52) — one consolidated drift read.
 *
 * A single endpoint that powers the whole publish admin panel so the UI is always
 * current with one fetch. It joins three sources:
 *
 *  - `pendingCount` — drafts-derived count (latest version === 'draft'), the SAME
 *    number `/api/pending-changes` reports;
 *  - `lastPublishedAt` — from the `siteBuildState` global (the publish-side TRUTH);
 *  - `lastSuccessfulBuildAt` + `currentRun` — read off the GitHub Actions API.
 *
 * From those it derives ONE authoritative `syncState` enum
 * (`'in-sync' | 'building' | 'failed'`) by precedence (#52, replacing the old
 * overloaded `inSync`/`building` booleans):
 *
 *  1. never published, OR last successful build >= last publish        → in-sync
 *  2. current run queued / in_progress                                 → building
 *  3. current run failed AND its startedAt >= last publish             → failed
 *  4. else (published, no successful build yet, no failed run for it)  → building
 *
 * Step 4 is the registration gap: just published, build dispatched, run not yet
 * visible — normal/transient, NOT a failure. Step 3's `startedAt >= lastPublishedAt`
 * scopes failure to THIS publish, so re-publishing over an older failed run shows
 * building (the new run is pending), not a stale red.
 *
 * These tests pin the contract (mirroring the #16 site-build-status suite —
 * getPayload harness, `fetch` mocked, env saved/restored). The GitHub API is
 * mocked at `fetch`; two GET calls are made (current run, then last successful
 * build), so the mock is sequenced. Local-only (needs the dev DB).
 */

let payload: Payload

const ORIGINAL_TOKEN = process.env.SITE_DISPATCH_TOKEN
const ORIGINAL_REPO = process.env.SITE_DISPATCH_REPO

// #111 added a GitHub App auth path (preferred over the static token). This suite
// pins the STATIC-token path, so null any App credentials a dev .env might carry.
const APP_ENV_KEYS = [
  'SITE_DISPATCH_APP_ID',
  'SITE_DISPATCH_APP_PRIVATE_KEY',
  'SITE_DISPATCH_APP_INSTALLATION_ID',
] as const
const ORIGINAL_APP_ENV = Object.fromEntries(APP_ENV_KEYS.map((k) => [k, process.env[k]]))

// Team members this suite creates, tracked so afterAll deletes EXACTLY these rows.
const createdTeamIds: string[] = []

// A GitHub `actions/runs` 200 with a single run.
const runsResponse = (run: Record<string, unknown>) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ total_count: 1, workflow_runs: [run] }),
    text: async () => '',
  }) as unknown as Response

// A GitHub `actions/runs` 200 with no runs at all.
const emptyRunsResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ total_count: 0, workflow_runs: [] }),
    text: async () => '',
  }) as unknown as Response

// The handler queries GitHub twice: querySiteBuildStatus (current run) then
// queryLastSuccessfulBuild. This mock answers the calls in order by URL so the
// test does not depend on call ordering being incidental.
const sequencedFetch = (opts: { current: Response; success: Response }) =>
  vi.fn(async (url: string) => {
    if (url.includes('status=success')) return opts.success
    return opts.current
  })

// Build the minimal PayloadRequest the handler reads: `user` (auth gate) and
// `payload` (local API + logger).
const reqWith = (user: unknown): PayloadRequest => ({ user, payload }) as unknown as PayloadRequest

type SyncBody = {
  pendingCount: number
  lastPublishedAt: string | null
  lastSuccessfulBuildAt: string | null
  currentRun: {
    status: string | null
    conclusion: string | null
    html_url: string | null
    startedAt: string | null
  } | null
  syncState: 'in-sync' | 'building' | 'failed'
}

// Stamp `siteBuildState.lastPublishedAt` to a fixed time (the publish-side truth).
// Relies on serial file execution (vitest.config `fileParallelism: false`, #48):
// `siteBuildState` is a singleton global, so a concurrent suite restamping it
// between this set and the handler's read makes the readback order-dependent.
const setLastPublishedAt = async (at: string | null): Promise<void> => {
  await payload.updateGlobal({ slug: 'siteBuildState', data: { lastPublishedAt: at } })
}

// Create a team member, tracking it for cleanup. Returns the created id.
const createTeamMember = async (): Promise<string> => {
  const id = `t-${randomUUID()}`
  await payload.create({ collection: 'team', data: { id, name: 'Test Member' }, draft: true })
  createdTeamIds.push(id)
  return id
}

// Stage a pending draft change WITHOUT publishing, so latest version is a draft.
const stageTeamDraft = async (id: string): Promise<void> => {
  await payload.update({
    collection: 'team',
    id,
    data: { name: `pending-${randomUUID()}` },
    draft: true,
  })
}

describe('GET /api/site-sync-status (#44, #52)', () => {
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
    if (createdTeamIds.length > 0) {
      await payload.delete({ collection: 'team', where: { id: { in: createdTeamIds } } })
    }
  })

  it('rejects an unauthenticated caller with 403 and never queries GitHub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith(undefined))

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // --- syncState matrix (#52) -------------------------------------------------

  it('syncState=in-sync when the last successful build is at-or-after the last publish', async () => {
    await setLastPublishedAt('2026-06-20T10:00:00.000Z')

    const successRun = runsResponse({
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/x/y/actions/runs/1',
      run_started_at: '2026-06-20T11:00:00Z',
      updated_at: '2026-06-20T11:05:00Z',
    })
    const fetchMock = sequencedFetch({ current: successRun, success: successRun })
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SyncBody

    expect(body.lastPublishedAt).toBe('2026-06-20T10:00:00.000Z')
    expect(body.lastSuccessfulBuildAt).toBe('2026-06-20T11:05:00Z')
    expect(body.syncState).toBe('in-sync')
  })

  it('syncState=in-sync when nothing has ever been published (lastPublishedAt null)', async () => {
    await setLastPublishedAt(null)

    const fetchMock = sequencedFetch({
      current: emptyRunsResponse(),
      success: emptyRunsResponse(),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SyncBody

    expect(body.lastPublishedAt).toBeNull()
    expect(body.lastSuccessfulBuildAt).toBeNull()
    expect(body.currentRun).toBeNull()
    expect(body.syncState).toBe('in-sync')
  })

  it('syncState=building when the current run is queued or in_progress', async () => {
    await setLastPublishedAt('2026-06-20T12:00:00.000Z')

    const fetchMock = sequencedFetch({
      current: runsResponse({
        status: 'in_progress',
        conclusion: null,
        html_url: 'https://github.com/x/y/actions/runs/3',
        run_started_at: '2026-06-20T12:01:00Z',
      }),
      // The last SUCCESSFUL build is an older completed run.
      success: runsResponse({
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/x/y/actions/runs/2',
        run_started_at: '2026-06-20T09:00:00Z',
        updated_at: '2026-06-20T09:05:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SyncBody

    expect(body.syncState).toBe('building')
    expect(body.currentRun?.status).toBe('in_progress')
  })

  it('syncState=building when published but NO run is visible yet (registration gap — #52 bug)', async () => {
    // The bug: publishSite stamps lastPublishedAt only after a 204 dispatch, so a
    // build IS in flight; GitHub just hasn't registered the run yet. Published >
    // built with no run must read as building, NOT a failure (the red flash).
    await setLastPublishedAt('2026-06-20T12:00:00.000Z')

    const fetchMock = sequencedFetch({
      current: emptyRunsResponse(),
      success: emptyRunsResponse(),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SyncBody

    expect(body.currentRun).toBeNull()
    expect(body.lastSuccessfulBuildAt).toBeNull()
    expect(body.syncState).toBe('building')
  })

  it('syncState=failed when a run failed AND its startedAt >= lastPublishedAt (this publish)', async () => {
    const publishedAt = '2026-06-20T12:00:00.000Z'
    await setLastPublishedAt(publishedAt)

    const fetchMock = sequencedFetch({
      // Current run is a terminal failure that started after this publish.
      current: runsResponse({
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/x/y/actions/runs/4',
        run_started_at: '2026-06-20T12:01:00Z',
        updated_at: '2026-06-20T12:05:00Z',
      }),
      // No successful build at-or-after the publish.
      success: runsResponse({
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/x/y/actions/runs/2',
        run_started_at: '2026-06-20T09:00:00Z',
        updated_at: '2026-06-20T09:05:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SyncBody

    expect(body.currentRun?.conclusion).toBe('failure')
    expect(body.syncState).toBe('failed')
  })

  it('syncState=building (not failed) when a failed run STARTED BEFORE the latest publish', async () => {
    // Re-published over an older failed run: the old failure's startedAt is before
    // the new lastPublishedAt, and the new run is not visible yet. This is the
    // registration gap for the new publish, NOT a stale failure → building.
    const publishedAt = '2026-06-20T14:00:00.000Z'
    await setLastPublishedAt(publishedAt)

    const fetchMock = sequencedFetch({
      // The current run is an OLD failure (started before the new publish).
      current: runsResponse({
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/x/y/actions/runs/4',
        run_started_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-20T10:05:00Z',
      }),
      // No successful build at-or-after the publish.
      success: runsResponse({
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/x/y/actions/runs/2',
        run_started_at: '2026-06-20T09:00:00Z',
        updated_at: '2026-06-20T09:05:00Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SyncBody

    expect(body.currentRun?.conclusion).toBe('failure')
    expect(body.syncState).toBe('building')
  })

  // --- shared contract --------------------------------------------------------

  it('reports the same pendingCount as /api/pending-changes for the same DB state', async () => {
    const memberId = await createTeamMember()
    await stageTeamDraft(memberId)

    const fetchMock = sequencedFetch({
      current: emptyRunsResponse(),
      success: emptyRunsResponse(),
    })
    vi.stubGlobal('fetch', fetchMock)

    const syncRes = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    const syncBody = (await syncRes.json()) as SyncBody

    const pendingRes = await pendingChangesHandler(reqWith({ id: 'admin' }))
    const pendingBody = (await pendingRes.json()) as { count: number }

    // Relies on serial file execution (vitest.config `fileParallelism: false`,
    // #48): this compares two separate global count reads, which a concurrent
    // suite staging/publishing a draft between them would perturb.
    expect(syncBody.pendingCount).toBe(pendingBody.count)
    expect(syncBody.pendingCount).toBeGreaterThan(0)
  })

  it('returns a well-formed 200 with nulls (not 500) when there is no run / no success', async () => {
    await setLastPublishedAt('2026-06-20T12:00:00.000Z')

    const fetchMock = sequencedFetch({
      current: emptyRunsResponse(),
      success: emptyRunsResponse(),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SyncBody

    expect(body.currentRun).toBeNull()
    expect(body.lastSuccessfulBuildAt).toBeNull()
    // Published, no successful build, no failed run for this publish → the
    // dispatched run is not yet visible (registration gap) → building, never 500.
    expect(body.syncState).toBe('building')
  })

  it('fails with 500 when GitHub credentials are missing (no silent skip)', async () => {
    delete process.env.SITE_DISPATCH_TOKEN
    const fetchMock = vi.fn().mockResolvedValue(emptyRunsResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))

    expect(res.status).toBe(500)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates a GitHub 5xx as a 502-class error (not a 200)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'upstream down',
      json: async () => ({}),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(502)
  })

  it('propagates a GitHub network failure as a 502-class error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await siteSyncStatusHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(502)
  })
})
