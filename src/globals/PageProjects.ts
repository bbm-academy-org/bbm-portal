import type { GlobalConfig } from 'payload'

import { filters, intro, seo } from '../fields/pageGroups'
import { localeField, text } from '../fields/shared'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `pageProjects` — projects-index copy (formerly `pages` row `projects`, #18
 * split). Field map: title, seo, intro, filters.
 */
export const PageProjects: GlobalConfig = {
  slug: 'pageProjects',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  hooks: { afterRead: [omitEmptyGlobal] },
  fields: [text('title'), seo, intro, filters, localeField],
}
