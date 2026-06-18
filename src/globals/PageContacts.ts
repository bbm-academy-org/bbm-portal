import type { GlobalConfig } from 'payload'

import { contacts, ctaSection, faq, faqIntro, intro, seo, teamIntro } from '../fields/pageGroups'
import { localeField, text } from '../fields/shared'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `pageContacts` — contacts-page copy (formerly `pages` row `contacts`, #18
 * split). Field map: title, seo, intro, contacts, team, faqIntro, faq, cta.
 * `team` here is the `teamIntro` group (stored under the field name `team`).
 */
export const PageContacts: GlobalConfig = {
  slug: 'pageContacts',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  hooks: { afterRead: [omitEmptyGlobal] },
  fields: [text('title'), seo, intro, contacts, teamIntro, faqIntro, faq, ctaSection, localeField],
}
