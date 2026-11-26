import { expect, test, type Page } from '@playwright/test'

import { signInThroughZitadel } from './support/zitadel-sign-in'

/**
 * Spec 584 (issue #586) — «Бюджет BBM» as a plain platform member (no finance
 * role reads it; EARS-701's link and refusal clauses stay on the #586 list):
 * the glass, the runway, the money tier, the two charts and the breakdown
 * render over the seeded budget, a breakdown line opens its operations, and the reporting-currency switch (EARS-721) re-renders the
 * page with the rate line of EARS-722 item 5 and the waterline's rate note
 * (EARS-713). Needs a stand with a Bank of Russia USD rate; seeds nothing and
 * writes nothing.
 */
const idpHost = process.env.E2E_IDP_HOST
const memberUsername = process.env.E2E_MEMBER_USERNAME
const memberPassword = process.env.E2E_MEMBER_PASSWORD
const shots = process.env.E2E_SHOTS_DIR

const ROUTE = '/p/finance/reports/budget'

async function shoot(page: Page, name: string) {
  if (!shots) return
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true })
}

test.describe('budget dashboard (spec 584)', () => {
  test.skip(!memberUsername || !memberPassword, 'E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD unset')

  test('EARS-721: a plain member reads the dashboard and switches its reporting currency', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await signInThroughZitadel(
      page,
      ROUTE,
      { username: memberUsername!, password: memberPassword! },
      { idpHost },
    )
    await expect(page.getByRole('heading', { name: 'Бюджет BBM', level: 1 })).toBeVisible({
      timeout: 90_000,
    })
    await expect(page.getByTestId('budget-glass')).toBeVisible()
    await expect(page.getByTestId('budget-runway')).toBeVisible()
    await expect(page.getByTestId('budget-money')).toBeVisible()
    await expect(page.getByTestId('budget-monthly').locator('svg:visible')).toBeVisible()
    await expect(page.getByTestId('budget-waterline').locator('svg:visible')).toBeVisible()
    await expect(page.getByTestId('budget-rate-line')).toContainText('точно, без пересчёта')
    await shoot(page, 'desktop-light-rub')

    // a breakdown line opens its operations
    await page.getByTestId('budget-breakdown-rows').getByRole('button').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')

    // EARS-721 — the switch travels in the URL and converts every tier
    await page.getByRole('combobox', { name: 'Валюта итога' }).click()
    const usd = page.getByRole('option', { name: /^USD/ })
    await expect(usd).toBeVisible()
    // The conversion half always runs: a stand without a Bank of Russia USD rate fails here
    // loudly instead of passing on the rouble half alone.
    await expect(
      usd,
      'USD is disabled on this stand — it has no Bank of Russia USD rate; sync the rates first',
    ).not.toHaveAttribute('aria-disabled', 'true')
    await usd.click()
    await expect(page).toHaveURL(/currency=USD/)
    await expect(page.getByTestId('budget-rate-line')).toContainText(
      'по фактическому курсу каждой операции',
    )
    await expect(page.getByTestId('budget-spent')).toContainText('$')
    await expect(page.getByTestId('budget-waterline-note')).toContainText('−лимит пересчитан')
    await shoot(page, 'desktop-light-usd')

    // the period selector keeps the chosen currency
    await page.getByTestId('budget-periods').getByRole('link', { name: 'Этот год' }).click()
    await expect(page).toHaveURL(/period=year/)
    await expect(page).toHaveURL(/currency=USD/)
  })
})
