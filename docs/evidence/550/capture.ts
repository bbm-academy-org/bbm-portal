/**
 * The #550 acceptance capture — task-cycle stage 5 item 3.
 *
 * Drives the LIVE stand this session booted (`PORT=<n> pnpm dev` against the
 * branch database `platform_550`, migrated and seeded by `pnpm dev:db:branch`
 * + `pnpm dev:seed`, with the Bank of Russia series synced by
 * `pnpm platform:finance:fx:sync --from 2026-07-01`) and writes the evidence
 * frames of the payment queue.
 *
 * Credentials come from the environment and are never written here (the
 * session reads the stand's test-user password into a file and exports it for
 * this process only — `.claude/rules/dev-env.md`):
 *   E2E_ADMIN_USERNAME / E2E_MEMBER_USERNAME / E2E_PASSWORD / E2E_IDP_HOST.
 *
 * Usage: pnpm exec tsx docs/evidence/550/capture.ts <baseURL> <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import { chromium, type Browser, type Page } from '@playwright/test'

import { signInThroughZitadel } from '../../../tests/e2e/support/zitadel-sign-in'

const baseURL = process.argv[2] ?? 'http://localhost:3000'
const outDir = process.argv[3] ?? '.playwright-mcp/550'
mkdirSync(outDir, { recursive: true })

const password = process.env.E2E_PASSWORD ?? ''
const approver = process.env.E2E_ADMIN_USERNAME ?? ''
const member = process.env.E2E_MEMBER_USERNAME ?? ''
if (password === '' || approver === '' || member === '') {
  throw new Error('set E2E_ADMIN_USERNAME / E2E_MEMBER_USERNAME / E2E_PASSWORD')
}

const ROUTE = '/p/finance/requests'
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const
const THEMES = ['light', 'dark'] as const
const findings: string[] = []

async function signedIn(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORTS[0] })
  const page = await context.newPage()
  await signInThroughZitadel(
    page,
    ROUTE,
    { username, password },
    {
      idpHost: process.env.E2E_IDP_HOST,
    },
  )
  await page.getByRole('group', { name: 'Итоги очереди' }).waitFor({ timeout: 90_000 })
  return page
}

async function setTheme(page: Page, theme: string) {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
    document.documentElement.style.colorScheme = value
  }, theme)
}

/** A state in both widths and both themes, full page; records any page-level sideways scroll. */
async function matrix(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    if (prepare) await prepare()
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    if (overflow > 0)
      findings.push(`${name} @ ${viewport.name}: page scrolls sideways by ${overflow}px`)
    for (const theme of THEMES) {
      await setTheme(page, theme)
      await page.waitForTimeout(150)
      await page.screenshot({
        path: `${outDir}/${name}--${viewport.name}--${theme}.png`,
        fullPage: true,
      })
      console.log(`captured ${name}--${viewport.name}--${theme}`)
    }
    await setTheme(page, 'light')
  }
  await page.setViewportSize(VIEWPORTS[0])
}

async function reload(page: Page) {
  await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
  await page.getByRole('group', { name: 'Итоги очереди' }).waitFor({ timeout: 90_000 })
}

async function tab(page: Page, name: string) {
  await page.getByRole('tab', { name, exact: true }).click()
}

async function choose(page: Page, combobox: string, option: string) {
  await page.getByRole('combobox', { name: combobox }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

const browser = await chromium.launch()

// ── the approve role: the owner's own view ──────────────────────────────────
const page = await signedIn(browser, approver)

await matrix(page, '01-queue-default')

await matrix(page, '02-drafts-expanded', async () => {
  const drafts = page.getByRole('region', { name: 'Черновики' })
  const toggle = drafts.getByRole('button', { name: /Черновики/ })
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
})
await reload(page)

await page
  .getByRole('group', { name: 'Итоги очереди' })
  .getByRole('button', { name: /К оплате/ })
  .click()
await matrix(page, '03-kpi-pay-only')
await reload(page)

await tab(page, '$')
await matrix(page, '04-currency-usd')
await tab(page, '€')
await matrix(page, '05-currency-eur')
await tab(page, '₽')

await page.getByRole('button', { name: 'Сортировать по сумме' }).first().click()
await matrix(page, '06-sorted-by-amount')
await reload(page)

await page.getByRole('searchbox', { name: 'Поиск по заявкам' }).fill('USDC')
await matrix(page, '07-search-usdc-no-rate')
await page.getByRole('searchbox', { name: 'Поиск по заявкам' }).fill('нет такой заявки')
await matrix(page, '08-search-empty-everywhere')
await page.getByRole('searchbox', { name: 'Поиск по заявкам' }).fill('')

await choose(page, 'Проект', 'Doctor School')
await matrix(page, '09-filter-project')
await reload(page)

await choose(page, 'Период', 'За 7 дней')
await matrix(page, '10-filter-period-7')
await reload(page)

await tab(page, 'Закрытые')
await matrix(page, '11-scope-closed')
await tab(page, 'Мои')
await matrix(page, '12-scope-mine')
await reload(page)

// The primary row act, its interaction states forced through CDP.
const act = page.getByRole('button', { name: /^Одобрить заявку №/ }).first()
await act.scrollIntoViewIfNeeded()
const cdp = await page.context().newCDPSession(page)
await cdp.send('DOM.enable')
await cdp.send('CSS.enable')
const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
const label = await act.getAttribute('aria-label')
const { nodeId } = await cdp.send('DOM.querySelector', {
  nodeId: root.nodeId,
  selector: `button[aria-label="${label}"]`,
})
for (const state of ['hover', 'focus-visible', 'active'] as const) {
  await cdp.send('CSS.forcePseudoState', {
    nodeId,
    forcedPseudoClasses: state === 'focus-visible' ? ['focus', 'focus-visible'] : [state],
  })
  await page.waitForTimeout(200)
  await act.screenshot({ path: `${outDir}/13-row-act-${state}.png` })
  console.log(`captured 13-row-act-${state}`)
}
await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })

// «Отметить оплату» opens the existing details sheet on that very row (#551 owns its form).
await page
  .getByRole('button', { name: /^Отметить оплату заявки №/ })
  .first()
  .click()
await page.getByRole('dialog').waitFor({ timeout: 30_000 })
await matrix(page, '14-pay-opens-sheet')
await page.keyboard.press('Escape')
await reload(page)

// «Одобрить» runs the approve act: the request leaves «Ждёт решения» for «К оплате».
const decide = page.getByRole('region', { name: 'Ждёт решения' })
const firstApprove = decide.getByRole('button', { name: /^Одобрить заявку №/ }).first()
const approvedLabel = (await firstApprove.getAttribute('aria-label')) ?? ''
await firstApprove.click()
await page.getByText('Заявка одобрена.').first().waitFor({ timeout: 30_000 })
await page.waitForTimeout(1200)
await matrix(page, '15-after-approve')
const id = approvedLabel.replace(/\D+/g, '')
const moved = await page
  .getByRole('region', { name: 'К оплате' })
  .getByRole('button', { name: new RegExp(`^Отметить оплату заявки №${id}$`) })
  .count()
findings.push(`approve #${id}: now in «К оплате» = ${moved === 1}`)

// ── a member without the approve role: same groups, no acts ─────────────────
const reader = await signedIn(browser, member)
await matrix(reader, '16-member-no-acts')
const readerActs = await reader.getByRole('button', { name: /^(Одобрить|Отметить)/ }).count()
findings.push(`member row acts visible: ${readerActs}`)

writeFileSync(`${outDir}/findings.txt`, findings.join('\n') + '\n')
console.log(findings.join('\n'))
await browser.close()
