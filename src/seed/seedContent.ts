import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import type { CollectionSlug, GlobalSlug, Payload, RequiredDataFromCollectionSlug } from 'payload'

/**
 * Content seed from the site's golden fixtures (BBMP-28 / #24).
 *
 * Projects the read-only golden fixtures in `../bbm-public-website/src/content/`
 * 1:1 into this Payload (publicProjects/team collections + the philosophy/
 * contact/siteChrome globals AND the 6 per-page globals — #18), so the
 * consumer-side loader swap (bbm-public-website#61/#112) is provably mechanical.
 * This module does NOT author or edit content — the fixtures are the SSOT; we
 * only mirror their shape.
 *
 * This is the ONE seed path: `pnpm seed:content` (→ runSeedContent.ts) runs it
 * against prod, and the content-parity int spec exercises the same function, so
 * "the script seeds what the test validates" is true by construction.
 *
 * The logic is a side-effect-free function (takes an already-resolved `payload`)
 * so tests import it without a stray process.exit — same split as `seedAdmin`.
 *
 * Drafts (#14): all 6 surfaces have `versions.drafts` enabled, so every
 * create/update/updateGlobal here MUST pass `_status: 'published'` — otherwise
 * the seeded content lands as a draft-only version and an unauthenticated public
 * REST GET (the public site's read path) returns nothing. Publishing here is what
 * keeps the content-parity int + content-rest e2e suites green.
 */

/** The site checkout is the content SSOT; default to the sibling-repo path. */
export const DEFAULT_CONTENT_DIR = path.resolve(process.cwd(), '../bbm-public-website/src/content')

export const readContentJson = (contentDir: string, rel: string): unknown =>
  JSON.parse(readFileSync(path.join(contentDir, rel), 'utf8'))

/** Per-file slug set for a `glob()`-style fixture dir (filename = entry slug). */
const slugsIn = (contentDir: string, dir: string): string[] =>
  readdirSync(path.join(contentDir, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))

export const projectSlugs = (contentDir: string): string[] => slugsIn(contentDir, 'publicProjects')
export const pageSlugs = (contentDir: string): string[] => slugsIn(contentDir, 'pages')

/**
 * The old monolithic `pages` collection was split into 6 per-page globals (#18).
 * Each page fixture slug maps to exactly one global slug; the seed (and the
 * content-parity suites) drive both off this single map so they stay coherent.
 */
export const PAGE_GLOBAL_BY_SLUG: Record<string, GlobalSlug> = {
  home: 'pageHome',
  about: 'pageAbout',
  contacts: 'pageContacts',
  participate: 'pageParticipate',
  privacy: 'pagePrivacy',
  projects: 'pageProjects',
}

/** A singleton fixture is a 1-element array carrying its own `id`; drop the id. */
export const singleton = (contentDir: string, rel: string): Record<string, unknown> => {
  const [entry] = readContentJson(contentDir, rel) as Array<Record<string, unknown>>
  const { id: _id, ...rest } = entry
  return rest
}

// The fixtures are dynamic JSON; a single typed cast at the seed boundary keeps
// `payload.create`/`update` happy without scattering `any`.
const asData = <S extends CollectionSlug>(raw: unknown): RequiredDataFromCollectionSlug<S> =>
  raw as RequiredDataFromCollectionSlug<S>

/**
 * Seed all 6 mirrored surfaces from the golden fixtures into `payload`.
 *
 * Idempotent rebuild: the 2 collections are wiped then recreated (all FKs are
 * ON DELETE cascade, so delete order is free), and all 9 globals (the 3 site
 * globals + the 6 per-page globals) are upserted via `updateGlobal` (already
 * idempotent). Running it twice yields the same state regardless of what was
 * there before.
 */
export async function seedContent(
  payload: Payload,
  contentDir: string = DEFAULT_CONTENT_DIR,
): Promise<void> {
  for (const collection of ['publicProjects', 'team'] as const) {
    await payload.delete({ collection, where: { id: { exists: true } } })
  }

  // Two-phase seed: the team↔publicProjects references are circular, so create
  // team WITHOUT projects first, then projects (which reference team), then
  // backfill team.projects once the projects exist.
  const team = readContentJson(contentDir, 'team/team.json') as Array<Record<string, unknown>>
  for (const { projects: _projects, ...member } of team) {
    await payload.create({ collection: 'team', data: asData<'team'>({ ...member, _status: 'published' }) })
  }

  for (const slug of projectSlugs(contentDir)) {
    const data = readContentJson(contentDir, `publicProjects/${slug}.json`) as Record<string, unknown>
    await payload.create({
      collection: 'publicProjects',
      data: asData<'publicProjects'>({ id: slug, ...data, _status: 'published' }),
    })
  }

  for (const { id, projects } of team) {
    if (projects) {
      await payload.update({
        collection: 'team',
        id: id as string,
        data: asData<'team'>({ projects, _status: 'published' }),
      })
    }
  }

  // Each page fixture upserts the matching per-page global (#18). `_status:
  // 'published'` keeps the unauthenticated public GET non-empty (the #14
  // invariant), same as the 3 site globals below.
  for (const slug of pageSlugs(contentDir)) {
    const data = readContentJson(contentDir, `pages/${slug}.json`) as Record<string, unknown>
    await payload.updateGlobal({
      // `PAGE_GLOBAL_BY_SLUG[slug]` is the full `GlobalSlug` union (which now
      // includes the versionless, drafts-disabled `siteBuildState`, #41, whose
      // data has no `_status`); the page globals it actually maps to are all
      // drafts-enabled, so cast the payload at this by-construction-valid
      // boundary, same as the explicit-slug updates below.
      slug: PAGE_GLOBAL_BY_SLUG[slug],
      data: { ...data, _status: 'published' } as Record<string, unknown>,
    })
  }

  await payload.updateGlobal({
    slug: 'philosophy',
    data: { ...singleton(contentDir, 'philosophy/philosophy.json'), _status: 'published' },
  })
  await payload.updateGlobal({
    slug: 'contact',
    data: { ...singleton(contentDir, 'siteSettings/contact.json'), _status: 'published' },
  })
  await payload.updateGlobal({
    slug: 'siteChrome',
    data: { ...singleton(contentDir, 'siteSettings/siteChrome.json'), _status: 'published' },
  })

  payload.logger.info(
    `seed:content — seeded ${projectSlugs(contentDir).length} projects, ${team.length} team members, ` +
      `${pageSlugs(contentDir).length} page globals + 3 site globals from ${contentDir}.`,
  )
}
