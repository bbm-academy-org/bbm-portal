/**
 * The #517 acceptance capture — task-cycle stage 5 item 3.
 *
 * Drives the LIVE stand this session booted (`PORT=<n> pnpm dev` against the
 * branch database `platform_517`, loaded with the 47 reconstructed requests by
 * `load-prod-corpus.mjs` and repaired by `run-0017-repair.mjs`) and writes the
 * evidence frames.
 *
 * Credentials come from the environment and are never written here: the
 * session reads `~/.bbm-portal/CREDENTIALS.dev.txt` on truenas into a file and
 * exports `E2E_MEMBER_USERNAME` / `E2E_MEMBER_PASSWORD` for this process only
 * (`.claude/rules/dev-env.md` — this stand's own test user is in the agent's
 * zone, and the secret never reaches the session's output).
 *
 * Matrix: five states × 1440×900 and 390×844 × light and dark, plus the
 * «Источник» link's :hover / :focus-visible / :active forced through CDP's
 * `CSS.forcePseudoState` — the one way to photograph an interaction state
 * without holding a real pointer down across a screenshot.
 *
 * Usage: pnpm exec tsx docs/evidence/517/capture.ts <baseURL> <outDir>
 */
import { mkdirSync } from 'node:fs'

import { chromium, type Page } from '@playwright/test'

import { signInThroughZitadel } from '../../../tests/e2e/support/zitadel-sign-in'

const baseURL = process.argv[2] ?? 'http://localhost:3000'
const outDir = process.argv[3] ?? '.playwright-mcp/517'
mkdirSync(outDir, { recursive: true })

const credentials = {
  username: process.env.E2E_MEMBER_USERNAME ?? '',
  password: process.env.E2E_MEMBER_PASSWORD ?? '',
}
if (credentials.username === '' || credentials.password === '') {
  throw new Error('set E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD for the capture run')
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]
const THEMES = ['light', 'dark'] as const

const browser = await chromium.launch()
// `baseURL` on the context, because `signInThroughZitadel` takes a RELATIVE
// path and waits for `url.pathname === targetPath`.
const context = await browser.newContext({ baseURL, viewport: VIEWPORTS[0] })
const page: Page = await context.newPage()

await signInThroughZitadel(page, '/p/finance/requests', credentials, {
  idpHost: process.env.E2E_IDP_HOST,
})

async function setTheme(theme: string) {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
    document.documentElement.setAttribute('data-theme', value)
    document.documentElement.style.colorScheme = value
  }, theme)
  await page.waitForTimeout(200)
}

