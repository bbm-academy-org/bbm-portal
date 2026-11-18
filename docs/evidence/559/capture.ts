/**
 * The #559 acceptance capture — task-cycle stage 5 item 3.
 *
 * Drives the LIVE stand this session booted (`PORT=<n> pnpm dev` against the
 * branch database `platform_559`, migrated and seeded by `pnpm dev:db:branch`,
 * plus the §J stand cases described in this folder's README) and writes the
 * evidence frames of «Курс против рынка».
 *
 * Credentials come from the environment and are never written here
 * (`.claude/rules/dev-env.md`): E2E_ADMIN_USERNAME / E2E_PASSWORD / E2E_IDP_HOST.
 *
 * Usage: pnpm exec tsx docs/evidence/559/capture.ts <baseURL> <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import { chromium, type Page } from '@playwright/test'

import { signInThroughZitadel } from '../../../tests/e2e/support/zitadel-sign-in'

const baseURL = process.argv[2] ?? 'http://localhost:3000'
const outDir = process.argv[3] ?? 'docs/evidence/559'
mkdirSync(outDir, { recursive: true })

const password = process.env.E2E_PASSWORD ?? ''
const username = process.env.E2E_ADMIN_USERNAME ?? ''
if (password === '' || username === '') throw new Error('set E2E_ADMIN_USERNAME / E2E_PASSWORD')

const ROUTE = '/p/finance/reports/market-rate'
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const
const findings: string[] = []

async function ready(page: Page) {
  await page.getByRole('group', { name: 'Итого за период' }).waitFor({ timeout: 90_000 })
}

async function matrix(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    if (prepare) await prepare()
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    if (overflow > 0)
      findings.push(`${name} @ ${viewport.name}: page scrolls sideways by ${overflow}px`)
    const sheetOpen = (await page.getByRole('dialog').count()) > 0
    await page.screenshot({ path: `${outDir}/${name}--${viewport.name}.png`, fullPage: !sheetOpen })
    console.log(`captured ${name}--${viewport.name}`)
  }
  await page.setViewportSize(VIEWPORTS[0])
}

async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await ready(page)
}

async function totalText(page: Page): Promise<string> {
  return (await page.getByRole('group', { name: 'Итого за период' }).innerText()).replace(
    /\s+/g,
    ' ',
  )
}

const browser = await chromium.launch()
const context = await browser.newContext({ baseURL, viewport: VIEWPORTS[0] })
const page = await context.newPage()
await signInThroughZitadel(
  page,
  '/p/finance',
  { username, password },
  { idpHost: process.env.E2E_IDP_HOST },
)
await page.getByRole('heading', { name: 'Финансы' }).waitFor({ timeout: 90_000 })

// Second pass, after the stand's November operations were reversed (see the
// README): «Этот месяц» is an empty period.
if (process.env.CAPTURE_EMPTY === '1') {
  await goto(page, `${ROUTE}?period=month`)
  findings.push(`empty month ₽ total: ${await totalText(page)}`)
  await matrix(page, '07-empty-month')
  writeFileSync(`${outDir}/findings-empty.txt`, `${findings.join('\n')}\n`)
  console.log(findings.join('\n'))
  await browser.close()
  process.exit(0)
}

// The header link (EARS-564).
await matrix(page, '01-finance-header-link')
await page.getByRole('link', { name: 'Курс против рынка' }).click()
await ready(page)
findings.push(`landed on ${new URL(page.url()).pathname} from the /p/finance header link`)

// Default period: the last 12 months, ₽.
await page.evaluate(() => window.localStorage.removeItem('bbm.finance.requests.displayCurrency'))
await goto(page, ROUTE)
findings.push(`12m ₽ total: ${await totalText(page)}`)
await matrix(page, '02-default-12m-rub')

// A month row opened (EARS-565).
await matrix(page, '03-november-opened', async () => {
  if ((await page.getByRole('dialog').count()) === 0) {
    await page
      .getByRole('region', { name: 'По месяцам' })
      .getByRole('button', { name: 'Ноябрь 2026' })
      .click()
    await page.getByRole('dialog').waitFor()
  }
})
await page.keyboard.press('Escape')

// The chain route row opened.
await matrix(page, '04-chain-route-opened', async () => {
  if ((await page.getByRole('dialog').count()) === 0) {
    await page
      .getByRole('region', { name: 'По получателям и маршрутам' })
      .getByRole('button', { name: 'RUB → USDT → USD' })
      .click()
    await page.getByRole('dialog').waitFor()
  }
})
await page.keyboard.press('Escape')

// ₽ → $: amounts change, the % does not (EARS-566).
const wordings = async () => page.locator('[data-slot="badge"]').allInnerTexts()
const rubWordings = await wordings()
await page.getByRole('tab', { name: '$', exact: true }).click()
await page.waitForTimeout(300)
findings.push(`12m $ total: ${await totalText(page)}`)
findings.push(
  `badges identical after ₽ → $: ${JSON.stringify(rubWordings) === JSON.stringify(await wordings())}`,
)
await matrix(page, '05-default-12m-usd')
await page.getByRole('tab', { name: '€', exact: true }).click()
await page.waitForTimeout(300)
findings.push(`12m € total: ${await totalText(page)}`)
// The same remembered choice as the requests queue.
await page.goto('/p/finance/requests', { waitUntil: 'domcontentloaded' })
await page.getByRole('tablist', { name: 'Валюта отображения' }).waitFor({ timeout: 90_000 })
findings.push(
  `requests queue currency tab after choosing € on the report: ${await page
    .getByRole('tablist', { name: 'Валюта отображения' })
    .getByRole('tab', { selected: true })
    .innerText()}`,
)
await page.getByRole('tab', { name: '₽', exact: true }).click()

// The period selector: this month, and an empty period.
await goto(page, ROUTE)
await page.getByRole('combobox', { name: 'Период' }).click()
await page.getByRole('option', { name: 'Этот месяц', exact: true }).click()
await page.waitForURL(/period=month/)
await ready(page)
findings.push(`month ₽ total: ${await totalText(page)}`)
await matrix(page, '06-this-month')

await goto(page, `${ROUTE}?period=all`)
findings.push(`all ₽ total: ${await totalText(page)}`)

writeFileSync(`${outDir}/findings.txt`, `${findings.join('\n')}\n`)
console.log(findings.join('\n'))
await browser.close()
