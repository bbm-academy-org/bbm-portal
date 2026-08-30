import { expect, test } from '@playwright/test'

import { signInThroughZitadel } from './support/zitadel-sign-in'

/**
 * The `/p` launcher, end to end (spec 311 §C; acceptance scenarios 1, 3 and 5).
 *
 * What no lower tier can say: the unit tier renders the launcher against a
 * FIXTURE registry with a mocked session, so it proves the composition. It
 * cannot prove that the real registry's providers survive a real request, that
 * the roles claim makes it from Zitadel's token through the Auth.js session into
 * the tile filter, or that «no admin tile appears anywhere on the page and View
 * source contains no mention of /p/admin» is true of the bytes actually sent.
 *
 * Three flows at three credential requirements, so the file always says
 * something — the same shape as `platform-claim-gate.e2e.spec.ts`:
 *
 *   1. anonymous — runs on ANY stand: `/p` never renders the catalogue to a
 *      caller with no session;
 *   2. member — needs `E2E_MEMBER_USERNAME` / `E2E_MEMBER_PASSWORD` (the dev
 *      IdP's `bbm-member`, `platform-user` alone): the catalogue, the external
 *      marks, the placeholders, and NO cabinet tile anywhere in the HTML;
 *   3. admin — needs `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD` (`bbm-test`,
 *      both roles): the same page plus the cabinet tile, with the placeholders
 *      looking exactly as they do for a member.
 *
 * The two credentialed flows are skipped without those variables. They are not
 * in any committed file: the dev IdP's seeded passwords live on the dev-stand
 * box (`infra/dev-stand/idp/bootstrap.md` → "Where the secrets live"), and
 * fetching a credential off another machine is a question for the owner rather
 * than a step (`.claude/rules/dev-env.md`).
 *
 *   E2E_PORT=3000 E2E_IDP_HOST=truenas.local:9180 \
 *   E2E_MEMBER_USERNAME=… E2E_MEMBER_PASSWORD=… \
 *   pnpm test:e2e tests/e2e/p-launcher.e2e.spec.ts
 *
 * Relative paths only, resolved against Playwright's `baseURL` (`E2E_PORT` /
 * `E2E_BASE_URL`, `tests/helpers/base-url.ts`). Read-only: nothing here writes
 * to the stand or to the shared dev database.
 */

const idpHost = process.env.E2E_IDP_HOST
const adminUsername = process.env.E2E_ADMIN_USERNAME
const adminPassword = process.env.E2E_ADMIN_PASSWORD
const memberUsername = process.env.E2E_MEMBER_USERNAME
const memberPassword = process.env.E2E_MEMBER_PASSWORD

const HOME = '/p'

const signIn = (
  page: Parameters<typeof signInThroughZitadel>[0],
  targetPath: string,
  credentials: { username: string; password: string },
) => signInThroughZitadel(page, targetPath, credentials, { idpHost })

