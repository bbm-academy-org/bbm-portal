import {
  type CollectionSlug,
  type Endpoint,
  type GlobalSlug,
  type PayloadHandler,
  type PayloadRequest,
} from 'payload'

/**
 * `GET /api/pending-changes` (#17, Part A) — read-only confirm-list source.
 *
 * The admin "Publish to site" button (#17) shows a confirmation list of WHICH
 * documents/globals have pending drafts BEFORE the editor publishes (transparency
 * + multi-editor safety). This endpoint reports exactly that set WITHOUT writing
 * anything — it is the read-only sibling of `POST /api/publish-site` (#15).
 *
 * It DERIVES the build surfaces from the sanitized config exactly like
 * publishSite.ts: every collection / global with `versions.drafts` enabled is a
 * build surface, taken in config-declaration order so the response is
 * deterministic. For each surface it selects the docs/globals whose latest
 * version is a draft (`_status: 'draft'`) — the SAME query publish-site uses to
 * choose what it would promote, so the confirm-list and the publish stay
 * consistent by construction.
 *
 * Read-only: no transaction, no writes. Admin-only (`req.user`), same convention
 * as publishSite.ts. The per-doc `label` is the surface's `admin.useAsTitle`
 * field (falling back to the id) so the UI can name each pending change.
 */

type PendingSurface = {
  surface: string
  type: 'collection' | 'global'
  ids: Array<number | string>
  labels: string[]
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Best-effort human label for a pending doc: its `useAsTitle` value, else id. */
const labelFor = (doc: Record<string, unknown>, titleField: string | undefined): string => {
  const raw = titleField ? doc[titleField] : undefined
  if (typeof raw === 'string' && raw.length > 0) return raw
  return String(doc.id)
}

/**
 * Collect the pending-draft surfaces. Mirrors publishSite.ts's surface
 * derivation (drafts-enabled collections/globals, in config order) but only
 * READS — it finds docs/globals whose latest version is `_status: 'draft'`.
 */
const collectPending = async (req: PayloadRequest): Promise<PendingSurface[]> => {
  const { payload } = req
  const pending: PendingSurface[] = []

  // Derive surfaces from the sanitized runtime config — identical to publishSite.
  // `slug` is typed `string` on the sanitized config; cast at this boundary to
  // the local-API slug unions (by construction valid registered slugs).
  const collectionSurfaces = payload.config.collections
    .filter((c) => c.versions && c.versions.drafts)
    .map((c) => ({ slug: c.slug as CollectionSlug, titleField: c.admin?.useAsTitle }))
  const globalSurfaces = payload.config.globals
    .filter((g) => g.versions && g.versions.drafts)
    .map((g) => ({ slug: g.slug as GlobalSlug }))

  for (const { slug, titleField } of collectionSurfaces) {
    // Only docs whose latest version is a draft have pending changes to ship —
    // the SAME selection publish-site promotes. Read-only `find`, no `req`
    // transaction (this endpoint never opens one).
    const { docs } = await payload.find({
      collection: slug,
      where: { _status: { equals: 'draft' } },
      draft: true,
      limit: 0, // all matching docs
      depth: 0,
      pagination: false,
    })

    const ids: Array<number | string> = []
    const labels: string[] = []
    for (const doc of docs) {
      ids.push(doc.id)
      labels.push(
        labelFor(
          doc as unknown as Record<string, unknown>,
          typeof titleField === 'string' ? titleField : undefined,
        ),
      )
    }
    if (ids.length > 0) {
      pending.push({ surface: slug, type: 'collection', ids, labels })
    }
  }

  for (const { slug } of globalSurfaces) {
    // A global has a pending change only when its latest version is an
    // unpublished draft (matches publish-site's promote guard).
    const current = await payload.findGlobal({ slug, draft: true, depth: 0 })
    if ((current as { _status?: string })._status === 'draft') {
      pending.push({ surface: slug, type: 'global', ids: [slug], labels: [slug] })
    }
  }

  return pending
}

/**
 * The endpoint handler — exported standalone for unit testing (mirrors
 * publishSiteHandler), asserted directly via the getPayload harness.
 */
export const pendingChangesHandler: PayloadHandler = async (
  req: PayloadRequest,
): Promise<Response> => {
  // Admin-only. Same convention as publishSite: any authenticated user is staff.
  if (!req.user) {
    return json({ error: 'Forbidden' }, 403)
  }

  const pending = await collectPending(req)
  const count = pending.reduce((n, p) => n + p.ids.length, 0)
  return json({ pending, count }, 200)
}

/**
 * Registered in `src/payload.config.ts` via the `endpoints` array, which Payload
 * mounts under `/api`, giving `GET /api/pending-changes`.
 */
export const pendingChangesEndpoint: Endpoint = {
  path: '/pending-changes',
  method: 'get',
  handler: pendingChangesHandler,
}
