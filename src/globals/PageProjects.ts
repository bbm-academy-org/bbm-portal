import type { GlobalConfig } from 'payload'

import { filters, intro, pageTabs } from '../fields/pageGroups'
import { omitEmptyGlobal } from '../hooks/omitEmpty'
import { siteRebuildGlobalAfterChange } from '../lib/siteSync'

/**
 * `pageProjects` — projects-index copy (formerly `pages` row `projects`, #18
 * split). Field map: title, seo, intro, filters (content groups in the
 * "Content" tab, title/seo/locale in "SEO & meta" — see pageTabs).
 */
export const PageProjects: GlobalConfig = {
  slug: 'pageProjects',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  // afterChange → publish-rebuild (#42): a draft→published transition triggers a
  // whole-site rebuild (best-effort) via siteSync.
  hooks: {
    afterRead: [omitEmptyGlobal],
    afterChange: [siteRebuildGlobalAfterChange],
  },
  fields: [pageTabs([intro, filters])],
}
