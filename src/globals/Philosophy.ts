import type { GlobalConfig } from 'payload'

import { area, flag, localeField, text } from '../fields/shared'
import { omitEmptyGlobal } from '../hooks/omitEmpty'

/**
 * `philosophy` singleton (`philosophySchema`, schemas.ts:173).
 *
 * `icon` (and role `code`) are VERBATIM token ids, not copy. Everything else is
 * prose. `roles[].extra` is REQUIRED but legitimately `""` for roles with no
 * royalty — the empty string is preserved (see `omitEmpty`), not dropped.
 */
export const Philosophy: GlobalConfig = {
  slug: 'philosophy',
  access: { read: () => true },
  versions: { drafts: { autosave: true } },
  hooks: { afterRead: [omitEmptyGlobal] },
  fields: [
    area('evolutionaryGoal'),
    area('mission'),
    {
      name: 'values',
      type: 'array',
      fields: [text('title'), area('body'), text('icon')], // icon VERBATIM
    },
    {
      name: 'principles',
      type: 'array',
      fields: [text('title'), area('body')],
    },
    {
      name: 'tealPillars',
      type: 'array',
      fields: [text('title'), area('body'), text('icon')], // icon VERBATIM
    },
    {
      name: 'roles',
      type: 'array',
      fields: [
        text('code'), // VERBATIM role token (doubles as a stable label id)
        text('icon'), // VERBATIM
        text('share'), // short prose ("4 доли", "—")
        text('extra'), // short prose, may be "" — kept verbatim
        area('body'),
        flag('hot'),
      ],
    },
    localeField,
  ],
}
