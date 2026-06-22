import type { Config } from 'payload'

/**
 * Admin Live Preview wiring (#19, epic #13).
 *
 * The 6 per-page globals (#18 split the monolith `pages` into `pageHome`→`home`,
 * …) each get a live-preview pane in /admin that iframes the Astro SSR preview
 * origin (`preview.bbm.academy`, deployed in #30/#114). With autosave already on
 * the globals (`versions.drafts.autosave`), edits refresh the iframe near-live.
 *
 * The preview route's contract is `/preview/[type]/[id]` where `[type]` is a
 * PUBLIC token (home/about/…) mapped server-side to the Payload global slug
 * (see bbm-public-website `src/preview/draft-source.ts` PREVIEW_SURFACES — the
 * inverse of the map below). A global is a single document, so the route ignores
 * `[id]`; we pass the slug for a readable, stable URL.
 */

type LivePreviewConfig = NonNullable<NonNullable<Config['admin']>['livePreview']>

/**
 * Per-page global slug → public preview `[type]` token. This is the source-of-
 * truth inverse of the SSR route's `PREVIEW_SURFACES`; the two repos must agree.
 * Only these 6 surfaces have a preview route — non-page globals (philosophy /
 * contact / siteChrome) are intentionally absent and get no preview pane.
 */
export const PAGE_PREVIEW_TYPES = {
  pageHome: 'home',
  pageAbout: 'about',
  pageContacts: 'contacts',
  pageParticipate: 'participate',
  pagePrivacy: 'privacy',
  pageProjects: 'projects',
} as const satisfies Record<string, string>

export type PageGlobalSlug = keyof typeof PAGE_PREVIEW_TYPES

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, '')

/**
 * Base URL of the Astro SSR live-preview origin. Prod falls back to the deployed
 * `preview.bbm.academy`; local dev points it at the `astro dev` / `build:preview`
 * server via `LIVE_PREVIEW_URL` (e.g. http://localhost:4321). Env-driven so no
 * host is hardcoded and the iframe `src` matches the environment.
 */
const PREVIEW_BASE_URL = stripTrailingSlash(
  process.env.LIVE_PREVIEW_URL ?? 'https://preview.bbm.academy',
)

/**
 * Build the live-preview iframe URL for a page global, or `null` if the slug has
 * no preview surface (which disables the preview pane for that global — Payload's
 * documented way to conditionally render Live Preview).
 */
export function previewUrlForGlobal(slug: string, baseUrl: string = PREVIEW_BASE_URL): string | null {
  const type = (PAGE_PREVIEW_TYPES as Record<string, string>)[slug]
  if (!type) return null
  return `${stripTrailingSlash(baseUrl)}/preview/${type}/${slug}`
}

/**
 * Root-level Live Preview config: enables the pane for exactly the 6 page globals
 * and resolves each one's iframe URL from its slug. Configured once at the root
 * (not per-global) so the slug→URL contract lives in a single place. Payload adds
 * the `responsive` breakpoint to this list automatically.
 */
export const livePreview: LivePreviewConfig = {
  globals: Object.keys(PAGE_PREVIEW_TYPES),
  breakpoints: [
    { name: 'mobile', label: 'Mobile', width: 375, height: 667 },
    { name: 'tablet', label: 'Tablet', width: 768, height: 1024 },
    { name: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  ],
  url: ({ globalConfig }) => (globalConfig ? previewUrlForGlobal(globalConfig.slug) : null),
}
