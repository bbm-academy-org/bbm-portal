import type { GlobalConfig } from 'payload'

import {
  contacts,
  ctaSection,
  faq,
  faqIntro,
  intro,
  pageTabs,
  teamIntro,
} from '../fields/pageGroups'
import { omitEmptyGlobal } from '../hooks/omitEmpty'
import { siteRebuildGlobalAfterChange } from '../lib/siteSync'

/**
 * `pageContacts` — contacts-page copy (formerly `pages` row `contacts`, #18
 * split). Field map: title, seo, intro, contacts, team, faqIntro, faq, cta.
 * `team` here is the `teamIntro` group (stored under the field name `team`).
 * Content groups in the "Content" tab, title/seo/locale in "SEO & meta".
 */
export const PageContacts: GlobalConfig = {
  slug: 'pageContacts',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  // afterChange → publish-rebuild (#42): a draft→published transition triggers a
  // whole-site rebuild (best-effort) via siteSync.
  hooks: {
    afterRead: [omitEmptyGlobal],
    afterChange: [siteRebuildGlobalAfterChange],
  },
  fields: [pageTabs([intro, contacts, teamIntro, faqIntro, faq, ctaSection])],
}
