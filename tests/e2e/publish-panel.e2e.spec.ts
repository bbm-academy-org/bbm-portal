import { test, expect, Page } from '@playwright/test'
import { getPayload } from 'payload'
import config from '../../src/payload.config.js'
import { login } from '../helpers/login'

/**
 * #17 — admin "Publish to site" panel, end-to-end on the dashboard.
 *
 * A real publish needs the prod GitHub dispatch token, so we DON'T hit GitHub:
 * the three admin endpoints are stubbed with Playwright route interception to
 * drive the flow deterministically:
 *   - GET  /api/pending-changes   → one changed doc (so the confirm-list renders
 *                                    and the button is enabled),
 *   - POST /api/publish-site      → 200 (accepted),
 *   - GET  /api/site-build-status → first poll "in_progress" (Building…), then
 *                                    "completed/success" (Published).
 *
 * We assert each visible state: confirm-list shows the changed doc → click
 * Publish → status shows Building → next poll shows Published.
 */

// A DEDICATED admin user for this suite — NOT the shared `seedUser` helper's
// `dev@payloadcms.com`. Playwright runs e2e files in parallel, and the shared
// helper deletes+recreates that one user in its `beforeAll`; reusing it here
// would race admin.e2e's login. A distinct email keeps the two suites isolated.
const panelUser = { email: 'publish-panel-e2e@bbm.academy', password: 'test-publish-17' }

const seedPanelUser = async (): Promise<void> => {
  const payload = await getPayload({ config })
  await payload.delete({ collection: 'users', where: { email: { equals: panelUser.email } } })
  await payload.create({ collection: 'users', data: panelUser })
}

const cleanupPanelUser = async (): Promise<void> => {
  const payload = await getPayload({ config })
  await payload.delete({ collection: 'users', where: { email: { equals: panelUser.email } } })
}

test.describe('Publish to site panel (#17)', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    await seedPanelUser()
    const context = await browser.newContext()
    page = await context.newPage()
  })

  test.afterAll(async () => {
    await cleanupPanelUser()
  })

  test('confirm-list → Publish → Building → Published', async () => {
    // pending-changes: one staged team draft so the confirm-list is non-empty.
    await page.route('**/api/pending-changes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pending: [
            {
              surface: 'team',
              type: 'collection',
              ids: ['eduard-ildarkhanov'],
              labels: ['Eduard Ildarkhanov'],
            },
          ],
          count: 1,
        }),
      })
    })

    // The build lifecycle is driven by a small state machine so the flow is
    // deterministic regardless of how the panel times its polls:
    //   - before Publish is clicked         → "no run yet" (all-null),
    //   - the publish POST flips to building,
    //   - the FIRST status read after that  → in_progress (Building…),
    //   - every later read                  → completed/success (Published).
    let published = false
    let statusReadsAfterPublish = 0
    const RUN_URL = 'https://github.com/owner/repo/actions/runs/1'

    // publish-site: accept the publish (no real dispatch) and arm the lifecycle.
    await page.route('**/api/publish-site', async (route) => {
      published = true
      statusReadsAfterPublish = 0
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          published: [{ surface: 'team', ids: ['eduard-ildarkhanov'] }],
          dispatch: { event_type: 'publish-site', repo: 'owner/repo', at: new Date().toISOString() },
        }),
      })
    })

    // site-build-status: null until publish, then in_progress once, then completed.
    await page.route('**/api/site-build-status', async (route) => {
      let body
      if (!published) {
        body = { status: null, conclusion: null, html_url: null, startedAt: null }
      } else {
        statusReadsAfterPublish += 1
        body =
          statusReadsAfterPublish <= 1
            ? {
                status: 'in_progress',
                conclusion: null,
                html_url: RUN_URL,
                startedAt: new Date().toISOString(),
              }
            : {
                status: 'completed',
                conclusion: 'success',
                html_url: RUN_URL,
                startedAt: new Date().toISOString(),
              }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })

    // Log in (the login helper navigates to /admin and asserts the dashboard).
    await login({ page, user: panelUser })
    await page.goto('http://localhost:3000/admin')

    // 1 — confirm-list shows the changed doc.
    const panel = page.locator('[data-testid="pending-changes"]')
    await expect(panel.getByText('Eduard Ildarkhanov')).toBeVisible()

    const publishButton = page.getByRole('button', { name: 'Publish to site' })
    await expect(publishButton).toBeEnabled()

    // 2 — click Publish → status shows Building.
    await publishButton.click()
    await expect(page.locator('[data-status="building"]')).toBeVisible()

    // 3 — next poll → Published (terminal). Button is no longer "Building…".
    await expect(page.locator('[data-status="published"]')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/^Published/)).toBeVisible()
  })

  test('no pending drafts → button STAYS enabled (publish to site is not gated on drafts)', async () => {
    // Regression: publishing pushes the current PUBLISHED CMS state to the static
    // site, which is independent of whether unpublished drafts exist. After a
    // native Payload "Publish changes" there are zero drafts — the button must
    // still be usable, and the panel must not claim the site is "up to date".
    // (Routes registered here take precedence over the prior test's handlers.)
    await page.route('**/api/pending-changes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pending: [], count: 0 }),
      })
    })
    await page.route('**/api/site-build-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: null, conclusion: null, html_url: null, startedAt: null }),
      })
    })

    // Already authenticated from the first test (shared page/context); just reload.
    await page.goto('http://localhost:3000/admin')

    // Honest copy — NOT the old false "site is up to date with the CMS".
    await expect(page.locator('[data-testid="nothing-to-publish"]')).toContainText(
      'No unpublished drafts',
    )

    // The fix: with zero pending drafts the button is still enabled.
    await expect(page.getByRole('button', { name: 'Publish to site' })).toBeEnabled()
  })
})
