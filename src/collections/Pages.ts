import type { CollectionConfig, Field } from 'payload'

import { area, cta, flag, localeField, secIntro, slugField, stringList, text } from '../fields/shared'
import { restoreGroupAnchorIds, stashGroupAnchorIds } from '../hooks/groupAnchorId'
import { omitEmptyCollection } from '../hooks/omitEmpty'

/**
 * `pages` — per-route copy (`pageSchema`, schemas.ts:410). `id` = route slug
 * (`home`, `about`, …).
 *
 * Generic fields (`title`/`body`/`seo`/`faq`/`pathSteps`) apply to every page;
 * the rest are PAGE-SPECIFIC optional `group` fields (`hero`, `about`, `trust`,
 * …) — NOT a polymorphic `blocks`/`layout` array. The consumer reads
 * `data.hero`, `data.about` by key; a `blocks` array would emit
 * `layout: [{ blockType }]` and fail `parse` (Decision B). Each group is left
 * non-required so pages that don't use it have it dropped whole by `clean`.
 */

// proofItems[]: { icon (VERBATIM token), title, body }
const proofItem: Field = {
  name: 'proofItems',
  type: 'array',
  fields: [text('icon'), text('title'), text('body')],
}

const hero: Field = {
  name: 'hero',
  type: 'group',
  fields: [
    text('eyebrow'),
    text('sticker'),
    // Split display headline so the hero can highlight a single word (.bbm-mark).
    text('titleLead'),
    text('titleMark'),
    text('titleTrail'),
    text('lead'),
    cta('primaryCta'),
    cta('secondaryCta'),
    stringList('chips'),
    text('proofLabel'),
    proofItem,
  ],
}

const whatIs: Field = {
  name: 'whatIs',
  type: 'group',
  fields: [text('eyebrow'), text('title'), stringList('paragraphs')],
}

const showcase: Field = {
  name: 'showcase',
  type: 'group',
  fields: [text('eyebrow'), text('title'), text('lead'), cta('allLink')],
}

const intro: Field = {
  name: 'intro',
  type: 'group',
  fields: [
    text('eyebrow'),
    text('title'),
    text('lead'),
    // Optional page-head CTA pair (label + optional href).
    { name: 'actions', type: 'array', fields: [text('label'), text('href')] },
  ],
}

const filters: Field = {
  name: 'filters',
  type: 'group',
  fields: [text('label'), text('allLabel')],
}

const about: Field = {
  name: 'about',
  type: 'group',
  fields: [
    secIntro('whatIs', true), // secIntroWithBody (+ paragraphs)
    secIntro('goal'),
    secIntro('values'),
    secIntro('principles'),
    secIntro('approach'),
    secIntro('roles'),
    text('goalKicker'),
    text('missionKicker'),
    { name: 'approachNote', type: 'group', fields: [text('title'), area('body')] },
  ],
}

const pathIntro: Field = {
  name: 'pathIntro',
  type: 'group',
  fields: [text('eyebrow'), text('title'), text('lead')],
}

const trust: Field = {
  name: 'trust',
  type: 'group',
  fields: [
    text('eyebrow'),
    text('title'),
    text('lead'),
    {
      name: 'stats',
      type: 'array',
      fields: [
        text('value'), // VERBATIM figure (e.g. "6 ТБ", "5 %", "—")
        text('label'),
        text('sub'),
        {
          name: 'tone',
          type: 'select',
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Teal', value: 'teal' },
            { label: 'Empty', value: 'empty' },
          ],
        },
      ],
    },
  ],
}

const contourSide: Field = {
  name: 'public',
  type: 'group',
  fields: [text('kicker'), text('title'), stringList('items')],
}

const contour: Field = {
  name: 'contour',
  type: 'group',
  fields: [
    text('eyebrow'),
    text('title'),
    contourSide,
    { name: 'internal', type: 'group', fields: [text('kicker'), text('title'), stringList('items')] },
    text('boundary'),
  ],
}

const faqIntro: Field = {
  name: 'faqIntro',
  type: 'group',
  fields: [text('eyebrow'), text('title')],
}

const contacts: Field = {
  name: 'contacts',
  type: 'group',
  fields: [
    text('eyebrow'),
    text('title'),
    text('lead'),
    // `icon` VERBATIM token; label/value are conceptual-boundary caption prose.
    { name: 'boundary', type: 'group', fields: [text('icon'), text('label'), text('value')] },
    text('note'),
  ],
}

