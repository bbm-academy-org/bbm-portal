import type { GlobalConfig } from 'payload'

import { localeField, text } from '../fields/shared'
import { omitEmptyGlobal } from '../hooks/omitEmpty'
import { siteRebuildGlobalAfterChange } from '../lib/siteSync'

/**
 * `siteChrome` singleton (`siteChromeSchema`, schemas.ts:278). Header nav +
 * login/CTA + footer columns/tagline/copyright.
 *
 * `nav[].label` is VERBATIM — it doubles as the active-state matching KEY
 * (`active === n.label`); routing it through prose would inject an nbsp and break
 * the highlight + e2e assertions. `copyright` is a VERBATIM brand/legal line.
 * Every `href` is VERBATIM. `loginLabel`/`ctaLabel`/`footerTagline` and footer
 * headings/link labels are display prose. The footer contact-email mailto is NOT
 * stored here — the site injects it at runtime from `contact` (single source).
 */
export const SiteChrome: GlobalConfig = {
  slug: 'siteChrome',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  // afterChange → publish-rebuild (#42): a draft→published transition triggers a
  // whole-site rebuild (best-effort) via siteSync.
  hooks: {
    afterRead: [omitEmptyGlobal],
    afterChange: [siteRebuildGlobalAfterChange],
  },
  fields: [
    {
      name: 'nav',
      type: 'array',
      fields: [text('label'), text('href')], // label VERBATIM (active-state key)
    },
    text('loginLabel'),
    text('loginHref'),
    text('ctaLabel'),
    text('ctaHref'),
    text('footerTagline'),
    {
      name: 'footerColumns',
      type: 'array',
      fields: [
        text('heading'),
        { name: 'links', type: 'array', fields: [text('label'), text('href')] },
      ],
    },
    text('copyright'), // VERBATIM brand/legal line
    localeField,
  ],
}
