import type { GlobalConfig } from 'payload'

import {
  contour,
  ctaSection,
  faq,
  faqIntro,
  hero,
  pathIntro,
  pathSteps,
  seo,
  showcase,
  trust,
  whatIs,
} from '../fields/pageGroups'
import { localeField, text } from '../fields/shared'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `pageHome` — homepage copy (formerly `pages` row `home`, #18 split).
 * Field map: title, seo, hero, whatIs, showcase, pathIntro, trust, contour,
 * faqIntro, faq, pathSteps, cta — only the groups the homepage uses.
 */
export const PageHome: GlobalConfig = {
  slug: 'pageHome',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  hooks: { afterRead: [omitEmptyGlobal] },
  fields: [
    text('title'),
    seo,
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
    localeField,
  ],
}