const teamIntro: Field = {
  name: 'team',
  type: 'group',
  fields: [text('eyebrow'), text('title'), text('lead')],
}

// One configurable lead-form field (`formFieldSchema`, schemas.ts:326).
const formField: Field = {
  name: 'fields',
  type: 'array',
  fields: [
    text('name'), // VERBATIM POST-body key
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Text', value: 'text' },
        { label: 'Email', value: 'email' },
        { label: 'Tel', value: 'tel' },
        { label: 'Select', value: 'select' },
        { label: 'Textarea', value: 'textarea' },
      ],
    },
    text('label'),
    text('placeholder'),
    text('hint'),
    flag('required'),
    flag('full'),
    text('autocomplete'), // VERBATIM hint token
    text('validationMessage'),
    { name: 'options', type: 'array', fields: [text('value'), text('label')] }, // value VERBATIM
    text('placeholderOption'),
  ],
}

const stateMsg = (name: string): Field => ({
  name,
  type: 'group',
  fields: [text('title'), area('body')],
})

// One dedicated lead form (`leadFormSchema`, schemas.ts:354).
const leadForm: Field = {
  name: 'forms',
  type: 'array',
  fields: [
    slugField('id'), // on-page anchor (link contract)
    text('scenario'), // VERBATIM routing tag
    text('eyebrow'),
    text('title'),
    text('lead'),
    formField,
    text('consentLabelLead'),
    text('consentLinkText'),
    text('consentValidationMessage'),
    text('submitLabel'),
    {
      name: 'states',
      type: 'group',
      fields: [stateMsg('success'), stateMsg('error'), stateMsg('unavailable')],
    },
    text('note'),
  ],
}

const participate: Field = {
  name: 'participate',
  type: 'group',
  fields: [
    // `slug` is surfaced as `id` by the groupAnchorId hooks (Payload drops a
    // field literally named `id` inside a group).
    { name: 'roles', type: 'group', fields: [slugField('slug'), text('eyebrow'), text('title'), text('lead')] },
    {
      name: 'noScript',
      type: 'group',
      fields: [text('message'), text('linkText'), text('contactsLinkText')],
    },
    leadForm,
  ],
}

const privacy: Field = {
  name: 'privacy',
  type: 'group',
  fields: [
    { name: 'draftNote', type: 'group', fields: [text('label'), area('body')] },
    {
      name: 'sections',
      type: 'array',
      fields: [slugField('id'), text('heading'), stringList('paragraphs')],
    },
    {
      // `{legalEntity}`/`{email}` tokens are spliced in from the contact global
      // by the page at render time; stored copy keeps the placeholders verbatim.
      name: 'operator',
      type: 'group',
      // `slug` surfaced as `id` by the groupAnchorId hooks (see participate.roles).
      fields: [slugField('slug'), text('heading'), stringList('paragraphs')],
    },
    {
      name: 'consent',
      type: 'group',
      fields: [slugField('anchor'), text('label'), stringList('text')],
    },
  ],
}

const ctaSection: Field = {
  name: 'cta',
  type: 'group',
  fields: [text('title'), text('lead'), cta('primaryCta'), cta('secondaryCta')],
}

export const Pages: CollectionConfig = {
  slug: 'pages',
  access: { read: () => true },
  admin: { useAsTitle: 'title' },
  hooks: {
    beforeValidate: [stashGroupAnchorIds],
    // restore runs before omitEmpty so the surfaced `id` is kept, not the empty `slug`.
    afterRead: [restoreGroupAnchorIds, omitEmptyCollection],
  },
  fields: [
    slugField('id', true), // route slug
    text('title', true),
    area('body'),
    {
      name: 'seo',
      type: 'group',
      fields: [text('title'), area('description')],
    },
    { name: 'faq', type: 'array', fields: [text('question'), area('answer')] },
    { name: 'pathSteps', type: 'array', fields: [text('title'), area('body')] },
    // Page-specific optional groups (present only on the pages that use them).
    hero,
    whatIs,
    showcase,
    intro,
    filters,
    about,
    pathIntro,
    trust,
    contour,
    faqIntro,
    contacts,
    teamIntro,
    participate,
    privacy,
    ctaSection,
    localeField,
  ],
}
