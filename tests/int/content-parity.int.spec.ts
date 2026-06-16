import { existsSync } from 'node:fs'
import path from 'node:path'

import { getPayload, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { pageSlugs, projectSlugs, readContentJson, seedContent, singleton } from '@/seed/seedContent'
import { expectNoNulls, expectSubset } from '../helpers/parity'

/**
 * Content-contract parity test (BBMP-28 Definition of Done) — LOCAL-API tier.
 *
 * For each of the 6 mirrored surfaces: seed Payload via the shared `seedContent`
 * path (the same one `pnpm seed:content` runs in prod), read the surface back
 * through the Local API, and assert the output mirrors the fixture shape —
 * proving the consumer-side loader swap is mechanical. The HTTP/wire tier of the
 * same proof lives in `tests/e2e/content-rest.e2e.spec.ts` (real REST GETs).
 *
 * `expectSubset` + `expectNoNulls` (see tests/helpers/parity.ts) stand in for the
 * site's `schema.parse(...)` without importing its Zod schemas — a deliberate
 * producer/consumer split documented in that helper.
 *
 * The fixtures are read from the sibling `bbm-public-website` checkout (the
 * contract SSOT), so this suite is skipped when that repo is absent.
 */

const SITE_CONTENT = path.resolve(process.cwd(), '../bbm-public-website/src/content')
const hasFixtures = existsSync(SITE_CONTENT)

// Bind the shared seedContent helpers to this suite's fixtures root, so the
// assertions read the SAME fixtures the seed consumed (one content path).
const readJson = (rel: string): unknown => readContentJson(SITE_CONTENT, rel)

// Bound to this suite's fixtures root (the shared helpers are contentDir-aware).
const projectSlugsHere = () => projectSlugs(SITE_CONTENT)
const pageSlugsHere = () => pageSlugs(SITE_CONTENT)
const singletonHere = (rel: string) => singleton(SITE_CONTENT, rel)

let payload: Payload

describe.skipIf(!hasFixtures)('content surfaces parity (seed → read → schema-shape)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    // Exercise the SAME seed path `pnpm seed:content` runs in prod — so the
    // shape this suite validates is exactly what the script produces (#24).
    await seedContent(payload, SITE_CONTENT)
  })

  it('publicProjects: every entry mirrors its fixture (id = slug, refs as slugs)', async () => {
    for (const slug of projectSlugsHere()) {
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
    for (const slug of pageSlugsHere()) {
      const fixture = readJson(`pages/${slug}.json`)
      const doc = await payload.findByID({ collection: 'pages', id: slug, depth: 0 })
      expectSubset(fixture, doc, `pages/${slug}`)
      expectNoNulls(doc, `pages/${slug}`)
      expect(doc.id, 'id === slug').toBe(slug)
    }
  })

  it('philosophy global mirrors its fixture (roles[].extra "" preserved)', async () => {
    const doc = await payload.findGlobal({ slug: 'philosophy', depth: 0 })
    expectSubset(singletonHere('philosophy/philosophy.json'), doc, 'philosophy')
    expectNoNulls(doc, 'philosophy')
  })

  it('contact global mirrors its fixture (legalEntity keeps ёлочки verbatim)', async () => {
    const doc = await payload.findGlobal({ slug: 'contact', depth: 0 })
    expectSubset(singletonHere('siteSettings/contact.json'), doc, 'contact')
    expectNoNulls(doc, 'contact')
    expect(doc.legalEntity).toBe('ООО «ИВЕКСКОН»')
  })

  it('siteChrome global mirrors its fixture (nav labels verbatim)', async () => {
    const doc = await payload.findGlobal({ slug: 'siteChrome', depth: 0 })
    expectSubset(singletonHere('siteSettings/siteChrome.json'), doc, 'siteChrome')
    expectNoNulls(doc, 'siteChrome')
  })
})
