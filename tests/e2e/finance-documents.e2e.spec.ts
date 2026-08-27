import { Client } from 'pg'

import { expect, test } from '@playwright/test'

import { signInThroughZitadel } from './support/zitadel-sign-in'

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
 * The fixture writes DIRECTLY to the stand's platform database with `pg` rather
 * than importing the finance module: this spec is about what the SERVER answers,
 * and a fixture that went through the module would be testing the module twice.
 * The blob itself is never written — an authorized read is not what is being
 * proved here, and the access decision is taken before any byte is fetched.
 *
 * Two flows at two credential requirements, so the file always says something:
 *
 *   1. anonymous — runs on ANY stand, no credentials: the document URL never
 *      returns the document;
 *   2. member — needs `E2E_MEMBER_USERNAME` / `E2E_MEMBER_PASSWORD`, an account
 *      holding `platform-user` and NEITHER flow role: the same URL, now with a
 *      real session, still refuses because the item belongs to someone else.
 *
 * Relative paths only, resolved against Playwright's `baseURL` (`E2E_PORT` /
 * `E2E_BASE_URL` — `tests/helpers/base-url.ts`; naming a port asserts the stand
 * is yours, `.claude/rules/parallel-sessions.md`).
 *
 *   E2E_PORT=3005 E2E_IDP_HOST=truenas.local:9180 \
 *   E2E_MEMBER_USERNAME=… E2E_MEMBER_PASSWORD=… \
 *   pnpm test:e2e tests/e2e/finance-documents.e2e.spec.ts
 */

const idpHost = process.env.E2E_IDP_HOST
const memberUsername = process.env.E2E_MEMBER_USERNAME
const memberPassword = process.env.E2E_MEMBER_PASSWORD
const databaseUrl = process.env.PLATFORM_DATABASE_URL

/** Whoever signs in for flow 2, this is not them — the item is «someone else's». */
const OWNER_EMAIL = 'e2e-document-owner@bbm.academy'

let documentId: number

/**
 * Seed one intake item owned by `OWNER_EMAIL` with one document linked to it.
 *
 * `set_config('app.source', …)` is not optional: the universal edit audit
 * (spec 201 EARS-24/26) refuses any write to `core` that names no door.
 */
async function seedDocument(): Promise<number> {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.source', 'cli:e2e-fixture', true)`)
    await client.query(`
      insert into core.member (slug, email, name)
      values ('e2e-document-owner', $1, 'E2E Document Owner')
      on conflict (email) do nothing
    `, [OWNER_EMAIL])
    const owner = await client.query<{ id: number }>(
      'select id from core.member where email = $1',
      [OWNER_EMAIL],
    )
    const ownerId = owner.rows[0].id
    await client.query(`
      insert into core.finance_currency (code, name, precision)
      values ('RUB', 'Рубль', 2) on conflict (code) do nothing
    `)
    const account = await client.query<{ id: number }>(`
      insert into core.finance_account (name, kind, currency)
      values ('E2E счёт', 'bank', 'RUB')
      returning id
    `)
    const purpose = await client.query<{ id: number }>(`
      insert into core.finance_purpose (name, product_binding)
      values ('E2E назначение', 'forbidden')
      returning id
    `)
    const project = await client.query<{ id: number }>(
      'select id from core.finance_project where is_fund limit 1',
    )
    const item = await client.query<{ id: number }>(`
      insert into core.finance_intake_item
        (source, kind, occurred_on, account_id, amount, currency, purpose_id, project_id, created_by)
      values ('request', 'expense', current_date, $1, 120000, 'RUB', $2, $3, $4)
      returning id
    `, [account.rows[0].id, purpose.rows[0].id, project.rows[0].id, ownerId])
    const doc = await client.query<{ id: number }>(`
      insert into core.finance_document (storage_key, filename, mime, size, kind, uploaded_by)
      values ($1, 'e2e-invoice.pdf', 'application/pdf', 24, 'ru_invoice', $2)
      returning id
    `, [`finance/documents/e2e/${Date.now()}.pdf`, ownerId])
    await client.query(`
      insert into core.finance_document_link (document_id, intake_item_id, linked_by)
      values ($1, $2, $3)
    `, [doc.rows[0].id, item.rows[0].id, ownerId])
    await client.query('commit')
    return doc.rows[0].id
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

test.beforeAll(async () => {
  test.skip(!databaseUrl, 'PLATFORM_DATABASE_URL is not set — no stand database to seed into')
  documentId = await seedDocument()
})

test.describe('a finance document has no URL that gives it away (spec 339 scenario 9)', () => {
  test('EARS-523: a signed-out request for a document never returns it', async ({ page }) => {
    const response = await page.goto(`/p/finance/api/documents/${documentId}`, {
      waitUntil: 'domcontentloaded',
    })

    // Either the Auth.js sign-in route, the IdP login, or a bare refusal — what
    // must NOT happen is a PDF coming back.
    expect(response).not.toBeNull()
    const status = response?.status() ?? 0
    const contentType = response?.headers()['content-type'] ?? ''
    expect(contentType).not.toContain('application/pdf')
    if (status === 200) {
      expect(page.url()).toMatch(/\/(api\/auth\/signin|ui\/v2\/login|oauth\/v2\/authorize)/)
    } else {
      expect([401, 403]).toContain(status)
    }
  })

  test('EARS-514: no unauthenticated object-storage URL is handed out either', async ({
    request,
  }) => {
    // The metadata endpoint is the only place a client could learn a storage
    // key from; anonymous, it answers nothing at all.
    const response = await request.get(`/p/finance/api/documents/${documentId}`, {
      maxRedirects: 0,
    })

    expect(response.status()).not.toBe(200)
    // …and nothing in the answer leaks a bucket URL to try directly.
    expect(await response.text()).not.toMatch(/s3|twcstorage|storage_key/i)
  })

  test('EARS-523: a signed-in role-less member is refused someone elses document', async ({
    page,
  }) => {
    test.skip(
      !memberUsername || !memberPassword,
      'needs E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD — an account with NEITHER finance flow role',
    )

    await signInThroughZitadel(
      page,
      '/p',
      { username: memberUsername as string, password: memberPassword as string },
      { idpHost },
    )

    const response = await page.goto(`/p/finance/api/documents/${documentId}`, {
      waitUntil: 'domcontentloaded',
    })

    expect(response?.status()).toBe(403)
    expect(response?.headers()['content-type'] ?? '').not.toContain('application/pdf')
  })
})
