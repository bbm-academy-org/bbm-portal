import { expect, test } from '@playwright/test'

import { signInThroughZitadel } from './support/zitadel-sign-in'

const idpHost = process.env.E2E_IDP_HOST
const adminUsername = process.env.E2E_ADMIN_USERNAME
const adminPassword = process.env.E2E_ADMIN_PASSWORD

const MEMBERS = '/p/admin/member/members'
const MEMBERS_API = '/api/p/member/admin/members'

function isResponse(path: string, method: string) {
  return (response: import('@playwright/test').Response) =>
    new URL(response.url()).pathname === path &&
    response.request().method() === method &&
    response.status() === 200
}

test.describe('members cabinet (spec 311 EARS-441..445)', () => {
  test('the D-9 API route exists and re-checks platform-admin', async ({ request }) => {
    const response = await request.get(MEMBERS_API, { maxRedirects: 0 })
    expect(response.status()).toBe(403)
  })

  test('admin completes real member and nested alias CRUD through handlers and branch DB', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (an account holding platform-admin) to run',
    )

    const stamp = `${Date.now()}${test.info().parallelIndex}`
    const name = `E2E участник ${stamp}`
    const email = `e2e-member-${stamp}@bbm.academy`
    const role = `Тестовая роль ${stamp}`
    const alias = `e2e_member_${stamp}`
    const updatedAlias = `${alias}_updated`

    await signInThroughZitadel(
      page,
      MEMBERS,
      { username: adminUsername!, password: adminPassword! },
      { idpHost },
    )

    await expect(page.getByRole('heading', { name: 'Участники', level: 1 })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Поиск участников' }).fill(email)
    await expect(page.getByText('Участников пока нет')).toBeVisible()
    await expect(page.getByRole('button', { name: /Удалить участника/ })).toHaveCount(0)

    await page.getByRole('button', { name: 'Добавить участника' }).click()
    await expect(page.getByRole('heading', { name: 'Новый участник' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Алиасы' })).toHaveCount(0)
    await page.getByLabel('Имя').fill(name)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Часовой пояс').click()
    await page.getByRole('option', { name: 'Бангкок — Asia/Bangkok' }).click()
    const createResponse = page.waitForResponse(isResponse(MEMBERS_API, 'POST'))
    await page.getByRole('button', { name: 'Создать участника' }).click()
    await createResponse

    await expect(page).toHaveURL(new RegExp(`${MEMBERS}/edit/\\d+$`))
    const memberId = Number(new URL(page.url()).pathname.split('/').at(-1))
    expect(memberId).toBeGreaterThan(0)
    const memberPath = `${MEMBERS_API}/${memberId}`
    const aliasesPath = `${memberPath}/aliases`
    const composition = page.locator('[data-member-composition]')
    await expect(composition.getByRole('heading', { name: 'Профиль' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(composition.getByRole('heading', { name: 'Алиасы' })).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveValue(email)
    await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '')
    await expect(page.getByLabel('Часовой пояс')).toContainText('Бангкок — Asia/Bangkok')
    await expect(page.getByRole('button', { name: /Удалить участника/ })).toHaveCount(0)

    await page.getByLabel('Роль').fill(role)
    await page.getByLabel('Часовой пояс').click()
    await page.getByRole('option', { name: 'Тбилиси — Asia/Tbilisi' }).click()
    const profileResponse = page.waitForResponse(isResponse(memberPath, 'PATCH'))
    await page.getByRole('button', { name: 'Сохранить профиль' }).click()
    await profileResponse
    await page.reload()
    await expect(page.getByLabel('Роль')).toHaveValue(role)
    await expect(page.getByLabel('Часовой пояс')).toContainText('Тбилиси — Asia/Tbilisi')

    await expect(page.getByText('Алиасов пока нет')).toBeVisible()
    await page.getByRole('button', { name: 'Добавить алиас' }).click()
    await page.getByLabel('Тип алиаса').click()
    await page.getByRole('option', { name: 'Mattermost — логин' }).click()
    await page.getByLabel('Значение алиаса').fill(alias)
    const aliasCreateResponse = page.waitForResponse(isResponse(aliasesPath, 'POST'))
    await page.getByRole('button', { name: 'Сохранить алиас' }).click()
    const aliasCreate = await aliasCreateResponse
    const aliasBody = (await aliasCreate.json()) as { data: { id: number } }
    const aliasPath = `${aliasesPath}/${aliasBody.data.id}`
    await expect(page.getByText(alias, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: `Изменить алиас ${alias}` }).click()
    await expect(page.getByLabel('Тип алиаса')).toContainText('Mattermost — логин')
    await page.getByLabel('Значение алиаса').fill(updatedAlias)
    const aliasUpdateResponse = page.waitForResponse(isResponse(aliasPath, 'PATCH'))
    await page.getByRole('button', { name: 'Сохранить алиас' }).click()
    await aliasUpdateResponse
    await expect(page.getByText(updatedAlias, { exact: true })).toBeVisible()

    const aliasDeleteResponse = page.waitForResponse(isResponse(aliasPath, 'DELETE'))
    await page.getByRole('button', { name: `Удалить алиас ${updatedAlias}` }).click()
    await aliasDeleteResponse
    await expect(page.getByText('Алиасов пока нет')).toBeVisible()

    await page.goto(MEMBERS)
    await page.getByRole('searchbox', { name: 'Поиск участников' }).fill(email)
    await expect(page.getByText(email, { exact: true })).toBeVisible()
    await expect(page.getByText(role, { exact: true })).toBeVisible()
    const deactivateResponse = page.waitForResponse(isResponse(memberPath, 'PATCH'))
    await page.getByRole('button', { name: `Деактивировать ${name}` }).click()
    await deactivateResponse
    await expect(page.getByRole('button', { name: `Активировать ${name}` })).toBeVisible()

    const activateResponse = page.waitForResponse(isResponse(memberPath, 'PATCH'))
    await page.getByRole('button', { name: `Активировать ${name}` }).click()
    await activateResponse
    await expect(page.getByRole('button', { name: `Деактивировать ${name}` })).toBeVisible()
    await expect(page.getByRole('button', { name: /Удалить участника/ })).toHaveCount(0)
  })
})
