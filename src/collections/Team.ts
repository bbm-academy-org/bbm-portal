import type { CollectionConfig } from 'payload'

import { area, localeField, slugField, text } from '../fields/shared'
import { omitEmptyCollection } from '../hooks/omitEmpty'

/**
 * `team` — экспертные лица экосистемы (`teamSchema`, schemas.ts:201).
 *
 * `id` is the member slug (`eduard-ildarkhanov`) — the value `publicProjects.team`
 * references and `projects` resolves back to. `name`/`initials` are VERBATIM
 * (proper name + glyph token); `socials` label+href are VERBATIM (platform name +
 * URL). `role`/`bio` are prose. `photo` is a string path задел (no assets yet).
 */
export const Team: CollectionConfig = {
  slug: 'team',
  access: { read: () => true },
  admin: { useAsTitle: 'name' },
  hooks: { afterRead: [omitEmptyCollection] },
  fields: [
    slugField('id', true),
    text('name', true), // VERBATIM person name
    text('initials'), // VERBATIM glyph token
    area('role'),
    area('bio'),
    text('photo'),
    {
      // Serializes to the project slug-id (custom id) at depth 0.
      name: 'projects',
      type: 'relationship',
      relationTo: 'publicProjects',
      hasMany: true,
    },
    {
      name: 'socials',
      type: 'array',
      fields: [text('label'), text('href')], // both VERBATIM
    },
    localeField,
  ],
}
