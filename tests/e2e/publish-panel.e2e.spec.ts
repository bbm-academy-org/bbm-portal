import { test, expect, Page } from '@playwright/test'
import { getPayload } from 'payload'
import config from '../../src/payload.config.js'
import { COLD_START_HOOK_TIMEOUT_MS, login } from '../helpers/login'

/**
 * #46 — admin publish panel, end-to-end on the dashboard, rewritten for the
 * "publish = live" DRIFT model (the panel was rebuilt in #45).
 *
 * The panel is now a site↔CMS drift indicator + batch/rebuild button, driven by
 * ONE consolidated read `GET /api/site-sync-status`. A real publish/rebuild
 * needs the prod GitHub dispatch token, so we DON'T hit GitHub: every endpoint
 * is stubbed with Playwright route interception to drive the flow deterministically:
 *   - GET  /api/site-sync-status → the consolidated drift shape
 *       `{ pendingCount, lastPublishedAt, lastSuccessfulBuildAt, currentRun, syncState }`,
 *   - GET  /api/pending-changes  → the confirm-list (only fetched when pendingCount > 0),
 *   - POST /api/publish-site     → 200 (accepted; batch publish also rebuilds).
 *
 * #52 — the panel is driven by ONE server-computed `syncState` enum
 * (`'in-sync' | 'building' | 'failed'`), replacing the old overloaded
 * `inSync`/`building` booleans. `data-status` mirrors `syncState` directly; the
 * old `"behind"` value is gone (a publish whose build hasn't registered yet now
 * reads as `building`, not a red failure).
 *
 * DOM hooks the panel exposes (relied on below, EXACTLY as the panel emits them):
 *   - wrapper `data-testid="sync-status"` with `data-status` ∈
 *       { "building" | "in-sync" | "failed" } (mirrors `syncState`),
 *   - confirm-list `data-testid="pending-changes"`, rows `data-testid="pending-item"`,
 *   - action button by role + accessible name: `Пересобрать сайт` (rebuild) or
 *       `Опубликовать N изменени… на сайт` (batch). When in-sync/building the
 *       button is ABSENT from the DOM (not merely disabled).
 *
 * We drive and assert each visible state: in-sync (green), in-sync + pending (no
 * green, #50), failed (red + rebuild), building (no red), pending (batch), and a
 * full publish → building → matches lifecycle.
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
    // Cold `next dev` compiles /admin inside this hook; see the constant's
    // docblock in tests/helpers/login.ts (DEBT 2026-08-15).
    test.setTimeout(COLD_START_HOOK_TIMEOUT_MS)

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
    // syncState='in-sync', no pending → the panel is status-only. The action
    // button must be entirely ABSENT (the contract hides it, not merely disabled).
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
          syncState: 'in-sync',
        }),
      })
    })

    await page.goto('/admin')

    const status = page.locator('[data-testid="sync-status"]')
    await expect(status).toHaveAttribute('data-status', 'in-sync')
    await expect(status.getByText(/✅ Сайт совпадает с CMS/)).toBeVisible()

    // The defining assertion: NO action button exists at all in the in-sync state.
    await expect(page.getByRole('button', { name: ANY_ACTION_BUTTON })).toHaveCount(0)
    // …and no confirm-list either (pendingCount === 0 → not fetched/rendered).
    await expect(page.locator('[data-testid="pending-changes"]')).toHaveCount(0)
  })

  test('in sync BUT pending drafts → NO green banner; confirm-list + batch button', async () => {
    // #50 — syncState is derived purely from lastPublishedAt vs the last successful
    // build; it deliberately ignores unpublished drafts. So the site genuinely
    // MATCHES what was last published (data-status stays "in-sync"), but the CMS
    // now holds staged drafts the site does not reflect. The green ✅ "Сайт
    // совпадает с CMS" banner would over-claim and contradict the pending list,
    // so it must be SUPPRESSED while pendingCount > 0 — the pending list + batch
    // publish button is the message. The building/behind banners are unaffected
    // (covered by the other cases); only the green slot is gated on pendingCount.
    await page.route('**/api/site-sync-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pendingCount: 2,
          lastPublishedAt: '2026-06-24T08:00:00.000Z',
          lastSuccessfulBuildAt: '2026-06-24T08:05:00.000Z', // build newer → in-sync
          currentRun: {
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/owner/repo/actions/runs/5',
            startedAt: '2026-06-24T08:00:00.000Z',
          },
          syncState: 'in-sync',
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
              ids: ['eduard-ildarkhanov', 'jane-doe'],
              labels: ['Eduard Ildarkhanov', 'Jane Doe'],
            },
          ],
          count: 2,
        }),
      })
    })

    await page.goto('/admin')

    const status = page.locator('[data-testid="sync-status"]')
    // The published content IS live, so the underlying drift state is still
    // "in-sync" — the data-status vocabulary is unchanged.
    await expect(status).toHaveAttribute('data-status', 'in-sync')
    // …but the green banner MUST be absent: pending drafts make "matches CMS" a
    // misleading over-claim. This is the defining #50 assertion.
    await expect(status.getByText(/✅ Сайт совпадает с CMS/)).toHaveCount(0)
    // No building / failed banner leaked into the green slot either.
    await expect(status.getByText(/Идёт сборка…/)).toHaveCount(0)
    await expect(status.getByText(/Сборка упала/)).toHaveCount(0)

    // The pending confirm-list + the primary batch-publish button ARE the message.
    const panel = page.locator('[data-testid="pending-changes"]')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-testid="pending-item"]')).toHaveCount(2)
    await expect(
      page.getByRole('button', { name: 'Опубликовать 2 изменения на сайт' }),
    ).toBeVisible()
  })

  test('failed, nothing pending → ⚠️ red both timestamps + log link + "Пересобрать сайт" button', async () => {
    // #52: syncState === 'failed' → a run for THIS publish reached a terminal
    // non-success conclusion (its startedAt >= lastPublishedAt). The panel shows
    // BOTH timestamps in red, a build-log link, and the manual-rebuild safety net.
    const publishedAt = '2026-06-24T11:00:00.000Z'
    const builtAt = '2026-06-24T09:00:00.000Z' // older than publishedAt
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
          syncState: 'failed',
        }),
      })
    })

    await page.goto('/admin')

    const status = page.locator('[data-testid="sync-status"]')
    await expect(status).toHaveAttribute('data-status', 'failed')
    // The "failed" copy surfaces BOTH the publish and the build timestamps. We
    // assert the stable label markers ("опубликовано …, собрано …") rather than
    // the formatted clock string, which depends on the browser's locale/TZ. The
    // panel renders an em dash only for null/invalid times, so requiring real
    // times here (no "—" between the markers) pins that both are shown.
    await expect(status.getByText(/Сборка упала/)).toBeVisible()
    await expect(status.getByText(/опубликовано .+, собрано .+\)/)).toBeVisible()
    await expect(status.getByText(/опубликовано —/)).toHaveCount(0)
    // The failed run carries an html_url → a build-log link is offered.
    await expect(status.getByRole('link', { name: /лог сборки/ })).toBeVisible()

    // Nothing pending, but the build failed → the secondary manual-rebuild button.
    await expect(page.getByRole('button', { name: 'Пересобрать сайт' })).toBeVisible()
    // No confirm-list (pendingCount === 0).
    await expect(page.locator('[data-testid="pending-changes"]')).toHaveCount(0)
  })

  test('building (publish dispatched, run not yet registered) → 🔄 no red, NO button', async () => {
    // #52 — the bug fix. Published but the build's run isn't visible yet
    // (currentRun null, no successful build at-or-after the publish). The old code
    // rendered this as red "behind"; now the server returns syncState='building'
    // and the panel shows 🔄 with no red banner and no action button.
    await page.route('**/api/site-sync-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pendingCount: 0,
          lastPublishedAt: '2026-06-24T11:00:00.000Z',
          lastSuccessfulBuildAt: '2026-06-24T09:00:00.000Z',
          currentRun: null,
          syncState: 'building',
        }),
      })
    })

    await page.goto('/admin')

    const status = page.locator('[data-testid="sync-status"]')
    await expect(status).toHaveAttribute('data-status', 'building')
    await expect(status.getByText(/Идёт сборка…/)).toBeVisible()
    // The defining fix: NO red failure banner during a normal in-flight publish.
    await expect(status.getByText(/Сборка упала/)).toHaveCount(0)
    // Building → no action button (the build is already running).
    await expect(page.getByRole('button', { name: ANY_ACTION_BUTTON })).toHaveCount(0)
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
          syncState: 'in-sync',
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

    await page.goto('/admin')

    // The published content is live (in-sync) AND there are pending drafts. The
    // green banner is suppressed (#50) but data-status stays "in-sync".
    const status = page.locator('[data-testid="sync-status"]')
    await expect(status).toHaveAttribute('data-status', 'in-sync')

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
    //   - before Publish is clicked → pending + in-sync (status="in-sync", green
    //     suppressed by pending #50, batch button shown),
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
          dispatch: {
            event_type: 'publish-site',
            repo: 'owner/repo',
            at: new Date().toISOString(),
          },
        }),
      })
    })

    // site-sync-status: pending until publish, then building once, then in-sync.
    await page.route('**/api/site-sync-status', async (route) => {
      let body
      if (!published) {
        // Pre-publish: in-sync (build newer than publish) with one pending change
        // → green suppressed (#50), batch button shown.
        body = {
          pendingCount: 1,
          lastPublishedAt: '2026-06-24T12:00:00.000Z',
          lastSuccessfulBuildAt: '2026-06-24T12:01:00.000Z',
          currentRun: null,
          syncState: 'in-sync',
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
                syncState: 'building',
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
                syncState: 'in-sync',
              }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })

    await page.goto('/admin')

    const status = page.locator('[data-testid="sync-status"]')

    // 1 — pre-publish: in-sync (green suppressed by pending), confirm-list shows
    // the changed doc, batch button.
    await expect(status).toHaveAttribute('data-status', 'in-sync')
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
