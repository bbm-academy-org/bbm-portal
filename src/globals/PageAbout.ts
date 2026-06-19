import type { GlobalConfig } from 'payload'

import { about, ctaSection, intro, seo } from '../fields/pageGroups'
import { localeField, text } from '../fields/shared'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `pageAbout` — about-page copy (formerly `pages` row `about`, #18 split).
 * Field map: title, seo, intro, about, cta.
 */
export const PageAbout: GlobalConfig = {
  slug: 'pageAbout',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  hooks: { afterRead: [omitEmptyGlobal] },
  fields: [text('title'), seo, intro, about, ctaSection, localeField],
}
