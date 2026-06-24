import { test, expect, Page } from '@playwright/test'
import { getPayload } from 'payload'
import config from '../../src/payload.config.js'
import { login } from '../helpers/login'

/**
 * #46 — admin publish panel, end-to-end on the dashboard, rewritten for the
 * "publish = live" DRIFT model (the panel was rebuilt in #45).
 *
 * The panel is now a site↔CMS drift indicator + batch/rebuild button, driven by
 * ONE consolidated read `GET /api/site-sync-status`. A real publish/rebuild
 * needs the prod GitHub dispatch token, so we DON'T hit GitHub: every endpoint
 * is stubbed with Playwright route interception to drive the flow deterministically:
 *   - GET  /api/site-sync-status → the consolidated drift shape
 *       `{ pendingCount, lastPublishedAt, lastSuccessfulBuildAt, currentRun, inSync, building }`,
 *   - GET  /api/pending-changes  → the confirm-list (only fetched when pendingCount > 0),
 *   - POST /api/publish-site     → 200 (accepted; batch publish also rebuilds).
 *
 * DOM hooks the panel exposes (relied on below, EXACTLY as #45 emits them):
 *   - wrapper `data-testid="sync-status"` with `data-status` ∈
 *       { "building" | "in-sync" | "behind" },
 *   - confirm-list `data-testid="pending-changes"`, rows `data-testid="pending-item"`,
 *   - action button by role + accessible name: `Пересобрать сайт` (rebuild) or
 *       `Опубликовать N изменени… на сайт` (batch). When in-sync the button is
 *       ABSENT from the DOM (not merely disabled).
 *
 * We drive and assert each visible state: in-sync, behind (rebuild), pending
 * (batch), and a full publish → building → matches lifecycle.
 */

// A DEDICATED admin user for this suite — NOT the shared `seedUser` helper's
// `dev@payloadcms.com`. Playwright runs e2e files in parallel, and the shared
// helper deletes+recreates that one user in its `beforeAll`; reusing it here
// would race admin.e2e's login. A distinct email keeps the two suites isolated.
const panelUser = { email: 'publish-panel-e2e@bbm.academy', password: 'test-publish-46' }

const seedPanelUser = async (): Promise<void> => {
  const payload = await getPayload({ config })
  await payload.delete({ collection: 'users', where: { email: { equals: panelUser.email } } })
  await payload.create({ collection: 'users', data: panelUser })
}

const cleanupPanelUser = async (): Promise<void> => {
  const payload = await getPayload({ config })
  await payload.delete({ collection: 'users', where: { email: { equals: panelUser.email } } })
}

// Any action button (batch publish OR rebuild). Used to assert presence/absence
// without coupling to which specific variant rendered.
const ANY_ACTION_BUTTON = /Опубликовать|Пересобрать/

