import type { GlobalConfig } from 'payload'

import { localeField, text } from '../fields/shared'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `contact` singleton (`contactSchema`, schemas.ts:232). The single source of
 * truth for how to reach BBM.
 *
 * NO prose fields — all VERBATIM tokens. `email`/`phone`/`domain` are resolvable
 * tokens, `socials.*` are platform name + URL, and `legalEntity` is a registered
 * legal name kept VERBATIM WITH its official ёлочки («ООО «ИВЕКСКОН»») — the one
 * place stored copy carries ёлочки (it is never routed through the typographer).
 */
export const Contact: GlobalConfig = {
  slug: 'contact',
  access: { read: () => true },
  hooks: { afterRead: [omitEmptyGlobal] },
  fields: [
    text('email', true),
    text('phone'),
    {
      name: 'socials',
      type: 'array',
      fields: [text('label'), text('href')],
    },
    text('legalEntity'),
    text('domain'),
    localeField,
  ],
}
