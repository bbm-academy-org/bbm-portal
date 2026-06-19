import { randomUUID } from 'crypto'

import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { publishSiteHandler } from '@/endpoints/publishSite'

/**
 * `POST /api/publish-site` (#15) — one-click publish.
 *
 * The endpoint promotes pending drafts → published on the six build surfaces
 * (the `pages` / `publicProjects` / `team` collections and the `contact` /
 * `philosophy` / `siteChrome` globals, all drafts-enabled by #14) and then
 * fires a `repository_dispatch` (`event_type: "publish-site"`) at the public
 * site repo so its GitHub Actions build runs. These tests pin the contract:
 *
 *  1. unauthenticated callers are rejected (403) and NOTHING is dispatched;
 *  2. a missing `SITE_DISPATCH_TOKEN` fails the request (500-class), never a
 *     silent skip;
 *  3. on success drafts are promoted AND the dispatch is sent with the correct
 *     repo, event_type and auth headers, and the response lists what shipped;
 *  4. ORDERING INVARIANT — if the dispatch fails, the promotes are rolled back
 *     (the surface stays a draft): we never end "promoted in CMS, build never
 *     started".
 *
 * The GitHub API is mocked at `fetch`. Local-only (needs the dev DB); mirrors
 * the getPayload harness of the other int suites.
 */

let payload: Payload

// Team members this suite creates, tracked so afterAll deletes EXACTLY these
// rows (never an unanchored `like` that could match seeded build-surface data).
const createdTeamIds: string[] = []

const ORIGINAL_TOKEN = process.env.SITE_DISPATCH_TOKEN
const ORIGINAL_REPO = process.env.SITE_DISPATCH_REPO

// A 204 No Content — the GitHub repository_dispatch success contract.
const dispatchAccepted = () => ({ ok: true, status: 204, text: async () => '' }) as Response
// A 4xx/5xx the handler must treat as a failed dispatch.
const dispatchRejected = (status = 500) =>
  ({ ok: false, status, text: async () => 'boom' }) as Response

// Build the minimal PayloadRequest the handler reads: `user` (auth gate) and
// `payload` (local API + transactions). Mirrors how Payload invokes a custom
// endpoint handler with an authenticated request.
const reqWith = (user: unknown): PayloadRequest =>
  ({ user, payload } as unknown as PayloadRequest)

// Create a team member (a row on the drafts-enabled `team` build surface) with a
// unique id, tracking it for cleanup. Returns the created id.
const createTeamMember = async (): Promise<string> => {
  const id = `t-${randomUUID()}`
  await payload.create({
    collection: 'team',
    data: { id, name: 'Test Member' },
    draft: true,
  })
  createdTeamIds.push(id)
  return id
}

// Stage a pending draft change on the `team` collection without publishing it,
// so a later publish has something to promote. Returns the unique staged role
// token so the caller can assert the published doc carries EXACTLY this value.
const stageTeamDraft = async (id: string): Promise<string> => {
  const token = `pending-${randomUUID()}`
  await payload.update({
    collection: 'team',
    id,
    data: { role: token },
    draft: true, // write to the draft, do NOT publish
  })
  return token
}

