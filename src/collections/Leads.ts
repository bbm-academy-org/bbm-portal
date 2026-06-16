import {
  APIError,
  type Access,
  type CollectionAfterChangeHook,
  type CollectionBeforeValidateHook,
  type CollectionConfig,
} from 'payload'

import { area, flag, text } from '../fields/shared'

/**
 * `leads` — the runtime PII receiver (bbm-public-website#23, ADR-001 /
 * bbm-public-website#77).
 *
 * UNLIKE every other surface in this repo this is NOT a build-time content
 * mirror: it is written AT RUNTIME by the public site's lead forms (data flows
 * site → portal, the opposite direction), so it is kept entirely separate from
 * the seeded loader-swap collections. Leads are PII under 152-FZ: they are
 * stored only in this Payload's RF-contour Postgres and never leave RF.
 *
 * The live site (`bbm-public-website/src/components/LeadForm.astro`) POSTs a
 * FLAT JSON body `{ scenario, consent, <field.name>... }` to the auto REST
 * create at `/api/leads`. Field NAMES differ per CTA form, so only the fields
 * common to every form are modeled as columns; any scenario-specific extra keys
 * are captured into `details` so no submitted data is ever silently dropped.
 */

// Public create, admin-only everything else: this is a write-only inbox for
// anonymous visitors; only authenticated staff may read/manage the PII.
const isAuthenticated: Access = ({ req }) => Boolean(req.user)

// The set of keys handled by dedicated columns (or managed by Payload). Anything
// the site POSTs outside this set is a scenario-specific field and is folded
// into `details` rather than dropped.
const MODELED_KEYS = new Set([
  'scenario',
  'name',
  'email',
  'phone',
  'role',
  'message',
  'consent',
  'details',
  'id',
  'createdAt',
  'updatedAt',
])

/**
 * Gate on consent and fold scenario-specific extra keys into `details`.
 *
 * Consent is a hard legal gate (152-FZ): a lead without explicit `consent: true`
 * is rejected with a 400-class error and never persisted. Running in
 * `beforeValidate` means the rejection happens before any write is attempted.
 */
const captureDetailsAndRequireConsent: CollectionBeforeValidateHook = ({ data }) => {
  if (!data) return data

  if (data.consent !== true) {
    throw new APIError('Lead consent is required (consent must be true).', 400)
  }

  const details: Record<string, unknown> = {
    ...((data.details as Record<string, unknown> | undefined) ?? {}),
  }
  for (const [key, value] of Object.entries(data)) {
    if (MODELED_KEYS.has(key)) continue
    details[key] = value
    delete (data as Record<string, unknown>)[key]
  }
  if (Object.keys(details).length > 0) data.details = details

  return data
}

/**
 * Notify the team of a new lead via a Mattermost incoming webhook.
 *
 * In-contour RF chat (`chat.bbm.academy`) only — NOT Resend/hermes, since the
 * payload references PII. Fire-and-forget: the webhook is not awaited and any
 * failure is logged but never propagated, so a notification outage can never
 * fail (or lose) the lead write itself.
 */
const notifyMattermost: CollectionAfterChangeHook = ({ doc, operation, req }) => {
  if (operation !== 'create') return doc

  const url = process.env.MATTERMOST_LEADS_WEBHOOK_URL
  if (!url) return doc

  const summary = [
    `**Новый лид** · \`${doc.scenario}\``,
    doc.name ? `Имя: ${doc.name}` : null,
    doc.email ? `Email: ${doc.email}` : null,
    doc.phone ? `Телефон: ${doc.phone}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: summary }),
  }).catch((err) => {
    req.payload.logger.error({ err, msg: 'Mattermost lead notification failed' })
  })

  return doc
}

export const Leads: CollectionConfig = {
  slug: 'leads',
  access: {
    create: () => true, // public, unauthenticated submit from the site
    read: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['scenario', 'name', 'email', 'phone', 'createdAt'],
    // Internal inbox, not editorial content — keep it out of the way visually.
    group: 'Leads',
  },
  hooks: {
    beforeValidate: [captureDetailsAndRequireConsent],
    afterChange: [notifyMattermost],
  },
  // Payload's automatic createdAt is the submission timestamp; no custom field.
  fields: [
    text('scenario', true), // VERBATIM CTA tag (site contract: z.string(), not an enum)
    text('name'),
    {
      name: 'email',
      type: 'email',
    },
    text('phone'), // already normalised to +7XXXXXXXXXX by the site
    text('role'),
    area('message'),
    flag('consent'), // gated to `true` by captureDetailsAndRequireConsent
    {
      // Scenario-specific extra keys (project/concept/stage/company/format/…),
      // captured so distinct per-CTA field sets never lose submitted data.
      name: 'details',
      type: 'json',
    },
  ],
}
