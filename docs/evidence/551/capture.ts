/**
 * The #551 acceptance capture — task-cycle stage 5 item 3.
 *
 * Drives the LIVE stand this session booted (`PORT=<n> pnpm dev` against the
 * branch database `platform_551`, migrated and seeded by `pnpm dev:db:branch`,
 * the Bank of Russia series synced by `pnpm platform:finance:fx:sync --from
 * 2026-07-01`, and the stand-only scenario rows of README.md) and writes the
 * evidence frames of the details sheet, its forms and the bulk dialog.
 *
 * It ACTS on the stand: the steps mark requests paid and reimbursed, so it is
 * run once against a freshly prepared branch DB, in the order written here
 * (the FX write-order rule makes the order part of the scenario).
 *
 * Credentials come from the environment and are never written here:
 *   E2E_ADMIN_USERNAME / E2E_MEMBER_USERNAME / E2E_PASSWORD / E2E_IDP_HOST.
 * A stand-only SQL hook is called between steps through E2E_STAND_SQL (a
 * command that takes one SQL string), so the stale-snapshot and «без курса»
 * states can be produced on the branch DB the stand reads.
 *
 * Usage: pnpm exec tsx docs/evidence/551/capture.ts <baseURL> <outDir> [step…]
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'

import { chromium, type Browser, type Locator, type Page } from '@playwright/test'

import { signInThroughZitadel } from '../../../tests/e2e/support/zitadel-sign-in'

const baseURL = process.argv[2] ?? 'http://localhost:3001'
const outDir = process.argv[3] ?? '.playwright-mcp/551'
const only = new Set(process.argv.slice(4))
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
/** Each finding is appended as it is made — a run that stops halfway keeps what it saw. */
const findings = {
  push(line: string) {
    appendFileSync(
      `${outDir}/findings.txt`,
      `${line}
`,
    )
    console.log(line)
  },
}

function standSql(sql: string): string {
  const [command, ...args] = (process.env.E2E_STAND_SQL ?? '').split(' ').filter(Boolean)
  if (command === undefined) throw new Error('set E2E_STAND_SQL')
  return execFileSync(command, [...args, sql], { encoding: 'utf8' })
}

async function signedIn(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORTS[0] })
  const page = await context.newPage()
  await signInThroughZitadel(
    page,
    ROUTE,
    { username, password },
    { idpHost: process.env.E2E_IDP_HOST },
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

/**
 * A state in both widths and both themes. With a sheet open the frame is the
 * viewport grown to the sheet's whole scroll height — the sheet is fixed and
 * scrolls inside itself, so a full-page frame would cut it at the fold.
 */
async function matrix(page: Page, name: string, themes: readonly string[] = THEMES) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(400)
    const dialog = page.getByRole('dialog')
    const open = (await dialog.count()) > 0
    if (open) {
      const height = await dialog.evaluate((node) => node.scrollHeight)
      await page.setViewportSize({
        width: viewport.width,
        height: Math.max(viewport.height, height),
      })
      await page.waitForTimeout(300)
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    if (overflow > 0)
      findings.push(`${name} @ ${viewport.name}: page scrolls sideways by ${overflow}px`)
    if (open) {
      const inner = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth)
      if (inner > 0)
        findings.push(`${name} @ ${viewport.name}: sheet scrolls sideways by ${inner}px`)
    }
    for (const theme of themes) {
      await setTheme(page, theme)
      await page.waitForTimeout(150)
      await page.screenshot({
        path: `${outDir}/${name}--${viewport.name}--${theme}.png`,
        fullPage: !open,
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

/** Open request №id from its row's bold line. */
async function openRequest(page: Page, id: number): Promise<Locator> {
  await reload(page)
  await page.getByRole('searchbox', { name: 'Поиск по заявкам' }).fill(`#${id}`)
  const link = page.getByRole('button', { name: new RegExp(`^Заявка №${id}:`) })
  // An open request is in «В работе»; a paid or refused one in «Закрытые».
  if ((await link.count()) === 0) {
    await page.getByRole('tab', { name: 'Закрытые', exact: true }).click()
  }
  await link.first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 30_000 })
  return dialog
}

async function pickAccount(dialog: Locator, page: Page, label: string, account: RegExp) {
  await dialog.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: account }).click()
}

async function toast(page: Page, text: string | RegExp) {
  await page.getByText(text).first().waitFor({ timeout: 30_000 })
}

const want = (step: string) => only.size === 0 || only.has(step)

const browser = await chromium.launch()
const page = await signedIn(browser, approver)