describe('POST /api/publish-site (#15)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    // Seed the drafts-enabled globals with valid PUBLISHED content so the build
    // surfaces are in a realistic, publishable state (production seeds them).
    // Otherwise an empty, never-populated global with required fields would fail
    // publish validation — a fixture gap, not the behaviour under test.
    await payload.updateGlobal({
      slug: 'contact',
      data: { email: 'hello@bbm.academy', _status: 'published' },
    })
    await payload.updateGlobal({
      slug: 'philosophy',
      data: { _status: 'published' },
    })
    await payload.updateGlobal({
      slug: 'siteChrome',
      data: { _status: 'published' },
    })
  })

  beforeEach(() => {
    process.env.SITE_DISPATCH_TOKEN = 'test-token'
    process.env.SITE_DISPATCH_REPO = 'bbm-academy-org/bbm-public-website'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (ORIGINAL_TOKEN === undefined) delete process.env.SITE_DISPATCH_TOKEN
    else process.env.SITE_DISPATCH_TOKEN = ORIGINAL_TOKEN
    if (ORIGINAL_REPO === undefined) delete process.env.SITE_DISPATCH_REPO
    else process.env.SITE_DISPATCH_REPO = ORIGINAL_REPO
  })

  // Clean up ONLY the exact team members this suite created (collected ids). The
  // `team` collection holds shared seeded build-surface content that other
  // suites (content-parity) read, so cleanup deletes by id `in [...]` — never an
  // unanchored `like` that could match seeded rows.
  afterAll(async () => {
    if (createdTeamIds.length > 0) {
      await payload.delete({ collection: 'team', where: { id: { in: createdTeamIds } } })
    }
  })

  it('rejects an unauthenticated caller with 403 and never dispatches', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await publishSiteHandler(reqWith(undefined))

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails the request when SITE_DISPATCH_TOKEN is missing (no silent skip)', async () => {
    delete process.env.SITE_DISPATCH_TOKEN
    const fetchMock = vi.fn().mockResolvedValue(dispatchAccepted())
    vi.stubGlobal('fetch', fetchMock)

    const res = await publishSiteHandler(reqWith({ id: 'admin' }))

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('promotes drafts and dispatches with the correct repo, event_type and auth', async () => {
    const memberId = await createTeamMember()
    const token = await stageTeamDraft(memberId)

    // Pre-condition: the PUBLISHED row must NOT already carry the staged token,
    // so a passing post-assertion can only mean THIS publish committed it (a
    // no-op promote would leave the published role unequal to the token).
    const before = await payload.findByID({ collection: 'team', id: memberId, draft: false })
    expect(before.role).not.toBe(token)

    const fetchMock = vi.fn().mockResolvedValue(dispatchAccepted())
    vi.stubGlobal('fetch', fetchMock)

    const res = await publishSiteHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      published: Array<{ surface: string; ids: unknown[] }>
      dispatch: { event_type: string; repo: string; at: string }
    }

    // Dispatch fired exactly once, at the right repo, with the right contract.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/bbm-academy-org/bbm-public-website/dispatches')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({ event_type: 'publish-site' })
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(headers.Accept).toBe('application/vnd.github+json')

    // Response reports what shipped + a build reference (no fabricated run id).
    expect(body.dispatch).toMatchObject({
      event_type: 'publish-site',
      repo: 'bbm-academy-org/bbm-public-website',
    })
    expect(typeof body.dispatch.at).toBe('string')

    // The surface set is config-derived (every collection/global with drafts):
    // post-#18 that is the publicProjects/team collections + the 3 site globals
    // + the 6 per-page globals, in config-declaration order (deterministic).
    // `pages` is gone — #18 retired the collection in favour of the page globals.
    expect(body.published.map((p) => p.surface)).toEqual([
      'publicProjects',
      'team',
      'philosophy',
      'contact',
      'siteChrome',
      'pageHome',
      'pageAbout',
      'pageContacts',
      'pageParticipate',
      'pagePrivacy',
      'pageProjects',
    ])

    const team = body.published.find((p) => p.surface === 'team')
    expect(team?.ids).toContain(memberId)

    // The promote was COMMITTED by this publish: the published row (draft:false)
    // now equals EXACTLY the token staged above — proving this change shipped,
    // not merely that some prior `pending-` value existed.
    const published = await payload.findByID({ collection: 'team', id: memberId, draft: false })
    expect(published.role).toBe(token)
  })

  it('rolls back the promote when the dispatch fails (ordering invariant)', async () => {
    const memberId = await createTeamMember()
    await stageTeamDraft(memberId)

    // Snapshot the currently-published role (before the staged draft).
    const before = await payload.findByID({
      collection: 'team',
      id: memberId,
      draft: false,
    })

    const fetchMock = vi.fn().mockResolvedValue(dispatchRejected(500))
    vi.stubGlobal('fetch', fetchMock)

    const res = await publishSiteHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The promote was rolled back: the published doc is UNCHANGED — it does not
    // carry the staged draft role, so the build would have had nothing stale.
    const after = await payload.findByID({
      collection: 'team',
      id: memberId,
      draft: false,
    })
    expect(after.role).toBe(before.role)
  })
})
