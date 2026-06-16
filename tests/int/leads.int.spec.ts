import { getPayload, type Payload, type RequiredDataFromCollectionSlug } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'

/**
 * Leads receiver (bbm-public-website#23, ADR-001 / bbm-public-website#77).
 *
 * The runtime PII receiver — write-at-runtime, opposite data direction from the
 * seeded content surfaces. The live site (`LeadForm.astro`) POSTs a FLAT JSON
 * body `{ scenario, consent, <field.name>... }` to `/api/leads`. These tests pin
 * the contract this collection must honour:
 *
 *  1. a public (unauthenticated) caller can CREATE a lead when consent is true;
 *  2. a lead WITHOUT consent is rejected (never persisted — 152-FZ);
 *  3. scenario-specific extra keys (different per CTA form) are captured into
 *     `details` so no submitted data is silently dropped;
 *  4. read/update/delete are admin-only (authenticated);
 *  5. a create fires a fire-and-forget Mattermost notification.
 *
 * Local-only (needs the dev DB); mirrors the getPayload pattern of the other int
 * suites.
 */

let payload: Payload

const ORIGINAL_WEBHOOK = process.env.MATTERMOST_LEADS_WEBHOOK_URL

// A lead body intentionally carries scenario-specific extra keys (project,
// concept, …) that are NOT columns — they exercise the `details` capture. A
// single cast at the create boundary keeps `payload.create` happy without
// scattering `any` (mirrors the `asData` pattern in content-parity.int.spec.ts).
const lead = (
  overrides: Record<string, unknown> = {},
): RequiredDataFromCollectionSlug<'leads'> =>
  ({
    scenario: 'participate',
    name: 'Иван Тестов',
    email: 'ivan@example.com',
    phone: '+79991234567',
    consent: true,
    ...overrides,
  }) as RequiredDataFromCollectionSlug<'leads'>

describe('Leads receiver (bbm-public-website#23)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterEach(async () => {
    await payload.delete({ collection: 'leads', where: { id: { exists: true } } })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (ORIGINAL_WEBHOOK === undefined) delete process.env.MATTERMOST_LEADS_WEBHOOK_URL
    else process.env.MATTERMOST_LEADS_WEBHOOK_URL = ORIGINAL_WEBHOOK
  })

  afterAll(async () => {
    await payload.delete({ collection: 'leads', where: { id: { exists: true } } })
  })

  it('creates a lead from an unauthenticated public caller when consent is true', async () => {
    const doc = await payload.create({
      collection: 'leads',
      data: lead(),
      overrideAccess: false, // simulate the public, unauthenticated site POST
      user: undefined,
    })

    expect(doc.id).toBeDefined()
    expect(doc.scenario).toBe('participate')
    expect(doc.email).toBe('ivan@example.com')
    expect(doc.phone).toBe('+79991234567')
    expect(doc.consent).toBe(true)
  })

  it('rejects a lead without consent (consent !== true → never persisted)', async () => {
    await expect(
      payload.create({
        collection: 'leads',
        data: lead({ consent: false }),
        overrideAccess: false,
      }),
    ).rejects.toThrow(/consent/i)

    const after = await payload.count({ collection: 'leads' })
    expect(after.totalDocs).toBe(0)
  })

  it('captures scenario-specific extra fields into details (no submitted data dropped)', async () => {
    const doc = await payload.create({
      collection: 'leads',
      data: lead({
        scenario: 'propose',
        project: 'BBM X',
        concept: 'Новая концепция',
        stage: 'idea',
        needs: 'Менторство',
      }),
      overrideAccess: false,
    })

    expect(doc.scenario).toBe('propose')
    expect(doc.details).toMatchObject({
      project: 'BBM X',
      concept: 'Новая концепция',
      stage: 'idea',
      needs: 'Менторство',
    })
  })

  it('lets an authorized caller update a stored lead without resupplying consent', async () => {
    const doc = await payload.create({ collection: 'leads', data: lead(), overrideAccess: false })

    // An admin edit is a partial body with no `consent` key — the create-time
    // consent gate must not fire on update, or stored leads become uneditable.
    const updated = await payload.update({
      collection: 'leads',
      id: doc.id,
      data: { name: 'Пётр Редактов' },
    })

    expect(updated.name).toBe('Пётр Редактов')
    expect(updated.consent).toBe(true)
  })

  it('denies unauthenticated read / update / delete (admin-only)', async () => {
    const doc = await payload.create({ collection: 'leads', data: lead(), overrideAccess: false })

    await expect(
      payload.find({ collection: 'leads', overrideAccess: false, user: undefined }),
    ).rejects.toThrow(/Forbidden|not allowed/i)

    await expect(
      payload.update({
        collection: 'leads',
        id: doc.id,
        data: { name: 'Кто-то' },
        overrideAccess: false,
        user: undefined,
      }),
    ).rejects.toThrow(/Forbidden|not allowed/i)

    await expect(
      payload.delete({ collection: 'leads', id: doc.id, overrideAccess: false, user: undefined }),
    ).rejects.toThrow(/Forbidden|not allowed/i)
  })

  it('posts a Mattermost notification on create (fire-and-forget)', async () => {
    process.env.MATTERMOST_LEADS_WEBHOOK_URL = 'https://chat.bbm.academy/hooks/test-token'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await payload.create({
      collection: 'leads',
      data: lead({ scenario: 'investor' }),
      overrideAccess: false,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://chat.bbm.academy/hooks/test-token')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain('investor')
  })

  it('does not fail the lead write when the Mattermost webhook rejects', async () => {
    process.env.MATTERMOST_LEADS_WEBHOOK_URL = 'https://chat.bbm.academy/hooks/test-token'
    const fetchMock = vi.fn().mockRejectedValue(new Error('webhook down'))
    vi.stubGlobal('fetch', fetchMock)

    const doc = await payload.create({
      collection: 'leads',
      data: lead(),
      overrideAccess: false,
    })

    expect(doc.id).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