// ── 01–03: the sheet of each open stage ─────────────────────────────────────
if (want('stages')) {
  let dialog = await openRequest(page, 33) // USD, submitted: «Ждёт решения»
  await matrix(page, '01-sheet-decide-usd')
  await page.keyboard.press('Escape')
  dialog = await openRequest(page, 14) // RUB, approved, no details: «К оплате» with the warning
  await matrix(page, '02-sheet-pay-missing-details')
  await page.keyboard.press('Escape')
  dialog = await openRequest(page, 35) // USD with a pay link and a fee
  await matrix(page, '03-sheet-pay-details-fee')
  await page.keyboard.press('Escape')
  dialog = await openRequest(page, 38) // personal funds, USD: «Вернуть сотруднику»
  await matrix(page, '04-sheet-reimburse')
  await page.keyboard.press('Escape')
  dialog = await openRequest(page, 36) // already paid USD, no debited amount: «факт не внесён»
  await matrix(page, '05-sheet-fact-not-entered')
  await page.keyboard.press('Escape')
  dialog = await openRequest(page, 32) // personal funds with a stated charge: «факт не проведён»
  await matrix(page, '06-sheet-fact-not-posted-reimburse')
  await page.keyboard.press('Escape')
  void dialog
}

// ── 07–09: «Одобрить и отметить оплату» on a USD request from a RUB account ──
if (want('approve-pay')) {
  const dialog = await openRequest(page, 33)
  await dialog.getByRole('button', { name: 'Одобрить и отметить оплату' }).click()
  await pickAccount(dialog, page, 'Откуда', /^Основной банк/)
  const disabled = await dialog.getByRole('button', { name: 'Оплачено' }).isDisabled()
  findings.push(`USD from RUB account, no debited amount: «Оплачено» disabled = ${disabled}`)
  await dialog.getByLabel('Дата оплаты').fill('2026-10-01')
  await matrix(page, '07-form-mark-paid-cross-currency-empty')
  await dialog.getByLabel(/Списано фактически/).fill('abc')
  await dialog.getByRole('button', { name: 'Оплачено' }).click()
  await matrix(page, '08-form-mark-paid-validation-error')
  await dialog.getByLabel(/Списано фактически/).fill('115 000,00')
  await dialog.getByRole('button', { name: 'Оплачено' }).click()
  await toast(page, 'Заявка одобрена, оплата отмечена.')
  await page.waitForTimeout(1200)
  await matrix(page, '09-after-approve-and-pay')
}

// ── 10–12: §J measured — хуже рынка, $ switch ───────────────────────────────
if (want('market')) {
  let dialog = await openRequest(page, 35)
  await dialog.getByRole('button', { name: 'Отметить оплату' }).click()
  await dialog.getByLabel('Дата оплаты').fill('2026-11-13')
  await pickAccount(dialog, page, 'Откуда', /^Основной банк/)
  await dialog.getByLabel(/Списано фактически/).fill('9 334,00')
  await dialog.getByRole('button', { name: 'Оплачено' }).click()
  await toast(page, 'Оплата отмечена.')
  dialog = await openRequest(page, 35)
  const text = (await dialog.textContent()) ?? ''
  findings.push(
    `#35 §J: ${['9 200,00 ₽', '9 384,00 ₽', '+184,00 ₽', 'хуже рынка на 2,0%'].map((s) => `${s}=${text.includes(s)}`).join(' ')}`,
  )
  await matrix(page, '10-market-worse')
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: '$', exact: true }).click()
  dialog = await openRequest(page, 35)
  const usd = (await dialog.textContent()) ?? ''
  findings.push(
    `#35 in $: «хуже рынка на 2,0%» kept = ${usd.includes('хуже рынка на 2,0%')}, «+2,00 $» = ${usd.includes('+2,00 $')}`,
  )
  await matrix(page, '11-market-worse-usd', ['light'])
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: '₽', exact: true }).click()
}

// ── 12–14: «Отметить возврат» — 9 016 ₽ from the RUB account, лучше рынка ────
if (want('reimburse')) {
  await reload(page)
  await page.getByRole('tab', { name: 'Обязательства' }).click()
  const before = (await page.getByRole('tabpanel').textContent()) ?? ''
  let dialog = await openRequest(page, 38)
  await dialog.getByRole('button', { name: 'Отметить возврат' }).click()
  await pickAccount(dialog, page, 'Откуда', /^Основной банк/)
  await dialog.getByRole('button', { name: 'Возвращено' }).click()
  await matrix(page, '12-form-reimburse-validation-error')
  await dialog.getByLabel(/Сумма возврата/).fill('9 016,00')
  await matrix(page, '13-form-reimburse-filled')
  await dialog.getByRole('button', { name: 'Возвращено' }).click()
  await toast(page, 'Возврат отмечен.')
  dialog = await openRequest(page, 38)
  const text = (await dialog.textContent()) ?? ''
  findings.push(
    `#38 after refund: «лучше рынка на 2,0%» = ${text.includes('лучше рынка на 2,0%')}, «−184,00 ₽» = ${text.includes('−184,00 ₽')}`,
  )
  await matrix(page, '14-market-better-reimbursed')
  await page.keyboard.press('Escape')
  await reload(page)
  await page.getByRole('tab', { name: 'Обязательства' }).click()
  const after = (await page.getByRole('tabpanel').textContent()) ?? ''
  findings.push(
    `liabilities unchanged by the one-act refund (booked + repaid): ${before === after}`,
  )
}