test.describe('the /p launcher (spec 311 §C)', () => {
  test('EARS-416: an anonymous request for the home never renders the catalogue', async ({
    page,
  }) => {
    await page.goto(HOME, { waitUntil: 'domcontentloaded' })

    expect(new URL(page.url()).pathname).not.toBe(HOME)
    await expect(page.locator('[data-tile-grid]')).toHaveCount(0)
  })

  test('EARS-422/423/478: a member sees one flat grid, marked external tiles and inert placeholders', async ({
    page,
  }) => {
    test.skip(
      !memberUsername || !memberPassword,
      'set E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD (an account WITHOUT platform-admin) to run',
    )

    await signIn(page, HOME, { username: memberUsername!, password: memberPassword! })

    // ONE grid, no grouping (EARS-422).
    await expect(page.locator('[data-tile-grid]')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Рабочее пространство BBM' })).toBeVisible()

    // The live apps are openable links; the external ones are marked and
    // targeted at their own tab (EARS-423).
    const external = page.locator('[data-tile-form="external"]')
    expect(await external.count()).toBeGreaterThan(0)
    for (let i = 0; i < (await external.count()); i += 1) {
      const tile = external.nth(i)
      await expect(tile).toHaveAttribute('target', '_blank')
      await expect(tile).toHaveAttribute('rel', 'noopener noreferrer')
      await expect(tile).toContainText('↗ внешний')
    }

    // The «портфель, позже» placeholders: below the live apps, no status line,
    // no link, and not reachable by Tab (EARS-477, EARS-478).
    const planned = page.locator('[data-tile-form="planned"]')
    await expect(planned).toHaveCount(5)
    for (let i = 0; i < 5; i += 1) {
      const tile = planned.nth(i)
      await expect(tile).toHaveText(/портфель, позже/)
      expect(await tile.evaluate((el) => el.tagName)).toBe('DIV')
      expect(await tile.evaluate((el) => el.getAttribute('tabindex'))).toBe(null)
    }
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('a, button, [tabindex]')).some((el) =>
          el.closest('[data-tile-form="planned"]'),
        ),
      ),
    ).toBe(false)

    // No cabinet tile ANYWHERE in the bytes — «View source» is the test
    // (EARS-404, D-7). This is what a CSS-hidden tile would fail.
    const html = await page.content()
    expect(html).not.toContain('/p/admin')
    expect(html).not.toContain('Админка')
    await expect(page.locator('[data-tile-form="admin"]')).toHaveCount(0)
  })

  test('EARS-425/470: the top bar is on the home in its home state, with switcher and sign-out', async ({
    page,
  }) => {
    test.skip(
      !memberUsername || !memberPassword,
      'set E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD to run',
    )

    await signIn(page, HOME, { username: memberUsername!, password: memberPassword! })

    await expect(page.locator('[data-top-bar]')).toHaveCount(1)
    await expect(page.locator('[data-top-bar-home]')).toHaveAttribute('href', '/p')
    await expect(page.locator('[data-top-bar-app]')).toHaveText('Главная')
    await expect(page.getByRole('button', { name: 'Приложения' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()

    // EARS-427/EARS-478: the switcher offers the openable apps and no placeholder.
    await page.getByRole('button', { name: 'Приложения' }).click()
    const menu = page.locator('[data-app-switcher-menu]')
    await expect(menu).toBeVisible()
    await expect(menu).not.toContainText('портфель, позже')
    expect(await menu.locator('a').count()).toBeGreaterThan(0)
  })

  test('EARS-469: from the home into an app, the bar names that app and leads back in one click', async ({
    page,
  }) => {
    test.skip(
      !memberUsername || !memberPassword,
      'set E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD to run',
    )

    await signIn(page, HOME, { username: memberUsername!, password: memberPassword! })

    const firstInternal = page.locator('[data-tile-form="internal"]').first()
    const name = (await firstInternal.locator('[data-tile-name]').textContent())?.trim()
    await firstInternal.click()

    await expect(page.locator('[data-top-bar-app]')).toHaveText(name!)
    await page.locator('[data-top-bar-home]').click()
    await expect(page).toHaveURL(/\/p$/)
    await expect(page.locator('[data-top-bar-app]')).toHaveText('Главная')
  })

  test('EARS-406: a live module publishes a status line on its own tile', async ({ page }) => {
    test.skip(
      !memberUsername || !memberPassword,
      'set E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD to run',
    )

    await signIn(page, HOME, { username: memberUsername!, password: memberPassword! })

    // EARS-407/408 make the CONTENT of a line unassertable end to end — a stand
    // with no open period, or with Plane unreachable, is a correct stand and
    // renders no line. What must hold on every stand is that the page rendered
    // completely anyway: every internal tile is a real, openable link, and the
    // foot is either a line or the explicit «no line» rule, never a broken tile.
    const internal = page.locator('[data-tile-form="internal"]')
    const count = await internal.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i += 1) {
      const tile = internal.nth(i)
      expect(await tile.evaluate((el) => el.tagName)).toBe('A')
      expect(await tile.evaluate((el) => el.querySelectorAll('[data-tile-status]').length)).toBe(1)
    }
  })

  test('EARS-404/417: an account holding platform-admin sees the cabinet tile', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (an account holding platform-admin) to run',
    )

    await signIn(page, HOME, { username: adminUsername!, password: adminPassword! })

    const cabinet = page.locator('[data-tile-form="admin"]')
    await expect(cabinet).toHaveCount(1)
    await expect(cabinet).toHaveAttribute('href', '/p/admin')
    await expect(cabinet).toContainText('только администратор')

    // A placeholder is NOT claim-gated: an admin sees exactly what a member sees
    // (EARS-478, scenario 5).
    await expect(page.locator('[data-tile-form="planned"]')).toHaveCount(5)
  })

  test('EARS-428: on a narrow viewport the grid reflows and the switcher stays reachable', async ({
    page,
  }) => {
    test.skip(
      !memberUsername || !memberPassword,
      'set E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD to run',
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, HOME, { username: memberUsername!, password: memberPassword! })

    // The page must not scroll SIDEWAYS — an unwrapped bar or a fixed
    // four-column grid is exactly what that would look like.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    expect(overflows).toBe(false)

    await expect(page.locator('[data-tile-grid]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Приложения' }).click()
    await expect(page.locator('[data-app-switcher-menu]')).toBeVisible()
  })
})
