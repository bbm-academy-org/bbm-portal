/**
 * The pre-acceptance UX pass over #550 / #551 / #559 (items 1–9): re-takes the
 * frames the pass changed, on the lead's acceptance stand, acting on nothing
 * (it opens, clicks «Прикрепить файл», and closes — no write).
 *
 * It signs in by minting the stand's own Auth.js cookie
 * (`tests/e2e/support/platform-session.ts`): `AUTH_SECRET` is read from the
 * process env, never written here.
 *
 * Usage: pnpm exec tsx --env-file=.env docs/evidence/551/ux-pass.ts <baseURL>
 */
import { appendFileSync } from 'node:fs'

import { chromium, type Page } from '@playwright/test'

import { signInAsPlatformMember } from '../../../tests/e2e/support/platform-session'

const baseURL = process.argv[2] ?? 'http://localhost:3000'
const only = new Set(process.argv.slice(3))
const want = (step: string) => only.size === 0 || only.has(step)
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const
const APPROVER = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'bbm-test@bbm.local',
  roles: ['platform-user', 'platform-admin', 'finance-approve', 'finance-entry'],
}
const FINDINGS = 'docs/evidence/551/findings-ux-pass.txt'

function note(line: string) {
  appendFileSync(FINDINGS, `${line}\n`)
  console.log(line)
}

/**
 * Light and dark at 1440 and 390. A sheet is framed whole (the viewport grows
 * to its scroll height); a page is framed whole with `fullPage`. `suffix`
 * keeps each folder's own naming: #550/#551 name the theme, #559 named none.
 */
async function shoot(page: Page, path: (viewport: string, theme: string) => string) {
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.evaluate((value) => {
        document.documentElement.classList.toggle('dark', value === 'dark')
      }, theme)
      // Let the dev server's «Compiling» chip settle out of the frame.
      await page.waitForTimeout(1500)
      const sheet = await page.evaluate(() => {
        const node = document.querySelector('[role="dialog"]') as HTMLElement | null
        return node === null ? 0 : node.scrollHeight
      })
      if (sheet > viewport.height) {
        await page.setViewportSize({ width: viewport.width, height: sheet + 8 })
        await page.waitForTimeout(250)
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      if (overflow > 0)
        note(`${path(viewport.name, theme)}: page scrolls sideways by ${overflow}px`)
      await page.screenshot({ path: path(viewport.name, theme), fullPage: sheet === 0 })
    }
  }
  await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

const queueFrame = (name: string) => (viewport: string, theme: string) =>
  `docs/evidence/550/${name}--${viewport}--${theme}.png`
const sheetFrame = (name: string) => (viewport: string, theme: string) =>
  `docs/evidence/551/${name}--${viewport}--${theme}.png`
const reportFrame = (name: string) => (viewport: string, theme: string) =>
  `docs/evidence/559/${name}--${viewport}${theme === 'light' ? '' : '--dark'}.png`

type Row = {
  id: number
  stage: string
  currency: string
  alreadyPaid: boolean
  personalFunds: boolean
  hasDocument: boolean
  note: string | null
  market: { kind: string } | null
}

const browser = await chromium.launch()
const context = await browser.newContext({ baseURL, viewport: VIEWPORTS[0] })
await signInAsPlatformMember(context, baseURL, APPROVER)
const page = await context.newPage()
const rows = (
  (await (await context.request.get('/p/finance/api/requests')).json()) as { requests: Row[] }
).requests
const pick = (label: string, test: (row: Row) => boolean) => {
  const row = rows.find(test)
  note(`${label}: ${row === undefined ? 'none' : `#${row.id} (${row.stage}, ${row.currency})`}`)
  return row
}

async function queue() {
  await page.goto('/p/finance/requests')
  await page.getByRole('group', { name: 'Итоги очереди' }).waitFor({ timeout: 90_000 })
}

async function openRequest(id: number) {
  await page.goto(`/p/finance/requests?request=${id}`)
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 90_000 })
  return dialog
}

// Items 1–2: the latest-request line and the tiered group headings.
if (want('queue')) {
  await queue()
  note(`latest line: ${await page.getByRole('status', { name: 'Последняя заявка' }).textContent()}`)
  await shoot(page, queueFrame('01-queue-default'))
  await page.getByRole('tab', { name: 'Закрытые' }).click()
  await page.getByRole('region', { name: 'Оплачено' }).waitFor()
  await shoot(page, queueFrame('11-scope-closed'))
}

// Items 3–6: the section labels, the put-away picker, the quiet «реквизитов нет», «факт не внесён».
if (want('sheet')) {
  const decide = pick('decide', (row) => row.stage === 'decide' && row.note !== null)
  if (decide) {
    await openRequest(decide.id)
    await shoot(page, sheetFrame('01-sheet-decide-usd'))
  }
  const missing = pick(
    'pay, no details',
    (row) => row.stage === 'pay' && !row.alreadyPaid && !row.personalFunds && !row.hasDocument,
  )
  if (missing) {
    const dialog = await openRequest(missing.id)
    note(
      `file inputs before «Прикрепить файл»: ${await dialog.locator('input[type=file]').count()}`,
    )
    await shoot(page, sheetFrame('02-sheet-pay-missing-details'))
    await dialog.getByRole('button', { name: 'Прикрепить файл' }).click()
    await shoot(page, sheetFrame('35-files-attach-opened'))
  }
  const pending = pick(
    '§J факт не внесён',
    (row) => row.market?.kind === 'not_posted' && row.stage === 'pay',
  )
  if (pending) {
    await openRequest(pending.id)
    await shoot(page, sheetFrame('05-sheet-fact-not-entered'))
  }
}

// Items 7–9: measured rows first, the unmeasured muted; the empty period; the counters.
if (want('report')) {
  for (const [period, name] of [
    ['12m', '02-default-12m-rub'],
    ['month', '06-this-month'],
  ] as const) {
    await page.goto(`/p/finance/reports/market-rate?period=${period}`)
    await page.getByRole('heading', { name: 'Курс против рынка' }).waitFor({ timeout: 90_000 })
    const counters = page.getByRole('list', { name: 'Не учтено в сумме' })
    note(
      `${period}: counters = ${(await counters.count()) > 0 ? await counters.textContent() : 'none'}`,
    )
    note(`${period}: empty = ${await page.getByText('За период нет валютных платежей').count()}`)
    await shoot(page, reportFrame(name))
  }
}

await browser.close()
