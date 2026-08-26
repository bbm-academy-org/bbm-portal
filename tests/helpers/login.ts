import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export interface LoginOptions {
  page: Page
  user: {
    email: string
    password: string
  }
}

/**
 * Hook budget for a `beforeAll` that signs in through `login()` (DEBT 2026-08-15).
 *
 * Playwright's default hook timeout is the 30 s test timeout, which is shorter
 * than `next dev`'s FIRST compile of `/admin` on a cold stand: the hook dies
 * waiting for `#field-email`, `admin.e2e.spec.ts` and `publish-panel.e2e.spec.ts`
 * go red, and the rest of the run is skipped. Nothing is wrong with the product —
 * a warmed stand passes — but task-cycle stage 5 makes a green Playwright run the
 * precondition for inviting the owner to a UI flow, so a routinely-red first run
 * of the day is expensive noise.
 *
 * Raised HERE and not via the config's global `timeout` on purpose: only the
 * sign-in hook pays the cold compile, and loosening every test's budget would
 * hide genuine hangs. Each such hook calls
 * `test.setTimeout(COLD_START_HOOK_TIMEOUT_MS)` as its first statement.
 */
export const COLD_START_HOOK_TIMEOUT_MS = 180_000

/**
 * Logs the user into the admin panel via the login page.
 *
 * Paths are RELATIVE on purpose (#169): the origin comes from Playwright's
 * `baseURL`, resolved once in `tests/helpers/base-url.ts` from
 * E2E_BASE_URL / E2E_PORT. A `serverURL` option here would be a second place
 * that decides which stand the suite talks to — exactly the drift that let the
 * suite attach to a parallel session's stand on port 3000.
 */
export async function login({ page, user }: LoginOptions): Promise<void> {
  await page.goto('/admin/login')

  await page.fill('#field-email', user.email)
  await page.fill('#field-password', user.password)
  await page.click('button[type="submit"]')

  await page.waitForURL('/admin')

  const dashboardArtifact = page.locator('span[title="Dashboard"]')
  await expect(dashboardArtifact).toBeVisible()
}
