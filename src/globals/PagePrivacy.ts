import type { GlobalConfig } from 'payload'

import { intro, pageTabs, privacy } from '../fields/pageGroups'
import { restoreGroupAnchorIdsGlobal, stashGroupAnchorIdsGlobal } from '../hooks/groupAnchorId'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `pagePrivacy` — privacy-page copy (formerly `pages` row `privacy`, #18
 * split). Field map: title, seo, intro, privacy.
 *
 * Carries `privacy.operator.slug`/`privacy.consent.anchor` surfaced as `id`, so
 * it needs the groupAnchorId hooks (restore runs before omitEmpty so the
 * surfaced `id` is kept, not the empty `slug`).
 */
export const PagePrivacy: GlobalConfig = {
  slug: 'pagePrivacy',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  hooks: {
    beforeValidate: [stashGroupAnchorIdsGlobal],
    afterRead: [restoreGroupAnchorIdsGlobal, omitEmptyGlobal],
  },
  fields: [pageTabs([intro, privacy])],
}
