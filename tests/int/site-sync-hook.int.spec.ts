import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/lib/siteSync.ts` — the publish-rebuild `afterChange` hook (#42).
 *
 * The idiomatic Payload "publish hook → downstream deploy hook": a native in-page
 * "Publish changes" both publishes AND triggers a whole-site rebuild. The shared
 * core `maybeRebuildOnPublish` fires a rebuild iff ALL THREE hold:
 *
 *  1. `doc._status === 'published'`, AND
 *  2. `previousDoc?._status !== 'published'` (a REAL draft→published transition —
 *     never a re-save of already-published content), AND
 *  3. `context?.skipSiteDispatch !== true` (lets the batch endpoint suppress it).
 *
 * When triggered it stamps `siteBuildState.lastPublishedAt`, then fires
 * `dispatchSiteBuild()` BEST-EFFORT: a dispatch failure logs + records
 * `lastDispatchError` and is swallowed — it must NEVER fail or roll back the
 * publish (the publish already happened; the drift indicator + manual rebuild are
 * the safety net).
 *
 * Behaviours 1-4 drive the core directly with a constructed `req`/`payload` stub
 * and a mocked `dispatchSiteBuild` (no DB). Behaviour 5 (the registration guard)
 * walks the real sanitized config. Located under tests/int to share the dotenv
 * setup; it creates no rows.
 */

// `dispatchSiteBuild` is mocked so we can assert call count + drive failures
// without touching GitHub. Hoisted so the vi.mock factory can reference the spy.
const { dispatchSiteBuildMock } = vi.hoisted(() => ({
  dispatchSiteBuildMock: vi.fn(async () => ({
    event_type: 'publish-site',
    repo: 'bbm-academy-org/bbm-public-website',
    at: '2026-06-23T10:00:00.000Z',
  })),
}))
vi.mock('@/lib/siteDispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/siteDispatch')>()
  return { ...actual, dispatchSiteBuild: dispatchSiteBuildMock }
})

import { SiteDispatchError } from '@/lib/siteDispatch'
import {
  maybeRebuildOnPublish,
  siteRebuildCollectionAfterChange,
  siteRebuildGlobalAfterChange,
} from '@/lib/siteSync'
import config from '@/payload.config'

/**
 * A minimal `req` carrying a `payload` stub: `updateGlobal` records the
 * `siteBuildState` writes, and `logger.error` is a spy. No DB involved.
 */
const makeReq = () => {
  const updateGlobal = vi.fn(async () => ({}))
  const error = vi.fn()
  return {
    req: { payload: { updateGlobal, logger: { error } } } as never,
    updateGlobal,
    error,
  }
}

/** The `siteBuildState` data written by the recorded `updateGlobal` calls. */
const buildStateWrites = (updateGlobal: ReturnType<typeof vi.fn>) =>
  updateGlobal.mock.calls
    .filter(([arg]) => (arg as { slug: string }).slug === 'siteBuildState')
    .map(([arg]) => (arg as { data: Record<string, unknown> }).data)

describe('maybeRebuildOnPublish core (#42)', () => {
  beforeEach(() => {
    dispatchSiteBuildMock.mockResolvedValue({
      event_type: 'publish-site',
      repo: 'bbm-academy-org/bbm-public-website',
      at: '2026-06-23T10:00:00.000Z',
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('fires a rebuild and stamps lastPublishedAt on a real draft→published transition', async () => {
    const { req, updateGlobal } = makeReq()

    await maybeRebuildOnPublish({
      doc: { _status: 'published' },
      previousDoc: { _status: 'draft' },
      req,
      context: {},
    })

    expect(dispatchSiteBuildMock).toHaveBeenCalledTimes(1)

    const writes = buildStateWrites(updateGlobal)
    // lastPublishedAt is stamped on publish; lastDispatchAt on dispatch success.
    expect(writes.some((d) => d.lastPublishedAt instanceof Date)).toBe(true)
    expect(writes.some((d) => d.lastDispatchAt instanceof Date)).toBe(true)
  })

  it('does NOT dispatch on a re-save of already-published content', async () => {
    const { req, updateGlobal } = makeReq()

    await maybeRebuildOnPublish({
      doc: { _status: 'published' },
      previousDoc: { _status: 'published' },
      req,
      context: {},
    })

    expect(dispatchSiteBuildMock).not.toHaveBeenCalled()
    expect(buildStateWrites(updateGlobal)).toHaveLength(0)
  })

  it('does NOT dispatch when context.skipSiteDispatch === true', async () => {
    const { req, updateGlobal } = makeReq()

    await maybeRebuildOnPublish({
      doc: { _status: 'published' },
      previousDoc: { _status: 'draft' },
      req,
      context: { skipSiteDispatch: true },
    })

    expect(dispatchSiteBuildMock).not.toHaveBeenCalled()
    expect(buildStateWrites(updateGlobal)).toHaveLength(0)
  })

  it('swallows a dispatch failure: no throw, logs, records lastDispatchError', async () => {
    const { req, updateGlobal, error } = makeReq()
    dispatchSiteBuildMock.mockRejectedValueOnce(
      new SiteDispatchError('GitHub rejected the site build dispatch (HTTP 502)'),
    )

    // The hard requirement: NO error escapes the hook.
    await expect(
      maybeRebuildOnPublish({
        doc: { _status: 'published' },
        previousDoc: { _status: 'draft' },
        req,
        context: {},
      }),
    ).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledTimes(1)

    const writes = buildStateWrites(updateGlobal)
    // The publish still stamped lastPublishedAt; the failure recorded the message
    // and NEVER lastDispatchAt.
    expect(writes.some((d) => d.lastPublishedAt instanceof Date)).toBe(true)
    expect(
      writes.some(
        (d) =>
          typeof d.lastDispatchError === 'string' &&
          (d.lastDispatchError as string).includes('HTTP 502'),
      ),
    ).toBe(true)
    expect(writes.some((d) => d.lastDispatchAt instanceof Date)).toBe(false)
  })

  it('the global adapter delegates to the core (real transition fires dispatch)', async () => {
    const { req } = makeReq()
    await siteRebuildGlobalAfterChange({
      doc: { _status: 'published' },
      previousDoc: { _status: 'draft' },
      req,
      context: {},
    } as never)
    expect(dispatchSiteBuildMock).toHaveBeenCalledTimes(1)
  })

  it('the collection adapter delegates to the core (real transition fires dispatch)', async () => {
    const { req } = makeReq()
    await siteRebuildCollectionAfterChange({
      doc: { _status: 'published' },
      previousDoc: { _status: 'draft' },
      req,
      context: {},
    } as never)
    expect(dispatchSiteBuildMock).toHaveBeenCalledTimes(1)
  })
})

describe('publish-rebuild hook registration guard (#42)', () => {
  it('every drafts-enabled surface registers the rebuild afterChange hook', async () => {
    const resolved = await config

    const draftCollections = resolved.collections.filter((c) => c.versions && c.versions.drafts)
    const draftGlobals = resolved.globals.filter((g) => g.versions && g.versions.drafts)

    // Sanity: the suite is actually exercising surfaces, not an empty set.
    expect(draftCollections.length).toBeGreaterThan(0)
    expect(draftGlobals.length).toBeGreaterThan(0)

    for (const c of draftCollections) {
      expect(
        c.hooks?.afterChange,
        `collection "${c.slug}" must register siteRebuildCollectionAfterChange`,
      ).toContain(siteRebuildCollectionAfterChange)
    }
    for (const g of draftGlobals) {
      expect(
        g.hooks?.afterChange,
        `global "${g.slug}" must register siteRebuildGlobalAfterChange`,
      ).toContain(siteRebuildGlobalAfterChange)
    }
  })
})
