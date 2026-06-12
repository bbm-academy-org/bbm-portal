import type { Field } from 'payload'

/**
 * Shared field builders for the mirrored content surfaces.
 *
 * The job of every surface is to emit JSON that passes the site's Zod schemas
 * (`bbm-public-website/src/content/schemas.ts`). These helpers encode the
 * recurring shapes from that contract once so each collection/global reads as a
 * 1:1 projection of its schema and the verbatim-vs-prose decisions stay
 * consistent. Plain text everywhere — NEVER richText: the site stores plain
 * strings and applies RU micro-typography at its own schema boundary.
 */

/**
 * `locale` задел (every schema, default `ru`). Modeled as an explicit `select`
 * (NOT Payload localization): v1 only ever emits `ru`, so a single stored value
 * is simpler than per-field localized columns and matches `z.enum(['ru','en'])
 * .default('ru')`.
 */
export const localeField: Field = {
  name: 'locale',
  type: 'select',
  required: true,
  defaultValue: 'ru',
  options: [
    { label: 'Русский', value: 'ru' },
    { label: 'English', value: 'en' },
  ],
}

/** A prose/verbatim single-line string — `text`. */
export const text = (name: string, required = false): Field => ({
  name,
  type: 'text',
  ...(required ? { required: true } : {}),
})

/** A prose multi-line string — `textarea`. */
export const area = (name: string, required = false): Field => ({
  name,
  type: 'textarea',
  ...(required ? { required: true } : {}),
})

/** A boolean flag — `checkbox` (omitted from output when false/unset via clean). */
export const flag = (name: string): Field => ({ name, type: 'checkbox' })

/**
 * An array of plain strings (`z.array(z.string())` / `z.array(prose(z))`).
 * Modeled as `text` + `hasMany` so the API returns `["a","b"]`, NOT an array of
 * `{ value }` objects (which an `array` field would emit and break `parse`).
 */
export const stringList = (name: string): Field => ({ name, type: 'text', hasMany: true })

/**
 * Anchor-safe slug (`slug(z)` — `^[a-z][a-z0-9-]*$`). A verbatim link target, not
 * copy; the regex is enforced at the schema boundary so a bad on-page anchor id
 * fails validation instead of silently shipping a dead jump target.
 */
export const slugField = (name: string, required = false): Field => ({
  name,
  type: 'text',
  ...(required ? { required: true } : {}),
  validate: (value: unknown) => {
    if (value === undefined || value === null || value === '') {
      return required ? `${name} is required` : true
    }
    return (
      /^[a-z][a-z0-9-]*$/.test(value as string) ||
      `${name} must be anchor-safe kebab-case (^[a-z][a-z0-9-]*$)`
    )
  },
})

/**
 * CTA descriptor (`ctaSchema` / project `nextStep`): `{ label, href? }`. `label`
 * is short button prose, `href` a verbatim URL/anchor. Both left non-required at
 * the Payload level so an absent CTA group is dropped whole by `clean`.
 */
export const cta = (name: string): Field => ({
  name,
  type: 'group',
  fields: [text('label'), text('href')],
})

/** Section intro (`secIntro`): `{ eyebrow, title, lead? }` (all prose). */
export const secIntro = (name: string, withBody = false): Field => ({
  name,
  type: 'group',
  fields: [
    text('eyebrow'),
    text('title'),
    text('lead'),
    // `secIntroWithBody` adds an optional explainer paragraph array (About → whatIs).
    ...(withBody ? [stringList('paragraphs')] : []),
  ],
})
