import { expect, test, type Page, type Response } from '@playwright/test'

import { signInThroughZitadel } from './support/zitadel-sign-in'

const idpHost = process.env.E2E_IDP_HOST
const adminUsername = process.env.E2E_ADMIN_USERNAME
const adminPassword = process.env.E2E_ADMIN_PASSWORD
const memberUsername = process.env.E2E_MEMBER_USERNAME
const memberPassword = process.env.E2E_MEMBER_PASSWORD

const FINANCE = '/p/finance'
const CABINET = '/p/admin'
const API_ROOT = '/api/p/finance/admin'
const CURRENCIES = '/p/admin/finance/currencies'
const ACCOUNTS = '/p/admin/finance/accounts'
const PROJECTS = '/p/admin/finance/projects'
const PRODUCTS = '/p/admin/finance/products'
const PURPOSES = '/p/admin/finance/purposes'
const CATEGORIES = '/p/admin/finance/categories'

const CURRENCIES_API = `${API_ROOT}/currencies`
const ACCOUNTS_API = `${API_ROOT}/accounts`
const PROJECTS_API = `${API_ROOT}/projects`
const PRODUCTS_API = `${API_ROOT}/products`
const PURPOSES_API = `${API_ROOT}/purposes`

const adminCredentials = { username: adminUsername!, password: adminPassword! }
const memberCredentials = { username: memberUsername!, password: memberPassword! }

function successful(path: string, method: string) {
  return (response: Response) =>
    new URL(response.url()).pathname === path &&
    response.request().method() === method &&
    response.status() === 200
}

async function signIn(page: Page, target: string, credentials: typeof adminCredentials) {
  await signInThroughZitadel(page, target, credentials, { idpHost })
}

async function saveCreated(page: Page, apiPath: string) {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === apiPath && candidate.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect((await response).status()).toBe(200)
  await expect(page.getByRole('status')).toContainText('Запись сохранена')
}

async function expectThemedFinanceCanvas(page: Page) {
  const canvas = page.locator('main[data-bbm-ui]')
  const heading = canvas.getByRole('heading', { name: 'Финансы', level: 1 })
  const card = canvas.locator('[data-slot="card"]').first()
  await expect(canvas).toBeVisible()
  await expect(card).toBeVisible()

  const headingStyle = await heading.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      contentGutter: element.getBoundingClientRect().left,
    }
  })
  const cardRadius = await card.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  )

  expect(headingStyle.fontFamily).not.toMatch(/times new roman|^serif$/i)
  expect(headingStyle.fontSize).toBe('24px')
  expect(headingStyle.contentGutter).toBeGreaterThanOrEqual(16)
  expect(cardRadius).toBeGreaterThan(0)
}

