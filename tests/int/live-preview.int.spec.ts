import config from '@/payload.config'

import { describe, it, expect } from 'vitest'

import { PAGE_PREVIEW_TYPES, previewUrlForGlobal } from '@/admin/livePreview'

/**
 * #19 — Admin Live Preview wiring for the 6 page globals. The URL builder is pure
 * (no Payload boot, no DB), and the config assertions only await the SANITIZED
 * config object (buildConfig) — neither connects to Postgres.
 */
describe('admin live preview (#19)', () => {
  const BASE = 'https://preview.example'

  it('maps every page global slug to its public /preview/[type]/[id] URL', () => {
    expect(previewUrlForGlobal('pageHome', BASE)).toBe(`${BASE}/preview/home/pageHome`)
    expect(previewUrlForGlobal('pageAbout', BASE)).toBe(`${BASE}/preview/about/pageAbout`)
    expect(previewUrlForGlobal('pageContacts', BASE)).toBe(`${BASE}/preview/contacts/pageContacts`)
    expect(previewUrlForGlobal('pageParticipate', BASE)).toBe(
      `${BASE}/preview/participate/pageParticipate`,
    )
    expect(previewUrlForGlobal('pagePrivacy', BASE)).toBe(`${BASE}/preview/privacy/pagePrivacy`)
    expect(previewUrlForGlobal('pageProjects', BASE)).toBe(`${BASE}/preview/projects/pageProjects`)
  })

  it('returns null for a global with no preview surface (disables the pane)', () => {
    expect(previewUrlForGlobal('philosophy', BASE)).toBeNull()
    expect(previewUrlForGlobal('contact', BASE)).toBeNull()
    expect(previewUrlForGlobal('siteChrome', BASE)).toBeNull()
  })

  it('strips a trailing slash on the base URL', () => {
    expect(previewUrlForGlobal('pageHome', `${BASE}/`)).toBe(`${BASE}/preview/home/pageHome`)
  })

  it('enables live preview for exactly the 6 page globals, all of which exist', async () => {
    const sanitized = await config
    const lp = sanitized.admin?.livePreview

    expect(lp?.globals).toEqual(Object.keys(PAGE_PREVIEW_TYPES))
    expect(typeof lp?.url).toBe('function')

    // Every previewed slug is a real registered global — guards a typo'd slug
    // that would silently never match in the url resolver.
    const globalSlugs = new Set<string>(sanitized.globals.map((g) => g.slug))
    for (const slug of Object.keys(PAGE_PREVIEW_TYPES)) {
      expect(globalSlugs.has(slug)).toBe(true)
    }
  })

  it('resolves the iframe URL from a global config via the root url function', async () => {
    const sanitized = await config
    const url = sanitized.admin?.livePreview?.url
    expect(typeof url).toBe('function')
    if (typeof url !== 'function') return

    const resolved = await url({ globalConfig: { slug: 'pageHome' } } as never)
    expect(resolved).toMatch(/\/preview\/home\/pageHome$/)
  })
})
