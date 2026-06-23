import type { GlobalConfig } from 'payload'

import { about, ctaSection, intro, pageTabs } from '../fields/pageGroups'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `pageAbout` — about-page copy (formerly `pages` row `about`, #18 split).
 * Field map: title, seo, intro, about, cta (content groups in the "Content" tab,
 * title/seo/locale in "SEO & meta" — see pageTabs).
 */
export const PageAbout: GlobalConfig = {
  slug: 'pageAbout',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  hooks: { afterRead: [omitEmptyGlobal] },
  fields: [pageTabs([intro, about, ctaSection])],
}
