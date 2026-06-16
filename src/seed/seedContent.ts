import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import type { CollectionSlug, Payload, RequiredDataFromCollectionSlug } from 'payload'

/**
 * Content seed from the site's golden fixtures (BBMP-28 / #24).
 *
 * Projects the read-only golden fixtures in `../bbm-public-website/src/content/`
 * 1:1 into this Payload (publicProjects/team/pages collections + the philosophy/
 * contact/siteChrome globals), so the consumer-side loader swap
 * (bbm-public-website#61) is provably mechanical. This module does NOT author or
 * edit content — the fixtures are the SSOT; we only mirror their shape.
 *
 * This is the ONE seed path: `pnpm seed:content` (→ runSeedContent.ts) runs it
 * against prod, and the content-parity int spec exercises the same function, so
 * "the script seeds what the test validates" is true by construction.
 *
 * The logic is a side-effect-free function (takes an already-resolved `payload`)
 * so tests import it without a stray process.exit — same split as `seedAdmin`.
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
 * Idempotent rebuild: the 3 collections are wiped then recreated (all FKs are
 * ON DELETE cascade, so delete order is free), and the 3 globals are upserted
 * via `updateGlobal` (already idempotent). Running it twice yields the same
 * state regardless of what was there before.
 */
export async function seedContent(
  payload: Payload,
  contentDir: string = DEFAULT_CONTENT_DIR,
): Promise<void> {
  for (const collection of ['publicProjects', 'team', 'pages'] as const) {
    await payload.delete({ collection, where: { id: { exists: true } } })
  }

  // Two-phase seed: the team↔publicProjects references are circular, so create
  // team WITHOUT projects first, then projects (which reference team), then
  // backfill team.projects once the projects exist.
  const team = readContentJson(contentDir, 'team/team.json') as Array<Record<string, unknown>>
  for (const { projects: _projects, ...member } of team) {
    await payload.create({ collection: 'team', data: asData<'team'>(member) })
  }

  for (const slug of projectSlugs(contentDir)) {
    const data = readContentJson(contentDir, `publicProjects/${slug}.json`) as Record<string, unknown>
    await payload.create({
      collection: 'publicProjects',
      data: asData<'publicProjects'>({ id: slug, ...data }),
    })
  }

  for (const { id, projects } of team) {
    if (projects) {
      await payload.update({
        collection: 'team',
        id: id as string,
        data: asData<'team'>({ projects }),
      })
    }
  }

  for (const slug of pageSlugs(contentDir)) {
    const data = readContentJson(contentDir, `pages/${slug}.json`) as Record<string, unknown>
    await payload.create({ collection: 'pages', data: asData<'pages'>({ id: slug, ...data }) })
  }

  await payload.updateGlobal({ slug: 'philosophy', data: singleton(contentDir, 'philosophy/philosophy.json') })
  await payload.updateGlobal({ slug: 'contact', data: singleton(contentDir, 'siteSettings/contact.json') })
  await payload.updateGlobal({ slug: 'siteChrome', data: singleton(contentDir, 'siteSettings/siteChrome.json') })

  payload.logger.info(
    `seed:content — seeded ${projectSlugs(contentDir).length} projects, ${team.length} team members, ` +
      `${pageSlugs(contentDir).length} pages + 3 globals from ${contentDir}.`,
  )
}
