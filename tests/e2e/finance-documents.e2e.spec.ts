import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { sql } from 'drizzle-orm'

import { expect, test } from '@playwright/test'

import { FINANCE_DOCUMENTS_DEFAULT_DIR } from '@/lib/finance'
import { closePlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'

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
 * The fixture writes the rows DIRECTLY (through `platformTransaction`, the one
 * place that may set the audit context — spec 201 EARS-24) rather than through
 * the finance module: this spec is about what the SERVER answers, and a fixture
 * that went through the module would be testing the module twice. The blob
 * itself is never written — an authorized read is not what is being proved
 * here, and the access decision is taken before any byte is fetched.
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

/** The member the item belongs to. The witness below is deliberately NOT them. */
const OWNER_EMAIL = 'e2e-document-owner@bbm.academy'

/** A signed-in platform member holding neither flow role — the EARS-523 witness. */
const OUTSIDER = { email: 'e2e-outsider@bbm.academy', roles: ['platform-user'] }

/** The positive control: a refusal that is never lifted proves nothing. */
const CLERK = { email: OWNER_EMAIL, roles: ['platform-user', 'finance-entry'] }

/** The confirming file's bytes — written to the disk fallback by the fixture. */
const PDF = Buffer.from('%PDF-1.7 e2e fixture invoice')

let documentId: number
let storageKey: string

/**
 * Seed one intake item owned by `OWNER_EMAIL` with one document linked to it.
 *
 * Through `platformTransaction` and never through a hand-rolled
 * `set_config('app.…')`: the audit context is set in ONE place in this repo
 * (spec 201 EARS-24), and an eslint rule enforces it. The door is a `cli:` one
 * because a fixture is not a person (EARS-7).
 */
const FIXTURE_DOOR = { actorEmail: null, source: 'cli:e2e-fixture' } as const

const one = (rows: unknown[]): number => Number((rows[0] as { id: number }).id)

async function seedDocument(): Promise<number> {
  return platformTransaction(FIXTURE_DOOR, async (tx) => {
    await tx.execute(sql`
      insert into core.member (slug, email, name)
      values ('e2e-document-owner', ${OWNER_EMAIL}, 'E2E Document Owner')
      on conflict (email) do nothing
    `)
    const ownerId = one(
      (await tx.execute(sql`select id from core.member where email = ${OWNER_EMAIL}`)).rows,
    )
    await tx.execute(sql`
      insert into core.finance_currency (code, name, precision)
      values ('RUB', 'Рубль', 2) on conflict (code) do nothing
    `)
    const accountId = one(
      (
        await tx.execute(sql`
          insert into core.finance_account (name, kind, currency)
          values (${`E2E счёт ${Date.now()}`}, 'bank', 'RUB') returning id
        `)
      ).rows,
    )
    const purposeId = one(
      (
        await tx.execute(sql`
          insert into core.finance_purpose (name, product_binding)
          values (${`E2E назначение ${Date.now()}`}, 'forbidden') returning id
        `)
      ).rows,
    )
    const projectId = one(
      (await tx.execute(sql`select id from core.finance_project where is_fund limit 1`)).rows,
    )
    const itemId = one(
      (
        await tx.execute(sql`
          insert into core.finance_intake_item
            (source, kind, occurred_on, account_id, amount, currency, purpose_id, project_id,
             created_by)
          values ('request', 'expense', current_date, ${accountId}, 120000, 'RUB', ${purposeId},
                  ${projectId}, ${ownerId})
          returning id
        `)
      ).rows,
    )
    storageKey = `finance/documents/e2e/${Date.now()}.pdf`
    // The bytes go where the DISK FALLBACK expects them (EARS-514): this stand
    // has no bucket configured, which is the acceptance criterion, so writing
    // here is also the proof that the fallback is the path actually in use.
    const blob = path.resolve(FINANCE_DOCUMENTS_DEFAULT_DIR, storageKey)
    mkdirSync(path.dirname(blob), { recursive: true })
    writeFileSync(blob, PDF)
    const docId = one(
      (
        await tx.execute(sql`
          insert into core.finance_document (storage_key, filename, mime, size, kind, uploaded_by)
          values (${storageKey}, 'e2e-invoice.pdf',
                  ${'application/pdf'}, ${PDF.byteLength}, 'ru_invoice', ${ownerId})
          returning id
        `)
      ).rows,
    )
    await tx.execute(sql`
      insert into core.finance_document_link (document_id, intake_item_id, linked_by)
      values (${docId}, ${itemId}, ${ownerId})
    `)
    return docId
  })
}

test.beforeAll(async () => {
  test.skip(!databaseUrl, 'PLATFORM_DATABASE_URL is not set — no stand database to seed into')
  documentId = await seedDocument()
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
    expect(response.headers()['content-type'] ?? '').not.toContain('application/pdf')
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
    expect(response?.headers()['content-type'] ?? '').not.toContain('application/pdf')
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
    expect(response.headers()['content-type']).toContain('application/pdf')
    // Never inline, never cached: an attachment with nosniff, private no-store.
    expect(response.headers()['content-disposition']).toContain('attachment')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(Buffer.from(await response.body()).equals(PDF)).toBe(true)
  })
})
