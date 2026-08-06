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