test.describe('Publish to site panel — drift model (#46)', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    await seedPanelUser()
    const context = await browser.newContext()
    page = await context.newPage()
    // Authenticate once for the whole suite (shared page/context). Each test
    // (re)registers its own route stubs before reloading, so they don't leak.
    await login({ page, user: panelUser })
  })

  test.afterAll(async () => {
    await cleanupPanelUser()
  })

  test('in sync → ✅ copy, status="in-sync", NO action button in the DOM', async () => {
    // inSync && !building → the panel is status-only. The action button must be
    // entirely ABSENT (the #45 contract hides it, it is not merely disabled).
    const builtAt = '2026-06-24T10:05:00.000Z'
    const publishedAt = '2026-06-24T10:00:00.000Z'
    await page.route('**/api/site-sync-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pendingCount: 0,
          lastPublishedAt: publishedAt,
          lastSuccessfulBuildAt: builtAt,
          currentRun: {
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/owner/repo/actions/runs/1',
            startedAt: publishedAt,
          },
          inSync: true,
          building: false,
        }),
      })
    })

    await page.goto('http://localhost:3000/admin')

    const status = page.locator('[data-testid="sync-status"]')
    await expect(status).toHaveAttribute('data-status', 'in-sync')
    await expect(status.getByText(/✅ Сайт совпадает с CMS/)).toBeVisible()

    // The defining assertion: NO action button exists at all in the in-sync state.
    await expect(page.getByRole('button', { name: ANY_ACTION_BUTTON })).toHaveCount(0)
    // …and no confirm-list either (pendingCount === 0 → not fetched/rendered).
    await expect(page.locator('[data-testid="pending-changes"]')).toHaveCount(0)
  })

  test('behind, nothing pending → ⚠️ both timestamps + "Пересобрать сайт" button', async () => {
    // !building && !inSync && pendingCount === 0 → a publish landed but its build
    // hasn't succeeded yet (here: the latest run FAILED). The panel shows BOTH
    // timestamps and offers the manual-rebuild safety net.
    const publishedAt = '2026-06-24T11:00:00.000Z'
    const builtAt = '2026-06-24T09:00:00.000Z' // older than publishedAt → behind
    await page.route('**/api/site-sync-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pendingCount: 0,
          lastPublishedAt: publishedAt,
          lastSuccessfulBuildAt: builtAt,
          currentRun: {
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/owner/repo/actions/runs/2',
            startedAt: publishedAt,
          },
          inSync: false,
          building: false,
        }),
      })
    })

    await page.goto('http://localhost:3000/admin')

    const status = page.locator('[data-testid="sync-status"]')
    await expect(status).toHaveAttribute('data-status', 'behind')
    // The "behind" copy surfaces BOTH the publish and the build timestamps. We
    // assert the stable label markers ("опубликовано …, собрано …") rather than
    // the formatted clock string, which depends on the browser's locale/TZ. The
    // panel renders an em dash only for null/invalid times, so requiring real
    // times here (no "—" between the markers) pins that both are shown.
    await expect(status.getByText(/опубликовано .+, собрано .+\)/)).toBeVisible()
    await expect(status.getByText(/опубликовано —/)).toHaveCount(0)

    // Nothing pending, but out of sync → the secondary manual-rebuild button.
    await expect(page.getByRole('button', { name: 'Пересобрать сайт' })).toBeVisible()
    // No confirm-list (pendingCount === 0).
    await expect(page.locator('[data-testid="pending-changes"]')).toHaveCount(0)
  })

  test('pending changes → confirm-list + "Опубликовать 1 изменение на сайт" button', async () => {
    // pendingCount > 0 → the panel fetches /api/pending-changes and renders the
    // confirm-list, and the action button is the PRIMARY batch-publish variant
    // with a correctly pluralized Russian label ("1 изменение").
    await page.route('**/api/site-sync-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pendingCount: 1,
          lastPublishedAt: '2026-06-24T08:00:00.000Z',
          lastSuccessfulBuildAt: '2026-06-24T08:01:00.000Z',
          currentRun: null,
          inSync: false,
          building: false,
        }),
      })
    })
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

    await page.goto('http://localhost:3000/admin')

    // Behind (a publish exists but isn't live yet) AND it has pending changes.
    const status = page.locator('[data-testid="sync-status"]')
    await expect(status).toHaveAttribute('data-status', 'behind')

    // The confirm-list renders the labelled pending doc.
    const panel = page.locator('[data-testid="pending-changes"]')
    await expect(panel).toBeVisible()
    const item = panel.locator('[data-testid="pending-item"]')
    await expect(item).toHaveCount(1)
    await expect(item).toHaveText('Eduard Ildarkhanov')

    // Primary batch-publish button with the singular Russian plural form.
    await expect(
      page.getByRole('button', { name: 'Опубликовать 1 изменение на сайт' }),
    ).toBeVisible()
  })

  test('Publish → Building → site matches (full lifecycle)', async () => {
    // From the pending state: click batch-publish, POST /api/publish-site succeeds,
    // the indicator flips to "building", then the next poll lands the terminal
    // in-sync state. The build lifecycle is driven by a small state machine so the
    // flow is deterministic regardless of how the panel times its polls:
    //   - before Publish is clicked → pending (status="behind", batch button),
    //   - the publish POST flips `published`,
    //   - the FIRST status read after that → building (status="building"),
    //   - every later read              → in-sync terminal (status="in-sync").
    let published = false
    let statusReadsAfterPublish = 0
    const RUN_URL = 'https://github.com/owner/repo/actions/runs/3'

    // pending-changes: one staged team draft so the confirm-list is non-empty and
    // the batch button renders before publishing.
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
          count: published ? 0 : 1,
        }),
      })
    })

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

    // site-sync-status: pending until publish, then building once, then in-sync.
    await page.route('**/api/site-sync-status', async (route) => {
      let body
      if (!published) {
        // Pre-publish: behind with one pending change → batch button shown.
        body = {
          pendingCount: 1,
          lastPublishedAt: '2026-06-24T12:00:00.000Z',
          lastSuccessfulBuildAt: '2026-06-24T12:01:00.000Z',
          currentRun: null,
          inSync: false,
          building: false,
        }
      } else {
        statusReadsAfterPublish += 1
        body =
          statusReadsAfterPublish <= 1
            ? {
                // First read after publish: a build is running.
                pendingCount: 0,
                lastPublishedAt: '2026-06-24T12:10:00.000Z',
                lastSuccessfulBuildAt: '2026-06-24T12:01:00.000Z',
                currentRun: {
                  status: 'in_progress',
                  conclusion: null,
                  html_url: RUN_URL,
                  startedAt: new Date().toISOString(),
                },
                inSync: false,
                building: true,
              }
            : {
                // Terminal: the build succeeded → the site matches the CMS again.
                pendingCount: 0,
                lastPublishedAt: '2026-06-24T12:10:00.000Z',
                lastSuccessfulBuildAt: '2026-06-24T12:11:00.000Z',
                currentRun: {
                  status: 'completed',
                  conclusion: 'success',
                  html_url: RUN_URL,
                  startedAt: '2026-06-24T12:10:00.000Z',
                },
                inSync: true,
                building: false,
              }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })

    await page.goto('http://localhost:3000/admin')

    const status = page.locator('[data-testid="sync-status"]')

    // 1 — pre-publish: behind, confirm-list shows the changed doc, batch button.
    await expect(status).toHaveAttribute('data-status', 'behind')
    await expect(
      page.locator('[data-testid="pending-changes"]').getByText('Eduard Ildarkhanov'),
    ).toBeVisible()
    const publishButton = page.getByRole('button', { name: 'Опубликовать 1 изменение на сайт' })
    await expect(publishButton).toBeEnabled()

    // 2 — click Publish → the indicator flips to "building".
    await publishButton.click()
    await expect(status).toHaveAttribute('data-status', 'building')
    await expect(status.getByText(/Идёт сборка…/)).toBeVisible()

    // 3 — next poll → in-sync terminal. The panel polls FAST (~4s) while building,
    // so give the transition a generous timeout. The action button is gone again.
    await expect(status).toHaveAttribute('data-status', 'in-sync', { timeout: 15000 })
    await expect(status.getByText(/✅ Сайт совпадает с CMS/)).toBeVisible()
    await expect(page.getByRole('button', { name: ANY_ACTION_BUTTON })).toHaveCount(0)
  })
})
