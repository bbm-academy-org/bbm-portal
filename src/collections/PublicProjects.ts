import type { CollectionConfig } from 'payload'

import { area, cta, localeField, slugField, stringList, text } from '../fields/shared'
import { omitEmptyCollection } from '../hooks/omitEmpty'

/**
 * `publicProjects` — the project showcase (`projectSchema`, schemas.ts:128).
 *
 * `id` is a human-readable slug (`doctor-school`), NOT a uuid — it is the
 * identity consumers key on, and it is what `team`/`related` references resolve
 * to. `name` and `metrics[].value` are VERBATIM (brand name + figures the
 * typographer must not touch); all other copy is plain prose.
 */
export const PublicProjects: CollectionConfig = {
  slug: 'publicProjects',
  access: { read: () => true },
  admin: { useAsTitle: 'name' },
  hooks: { afterRead: [omitEmptyCollection] },
  fields: [
    // Custom text id = slug (entry identity = the slug consumers key on).
    slugField('id', true),
    text('name', true), // VERBATIM brand name
    text('tagline', true),
    text('direction', true),
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Launching', value: 'launching' },
        { label: 'Exploring', value: 'exploring' },
        { label: 'Soon', value: 'soon' },
      ],
    },
    {
      // Editorial readiness gate — INDEPENDENT axis from `status` (shared 'soon'
      // token is purely lexical; do not couple them).
      name: 'maturity',
      type: 'select',
      required: true,
      options: [
        { label: 'Rich', value: 'rich' },
        { label: 'Thin', value: 'thin' },
        { label: 'Soon', value: 'soon' },
      ],
    },
    area('description'),
    area('disclaimer'),
    {
      name: 'metrics',
      type: 'array',
      fields: [text('label'), text('value')], // value is VERBATIM (e.g. "4 / 2 / 1", "5%")
    },
    {
      // Serializes to the team member slug-id (custom id) at depth 0.
      name: 'team',
      type: 'relationship',
      relationTo: 'team',
      hasMany: true,
    },
    {
      name: 'media',
      type: 'group',
      fields: [text('logo')], // string path задел; no logo assets yet (Decision A)
    },
    cta('nextStep'),
    stringList('related'), // project slugs (plain strings, not a relationship per schema)
    {
      name: 'visibility',
      type: 'select',
      defaultValue: 'public',
      options: [
        { label: 'Public', value: 'public' },
        { label: 'Restricted', value: 'restricted' },
      ],
    },
    localeField,
  ],
}
