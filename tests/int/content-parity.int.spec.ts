import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { getPayload, type CollectionSlug, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'

/**
 * Content-contract parity test (BBMP-28 Definition of Done).
 *
 * For each of the 6 mirrored surfaces: seed Payload from the site's REAL golden
 * fixtures, read the surface back through the API, and assert the output mirrors
 * the fixture shape — proving the consumer-side loader swap is mechanical.
 *
 * Two checks together stand in for the site's `schema.parse(...)` (its Zod
 * schemas live in the sibling repo and pull `typograf`, so they are not imported
 * here — CI runs lint+typecheck only, and these int tests are local-only):
 *  1. `expectSubset(fixture, output)` — every fixture leaf appears identically in
 *     the output (no dropped/renamed/typographed field; plain text preserved).
 *  2. `expectNoNulls(output)` — the output contains no `null` (invariant #6:
 *     "optional means omit, not null"); a `null` would fail the schemas'
 *     non-nullable `.optional()`.
 *
 * The fixtures are read from the sibling `bbm-public-website` checkout (the
 * contract SSOT), so this suite is skipped when that repo is absent.
 */

const SITE_CONTENT = path.resolve(process.cwd(), '../bbm-public-website/src/content')
const hasFixtures = existsSync(SITE_CONTENT)

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(path.join(SITE_CONTENT, rel), 'utf8'))

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

/** Assert every leaf of `expected` (a fixture) appears identically in `actual`. */
function expectSubset(expected: unknown, actual: unknown, at = '$'): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${at} should be an array`).toBe(true)
    const arr = actual as unknown[]
    expect(arr.length, `${at} length`).toBe(expected.length)
    expected.forEach((item, i) => expectSubset(item, arr[i], `${at}[${i}]`))
  } else if (isObject(expected)) {
    expect(isObject(actual), `${at} should be an object`).toBe(true)
    for (const key of Object.keys(expected)) {
      expectSubset(expected[key], (actual as Record<string, unknown>)[key], `${at}.${key}`)
    }
  } else {
    expect(actual, `${at} mismatch`).toStrictEqual(expected)
  }
}

/** Assert `value` contains no `null` anywhere (omit-not-null invariant). */
function expectNoNulls(value: unknown, at = '$'): void {
  expect(value, `${at} must not be null`).not.toBeNull()
  if (Array.isArray(value)) value.forEach((v, i) => expectNoNulls(v, `${at}[${i}]`))
  else if (isObject(value)) for (const k of Object.keys(value)) expectNoNulls(value[k], `${at}.${k}`)
}

const projectSlugs = () =>
  readdirSync(path.join(SITE_CONTENT, 'publicProjects'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))

const pageSlugs = () =>
  readdirSync(path.join(SITE_CONTENT, 'pages'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))

// The fixtures are dynamic JSON; a single typed cast at the seed boundary keeps
// `payload.create`/`update` happy without scattering `any`.
const asData = <S extends CollectionSlug>(raw: unknown): RequiredDataFromCollectionSlug<S> =>
  raw as RequiredDataFromCollectionSlug<S>

const singleton = (rel: string): Record<string, unknown> => {
  const [entry] = readJson(rel) as Array<Record<string, unknown>>
  const { id: _id, ...rest } = entry
  return rest
}

let payload: Payload

describe.skipIf(!hasFixtures)('content surfaces parity (seed → read → schema-shape)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    // Idempotent reset (all FKs are ON DELETE cascade, so order is free).
    for (const collection of ['publicProjects', 'team', 'pages'] as const) {
      await payload.delete({ collection, where: { id: { exists: true } } })
    }

    // Two-phase seed: the team↔publicProjects references are circular, so create
    // team WITHOUT projects first, then projects (which reference team), then
    // backfill team.projects once the projects exist.
    const team = readJson('team/team.json') as Array<Record<string, unknown>>
    for (const { projects: _projects, ...member } of team) {
      await payload.create({ collection: 'team', data: asData<'team'>(member) })
    }

    for (const slug of projectSlugs()) {
      const data = readJson(`publicProjects/${slug}.json`) as Record<string, unknown>
      await payload.create({ collection: 'publicProjects', data: asData<'publicProjects'>({ id: slug, ...data }) })
    }

    for (const { id, projects } of team) {
      if (projects) {
        await payload.update({ collection: 'team', id: id as string, data: asData<'team'>({ projects }) })
      }
    }

    for (const slug of pageSlugs()) {
      const data = readJson(`pages/${slug}.json`) as Record<string, unknown>
      await payload.create({ collection: 'pages', data: asData<'pages'>({ id: slug, ...data }) })
    }

    await payload.updateGlobal({ slug: 'philosophy', data: singleton('philosophy/philosophy.json') })
    await payload.updateGlobal({ slug: 'contact', data: singleton('siteSettings/contact.json') })
    await payload.updateGlobal({ slug: 'siteChrome', data: singleton('siteSettings/siteChrome.json') })
  })

  it('publicProjects: every entry mirrors its fixture (id = slug, refs as slugs)', async () => {
    for (const slug of projectSlugs()) {
      const fixture = readJson(`publicProjects/${slug}.json`)
      const doc = await payload.findByID({ collection: 'publicProjects', id: slug, depth: 0 })
      expectSubset(fixture, doc, `publicProjects/${slug}`)
      expectNoNulls(doc, `publicProjects/${slug}`)
      expect(doc.id, 'id === slug').toBe(slug)
      expect(doc.visibility, 'visibility default').toBe('public')
      expect(doc.locale, 'locale default').toBe('ru')
    }
  })

  it('team: array mirrors fixture, projects serialize to project slugs', async () => {
    const fixture = readJson('team/team.json') as Array<Record<string, unknown>>
    for (const member of fixture) {
      const doc = await payload.findByID({ collection: 'team', id: member.id as string, depth: 0 })
      expectSubset(member, doc, `team/${member.id}`)
      expectNoNulls(doc, `team/${member.id}`)
    }
  })

  it('pages: every page mirrors its fixture (named groups, no blocks array)', async () => {
    for (const slug of pageSlugs()) {
      const fixture = readJson(`pages/${slug}.json`)
      const doc = await payload.findByID({ collection: 'pages', id: slug, depth: 0 })
      expectSubset(fixture, doc, `pages/${slug}`)
      expectNoNulls(doc, `pages/${slug}`)
      expect(doc.id, 'id === slug').toBe(slug)
    }
  })

  it('philosophy global mirrors its fixture (roles[].extra "" preserved)', async () => {
    const doc = await payload.findGlobal({ slug: 'philosophy', depth: 0 })
    expectSubset(singleton('philosophy/philosophy.json'), doc, 'philosophy')
    expectNoNulls(doc, 'philosophy')
  })

  it('contact global mirrors its fixture (legalEntity keeps ёлочки verbatim)', async () => {
    const doc = await payload.findGlobal({ slug: 'contact', depth: 0 })
    expectSubset(singleton('siteSettings/contact.json'), doc, 'contact')
    expectNoNulls(doc, 'contact')
    expect(doc.legalEntity).toBe('ООО «ИВЕКСКОН»')
  })

  it('siteChrome global mirrors its fixture (nav labels verbatim)', async () => {
    const doc = await payload.findGlobal({ slug: 'siteChrome', depth: 0 })
    expectSubset(singleton('siteSettings/siteChrome.json'), doc, 'siteChrome')
    expectNoNulls(doc, 'siteChrome')
  })
})
