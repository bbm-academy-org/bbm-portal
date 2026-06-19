import {
  commitTransaction,
  initTransaction,
  killTransaction,
  type CollectionSlug,
  type Endpoint,
  type GlobalSlug,
  type PayloadHandler,
  type PayloadRequest,
} from 'payload'

import { dispatchSiteBuild, SiteDispatchError } from '../lib/siteDispatch'

/**
 * `POST /api/publish-site` (#15) — one-click publish.
 *
 * Promotes pending drafts → published on the six build surfaces and triggers
 * the public site's GitHub Actions build via `repository_dispatch`. Consumed by
 * #17's admin button; pairs with #16's build-status endpoint.
 *
 * The build surfaces are DERIVED at runtime from the sanitized Payload config:
 * every collection and global with `versions.drafts` enabled is a promote
 * surface — which is precisely the set the public build consumes. We do NOT
 * hardcode the list, so it tracks the config automatically: today that resolves
 * to the `pages` / `publicProjects` / `team` collections and the `contact` /
 * `philosophy` / `siteChrome` globals, and when the page model changes (e.g. the
 * `pages` collection is retired in favour of per-page globals) this picks the
 * new surfaces up with no edit here. Surfaces are taken in config-declaration
 * order so the response `published[]` is deterministic.
 *
 * ORDERING INVARIANT (critical): we must NEVER end "promoted in CMS but the
 * build never started". Payload exposes DB transactions to custom endpoints via
 * `initTransaction` / `commitTransaction` / `killTransaction`, so we take the
 * clean path: open a transaction, run every promote inside it, fire+verify the
 * dispatch, and only COMMIT once GitHub returns 204. If the dispatch fails we
 * ROLL BACK the promotes — the CMS is left exactly as it was, and the request
 * fails. (This beats the dispatch-first fallback, which would risk a build off
 * not-yet-promoted content.)
 */

type PublishedSurface = { surface: string; ids: Array<number | string> }

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/**
 * Promote every doc / global on the build surfaces to `_status: 'published'`,
 * inside the request's transaction. Returns the published ids per surface.
 *
 * Passing `req` (which carries `transactionID`) makes each local-API write join
 * the open transaction, so the whole promote set commits or rolls back as one.
 */
const promoteSurfaces = async (req: PayloadRequest): Promise<PublishedSurface[]> => {
  const { payload } = req
  const published: PublishedSurface[] = []

  // Derive the promote surfaces from the sanitized runtime config: every
  // collection / global with drafts enabled is, by definition, a build surface.
  // Declaration order is preserved so `published[]` is deterministic.
  // `slug` is typed `string` on the sanitized config; cast at this boundary to
  // the local-API slug unions (these are by construction valid registered slugs).
  const collectionSurfaces = payload.config.collections
    .filter((c) => c.versions && c.versions.drafts)
    .map((c) => c.slug as CollectionSlug)
  const globalSurfaces = payload.config.globals
    .filter((g) => g.versions && g.versions.drafts)
    .map((g) => g.slug as GlobalSlug)

  for (const slug of collectionSurfaces) {
    // Only docs whose latest version is a draft have pending changes to ship;
    // already-published docs are skipped (nothing to promote). Each match is
    // promoted by re-saving it with `_status: 'published'`.
    const { docs } = await payload.find({
      collection: slug,
      where: { _status: { equals: 'draft' } },
      draft: true,
      limit: 0, // all matching docs
      depth: 0,
      pagination: false,
      req,
    })

    const ids: Array<number | string> = []
    for (const doc of docs) {
      const updated = await payload.update({
        collection: slug,
        id: doc.id,
        data: { _status: 'published' },
        draft: false,
        req,
      })
      ids.push(updated.id)
    }
    published.push({ surface: slug, ids })
  }

  for (const slug of globalSurfaces) {
    // Promote the global only when its latest version is an unpublished draft.
    // A global with no pending draft is left untouched (nothing to ship), which
    // also avoids re-validating a global that has no content yet.
    const current = await payload.findGlobal({ slug, draft: true, depth: 0, req })
    if ((current as { _status?: string })._status !== 'draft') {
      published.push({ surface: slug, ids: [] })
      continue
    }

    await payload.updateGlobal({
      slug,
      data: { _status: 'published' },
      draft: false,
      req,
    })
    published.push({ surface: slug, ids: [slug] })
  }

  return published
}

/**
 * The endpoint handler — exported standalone for unit testing (the issue's
 * acceptance asserts against it directly via the getPayload harness).
 */
export const publishSiteHandler: PayloadHandler = async (req: PayloadRequest): Promise<Response> => {
  // Admin-only. Same convention as Leads: `Boolean(req.user)`. Users is the
  // only auth collection, so any authenticated user is staff.
  if (!req.user) {
    return json({ error: 'Forbidden' }, 403)
  }

  // Open a transaction so the promotes can be rolled back if the dispatch fails.
  await initTransaction(req)

  let published: PublishedSurface[]
  try {
    published = await promoteSurfaces(req)
  } catch (err) {
    await killTransaction(req)
    req.payload.logger.error({ err, msg: 'publish-site: promote failed, rolled back' })
    return json({ error: 'Failed to promote drafts; nothing was published.' }, 500)
  }

  // Fire + verify the build BEFORE committing the promotes. Only a confirmed
  // 204 lets the promotes commit; any failure rolls them back.
  let dispatch
  try {
    dispatch = await dispatchSiteBuild()
  } catch (err) {
    await killTransaction(req)
    const status = err instanceof SiteDispatchError ? err.status : 500
    req.payload.logger.error({ err, msg: 'publish-site: dispatch failed, promotes rolled back' })
    return json(
      { error: err instanceof Error ? err.message : 'Failed to trigger the site build.' },
      status,
    )
  }

  // Dispatch accepted (204) — commit the promotes. The build is already running
  // against content we are now making canonical.
  await commitTransaction(req)

  return json({ published, dispatch }, 200)
}

/**
 * Registered in `src/payload.config.ts` via `endpoints: [publishSiteEndpoint]`,
 * which Payload mounts under `/api`, giving `POST /api/publish-site`.
 */
export const publishSiteEndpoint: Endpoint = {
  path: '/publish-site',
  method: 'post',
  handler: publishSiteHandler,
}
