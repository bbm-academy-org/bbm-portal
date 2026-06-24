import type { GlobalConfig } from 'payload'

import { about, ctaSection, intro, pageTabs } from '../fields/pageGroups'
import { omitEmptyGlobal } from '../hooks/omitEmpty'
import { siteRebuildGlobalAfterChange } from '../lib/siteSync'

/**
 * `pageAbout` — about-page copy (formerly `pages` row `about`, #18 split).
 * Field map: title, seo, intro, about, cta (content groups in the "Content" tab,
 * title/seo/locale in "SEO & meta" — see pageTabs).
 */
export const PageAbout: GlobalConfig = {
  slug: 'pageAbout',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  // afterChange → publish-rebuild (#42): a draft→published transition triggers a
  // whole-site rebuild (best-effort) via siteSync.
  hooks: {
    afterRead: [omitEmptyGlobal],
    afterChange: [siteRebuildGlobalAfterChange],
  },
  fields: [pageTabs([intro, about, ctaSection])],
}
