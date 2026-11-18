/**
 * The #551 RE-CAPTURE after the review of PR #564 (S1–S3, UX 1–7).
 *
 * `capture.ts` ACTS on a freshly prepared stand in a fixed order; this script
 * re-takes only the frames the review changed, on the stand as `capture.ts`
 * left it, and acts only where a frame needs a refusal (which writes nothing).
 * It signs in by minting the stand's own Auth.js cookie
 * (`tests/e2e/support/platform-session.ts`): `AUTH_SECRET` is read from the
 * process env, never written here.
 *
 * Usage: pnpm exec tsx docs/evidence/551/recapture.ts <baseURL> <outDir> [step…]
 */
import { appendFileSync, mkdirSync } from 'node:fs'

import { chromium, type Locator, type Page } from '@playwright/test'

import { signInAsPlatformMember } from '../../../tests/e2e/support/platform-session'

const baseURL = process.argv[2] ?? 'http://localhost:3001'
const outDir = process.argv[3] ?? '.playwright-mcp/551'
const only = new Set(process.argv.slice(4))
const want = (step: string) => only.size === 0 || only.has(step)
mkdirSync(outDir, { recursive: true })

const ROUTE = '/p/finance/requests'
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const
const APPROVER = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'bbm-test@bbm.local',
  roles: ['platform-user', 'platform-admin', 'finance-approve', 'finance-entry'],
}

function note(line: string) {
  appendFileSync(`${outDir}/findings.txt`, `${line}\n`)
  console.log(line)
}

async function shoot(page: Page, name: string, themes: readonly string[] = ['light']) {
  for (const viewport of VIEWPORTS) {
    for (const theme of themes) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.evaluate((value) => {
        document.documentElement.classList.toggle('dark', value === 'dark')
      }, theme)
      await page.waitForTimeout(250)
      // With a sheet open, grow the viewport to the sheet's scroll height.
      const height = await page.evaluate(() => {
        const sheet = document.querySelector('[role="dialog"]') as HTMLElement | null
        return sheet === null ? 0 : sheet.scrollHeight
      })
      if (height > viewport.height) {
        await page.setViewportSize({ width: viewport.width, height: height + 8 })
        await page.waitForTimeout(250)
      }
      await page.screenshot({ path: `${outDir}/${name}--${viewport.name}--${theme}.png` })
    }
  }
  await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

async function openRequest(page: Page, id: number): Promise<Locator> {
  await page.goto(`${ROUTE}?request=${id}`)
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 90_000 })
  return dialog
}

type Row = {
  id: number
  status: string
  stage: string
  currency: string
  alreadyPaid: boolean
  personalFunds: boolean
  paidCurrency: string | null
  note: string | null
  hasDocument: boolean
}

