import type { GlobalConfig } from 'payload'

import {
  contour,
  ctaSection,
  faq,
  faqIntro,
  hero,
  pageTabs,
  pathIntro,
  pathSteps,
  showcase,
  trust,
  whatIs,
} from '../fields/pageGroups'
import { omitEmptyGlobal } from '../hooks/omitEmpty'
import { siteRebuildGlobalAfterChange } from '../lib/siteSync'

/**
 * `pageHome` — homepage copy (formerly `pages` row `home`, #18 split).
 * Field map: title, seo, hero, whatIs, showcase, pathIntro, trust, contour,
 * faqIntro, faq, pathSteps, cta — only the groups the homepage uses. Content
 * groups sit in the "Content" tab; title/seo/locale move to "SEO & meta"
 * (pageTabs — presentational only, data stays flat).
 */
export const PageHome: GlobalConfig = {
  slug: 'pageHome',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  // afterChange → publish-rebuild (#42): a draft→published transition triggers a
  // whole-site rebuild (best-effort) via siteSync.
  hooks: {
    afterRead: [omitEmptyGlobal],
    afterChange: [siteRebuildGlobalAfterChange],
  },
  fields: [
    pageTabs([
      hero,
      whatIs,
      showcase,
      pathIntro,
      trust,
      contour,
      faqIntro,
      faq,
      pathSteps,
      ctaSection,
    ]),
  ],
}
