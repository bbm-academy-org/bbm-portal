import { existsSync } from 'node:fs'

import { expect, test, type APIRequestContext } from '@playwright/test'
import { getPayload } from 'payload'

import config from '../../src/payload.config'
import {
  DEFAULT_CONTENT_DIR,
  PAGE_GLOBAL_BY_SLUG,
  pageSlugs,
  projectSlugs,
  readContentJson,
  seedContent,
  singleton,
} from '../../src/seed/seedContent'
import { expectNoNulls, expectSubset } from '../helpers/parity'

/**
 * Content-contract parity — HTTP/REST tier (#24 DoD).
 *
 * The producer's real contract is its REST output over the wire (the site
 * fetches `/api/...` at build time), so this proves parity against the ACTUAL
 * REST endpoints — not the Local API the int spec uses. It seeds via the shared
 * `seedContent` path (Local API, same `cms` DB the dev server reads) then GETs
 * each surface over HTTP and runs the same shape assertions.
 *
 * Why no `schema.parse` here: importing the site's Zod schemas would be a
 * wrong-direction producer→consumer dependency (they pull `typograf`/`astro`).
 * The validation half lives in bbm-public-website #61; see tests/helpers/parity.ts.
 *
 * Local-only: needs the dev DB + the sibling fixtures checkout; skipped without
 * them. The dev server is provided by playwright.config.ts `webServer`.
 */

const CONTENT = DEFAULT_CONTENT_DIR
const REST = 'http://localhost:3000/api'
const hasFixtures = existsSync(CONTENT)

const getJson = async (request: APIRequestContext, route: string): Promise<unknown> => {
  const res = await request.get(`${REST}${route}`)
  expect(res.ok(), `${route} → HTTP ${res.status()}`).toBeTruthy()
  return res.json()
}

/** Fetch a collection over REST and index its docs by their slug-id. */
const fetchById = async (
  request: APIRequestContext,
  slug: string,
): Promise<Map<string, Record<string, unknown>>> => {
  const body = (await getJson(request, `/${slug}?depth=0&limit=100`)) as {
    docs: Array<Record<string, unknown>>
  }
  return new Map(body.docs.map((d) => [d.id as string, d]))
}

test.describe('content REST parity (seed → GET /api → schema-shape)', () => {
  // Local-only: skip the whole group when the sibling fixtures checkout is
  // absent. This MUST sit at describe-body level — `test.skip()` inside a
  // `beforeAll` aborts only the hook, leaving the tests to run against an
  // unseeded DB (mirrors the int spec's `describe.skipIf`).
  test.skip(!hasFixtures, 'sibling bbm-public-website fixtures checkout is absent')

  test.beforeAll(async () => {
    const payload = await getPayload({ config })
    await seedContent(payload, CONTENT)
  })

  test('publicProjects: every entry mirrors its fixture over REST (id = slug, refs as slugs)', async ({
    request,
  }) => {
    const byId = await fetchById(request, 'publicProjects')
    for (const slug of projectSlugs(CONTENT)) {
      const fixture = readContentJson(CONTENT, `publicProjects/${slug}.json`)
      const doc = byId.get(slug)
      expect(doc, `publicProjects/${slug} present in REST docs`).toBeTruthy()
      expectSubset(fixture, doc, `publicProjects/${slug}`)
      expectNoNulls(doc, `publicProjects/${slug}`)
      expect(doc!.visibility, 'visibility default').toBe('public')
      expect(doc!.locale, 'locale default').toBe('ru')
    }
  })

  test('team: array mirrors fixture, projects serialize to project slugs', async ({ request }) => {
    const byId = await fetchById(request, 'team')
    const fixture = readContentJson(CONTENT, 'team/team.json') as Array<Record<string, unknown>>
    for (const member of fixture) {
      const doc = byId.get(member.id as string)
      expect(doc, `team/${member.id} present in REST docs`).toBeTruthy()
      expectSubset(member, doc, `team/${member.id}`)
      expectNoNulls(doc, `team/${member.id}`)
    }
  })

  test('page globals: every page mirrors its fixture over REST (named groups, no blocks array)', async ({
    request,
  }) => {
    for (const slug of pageSlugs(CONTENT)) {
      const fixture = readContentJson(CONTENT, `pages/${slug}.json`)
      const global = PAGE_GLOBAL_BY_SLUG[slug]
      const doc = await getJson(request, `/globals/${global}?depth=0`)
      expectSubset(fixture, doc, `${global} (pages/${slug})`)
      expectNoNulls(doc, `${global} (pages/${slug})`)
    }
  })

  test('philosophy global mirrors its fixture (roles[].extra "" preserved)', async ({ request }) => {
    const doc = await getJson(request, '/globals/philosophy?depth=0')
    expectSubset(singleton(CONTENT, 'philosophy/philosophy.json'), doc, 'philosophy')
    expectNoNulls(doc, 'philosophy')
  })

  test('contact global mirrors its fixture (legalEntity keeps ёлочки verbatim)', async ({
    request,
  }) => {
    const doc = (await getJson(request, '/globals/contact?depth=0')) as Record<string, unknown>
    expectSubset(singleton(CONTENT, 'siteSettings/contact.json'), doc, 'contact')
    expectNoNulls(doc, 'contact')
    expect(doc.legalEntity).toBe('ООО «ИВЕКСКОН»')
  })

  test('siteChrome global mirrors its fixture (nav labels verbatim)', async ({ request }) => {
    const doc = await getJson(request, '/globals/siteChrome?depth=0')
    expectSubset(singleton(CONTENT, 'siteSettings/siteChrome.json'), doc, 'siteChrome')
    expectNoNulls(doc, 'siteChrome')
  })
})
