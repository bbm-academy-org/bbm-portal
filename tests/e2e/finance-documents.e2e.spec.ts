import { sql } from 'drizzle-orm'

import { expect, test } from '@playwright/test'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import {
  DEV_SEED_DOCUMENT_BYTES,
  DEV_SEED_MEMBERS,
  DEV_SEED_REQUESTS,
  devSeedNote,
} from '../../tools/platform/dev-seed-plan'

import { signInAsPlatformMember } from './support/platform-session'

/**
 * A finance document is private, end to end — spec
 * `docs/specs/339-ledger-intake.md` acceptance scenario 9, issue #382.
 *
 * The scenario the owner wrote is exactly two requests: copy a document's URL
 * from your session, then open it **signed out** and as a **signed-in role-less
 * member on someone else's item** — refused both times (EARS-514/523). Neither
 * refusal can be proved below this tier: the unit suite proves the storage
 * decision and the integration suite proves the module's access join, but only
 * a real HTTP request can say that the URL grants nothing on its own — that
 * there is no public object-storage link behind the handler and no route that
 * serves the bytes without asking.
 *
 * **The fixture is the stand's own seed (#436).** This spec used to insert its
 * own member, currency, account, purpose, intake item, document and link, and
 * to write the blob itself — then leave every one of those rows behind. It now
 * READS the document `pnpm dev:seed` already attached to the first posted
 * request. That is the acceptance criterion of #436 («the e2e suite passes
 * against the seeded database with no suite-local seeding of its own») and it
 * is also the stronger test: the row under assertion is one the owner will see
 * on the same stand, created through the real posting path rather than by
 * hand-written SQL that could drift from what the module actually writes.
 *
 * **The role-less member is MINTED, not signed in through the IdP.** The
 * witness this scenario needs holds `platform-user` and NEITHER flow role, and
 * the dev IdP has no such account: `bbm-test` holds `platform-admin` plus both
 * finance roles after `provision.sh` step 8. `signInAsPlatformMember` states the
 * session under test exactly, with the stand's own `AUTH_SECRET`, so everything
 * from `auth()` down runs untouched — see `./support/platform-session`. The OIDC
 * round trip itself is `tests/e2e/platform-claim-gate.e2e.spec.ts`'s subject.
 *
 * Relative paths only, resolved against Playwright's `baseURL` (`E2E_PORT` /
 * `E2E_BASE_URL` — `tests/helpers/base-url.ts`; naming a port asserts the stand
 * is yours, `.claude/rules/parallel-sessions.md`).
 *
 *   E2E_PORT=3005 pnpm test:e2e tests/e2e/finance-documents.e2e.spec.ts
 */

const databaseUrl = process.env.PLATFORM_DATABASE_URL

/** The seeded request whose confirming document this spec reads. */
const SEEDED_REQUEST = DEV_SEED_REQUESTS.find((request) => request.status === 'posted')!

/** The member the item belongs to. The witness below is deliberately NOT them. */
const OWNER_EMAIL = DEV_SEED_MEMBERS.find(
  (member) => member.slug === SEEDED_REQUEST.submitterSlug,
)!.email

/** A signed-in platform member holding neither flow role — the EARS-523 witness. */
const OUTSIDER = { email: 'e2e-outsider@bbm.academy', roles: ['platform-user'] }

/** The positive control: a refusal that is never lifted proves nothing. */
const CLERK = { email: OWNER_EMAIL, roles: ['platform-user', 'finance-entry'] }

let documentId: number

/**
 * Find the seeded document — a READ, not a write.
 *
 * The intake note carries the plan's `[seed:<slug>]` marker, which is the same
 * stable identity the seed itself matches on for idempotency, so this lookup
 * cannot pick up a row some other suite happened to leave behind.
 */
