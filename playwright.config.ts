import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import 'dotenv/config'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  /* The deployed-stand suite (tests/e2e/portal-prod.e2e.spec.ts) targets the
   * remote origins in PORTAL_E2E_BASE_URL/CMS_E2E_BASE_URL — when that mode is
   * active, don't boot (or require) the local dev server. All other e2e specs
   * run without these vars set and keep the local webServer as before. */
  webServer: process.env.PORTAL_E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        reuseExistingServer: true,
        url: 'http://localhost:3000',
      },
})
