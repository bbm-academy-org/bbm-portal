import type { GlobalConfig } from 'payload'

import { ctaSection, intro, participate, seo } from '../fields/pageGroups'
import { localeField, text } from '../fields/shared'
import { restoreGroupAnchorIdsGlobal, stashGroupAnchorIdsGlobal } from '../hooks/groupAnchorId'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `pageParticipate` — participate-page copy (formerly `pages` row
 * `participate`, #18 split). Field map: title, seo, intro, participate, cta.
 *
 * Carries the `participate.roles.slug` anchor surfaced as `id`, so it needs the
 * groupAnchorId hooks (restore runs before omitEmpty so the surfaced `id` is
 * kept, not the empty `slug`).
 */
export const PageParticipate: GlobalConfig = {
  slug: 'pageParticipate',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  hooks: {
    beforeValidate: [stashGroupAnchorIdsGlobal],
    afterRead: [restoreGroupAnchorIdsGlobal, omitEmptyGlobal],
  },
  fields: [text('title'), seo, intro, participate, ctaSection, localeField],
}