async function seededDocumentId(): Promise<number> {
  const note = devSeedNote(SEEDED_REQUEST.slug, SEEDED_REQUEST.note)
  const result = await getPlatformDb().execute(sql`
    select d.id
      from core.finance_document d
      join core.finance_document_link dl on dl.document_id = d.id
      join core.finance_intake_item i on i.id = dl.intake_item_id
     where i.note = ${note} and d.storage_state = 'ready'
     limit 1
  `)
  const row = result.rows[0] as { id: number } | undefined
  if (row === undefined) {
    throw new Error(
      `no seeded document behind «${SEEDED_REQUEST.slug}» — run pnpm dev:seed against this stand`,
    )
  }
  return Number(row.id)
}

test.beforeAll(async () => {
  test.skip(!databaseUrl, 'PLATFORM_DATABASE_URL is not set — no stand database to read')
  documentId = await seededDocumentId()
})

test.afterAll(async () => {
  await closePlatformDb()
})

test.describe('a finance document has no URL that gives it away (spec 339 scenario 9)', () => {
  test('EARS-523: a signed-out request for a document never returns it', async ({ request }) => {
    // The `request` fixture, not `page.goto`: this is the owner's «copy the URL
    // and open it signed out», and a plain HTTP GET is what that is. It also
    // sees what a browser hides — the exact status, and that the body is empty
    // rather than a rendered «нет доступа» page carrying a 200.
    const response = await request.get(`/p/finance/api/documents/${documentId}`, {
      maxRedirects: 0,
    })

    expect(response.status()).toBe(403)
    expect(response.headers()['content-type'] ?? '').not.toContain('image/png')
    // The claim gate answers BARE for an anonymous caller (spec 311 D-5) — and
    // nothing in that answer leaks a bucket URL to try directly (EARS-514).
    expect(await response.text()).not.toMatch(/s3|twcstorage|storage_key/i)
  })

  test('EARS-514: a browser cannot render the document either', async ({ page }) => {
    // Chromium refuses to navigate to a 403 with an empty body at all, so the
    // navigation THROWS rather than returning a response — which is the point:
    // there is nothing behind this URL for an anonymous caller to look at, and
    // no redirect to an object-storage address to follow.
    const navigation = page
      .goto(`/p/finance/api/documents/${documentId}`, { waitUntil: 'domcontentloaded' })
      .then((response) => ({ status: response?.status() ?? 0 }))
      .catch((error: Error) => ({ status: 0, error: error.message }))
    const outcome = await navigation

    expect(outcome.status).not.toBe(200)
    if ('error' in outcome) expect(outcome.error).toContain('ERR_HTTP_RESPONSE_CODE_FAILURE')
    else expect(outcome.status).toBe(403)
  })

  test('EARS-523: a signed-in role-less member is refused someone elses document', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsPlatformMember(context, baseURL as string, OUTSIDER)

    const response = await page.goto(`/p/finance/api/documents/${documentId}`, {
      waitUntil: 'domcontentloaded',
    })

    expect(response?.status()).toBe(403)
    expect(response?.headers()['content-type'] ?? '').not.toContain('image/png')
    // The refusal is the module's, not the gate's — the session DID hold
    // `platform-user`, the role that opens /p/finance for everyone (EARS-530),
    // and it bought nothing here (EARS-523).
    expect(await response?.text()).toContain('EARS-523')
  })

  test('EARS-514: a flow-role holder DOES get the bytes, from the local-disk fallback', async ({
    context,
    baseURL,
    request,
  }) => {
    // The positive control. Without it the three refusals above are also passed
    // by a handler that answers 403 to everyone — and this flow is additionally
    // the acceptance criterion «a dev stand with no bucket configured works».
    await signInAsPlatformMember(context, baseURL as string, CLERK)
    const cookies = await context.cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    const response = await request.get(`/p/finance/api/documents/${documentId}`, {
      headers: { cookie: cookieHeader },
    })

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
    // Never inline, never cached: an attachment with nosniff, private no-store.
    expect(response.headers()['content-disposition']).toContain('attachment')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(Buffer.from(await response.body()).equals(DEV_SEED_DOCUMENT_BYTES)).toBe(true)
  })
})