async function shot(name: string) {
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${outDir}/${name}.png` })
  console.log(`captured ${name}`)
}

/** The register, at the «Все» scope where the reconstructed corpus lives. */
async function openRegister() {
  await page.goto(`${baseURL}/p/finance/requests`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Все' }).click({ timeout: 60_000 })
  await page.getByRole('table').first().waitFor({ timeout: 60_000 })
}

/**
 * The register pages at 25 rows and the corpus is 48, so a request is not
 * assumed to be on page 1: «Подана» is sorted ASCENDING first — which brings
 * the oldest of the reconstructed corpus, including the Higgsfield request of
 * 2026-04-20, onto the first page — and the pager is walked if that still is
 * not enough.
 */
async function openRequest(id: number) {
  await openRegister()
  const open = page.getByRole('button', { name: `Заявка №${id}` })
  if ((await open.count()) === 0) {
    await page.getByRole('button', { name: 'Сортировать по дате подачи' }).first().click()
    await page.waitForTimeout(600)
  }
  for (let step = 0; step < 10 && (await open.count()) === 0; step += 1) {
    const next = page.getByRole('button', { name: 'Следующая страница' }).first()
    if ((await next.count()) === 0 || (await next.isDisabled())) break
    await next.click()
    await page.waitForTimeout(500)
  }
  await open.scrollIntoViewIfNeeded()
  await open.click()
  await page.getByRole('dialog').waitFor({ timeout: 30_000 })
}

/** Pick the first real option of one of the sheet's kit selects. */
async function pickFirst(label: string) {
  // The combobox, not the inline «Новый контрагент» text field that shares the
  // word — `getByLabel` matches both.
  await page.getByRole('combobox', { name: label }).first().click()
  const listbox = page.getByRole('listbox')
  await listbox.waitFor({ timeout: 15_000 })
  const options = listbox.getByRole('option')
  const count = await options.count()
  for (let index = 0; index < count; index += 1) {
    const text = (await options.nth(index).innerText()).trim()
    if (text !== '—' && !text.startsWith('Без') && !text.startsWith('Нет подходящего')) {
      await options.nth(index).click()
      return
    }
  }
  await page.keyboard.press('Escape')
}

/**
 * The form, with «Ссылка на источник» filled.
 *
 * For the REFUSAL frame the whole form is filled first: the schema runs on
 * submit (`mode: 'onSubmit'`), so «Подать заявку» has to be reachable for the
 * message under the source field to exist at all.
 */
async function openForm(sourceRef: string, invalid = false) {
  await openRegister()
  await page.getByRole('button', { name: 'Новая заявка' }).click()
  await page.getByRole('dialog').waitFor({ timeout: 30_000 })
  if (invalid) {
    await pickFirst('Назначение')
    await pickFirst('Проект')
    // The counterparty is «picked or typed» (EARS-532); typing is the branch
    // that needs no open listbox and is therefore the stable one here.
    await page.getByRole('textbox', { name: 'Новый контрагент' }).fill('Higgsfield')
    await page.getByLabel('Сумма документа').fill('1 000,00')
  }
  const field = page.getByLabel('Ссылка на источник')
  await field.scrollIntoViewIfNeeded()
  await field.fill(sourceRef)
  if (invalid) {
    const submit = page.getByRole('button', { name: 'Подать заявку' })
    await submit.scrollIntoViewIfNeeded()
    if (await submit.isDisabled()) {
      const reason = await page
        .locator('#submit-block-reason')
        .innerText()
        .catch(() => '')
      throw new Error(`the form is still blocked: ${reason}`)
    }
    await submit.click({ timeout: 30_000 })
    await page.getByText(/Вставьте адрес целиком/).waitFor({ timeout: 30_000 })
    await page.getByLabel('Ссылка на источник').scrollIntoViewIfNeeded()
  }
}

const STATES = [
  { name: 'register', run: openRegister },
  { name: 'sheet-higgsfield', run: () => openRequest(6) },
  { name: 'sheet-no-source', run: () => openRequest(52) },
  {
    name: 'form-source-filled',
    run: () => openForm('https://chat.bbm.academy/bbm/pl/q41r3h4nxjnozgft493okar9tw'),
  },
  { name: 'form-source-invalid', run: () => openForm('см. в чате', true) },
]

for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  for (const theme of THEMES) {
    for (const state of STATES) {
      await state.run()
      await setTheme(theme)
      await shot(`${state.name}--${viewport.name}--${theme}`)
    }
  }
}

// The link's interaction states, FORCED. A real hover would answer `:hover`,
// but `:active` cannot be held across a screenshot and `:focus-visible`
// depends on the heuristics of the last input modality — CDP answers all three
// the same way, from the same node.
await page.setViewportSize(VIEWPORTS[0]!)
await openRequest(6)
await setTheme('light')
await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]')
  dialog?.querySelector('a[target="_blank"]')?.setAttribute('data-capture', 'source-link')
})
const cdp = await context.newCDPSession(page)
await cdp.send('DOM.enable')
await cdp.send('CSS.enable')
const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
const { nodeId } = await cdp.send('DOM.querySelector', {
  nodeId: root.nodeId,
  selector: '[data-capture="source-link"]',
})
if (nodeId === 0) throw new Error('the «Источник» link was not found in the sheet')
for (const pseudo of ['hover', 'focus-visible', 'active']) {
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [pseudo] })
  await shot(`source-link--${pseudo}--desktop--light`)
}
await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })

await browser.close()