// ── 15: the FX write-order refusal, verbatim ────────────────────────────────
if (want('write-order')) {
  const dialog = await openRequest(page, 36)
  await dialog.getByRole('button', { name: 'Отметить оплату' }).click()
  await dialog.getByLabel(/Списано фактически/).fill('16 500,00')
  await dialog.getByRole('button', { name: 'Оплачено' }).click()
  await dialog.getByRole('alert').first().waitFor({ timeout: 30_000 })
  findings.push(
    `write-order refusal: ${(await dialog.getByRole('alert').first().textContent())?.trim()}`,
  )
  await matrix(page, '15-refusal-fx-write-order')
  await page.keyboard.press('Escape')
}

// ── 16–19: mark paid without a receipt → «без чека» → attach later ───────────
if (want('no-receipt')) {
  // #14 names its account already, so the form opens filled; clearing the
  // date shows the required-field error.
  let dialog = await openRequest(page, 14)
  await dialog.getByRole('button', { name: 'Отметить оплату' }).click()
  await matrix(page, '17-form-mark-paid-same-currency')
  await dialog.getByLabel('Дата оплаты').fill('')
  await dialog.getByRole('button', { name: 'Оплачено' }).click()
  await matrix(page, '16-form-mark-paid-required-errors')
  await dialog.getByLabel('Дата оплаты').fill('2026-11-17')
  await dialog.getByRole('button', { name: 'Оплачено' }).click()
  await toast(page, 'Оплата отмечена.')
  await reload(page)
  await page.getByRole('tab', { name: 'Закрытые', exact: true }).click()
  await matrix(page, '18-queue-paid-without-receipt')
  dialog = await openRequest(page, 14)
  await matrix(page, '19-sheet-paid-without-receipt')
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'receipt-551.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  })
  await toast(page, 'Документ приложен.')
  await page.waitForTimeout(1500)
  const marker = await page.getByRole('dialog').getByText('без чека').count()
  findings.push(`#14 after «Прикрепить чек»: «без чека» markers in the sheet = ${marker}`)
  await matrix(page, '20-sheet-receipt-attached')
  await page.keyboard.press('Escape')
}

// ── 21: the stale snapshot refusal (EARS-548) ───────────────────────────────
if (want('stale')) {
  const dialog = await openRequest(page, 16)
  await dialog.getByRole('button', { name: 'Отметить оплату' }).click()
  await pickAccount(dialog, page, 'Откуда', /^Основной банк/)
  standSql("update core.finance_intake_item set note = note || ' (уточнено)' where id = 16")
  await dialog.getByRole('button', { name: 'Оплачено' }).click()
  await dialog.getByRole('alert').first().waitFor({ timeout: 30_000 })
  findings.push(
    `stale snapshot refusal: ${(await dialog.getByRole('alert').first().textContent())?.trim()}`,
  )
  await matrix(page, '21-refusal-stale-snapshot')
  await page.keyboard.press('Escape')
}

// ── 22–23: refuse / revoke need a reason ────────────────────────────────────
if (want('reason')) {
  let dialog = await openRequest(page, 17)
  await dialog.getByRole('button', { name: 'Отозвать' }).click()
  await dialog.getByRole('button', { name: 'Отозвать' }).click()
  await matrix(page, '22-form-revoke-reason-required')
  await page.keyboard.press('Escape')
  dialog = await openRequest(page, 7)
  await dialog.getByRole('button', { name: 'Отклонить' }).click()
  await matrix(page, '23-form-refuse')
  await page.keyboard.press('Escape')
}

