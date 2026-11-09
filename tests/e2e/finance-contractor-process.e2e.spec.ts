import { expect, test } from '@playwright/test'

import { signInAsPlatformMember } from './support/platform-session'

/**
 * «Как работаем с исполнителями» (`/p/finance/contractor-process`, #545), end
 * to end.
 *
 * What no lower tier can say: the unit tier renders the view in jsdom, which
 * has no canvas and no layout. Only a browser proves that the diagram is
 * measured and drawn after hydration, that a click on an SVG step really opens
 * the panel, and that the automation view really dims what it should — a
 * computed opacity, not a class name.
 *
 * Three flows at three requirements, so the file always says something:
 *
 *   1. anonymous — runs on ANY stand: the section is never rendered to a caller
 *      with no session, it sends them to sign in;
 *   2. member, from the overview — needs `AUTH_SECRET` (the stand's, to mint a
 *      session, `support/platform-session.ts`) and `PLATFORM_DATABASE_URL`
 *      (the overview reads balances): `/p/finance` leads to the section;
 *   3. member, the map itself — needs `AUTH_SECRET` only (the section reads no
 *      database): a step opens its panel, a lane opens «О роли», the
 *      automation view dims the steps that cannot be automated.
 *
 * The member flows are skipped without those variables. The stand draws the
 * public example (`content/finance/contractor-process.example.json`) unless it
 * holds `PATH_MAPS_GITHUB_TOKEN`; the assertions use only what every process
 * has — a step, a lane, a step with and one without automation — so they hold
 * on the live data too.
 *
 *   E2E_PORT=<your stand> pnpm test:e2e tests/e2e/finance-contractor-process.e2e.spec.ts
 *
 * Relative paths only, resolved against Playwright's `baseURL` (`E2E_PORT` /
 * `E2E_BASE_URL`, `tests/helpers/base-url.ts`). Read-only: nothing here writes
 * to the stand or to the shared dev database.
 */

const PATH = '/p/finance/contractor-process'
const MEMBER = { email: 'e2e-member@bbm.academy', roles: ['platform-user'] }

const authSecret = process.env.AUTH_SECRET
const databaseUrl = process.env.PLATFORM_DATABASE_URL

test.describe('«Как работаем с исполнителями» (#545)', () => {
  test('an anonymous visit is sent to sign in and never sees the map', async ({ page }) => {
    await page.goto(PATH, { waitUntil: 'domcontentloaded' })

    const url = new URL(page.url())
    expect(url.pathname).not.toBe(PATH)
    expect(url.searchParams.get('callbackUrl') ?? url.href).toContain(PATH)
    await expect(page.locator('[data-contractor-process]')).toHaveCount(0)
  })

  test('a member reaches the section from the finance overview', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(!authSecret, 'AUTH_SECRET is not set — cannot mint a session for this stand')
    test.skip(!databaseUrl, 'PLATFORM_DATABASE_URL is not set — the overview reads balances')

    await signInAsPlatformMember(context, baseURL as string, MEMBER)
    await page.goto('/p/finance')
    await page.getByRole('link', { name: 'Как работаем с исполнителями' }).click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(
      page.getByRole('heading', { level: 1, name: 'Как работаем с исполнителями' }),
    ).toBeVisible()
  })

  test('a member opens a step and a lane, and the automation view dims the rest', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(!authSecret, 'AUTH_SECRET is not set — cannot mint a session for this stand')

    await signInAsPlatformMember(context, baseURL as string, MEMBER)
    await page.goto(PATH)

    const diagram = page.getByRole('group', { name: 'Схема процесса' })
    await expect(diagram).toBeVisible()
    const panel = page.locator('[data-cp-panel]')

    // A step: its title heads the panel.
    const step = diagram.locator('[data-step-id]').first()
    // The accessible name is the title, plus « — вопрос открыт» / « — авто» when the box shows them.
    const title = (await step.getAttribute('aria-label'))!.split(' — ')[0]
    await step.click()
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(title)
    await expect(step).toHaveAttribute('aria-expanded', 'true')

    // A lane opened from the keyboard: «О роли» when the role is described,
    // the no-questions hint otherwise — either way the lane's own panel.
    const lane = diagram.locator('[data-lane-id]').first()
    const laneName = (await lane.getAttribute('aria-label'))!.replace(
      /^Дорожка «(.*)»(?: — .*)?$/,
      '$1',
    )
    await lane.focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(laneName)
    await expect(panel.locator('[data-cp-panel-kind="lane"]')).toBeVisible()

    // Esc closes it.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // The automation view: steps that cannot be automated are dimmed, the others are not.
    await page.getByRole('button', { name: 'Показать автоматизацию' }).click()
    const opacity = (selector: string) =>
      diagram
        .locator(selector)
        .first()
        .evaluate((el) => Number(getComputedStyle(el).opacity))
    expect(await opacity('.cp-node:not(.has-auto)')).toBeCloseTo(0.3)
    expect(await opacity('.cp-node.has-auto')).toBe(1)
  })
})
