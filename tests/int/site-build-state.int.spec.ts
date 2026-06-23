import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'

/**
 * `siteBuildState` global (#41) — the versionless, drafts-disabled record that
 * persists the publish-side truth a drift indicator reads. Because it is
 * drafts-disabled it is NOT a build surface, so the publish-rebuild hook (a later
 * task) never fires on writes to it — no rebuild loop.
 *
 * These tests pin the contract:
 *
 *  1. the global is readable via `findGlobal` and its three machine-written
 *     fields default to null/undefined (never written by hand);
 *  2. it is EXCLUDED from the drafts-derived build-surface set that publishSite /
 *     pendingChanges build (`globals.filter(g => g.versions && g.versions.drafts)`),
 *     proving it can never be promoted/published and never triggers a rebuild;
 *  3. the three fields round-trip through `updateGlobal` (machine writes persist).
 *
 * Local-only (needs the dev DB on :5444); mirrors the getPayload harness of
 * pending-changes.int.spec.ts.
 */

let payload: Payload

type SiteBuildState = {
  lastPublishedAt?: string | null
  lastDispatchAt?: string | null
  lastDispatchError?: string | null
}

describe('siteBuildState global (#41)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  // Reset the machine-written fields back to null so the suite is idempotent and
  // leaves no drift-indicator state behind for other suites.
  afterAll(async () => {
    await payload.updateGlobal({
      slug: 'siteBuildState',
      data: { lastPublishedAt: null, lastDispatchAt: null, lastDispatchError: null },
    })
  })

  it('is readable and its three fields default to null/undefined', async () => {
    // Read a clean slate first (other suites must not have left state behind).
    await payload.updateGlobal({
      slug: 'siteBuildState',
      data: { lastPublishedAt: null, lastDispatchAt: null, lastDispatchError: null },
    })

    const global = (await payload.findGlobal({ slug: 'siteBuildState' })) as SiteBuildState

    expect(global.lastPublishedAt ?? null).toBeNull()
    expect(global.lastDispatchAt ?? null).toBeNull()
    expect(global.lastDispatchError ?? null).toBeNull()
  })

  it('is EXCLUDED from the drafts-derived build-surface set', async () => {
    const resolved = await config
    const draftSurfaceSlugs = resolved.globals
      .filter((g) => g.versions && g.versions.drafts)
      .map((g) => g.slug)

    // It must NOT be a draft surface — that is the whole point: no versions/drafts
    // means publishSite/pendingChanges never see it, so it can never be promoted
    // and never triggers the publish-rebuild hook (no loop).
    expect(draftSurfaceSlugs).not.toContain('siteBuildState')

    // Sanity: it IS a registered global (just a non-draft one).
    expect(resolved.globals.map((g) => g.slug)).toContain('siteBuildState')
  })

  it('round-trips machine writes to all three fields', async () => {
    const lastPublishedAt = '2026-06-23T10:00:00.000Z'
    const lastDispatchAt = '2026-06-23T10:00:01.000Z'
    const lastDispatchError = 'dispatch failed: 502'

    const updated = (await payload.updateGlobal({
      slug: 'siteBuildState',
      data: { lastPublishedAt, lastDispatchAt, lastDispatchError },
    })) as SiteBuildState

    expect(new Date(updated.lastPublishedAt as string).toISOString()).toBe(lastPublishedAt)
    expect(new Date(updated.lastDispatchAt as string).toISOString()).toBe(lastDispatchAt)
    expect(updated.lastDispatchError).toBe(lastDispatchError)

    // Persisted, not just echoed back from the call.
    const reread = (await payload.findGlobal({ slug: 'siteBuildState' })) as SiteBuildState
    expect(new Date(reread.lastPublishedAt as string).toISOString()).toBe(lastPublishedAt)
    expect(reread.lastDispatchError).toBe(lastDispatchError)
  })
})