test.describe('finance F1b browser acceptance (#357, spec 338 EARS-324..326)', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  test('EARS-462: anonymous finance cabinet API access is a bare 403', async ({ request }) => {
    const response = await request.get(CURRENCIES_API, { maxRedirects: 0 })
    expect(response.status()).toBe(403)
    expect(await response.text()).toBe('')
  })

  test('EARS-325/330: a member sees balances but cannot read or write finance references', async ({
    page,
  }) => {
    test.skip(
      !memberUsername || !memberPassword,
      'set E2E_MEMBER_USERNAME / E2E_MEMBER_PASSWORD (without platform-admin) to run',
    )

    await signIn(page, FINANCE, memberCredentials)
    await expect(page.getByRole('heading', { name: 'Финансы', level: 1 })).toBeVisible()
    await expect(page.getByText('Деньги сейчас', { exact: true })).toBeVisible()
    await expectThemedFinanceCanvas(page)

    const read = await page.context().request.get(CURRENCIES_API, { maxRedirects: 0 })
    expect(read.status()).toBe(403)
    expect(await read.text()).toBe('')

    const write = await page.context().request.post(CURRENCIES_API, {
      maxRedirects: 0,
      data: { code: 'DENY', name: 'Недоступная валюта', precision: 2 },
    })
    expect(write.status()).toBe(403)
    expect(await write.text()).toBe('')
  })

  test('EARS-324/409: the admin cabinet derives the Finance group and all six resources', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (holding platform-admin) to run',
    )

    await signIn(page, CABINET, adminCredentials)
    const navigation = page.getByRole('navigation', { name: 'Разделы админки' })
    await expect(navigation.getByText('Финансы', { exact: true })).toBeVisible()
    for (const resource of [
      'Валюты',
      'Счета',
      'Проекты',
      'Продукты',
      'Назначения расходов',
      'Статьи расходов',
    ]) {
      await expect(navigation.getByRole('link', { name: resource, exact: true })).toBeVisible()
    }
  })

  test('EARS-317/325: the live stand carries representative linked rows and varied balances', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (holding platform-admin) to run',
    )

    await signIn(page, FINANCE, adminCredentials)
    for (const balance of [
      { account: 'Основной банк', amount: '1 284 500,00', currency: 'RUB' },
      { account: 'Корпоративная карта', amount: '8 750,00', currency: 'USD' },
      { account: 'Операционная касса', amount: '64 320,50', currency: 'THB' },
    ]) {
      const row = page.locator('main[data-bbm-ui] > div').filter({ hasText: balance.account })
      await expect(row).toContainText(balance.amount)
      await expect(row).toContainText(balance.currency)
    }

    for (const [path, rows] of [
      [PROJECTS, ['Doctor School', 'BBM Academy']],
      [PRODUCTS, ['Курс «Основы нутрициологии»', 'Клуб BBM']],
      [PURPOSES, ['Продажи курса', 'Партнёрская программа', 'Операционные расходы']],
      [CATEGORIES, ['Маркетинг', 'Комиссии', 'Операционные расходы']],
    ] as const) {
      await page.goto(path)
      for (const row of rows) await expect(page.getByText(row, { exact: true })).toBeVisible()
    }
  })

  test('EARS-301/472: admin creates the accepted reference chain through the actual UI', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (holding platform-admin) to run',
    )

    const stamp = `${Date.now()}${test.info().parallelIndex}`
    const currencyCode = `T${stamp}`
    const currencyName = `E2E валюта ${stamp}`
    const accountName = `E2E счёт ${currencyCode}`
    const projectName = `E2E проект ${stamp}`
    const productName = `E2E продукт ${stamp}`
    const purposeName = `E2E назначение ${stamp}`

    await signIn(page, CATEGORIES, adminCredentials)
    await expect(page.getByText('Маркетинг', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Добавить статью расходов' })).toBeVisible()

    await page.goto(CURRENCIES)
    await page.getByRole('button', { name: 'Добавить валюту' }).click()
    await page.getByLabel('Код').fill(currencyCode)
    await page.getByLabel('Название').fill(currencyName)
    await page.getByLabel('Точность').fill('2')
    await saveCreated(page, CURRENCIES_API)

    await page.goto(ACCOUNTS)
    await page.getByRole('button', { name: 'Добавить счёт' }).click()
    await page.getByLabel('Название').fill(accountName)
    await page.getByLabel('Тип').click()
    await page.getByRole('option', { name: 'Банк', exact: true }).click()
    await page.getByLabel('Валюта').click()
    await page
      .getByRole('option', { name: `${currencyCode} — ${currencyName}`, exact: true })
      .click()
    await saveCreated(page, ACCOUNTS_API)

    await page.goto(PROJECTS)
    await page.getByRole('button', { name: 'Добавить проект' }).click()
    await page.getByLabel('Название').fill(projectName)
    await saveCreated(page, PROJECTS_API)

    await page.goto(PRODUCTS)
    await page.getByRole('button', { name: 'Добавить продукт' }).click()
    await page.getByLabel('Название').fill(productName)
    await page.getByLabel('Проект').click()
    await page.getByRole('option', { name: projectName, exact: true }).click()
    await saveCreated(page, PRODUCTS_API)

    await page.goto(PURPOSES)
    await page.getByRole('button', { name: 'Добавить назначение' }).click()
    await page.getByLabel('Название').fill(purposeName)
    await page.getByLabel('Статья расходов').click()
    await page.getByRole('option', { name: 'Операционные расходы', exact: true }).click()
    await page.getByLabel('Привязка продукта').click()
    await page.getByRole('option', { name: 'Обязательна', exact: true }).click()
    await saveCreated(page, PURPOSES_API)

    await page.goto(FINANCE)
    await expectThemedFinanceCanvas(page)
    const balanceRow = page
      .locator('[data-slot="card"] .divide-y > div')
      .filter({ hasText: accountName })
    await expect(balanceRow.getByText(accountName, { exact: true })).toBeVisible()
    await expect(balanceRow.getByText('0,00', { exact: true })).toBeVisible()
    await expect(balanceRow.getByText(currencyCode, { exact: true })).toBeVisible()

    await page.goto(CURRENCIES)
    const deleteResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${CURRENCIES_API}/${currencyCode}` &&
        response.request().method() === 'DELETE' &&
        response.status() === 409,
    )
    await page.getByRole('button', { name: `Удалить ${currencyName}` }).click()
    await deleteResponse
    const currencyRefusal = page
      .locator('main [data-slot="alert"]:visible')
      .filter({ hasText: 'нельзя удалить' })
    await expect(currencyRefusal).toContainText('нельзя удалить')
    await expect(currencyRefusal).toContainText('выводят из обращения')

    await page.goto(PROJECTS)
    const fundRow = page.getByRole('row').filter({ hasText: 'Фонд BBM' })
    await expect(fundRow.getByRole('button', { name: 'Архивировать Фонд BBM' })).toHaveCount(0)
    const projectList = await page.context().request.get(PROJECTS_API)
    expect(projectList.status()).toBe(200)
    const projectBody = (await projectList.json()) as {
      data: { id: number; name: string; isFund: boolean }[]
    }
    const fund = projectBody.data.find((project) => project.isFund)
    expect(fund, 'fresh finance DB carries its one seeded Fund row').toBeDefined()
    const retireFund = await page.context().request.patch(`${PROJECTS_API}/${fund!.id}`, {
      data: { retire: true },
    })
    expect(retireFund.status()).toBe(409)
    const retireFundBody = (await retireFund.json()) as { error: { message: string } }
    expect(retireFundBody.error.message).toContain('фонд BBM')
    expect(retireFundBody.error.message).toContain('нельзя')

    await page.goto(ACCOUNTS)
    const originalRow = page.getByRole('row').filter({ hasText: accountName })
    await expect(originalRow).toContainText('Банк')
    await expect(originalRow).toContainText(currencyCode)
    await originalRow.getByRole('button', { name: `Изменить ${accountName}` }).click()
    const renamedAccount = `${accountName} — переименован`
    await page.getByLabel('Название').fill(renamedAccount)
    const renameResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith(`${ACCOUNTS_API}/`) &&
        response.request().method() === 'PATCH' &&
        response.status() === 200,
    )
    await page.getByRole('button', { name: 'Сохранить изменения' }).click()
    await renameResponse
    await expect(page.getByRole('status')).toContainText('Изменения сохранены')

    await page.goto(ACCOUNTS)
    const renamedRow = page.getByRole('row').filter({ hasText: renamedAccount })
    await expect(renamedRow).toContainText('Банк')
    await expect(renamedRow).toContainText(currencyCode)
  })
})