const browser = await chromium.launch()
const context = await browser.newContext({ baseURL, viewport: VIEWPORTS[0] })
await signInAsPlatformMember(context, baseURL, APPROVER)
const page = await context.newPage()
const response = await context.request.get('/p/finance/api/requests')
const rows = ((await response.json()) as { requests: Row[] }).requests
const pick = (label: string, test: (row: Row) => boolean) => {
  const row = rows.find(test)
  note(`${label}: ${row === undefined ? 'none' : `#${row.id} (${row.stage}, ${row.currency})`}`)
  return row
}

// The stand as `capture.ts` left it has no unpaid «К оплате» row and no USD
// refund with its currency still open: one seeded request is approved, and a
// member's USD card spend with no stated charge is filed (stand-only data).
if (only.has('prepare')) {
  const snapshot = (await (await context.request.get('/p/finance/api/requests')).json()) as {
    references: { projects: { id: number }[]; purposes: { id: number; productBinding: string }[] }
  }
  for (const id of [6, 7]) {
    if (!rows.some((row) => row.id === id && row.stage === 'decide')) continue
    const approve = await context.request.post(`/p/finance/api/requests/${id}/actions`, {
      data: { act: 'approve' },
      headers: { origin: baseURL },
    })
    note(`approve #${id}: ${approve.status()}`)
  }
  if (rows.some((row) => row.note?.startsWith('Подписка на стоковую музыку'))) {
    note('the USD personal-funds request is already filed')
  } else {
    const filed = await context.request.post('/p/finance/api/requests', {
      headers: { origin: baseURL },
      data: {
        occurredOn: '2026-11-14',
        accountId: null,
        amount: '4500',
        currency: 'USD',
        paidAmount: null,
        paidCurrency: null,
        purposeId:
          snapshot.references.purposes.find((row) => row.productBinding !== 'required')?.id ?? null,
        purposeProposal: null,
        projectId: snapshot.references.projects[0]!.id,
        productId: null,
        counterpartyId: null,
        counterpartyName: 'Epidemic Sound',
        note: 'Подписка на стоковую музыку, оплатил своей картой в долларах',
        sourceRef: null,
        alreadyPaid: true,
        personalFunds: true,
      },
    })
    note(`file USD personal-funds request: ${filed.status()} ${(await filed.text()).slice(0, 160)}`)
  }
}

if (want('probe')) {
  for (const row of rows) {
    note(
      `#${row.id} ${row.status}/${row.stage} ${row.currency} paid=${row.alreadyPaid} pf=${row.personalFunds} paidCur=${row.paidCurrency} doc=${row.hasDocument} note=${(row.note ?? '').slice(0, 40)}`,
    )
  }
}

// UX 4 — the sheet title is the queue row's line; UX 1 — no details warning once paid.
if (want('stages')) {
  const decide = pick('decide', (row) => row.stage === 'decide' && row.note !== null)
  if (decide) {
    await openRequest(page, decide.id)
    await shoot(page, '01-sheet-decide-usd', ['light', 'dark'])
  }
  const missing = pick(
    'pay, no details',
    (row) => row.stage === 'pay' && !row.alreadyPaid && !row.personalFunds && !row.hasDocument,
  )
  if (missing) {
    await openRequest(page, missing.id)
    await shoot(page, '02-sheet-pay-missing-details')
  }
  const paid = pick(
    'pay, already paid',
    (row) => row.stage === 'pay' && row.alreadyPaid && !row.personalFunds,
  )
  if (paid) {
    await openRequest(page, paid.id)
    await shoot(page, '32-sheet-pay-already-paid')
  }
}

// UX 5 + S3 — a USD personal-funds refund in the form's currency; «факт не внесён» → «Отметить возврат».
if (want('reimburse')) {
  const usd = pick(
    'reimburse, USD, open refund currency',
    (row) =>
      row.stage === 'reimburse' &&
      row.currency !== 'RUB' &&
      row.paidCurrency === null &&
      row.status !== 'posted',
  )
  if (usd) {
    const dialog = await openRequest(page, usd.id)
    await shoot(page, '04-sheet-reimburse', ['light', 'dark'])
    await dialog.getByRole('button', { name: 'Отметить возврат' }).click()
    await shoot(page, '13-form-reimburse-filled')
  }
}

// UX 2 — one upload control while a payment form is open.
if (want('pay-form')) {
  const pay = pick(
    'pay form, foreign currency',
    (row) => row.stage === 'pay' && !row.personalFunds && row.currency !== 'RUB',
  )
  if (pay) {
    const dialog = await openRequest(page, pay.id)
    await dialog.getByRole('button', { name: 'Отметить оплату' }).click()
    const pickers = await dialog.getByLabel('Подтверждающий документ').count()
    note(`pay form open: «Подтверждающий документ» pickers = ${pickers}`)
    await shoot(page, '07-form-mark-paid-cross-currency-empty')
  }
}

// UX 7 — a refusal reaches the owner without spec codes, dates as ДД.ММ.ГГГГ.
if (want('refusal')) {
  const early = pick(
    'pay, foreign currency, for the write-order refusal',
    (row) => row.stage === 'pay' && row.currency !== 'RUB' && !row.personalFunds,
  )
  if (early) {
    const dialog = await openRequest(page, early.id)
    await dialog.getByRole('button', { name: 'Отметить оплату' }).click()
    await dialog.getByLabel('Дата оплаты').fill('2026-07-01')
    const account = dialog.getByRole('combobox', { name: 'Откуда' })
    await account.click()
    await page.getByRole('option', { name: /RUB/ }).first().click()
    const debited = dialog.getByLabel(/Списано фактически/)
    if ((await debited.count()) > 0) await debited.fill('1 000,00')
    await dialog.getByRole('button', { name: 'Оплачено' }).click()
    const alert = dialog.getByRole('alert')
    await alert.waitFor({ timeout: 30_000 })
    const text = (await alert.textContent()) ?? ''
    note(`refusal shown: ${text}`)
    note(
      `refusal carries EARS codes = ${/EARS-/.test(text)}, ISO dates = ${/\d{4}-\d{2}-\d{2}/.test(text)}`,
    )
    await shoot(page, '15-refusal-fx-write-order')
  }
}

// UX 3 + the reimburse label — the bulk preview at 390 px; cancel posts nothing.
if (want('bulk')) {
  await page.goto(ROUTE)
  await page.getByRole('group', { name: 'Итоги очереди' }).waitFor({ timeout: 90_000 })
  for (const [group, label, frame] of [
    ['К оплате', /^Отметить все \d+ как оплаченные…$/, '25-bulk-preview'],
    ['Вернуть сотруднику', /^Отметить все \d+ как возвращённые…$/, '33-bulk-reimburse-preview'],
  ] as const) {
    await page.goto(ROUTE)
    await page.getByRole('group', { name: 'Итоги очереди' }).waitFor({ timeout: 90_000 })
    const act = page.getByRole('region', { name: group }).getByRole('button', { name: label })
    if ((await act.count()) === 0) {
      note(`${group}: no bulk act (fewer than two rows)`)
      continue
    }
    note(`${group}: bulk act «${await act.textContent()}»`)
    await act.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox', { name: 'Счёт пакета' }).click()
    await page.getByRole('option', { name: /RUB/ }).first().click()
    await dialog.getByRole('region', { name: 'Будет отмечено' }).waitFor({ timeout: 30_000 })
    await shoot(page, frame, ['light', 'dark'])
    await dialog.getByRole('button', { name: 'Отмена' }).click()
  }
}

await browser.close()
