import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import 'dotenv/config'

import { portConflictMessage, resolveE2eTarget } from './tests/helpers/base-url'
import { probePortFree } from './tools/dev/dev-ports.mjs'

/**
 * See https://playwright.dev/docs/test-configuration.
 */

/* Where the local suite points (#169). ONE resolution, in tests/helpers/base-url.ts:
 * E2E_BASE_URL / E2E_PORT, defaulting to localhost on DEFAULT_E2E_PORT. Specs use
 * RELATIVE paths and inherit it via `use.baseURL` — no spec spells its own origin. */
const target = resolveE2eTarget(process.env)

/* The deployed-stand suites (tests/e2e/portal-prod, hours-prod) target the remote
 * origins in PORTAL_E2E_BASE_URL/CMS_E2E_BASE_URL — when that mode is active,
 * don't boot (or require) the local dev server. All other e2e specs run without
 * these vars set and keep the local webServer as before. */
const remoteMode = Boolean(process.env.PORTAL_E2E_BASE_URL)

/* Refuse to run against a stand nobody named (#169). With parallel sessions on one
 * box, a listener on the DEFAULT port is most likely another session's acceptance
 * stand; attaching to it would seed and delete users in the shared dev DB under
 * someone else's acceptance. An explicitly named target is the operator taking
 * responsibility for that port and IS reused (see `reuseExistingServer` below), so
 * this pre-flight guards only the default. Playwright would fail here on its own
 * too, but its message advises exactly the fix that caused this bug
 * ("set reuseExistingServer: true"). */
if (!remoteMode && !target.explicit && !(await probePortFree(target.port))) {
  throw new Error(portConflictMessage(target.port))
}

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
    /* Base URL for the relative paths the specs use — `page.goto('/admin')` and
     * the `request` fixture's `/api/...` calls both resolve against it. */
    baseURL: target.baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: remoteMode
    ? undefined
    : {
        command: 'pnpm dev',
        /* `next dev` reads PORT — the same boot form `pnpm dev:ports` prints.
         * `pnpm dev -- -p <n>` does NOT work here (the `--` reaches Next as a path). */
        env: { PORT: String(target.port) },
        /* Reuse ONLY a target the operator named (E2E_PORT / E2E_BASE_URL). A
         * default run boots its own server; the pre-flight above has already
         * refused if the default port was taken. */
        reuseExistingServer: target.reuseExistingServer,
        url: target.baseURL,
      },
})
