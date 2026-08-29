import { expect, test, type Route } from '@playwright/test'

import { signInThroughZitadel } from './support/zitadel-sign-in'

const idpHost = process.env.E2E_IDP_HOST
const adminUsername = process.env.E2E_ADMIN_USERNAME
const adminPassword = process.env.E2E_ADMIN_PASSWORD

const MEMBERS = '/p/admin/member/members'
const MEMBERS_API = '/api/p/member/admin/members'
const now = '2026-08-29T06:00:00.000Z'
const member = {
  id: 7,
  slug: 'anna',
  email: 'anna@bbm.local',
  name: 'Анна',
  role: 'Куратор',
  status: 'active',
  timezone: 'Europe/Moscow',
  createdAt: now,
  updatedAt: now,
}

async function mockMembers(route: Route) {
  const request = route.request()
  const path = new URL(request.url()).pathname
  const method = request.method()

  if (path === MEMBERS_API && method === 'GET') {
    return route.fulfill({ json: { data: [member], total: 1 } })
  }
  if (path === MEMBERS_API && method === 'POST') {
    return route.fulfill({ json: { data: member } })
  }
  if (path === `${MEMBERS_API}/7` && (method === 'GET' || method === 'PATCH')) {
    return route.fulfill({ json: { data: member } })
  }
  if (path === `${MEMBERS_API}/7/aliases` && method === 'GET') {
    return route.fulfill({ json: { data: [], total: 0 } })
  }
  if (path === `${MEMBERS_API}/7/aliases` && method === 'POST') {
    return route.fulfill({
      json: {
        data: { id: 11, memberId: 7, kind: 'mattermost', value: 'anna', note: null },
      },
    })
  }
  return route.fulfill({
    status: 404,
    json: { error: { code: 'not-found', message: `Unmocked ${method} ${path}` } },
  })
}

test.describe('members cabinet (spec 311 EARS-441..445)', () => {
  test('the D-9 API route exists and re-checks platform-admin', async ({ request }) => {
    const response = await request.get(MEMBERS_API, { maxRedirects: 0 })
    expect(response.status()).toBe(403)
  })

  test('admin lists, creates and adds a nested alias through the accepted composition', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (an account holding platform-admin) to run',
    )

    await page.route(`**${MEMBERS_API}**`, mockMembers)
    await signInThroughZitadel(
      page,
      MEMBERS,
      { username: adminUsername!, password: adminPassword! },
      { idpHost },
    )

    await expect(page.getByRole('heading', { name: 'Участники', level: 1 })).toBeVisible()
    await expect(page.getByText('anna@bbm.local')).toBeVisible()
    await expect(page.getByRole('button', { name: /Удалить участника/ })).toHaveCount(0)

    await page.getByRole('button', { name: 'Добавить участника' }).click()
    await expect(page.getByRole('heading', { name: 'Новый участник' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Алиасы' })).toHaveCount(0)
    await page.getByLabel('Имя').fill('Анна')
    await page.getByLabel('Email').fill('anna@bbm.local')
    await page.getByRole('button', { name: 'Создать участника' }).click()

    await expect(page).toHaveURL(`${MEMBERS}/edit/7`)
    const composition = page.locator('[data-member-composition]')
    await expect(composition.getByRole('heading', { name: 'Профиль' })).toBeVisible()
    await expect(composition.getByRole('heading', { name: 'Алиасы' })).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '')
    await expect(page.getByText('Алиасов пока нет')).toBeVisible()

    await page.getByRole('button', { name: 'Добавить алиас' }).click()
    await page.getByLabel('Тип алиаса').fill('mattermost')
    await page.getByLabel('Значение алиаса').fill('anna')
    await page.getByRole('button', { name: 'Сохранить алиас' }).click()
    await expect(page.getByText('mattermost')).toBeVisible()
    await expect(page.getByText('anna', { exact: true })).toBeVisible()
  })
})