// ── 24–27: the bulk dialog on «К оплате» ────────────────────────────────────
if (want('bulk')) {
  await reload(page)
  const pay = page.getByRole('region', { name: 'К оплате' })
  await pay.getByRole('button', { name: /^Отметить все \d+ как оплаченные…$/ }).click()
  let dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await matrix(page, '24-bulk-open')
  await pickAccount(dialog, page, 'Счёт пакета', /^Основной банк/)
  await dialog.getByRole('region', { name: 'Будет отмечено' }).waitFor({ timeout: 30_000 })
  const excluded =
    (await dialog.getByRole('region', { name: 'Не войдут в пакет' }).textContent()) ?? ''
  findings.push(`bulk preview excluded: ${excluded.replace(/\s+/g, ' ').slice(0, 300)}`)
  await matrix(page, '25-bulk-preview')
  await page.keyboard.press('Escape')
  const stillThere = await page
    .getByRole('region', { name: 'К оплате' })
    .getByRole('button', { name: /^Отметить оплату заявки №/ })
    .count()
  findings.push(`bulk cancelled — «К оплате» rows still with their act: ${stillThere}`)
  await pay.getByRole('button', { name: /^Отметить все \d+ как оплаченные…$/ }).click()
  dialog = page.getByRole('dialog')
  await pickAccount(dialog, page, 'Счёт пакета', /^Основной банк/)
  await dialog.getByRole('region', { name: 'Будет отмечено' }).waitFor({ timeout: 30_000 })
  const confirm = dialog.getByRole('button', { name: /^Отметить \d+ как оплаченные$/ })
  findings.push(`bulk confirm: ${await confirm.textContent()}`)
  await confirm.click()
  await toast(page, /Отмечено оплаченными/)
  findings.push(
    `bulk toast: ${await page
      .getByText(/Отмечено оплаченными/)
      .first()
      .textContent()}`,
  )
  await page.waitForTimeout(1200)
  await matrix(page, '26-after-bulk')
}

// ── 27: «нет курса ЦБ» — the rates of the 15 days up to #33's payment date removed ──
if (want('no-rate')) {
  standSql(
    "delete from core.finance_fx_rate where currency = 'USD' and rate_date between '2026-09-17' and '2026-10-01'",
  )
  const dialog = await openRequest(page, 33)
  findings.push(
    `#33 no rate: ${(await dialog.textContent())?.includes('нет курса ЦБ на 01.10.2026')}`,
  )
  await matrix(page, '27-market-no-rate')
  await page.keyboard.press('Escape')
}

// ── 28: the sheet's primary act, interaction states forced through CDP ──────
if (want('states')) {
  const dialog = await openRequest(page, 36) // still «К оплате» after the batch excluded it
  const act = dialog.getByRole('button', { name: 'Отметить оплату' })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  await act.evaluate((node) => node.setAttribute('data-capture', 'primary'))
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-capture="primary"]',
  })
  for (const state of ['hover', 'focus-visible', 'active'] as const) {
    await cdp.send('CSS.forcePseudoState', {
      nodeId,
      forcedPseudoClasses: state === 'focus-visible' ? ['focus', 'focus-visible'] : [state],
    })
    await page.waitForTimeout(200)
    await act.screenshot({ path: `${outDir}/28-sheet-act-${state}.png` })
  }
  await page.keyboard.press('Escape')
  findings.push(`Escape closes the sheet: ${(await page.getByRole('dialog').count()) === 0}`)
}

// ── 29: a member without `finance-approve` — no acts in the sheet ───────────
if (want('member')) {
  const reader = await signedIn(browser, member)
  const dialog = await openRequest(reader, 36)
  const acts = await dialog
    .getByRole('button', { name: /^(Одобрить|Отметить|Отклонить|Отозвать)/ })
    .count()
  findings.push(`member sheet acts: ${acts}`)
  await matrix(reader, '29-member-sheet-no-acts')
}

// ── 03 (re-take): a «К оплате» request carrying a fee, after the fee wording changed ──
if (want('fee')) {
  standSql(
    "update core.finance_intake_item set fee_amount = 5000, fee_currency = 'RUB', note = note || ' https://pay.example/inv/36' where id = 36",
  )
  await openRequest(page, 36)
  await matrix(page, '03-sheet-pay-details-fee')
  await page.keyboard.press('Escape')
}

// ── 30–31: the deep link ?request=<id> (lead addition) ─────────────────────
if (want('link')) {
  await page.goto(`${ROUTE}?request=36`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('dialog').waitFor({ timeout: 90_000 })
  findings.push(
    `?request=36 opens: ${await page.getByRole('dialog').getByText('Заявка №36').count()}`,
  )
  await matrix(page, '30-deep-link-opens-sheet', ['light'])
  await page.goto(`${ROUTE}?request=999`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Заявки №999 нет в списке').waitFor({ timeout: 90_000 })
  await matrix(page, '31-deep-link-unknown', ['light'])
}

await browser.close()
