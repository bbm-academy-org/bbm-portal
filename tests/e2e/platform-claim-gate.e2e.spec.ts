import { expect, test, type Page } from '@playwright/test'

import { isAllowedE2EIdpOrigin } from './support/idp-origin'

/**
 * The claim gate over `/p/admin`, end to end (spec 311 §B, acceptance scenario 7:
 * «The boundary is the server»).
 *
 * The unit tier (`tests/unit/platform-claim-gate.spec.ts`) proves the DECISION;
 * what no lower tier can say is that the decision is actually WIRED — that the
 * roles survive the round trip through Zitadel's token, the Auth.js session and
 * the layout, and that a refusal comes back as a real HTTP 403 with no chrome
 * rather than a rendered "access denied" page with status 200.
 *
 * Three flows, at three different credential requirements, so the file always
 * says something:
 *
 *   1. anonymous — runs on ANY stand, no credentials: a direct request to
 *      `/p/admin` never renders the cabinet; it lands at sign-in (EARS-405 —
 *      the URL alone grants nothing);
 *   2. admin — needs `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD`: an account
 *      holding `platform-admin` reaches `/p/admin` (EARS-417 — that ONE grant
 *      also carries it through the `/p` membership gate);
 *   3. member — needs `E2E_MEMBER_USERNAME` / `E2E_MEMBER_PASSWORD`: an account
 *      holding only `platform-user` TYPES the same URL and gets a bare 403 with
 *      an empty body (EARS-418, D-5).
 *
 * Flow 3 needs an account the dev IdP does NOT grant `platform-admin` to; the
 * dev test user `bbm-test` holds both roles after `provision.sh` step 8, so it
 * is the account for flow 2, not flow 3.
 *
 * Relative paths only, resolved against Playwright's `baseURL` — `E2E_PORT` /
 * `E2E_BASE_URL`, the one resolution in `tests/helpers/base-url.ts`
 * (`.claude/rules/parallel-sessions.md`: naming a port asserts the stand is
 * yours). Read-only: no flow here writes anything to the stand.
 *
 *   E2E_PORT=3005 E2E_ADMIN_USERNAME=… E2E_ADMIN_PASSWORD=… \
 *   pnpm test:e2e tests/e2e/platform-claim-gate.e2e.spec.ts
 *
 * The sign-in flow is a local copy for the same reason `hours-core-parity`
 * carries one: the shared-helper extraction is a follow-up, not a silent edit of
 * an acceptance-critical file.
 */

const idpHost = process.env.E2E_IDP_HOST
const adminUsername = process.env.E2E_ADMIN_USERNAME
const adminPassword = process.env.E2E_ADMIN_PASSWORD
const memberUsername = process.env.E2E_MEMBER_USERNAME
const memberPassword = process.env.E2E_MEMBER_PASSWORD

const ADMIN_PATH = '/p/admin'

async function signIn(
  page: Page,
  targetPath: string,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.goto(targetPath, { waitUntil: 'domcontentloaded' })

  if (new URL(page.url()).pathname.startsWith('/api/auth/signin')) {
    await page
      .getByRole('button', { name: /zitadel|sign in/i })
      .first()
      .click()
  }

  if (new URL(page.url()).pathname !== targetPath) {
    const loginName = page.locator('input[name="loginName"], input#loginName').first()
    await loginName.waitFor({ state: 'visible', timeout: 30_000 })
    // Credentials are never typed into an origin the operator did not name.
    if (!isAllowedE2EIdpOrigin(page.url(), idpHost)) {
      throw new Error(`Refusing to submit E2E username to untrusted IdP origin: ${page.url()}`)
    }
    await loginName.fill(credentials.username)
    await page.keyboard.press('Enter')
    const password = page.locator('input[type="password"]').first()
    await password.waitFor({ state: 'visible' })
    if (!isAllowedE2EIdpOrigin(page.url(), idpHost)) {
      throw new Error(`Refusing to submit E2E password to untrusted IdP origin: ${page.url()}`)
    }
    await password.fill(credentials.password)
    await page.keyboard.press('Enter')
  }

  await page.waitForURL((url) => url.pathname === targetPath, { timeout: 45_000 })
}

test.describe('the platform-admin claim gate over /p/admin (spec 311 §B)', () => {
  test('EARS-405: an anonymous request for the cabinet never renders it', async ({ page }) => {
    await page.goto(ADMIN_PATH, { waitUntil: 'domcontentloaded' })

    // Either the Auth.js sign-in route or the IdP login — both mean "not the
    // cabinet". What must NOT happen is the cabinet answering an anonymous
    // caller, so the assertion is on the CONTENT as well as the URL.
    expect(new URL(page.url()).pathname).not.toBe(ADMIN_PATH)
    await expect(page.getByRole('heading', { name: 'Админка' })).toHaveCount(0)
  })

  test('EARS-417: an account holding only platform-admin reaches the cabinet', async ({ page }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (an account holding platform-admin) to run',
    )

    await signIn(page, ADMIN_PATH, { username: adminUsername!, password: adminPassword! })

    await expect(page.getByRole('heading', { name: 'Админка' })).toBeVisible()
  })

  test('EARS-418: a member without the claim gets a bare 403, no chrome', async ({ page }) => {
    test.skip(
      !memberUsername || !memberPassword,
      'set E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD (an account WITHOUT platform-admin) to run',
    )

    // Sign in on a path the member may have, then TYPE the cabinet URL — the
    // scenario is a member who knows the address, not one who followed a link.
    await signIn(page, '/p/hours', { username: memberUsername!, password: memberPassword! })

    const response = await page.goto(ADMIN_PATH, { waitUntil: 'domcontentloaded' })

    expect(response?.status()).toBe(403)
    await expect(page.getByRole('heading', { name: 'Админка' })).toHaveCount(0)
    // Bare means bare (D-5): no explanation, no contact block, no login loop.
    expect(await page.locator('body').innerText()).toBe('')
    expect(new URL(page.url()).pathname).toBe(ADMIN_PATH)
  })
})
