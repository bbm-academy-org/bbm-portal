import { expect, type Locator, type Page } from '@playwright/test'

import { isAllowedE2EIdpOrigin } from './idp-origin'

/**
 * Signing an e2e flow in through the dev Zitadel's login-v2 screens.
 *
 * **Why this is not three `fill` calls.** login-v2 is a React app served as
 * pre-rendered HTML: the `loginName` input, the password input and the
 * `Continue` button all exist in the markup BEFORE react-hook-form hydrates,
 * and a value typed into that pre-hydration DOM is discarded when React takes
 * over the field. The symptom is a page that looks untouched — an EMPTY
 * Loginname box with `Continue` still disabled and the password screen never
 * reached — and it is a race, so it shows up in some runs and not others
 * (observed: 2 failures in 4 runs of the claim-gate file, once on EARS-417,
 * once on EARS-418).
 *
 * The signal this file waits on is the SUBMIT BUTTON becoming enabled. On both
 * screens Zitadel renders it `disabled` and enables it only from the hydrated
 * form's own validation state, so "enabled" is the one observation that means
 * BOTH «React has taken the form over» AND «the value we typed is the value it
 * is holding». A `waitForTimeout` would only make the race less likely; this
 * makes it unobservable. The fill is re-run inside `expect.toPass()` so a fill
 * that lost the race is simply repeated rather than failing the flow.
 *
 * Credentials are never typed into an origin the operator did not name
 * (`E2E_IDP_HOST`, checked by `isAllowedE2EIdpOrigin`) — the check runs again
 * before the password, because the loginName step navigates in between.
 */

export interface ZitadelCredentials {
  username: string
  password: string
}

export interface ZitadelSignInOptions {
  /** `E2E_IDP_HOST` — the only non-production IdP origin credentials may reach. */
  idpHost?: string
}

const HYDRATION_TIMEOUT = 30_000
const NAVIGATION_TIMEOUT = 45_000

/**
 * Fill one login-v2 field and submit it, treating "the submit button is
 * enabled" as the proof that the form is hydrated and holds our value.
 */
async function fillAndSubmit(page: Page, field: Locator, value: string): Promise<void> {
  const submit = page.locator('form button[type="submit"]').first()

  await expect(field).toBeVisible({ timeout: HYDRATION_TIMEOUT })

  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value, { timeout: 1_000 })
    await expect(submit).toBeEnabled({ timeout: 2_000 })
  }).toPass({ timeout: HYDRATION_TIMEOUT, intervals: [200, 500, 1_000] })

  await submit.click()
}

/**
 * Drive `targetPath` to a signed-in render: follow the Auth.js sign-in route if
 * it appears, then the IdP's loginName + password screens, then wait for the
 * app to land back on `targetPath`.
 *
 * Paths are RELATIVE, resolved against Playwright's `baseURL` (the single
 * resolution in `tests/helpers/base-url.ts`).
 */
export async function signInThroughZitadel(
  page: Page,
  targetPath: string,
  credentials: ZitadelCredentials,
  options: ZitadelSignInOptions = {},
): Promise<void> {
  const { idpHost } = options

  await page.goto(targetPath, { waitUntil: 'domcontentloaded' })

  if (new URL(page.url()).pathname.startsWith('/api/auth/signin')) {
    await page
      .getByRole('button', { name: /zitadel|sign in/i })
      .first()
      .click()
  }

  if (new URL(page.url()).pathname !== targetPath) {
    // Scoped to the VISIBLE field on purpose: the password screen carries a
    // hidden `loginName` input as well, so an unscoped locator would keep
    // matching after the first step has already been submitted.
    const loginName = page
      .locator('input[name="loginName"]:visible, input#loginName:visible')
      .first()
    await expect(loginName).toBeVisible({ timeout: HYDRATION_TIMEOUT })

    if (!isAllowedE2EIdpOrigin(page.url(), idpHost)) {
      throw new Error(`Refusing to submit E2E username to untrusted IdP origin: ${page.url()}`)
    }
    await fillAndSubmit(page, loginName, credentials.username)

    const password = page.locator('input[type="password"]').first()
    await expect(password).toBeVisible({ timeout: HYDRATION_TIMEOUT })

    if (!isAllowedE2EIdpOrigin(page.url(), idpHost)) {
      throw new Error(`Refusing to submit E2E password to untrusted IdP origin: ${page.url()}`)
    }
    await fillAndSubmit(page, password, credentials.password)
  }

  await page.waitForURL((url) => url.pathname === targetPath, { timeout: NAVIGATION_TIMEOUT })
}
