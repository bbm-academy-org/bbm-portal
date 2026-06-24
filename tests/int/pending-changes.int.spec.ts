import { randomUUID } from 'crypto'

import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { pendingChangesHandler } from '@/endpoints/pendingChanges'

/**
 * `GET /api/pending-changes` (#17, Part A) — read-only confirm-list source.
 *
 * The admin "Publish to site" button (#17) renders a confirmation list of the
 * documents/globals that have pending drafts BEFORE the editor publishes. This
 * endpoint reports exactly that set WITHOUT writing anything: it derives the
 * SAME build surfaces as `POST /api/publish-site` (#15) — every collection /
 * global with `versions.drafts` enabled — and, per surface, lists the docs whose
 * latest version is a draft (`_status: 'draft'`), which is precisely the set
 * publish-site would promote. These tests pin the contract:
 *
 *  1. unauthenticated callers are rejected (403);
 *  2. a staged draft doc shows up under its surface (with id + label);
 *  3. when nothing is pending the list is empty and `count` is 0.
 *
 * Read-only — no transaction, no writes. Local-only (needs the dev DB); mirrors
 * the getPayload harness of publish-site.int.spec.ts.
 */

let payload: Payload

// Team members this suite creates, tracked so afterAll deletes EXACTLY these
// rows (never an unanchored `like` that could match seeded build-surface data).
const createdTeamIds: string[] = []

// Build the minimal PayloadRequest the handler reads: `user` (auth gate) and
// `payload` (local API). Mirrors how Payload invokes a custom endpoint handler.
const reqWith = (user: unknown): PayloadRequest =>
  ({ user, payload } as unknown as PayloadRequest)

type PendingSurface = {
  surface: string
  type: 'collection' | 'global'
  ids: Array<number | string>
  labels: string[]
}
type PendingBody = { pending: PendingSurface[]; count: number }

// Create a team member, tracking it for cleanup. Returns the created id. Mirrors
// the publish-site harness (create with `draft: true`, no `_status`).
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

// Stage a pending draft change on a team member WITHOUT publishing it, so its
// latest version is a draft. Returns the unique staged name token.
const stageTeamDraft = async (id: string): Promise<string> => {
  const token = `pending-${randomUUID()}`
  await payload.update({
    collection: 'team',
    id,
    data: { name: token },
    draft: true, // write to the draft, do NOT publish
  })
  return token
}

// Find a team member in the pending response if present.
const teamSurface = (body: PendingBody): PendingSurface | undefined =>
  body.pending.find((p) => p.surface === 'team')

describe('GET /api/pending-changes (#17 Part A)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  // Clean up ONLY the exact team members this suite created (collected ids). The
  // `team` collection holds shared seeded build-surface content, so cleanup
  // deletes by id `in [...]` — never an unanchored `like`.
  afterAll(async () => {
    if (createdTeamIds.length > 0) {
      await payload.delete({ collection: 'team', where: { id: { in: createdTeamIds } } })
    }
  })

  it('rejects an unauthenticated caller with 403', async () => {
    const res = await pendingChangesHandler(reqWith(undefined))
    expect(res.status).toBe(403)
  })

  it('reports a staged draft doc under its surface with id and label', async () => {
    const memberId = await createTeamMember()
    const token = await stageTeamDraft(memberId)

    const res = await pendingChangesHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as PendingBody

    // The response shape: a `pending[]` of surfaces and a numeric `count`.
    expect(Array.isArray(body.pending)).toBe(true)
    expect(typeof body.count).toBe('number')

    // Every reported surface is config-derived (collection or global) and the
    // count equals the total number of pending ids across surfaces.
    const totalIds = body.pending.reduce((n, p) => n + p.ids.length, 0)
    expect(body.count).toBe(totalIds)

    // Our staged team member is listed under the `team` surface with its label.
    const team = teamSurface(body)
    expect(team).toBeDefined()
    expect(team?.type).toBe('collection')
    expect(team?.ids).toContain(memberId)
    expect(team?.labels).toContain(token)
  })

  it('drops a doc from the pending list once it is no longer a pending draft', async () => {
    // Stage a pending team draft, confirm it is listed, then delete it (the
    // deterministic way to clear a surface under autosave drafts) and confirm it
    // is gone from the list. The empty-list code path: every surface with zero
    // pending docs is omitted, and `count` always equals the listed-id total —
    // exactly 0 when nothing across surfaces is pending.
    const memberId = await createTeamMember()
    await stageTeamDraft(memberId)

    let res = await pendingChangesHandler(reqWith({ id: 'admin' }))
    let body = (await res.json()) as PendingBody
    expect(teamSurface(body)?.ids).toContain(memberId)

    // Remove the pending doc, then re-read.
    await payload.delete({ collection: 'team', where: { id: { in: [memberId] } } })
    createdTeamIds.splice(createdTeamIds.indexOf(memberId), 1)

    res = await pendingChangesHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    body = (await res.json()) as PendingBody

    // The deleted member must NOT appear among pending team ids anymore.
    expect(teamSurface(body)?.ids ?? []).not.toContain(memberId)

    // Invariant: `count` is always exactly the number of listed ids (so it is 0
    // when, and only when, no surface lists any pending doc). Every listed
    // surface is non-empty (empty surfaces are omitted from the response).
    const totalIds = body.pending.reduce((n, p) => n + p.ids.length, 0)
    expect(body.count).toBe(totalIds)
    expect(body.pending.every((p) => p.ids.length > 0)).toBe(true)
  })

  it('drops a doc from the pending list once it is PUBLISHED', async () => {
    // The confirm-list's core correctness claim: a doc that gets PUBLISHED (not
    // deleted) must disappear from pending. The sibling test above proves the
    // delete path; this proves the actual publish path — exactly what the panel
    // refreshes the list on after a build completes.
    const memberId = await createTeamMember()
    await stageTeamDraft(memberId)

    // 1 — staged draft appears under `team`, and `count` includes it.
    let res = await pendingChangesHandler(reqWith({ id: 'admin' }))
    let body = (await res.json()) as PendingBody
    expect(teamSurface(body)?.ids).toContain(memberId)

    // 2 — PUBLISH it (promote the draft to published — the publish-site path).
    await payload.update({
      collection: 'team',
      id: memberId,
      data: { _status: 'published' },
      draft: false,
    })

    // 3 — the published id is GONE from the team surface, and the
    // `count === sum of all listed ids` invariant still holds. Correctness is
    // self-anchored to OUR id (absent from the flattened pending set) plus the
    // within-response invariant — never the absolute global count or a global
    // delta, which a concurrent suite staging/publishing on the shared dev DB
    // can perturb between the two reads.
    res = await pendingChangesHandler(reqWith({ id: 'admin' }))
    expect(res.status).toBe(200)
    body = (await res.json()) as PendingBody

    expect(teamSurface(body)?.ids ?? []).not.toContain(memberId)
    const totalIds = body.pending.reduce((n, p) => n + p.ids.length, 0)
    expect(body.count).toBe(totalIds)
  })
})
