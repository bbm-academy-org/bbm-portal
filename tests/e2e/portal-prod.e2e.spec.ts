import { expect, test } from '@playwright/test'

/**
 * Browser E2E for the spec 060 acceptance scenarios 1–5 (issue #60) — runs
 * against a REAL deployed stand, never against the local dev server. The
 * mandatory green run happens BEFORE the owner is invited to accept
 * (task-cycle stage 5 precondition).
 *
 * Parameterized by env; the whole file self-skips when the origins are unset,
 * so CI / local `pnpm test:e2e` runs are unaffected:
 *   PORTAL_E2E_BASE_URL  e.g. https://portal.bbm.academy
 *   CMS_E2E_BASE_URL     e.g. https://cms.bbm.academy
 * The login scenario additionally needs real IdP credentials and self-skips
 * without them:
 *   E2E_IDP_USERNAME / E2E_IDP_PASSWORD
 *
 * Example run:
 *   PORTAL_E2E_BASE_URL=https://portal.bbm.academy \
 *   CMS_E2E_BASE_URL=https://cms.bbm.academy \
 *   pnpm test:e2e tests/e2e/portal-prod.e2e.spec.ts
 * (playwright.config.ts skips the local webServer when PORTAL_E2E_BASE_URL is
 * set.)
 */

const portalBase = (process.env.PORTAL_E2E_BASE_URL ?? '').replace(/\/+$/, '')
const cmsBase = (process.env.CMS_E2E_BASE_URL ?? '').replace(/\/+$/, '')
const idpUsername = process.env.E2E_IDP_USERNAME
const idpPassword = process.env.E2E_IDP_PASSWORD

// Markers that only the rendered OKR dashboard contains (OkrView) — asserting
// their ABSENCE proves no PII/dashboard data leaked to an anonymous context.
const OKR_ROOT = '.okr-root'
const OKR_OVERLINE_TEXT = 'Северная звезда'

/** Anonymous /p/okr must land on a login (Auth.js sign-in hop or the Zitadel
 * login UI on id.bbm.academy) with zero dashboard content. */
async function expectAnonymousLogin(page: import('@playwright/test').Page) {
  await page.goto(`${portalBase}/p/okr`, { waitUntil: 'domcontentloaded' })
  const url = new URL(page.url())
  expect(url.pathname, 'anonymous request must be redirected off /p/okr').not.toBe('/p/okr')
  expect(
    url.hostname === 'id.bbm.academy' || url.pathname.startsWith('/api/auth/signin'),
    `expected the IdP login or the Auth.js sign-in hop, got ${page.url()}`,
  ).toBe(true)
  await expect(page.locator(OKR_ROOT)).toHaveCount(0)
  await expect(page.getByText(OKR_OVERLINE_TEXT)).toHaveCount(0)
}

test.describe('portal.bbm.academy prod acceptance (spec 060 scenarios 1–5)', () => {
  test.skip(
    !portalBase || !cmsBase,
    'deployed-stand suite: set PORTAL_E2E_BASE_URL and CMS_E2E_BASE_URL to run',
  )

  test('scenario 1: anonymous /p/okr redirects to login — no data leaked', async ({ page }) => {
    await expectAnonymousLogin(page)
  })

  test('scenario 2: login via Zitadel returns to /p/okr with the OKR tree', async ({ page }) => {
    test.skip(!idpUsername || !idpPassword, 'set E2E_IDP_USERNAME / E2E_IDP_PASSWORD to run')
    test.slow() // full OIDC round-trip + live Plane data

    await page.goto(`${portalBase}/p/okr`, { waitUntil: 'domcontentloaded' })

    // Hop 1 (only if the Auth.js provider-picker page is shown): single
    // provider — one button forwards to Zitadel.
    if (new URL(page.url()).pathname.startsWith('/api/auth/signin')) {
      await page.getByRole('button', { name: /zitadel|sign in/i }).first().click()
      await page.waitForURL(/id\.bbm\.academy/)
    }

    // Zitadel login. Tolerate both the classic (loginName -> password steps)
    // and single-form variants.
    const loginName = page.locator('input[name="loginName"], input#loginName').first()
    await loginName.fill(idpUsername!)
    await page.keyboard.press('Enter')
    const password = page.locator('input[type="password"]').first()
    await password.waitFor({ state: 'visible' })
    await password.fill(idpPassword!)
    await page.keyboard.press('Enter')

    // Back on the portal with a session: the dashboard renders live data.
    await page.waitForURL(`${portalBase}/p/okr`, { timeout: 45_000 })
    await expect(page.locator(OKR_ROOT)).toBeVisible()
    await expect(page.getByText(OKR_OVERLINE_TEXT).first()).toBeVisible()
  })

  test('scenario 3: CMS host is clean — /p/okr and /api/auth/* 404, /admin and frontend keep working', async ({
    page,
  }) => {
    // Platform surface must not exist on the CMS host (ADR-003 default-deny).
    for (const path of ['/p/okr', '/api/auth/signin', '/api/auth/session']) {
      const res = await page.request.get(`${cmsBase}${path}`, { maxRedirects: 0 })
      expect(res.status(), `${cmsBase}${path}`).toBe(404)
    }
    // Payload admin still serves its login UI…
    await page.goto(`${cmsBase}/admin`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('input[type="password"]')).toBeVisible()
    // …and the (frontend) static-backend root still answers.
    const home = await page.request.get(`${cmsBase}/`)
    expect(home.ok()).toBe(true)
  })

  test('scenario 4: portal host is clean — /admin and Payload API 404', async ({ page }) => {
    for (const path of ['/admin', '/admin/login', '/api/pages', '/api/graphql', '/']) {
      const res = await page.request.get(`${portalBase}${path}`, { maxRedirects: 0 })
      expect(res.status(), `${portalBase}${path}`).toBe(404)
    }
  })

  test('scenario 5: fresh (incognito) context has no session and sees no data', async ({
    browser,
  }) => {
    // A brand-new context = no cookies, the incognito check of scenario 5.
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      const session = await page.request.get(`${portalBase}/api/auth/session`)
      if (session.ok()) {
        const body = await session.text()
        expect(body === '' || body === 'null' || body === '{}').toBe(true)
      }
      await expectAnonymousLogin(page)
    } finally {
      await context.close()
    }
  })
})
