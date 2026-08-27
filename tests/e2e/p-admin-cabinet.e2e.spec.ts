import { expect, test } from '@playwright/test'

import { signInThroughZitadel } from './support/zitadel-sign-in'

/**
 * The `/p/admin` cabinet, end to end (spec 311 §D and §G; acceptance scenarios
 * 6, 7 and 12).
 *
 * What no lower tier can say. The unit tier derives the navigation from a
 * FIXTURE registry and renders the sidebar in jsdom, so it proves the
 * composition; it cannot prove that `/api/p/*` is actually REACHABLE on the
 * platform surface (the host allowlist is middleware, not a function call at
 * that point), that the cabinet's handler refuses a real unauthenticated
 * request with a bare 403 rather than a redirect, or that the Refine shell
 * mounts at all in a browser.
 *
 * Four flows at two credential requirements, so the file always says something
 * — the same shape as `p-launcher.e2e.spec.ts` and `platform-claim-gate`:
 *
 *   1-2. anonymous — run on ANY stand, no credentials: the module API answers
 *        on the portal surface and refuses without a session (EARS-461,
 *        EARS-462, EARS-463), and the cabinet itself never renders to a caller
 *        with no session (EARS-405);
 *   3-4. admin — need `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD` (`bbm-test`,
 *        both roles): the cabinet's SHAPE — an index of sections under the
 *        workspace's own top bar, a left sidebar whose items are visibly nested
 *        under their module group (scenario 6, EARS-431…EARS-435, EARS-440) —
 *        and the OKR section's read-only page (scenario 12, EARS-437, EARS-453,
 *        EARS-455, EARS-475, EARS-476).
 *
 * The credentialed flows are skipped without those variables. They are in no
 * committed file: the dev IdP's seeded passwords live on the dev-stand BOX
 * (`infra/dev-stand/idp/bootstrap.md` → «Where secrets live on the box»), and
 * fetching a credential off another machine is a question for the owner rather
 * than a step (`.claude/rules/dev-env.md`).
 *
 *   E2E_PORT=3001 E2E_IDP_HOST=truenas.local:9180 \
 *   E2E_ADMIN_USERNAME=… E2E_ADMIN_PASSWORD=… \
 *   pnpm test:e2e tests/e2e/p-admin-cabinet.e2e.spec.ts
 *
 * Relative paths only, resolved against Playwright's `baseURL` (`E2E_PORT` /
 * `E2E_BASE_URL`, `tests/helpers/base-url.ts`). Read-only: nothing here writes
 * to the stand or to the shared dev database.
 */

const idpHost = process.env.E2E_IDP_HOST
const adminUsername = process.env.E2E_ADMIN_USERNAME
const adminPassword = process.env.E2E_ADMIN_PASSWORD

const CABINET = '/p/admin'
const OKR_PARAMETERS = '/p/admin/okr/parameters'
const OKR_API = '/api/p/okr/admin/parameters'

const signIn = (page: Parameters<typeof signInThroughZitadel>[0], targetPath: string) =>
  signInThroughZitadel(
    page,
    targetPath,
    { username: adminUsername!, password: adminPassword! },
    { idpHost },
  )

test.describe('the /p/admin cabinet (spec 311 §D, §G)', () => {
  test('EARS-463: the module API surface answers on the portal — it is routed, not 404', async ({
    request,
  }) => {
    // Before the allowlist change of this task the SAME request answered 404 on
    // `portal.bbm.academy`, because `isPlatformSurfacePath` admitted only /p,
    // /p/* and /api/auth/*. A 403 is therefore the evidence: it can only come
    // from the handler, which means middleware let the request through.
    const response = await request.get(OKR_API)
    expect(response.status()).not.toBe(404)
    expect(response.status()).toBe(403)
  })

  test('EARS-462: the cabinet handler refuses an anonymous caller bare — no redirect, no body', async ({
    request,
  }) => {
    // A handler never redirects (the gate helper's own contract): an API caller
    // gets the bare 403 in every refused case, so the trust boundary is the
    // handler and not the shell that rendered a link to it.
    const response = await request.get(OKR_API, { maxRedirects: 0 })
    expect(response.status()).toBe(403)
    expect(await response.text()).toBe('')
  })

  test('EARS-405: an anonymous request for the cabinet never renders it', async ({ page }) => {
    await page.goto(CABINET, { waitUntil: 'domcontentloaded' })
    expect(new URL(page.url()).pathname).not.toBe(CABINET)
    await expect(page.locator('[data-cabinet]')).toHaveCount(0)
  })

  test('scenario 6: the cabinet opens on an index of sections, under the shared top bar, with a nested sidebar', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (an account holding platform-admin) to run',
    )

    await signIn(page, CABINET)

    // EARS-434: an INDEX of sections — not a dashboard, not a jump into the
    // first resource. The URL is still the cabinet's own.
    expect(new URL(page.url()).pathname).toBe(CABINET)
    await expect(page.getByRole('heading', { name: 'Админка', level: 1 })).toBeVisible()
    await expect(page.locator('[data-section="okr"]')).toBeVisible()

    // EARS-440: the workspace's own top bar, the same one every /p/* page has.
    await expect(page.locator('[data-top-bar]')).toBeVisible()

    // EARS-432/EARS-433: a persistent left sidebar, grouped by module, whose
    // items sit in a nested list under a real parent node.
    const group = page.locator('[data-nav-group="okr"]')
    await expect(group).toBeVisible()
    await expect(
      group.locator('[data-nav-children] [data-nav-item="okr.parameters"]'),
    ).toBeVisible()

    // EARS-435: on the index there is one crumb and no module is named yet.
    await expect(page.locator('[data-cabinet-crumbs]')).toContainText('Админка')
  })

  test('scenario 12: the OKR section is one read-only page that says what the dashboard reads', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (an account holding platform-admin) to run',
    )

    await signIn(page, OKR_PARAMETERS)

    // EARS-435: `Админка / OKR / Источник и параметры`.
    const crumbs = page.locator('[data-cabinet-crumbs]')
    await expect(crumbs).toContainText('Админка')
    await expect(crumbs).toContainText('OKR')
    await expect(crumbs).toContainText('Источник и параметры')

    // EARS-475: the workspace, the projects and the mapping the dashboard applies.
    await expect(page.locator('[data-okr-source]')).toContainText('doctor-school')
    await expect(page.locator('[data-okr-projects]')).toContainText('DSG1')

    // EARS-476: the module's current read state, with the moment it was obtained.
    await expect(page.locator('[data-okr-read-state]')).toBeVisible()

    // EARS-437/EARS-455: no save and no delete control anywhere on the screen,
    // and the reason is stated rather than implied.
    await expect(page.getByRole('button', { name: /сохранить|удалить/i })).toHaveCount(0)
    await expect(page.locator('main')).toContainText('Только просмотр')
  })
})
