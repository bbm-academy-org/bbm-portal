import { expect, test, type Page } from '@playwright/test'

import { isAllowedE2EIdpOrigin } from './support/idp-origin'

/**
 * Browser E2E для acceptance-сценариев спеки 081 (issue #81) — против РЕАЛЬНОГО
 * задеплоенного стенда, не против локального dev-сервера. Обязательный зелёный
 * прогон — ДО приглашения владельца на приёмку (task-cycle, стадия 5).
 *
 * Автоматизируется только то, что можно проверить без изменения прод-данных:
 *   - сценарий 1 (логин): анониму контент не отдаётся;
 *   - сценарий 9/311 EARS-452: old admin URLs are hard 404, while the new JSON
 *     handler refuses an anonymous caller itself;
 *   - сценарий 11 (CMS-поверхность): cms.bbm.academy/p/hours отвечает 404.
 * Сохранение оценки, открытие/закрытие периода и заведение участника —
 * мутации прод-данных: это шаги ЖИВОЙ приёмки владельцем, а не автотест.
 *
 * Файл самоскипается без переменных, поэтому CI и локальный `pnpm test:e2e` не
 * меняются:
 *   PORTAL_E2E_BASE_URL  e.g. https://portal.bbm.academy
 *   CMS_E2E_BASE_URL     e.g. https://cms.bbm.academy
 * Сценарий с логином дополнительно требует реальных учёток IdP:
 *   E2E_IDP_USERNAME / E2E_IDP_PASSWORD
 * Для непродового IdP нужен точный host allowlist (с портом):
 *   E2E_IDP_HOST       e.g. truenas.local:9180
 * Desktop-проверка админской таблицы требует отдельной admin-учётки:
 *   E2E_HOURS_ADMIN_USERNAME / E2E_HOURS_ADMIN_PASSWORD
 *
 * Пример запуска:
 *   PORTAL_E2E_BASE_URL=https://portal.bbm.academy \
 *   CMS_E2E_BASE_URL=https://cms.bbm.academy \
 *   pnpm test:e2e tests/e2e/hours-prod.e2e.spec.ts
 */

const portalBase = (process.env.PORTAL_E2E_BASE_URL ?? '').replace(/\/+$/, '')
const cmsBase = (process.env.CMS_E2E_BASE_URL ?? '').replace(/\/+$/, '')
const idpUsername = process.env.E2E_IDP_USERNAME
const idpPassword = process.env.E2E_IDP_PASSWORD
const idpHost = process.env.E2E_IDP_HOST
const hoursAdminUsername = process.env.E2E_HOURS_ADMIN_USERNAME
const hoursAdminPassword = process.env.E2E_HOURS_ADMIN_PASSWORD

/** Маркеры отрисованной страницы часов — их ОТСУТСТВИЕ и есть доказательство. */
const HOURS_ROOT = '.hours-root'
const HOURS_HEADING = 'Сколько было отработано'

async function signIn(
  page: Page,
  targetPath: string,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.goto(`${portalBase}${targetPath}`, { waitUntil: 'domcontentloaded' })

  if (new URL(page.url()).pathname.startsWith('/api/auth/signin')) {
    await page
      .getByRole('button', { name: /zitadel|sign in/i })
      .first()
      .click()
  }

  const targetUrl = new URL(targetPath, portalBase)
  if (page.url() !== targetUrl.href) {
    const loginName = page.locator('input[name="loginName"], input#loginName').first()
    await loginName.waitFor({ state: 'visible', timeout: 30_000 })
    if (!isAllowedE2EIdpOrigin(page.url(), idpHost)) {
      throw new Error(`Refusing to submit E2E username to untrusted IdP origin: ${page.url()}`)
    }
    await loginName.fill(credentials.username)
    await page.keyboard.press('Enter')
    const password = page.locator('input[type="password"]').first()
    await password.waitFor({ state: 'visible' })
    if (!isAllowedE2EIdpOrigin(page.url(), idpHost)) {
      throw new Error(`Refusing to submit E2E password to untrusted IdP origin: ${page.url()}`)
    }
    await password.fill(credentials.password)
    await page.keyboard.press('Enter')
  }

  await page.waitForURL(`${portalBase}${targetPath}`, { timeout: 45_000 })
}

test.describe('portal.bbm.academy · модуль часов (спека 081, сценарии 1, 9, 11)', () => {
  test.skip(
    !portalBase || !cmsBase,
    'deployed-stand suite: set PORTAL_E2E_BASE_URL and CMS_E2E_BASE_URL to run',
  )

  test('сценарий 1: аноним на /p/hours уезжает на логин — данные не отдаются', async ({ page }) => {
    await page.goto(`${portalBase}/p/hours`, { waitUntil: 'domcontentloaded' })
    const url = new URL(page.url())
    expect(url.pathname, 'анонима обязано унести с /p/hours').not.toBe('/p/hours')
    expect(
      isAllowedE2EIdpOrigin(page.url(), idpHost) || url.pathname.startsWith('/api/auth/signin'),
      `ожидался логин IdP или хоп Auth.js, получено ${page.url()}`,
    ).toBe(true)
    // Ни ставок, ни имён, ни начислений в анонимном контексте.
    await expect(page.locator(HOURS_ROOT)).toHaveCount(0)
    await expect(page.getByText(HOURS_HEADING)).toHaveCount(0)
  })

  test('сценарий 9: old admin URLs are 404 and the new export re-checks the claim', async ({
    page,
  }) => {
    for (const path of ['/p/hours/admin', '/p/hours/admin/export']) {
      const response = await page.request.get(`${portalBase}${path}`, { maxRedirects: 0 })
      expect(response.status(), `${path} must be deleted, not redirected`).toBe(404)
    }

    const res = await page.request.get(`${portalBase}/api/p/hours/admin/export`, {
      maxRedirects: 0,
    })
    expect(res.status(), 'выгрузка JSON не должна открываться анониму').not.toBe(200)
    const body = await res.text().catch(() => '')
    expect(body).not.toContain('"participants"')
    expect(body).not.toContain('"assessments"')
  })

  test('сценарий 11: CMS-хост не знает про /p/hours', async ({ page }) => {
    for (const path of [
      '/p/hours',
      '/p/hours/admin',
      '/p/hours/admin/export',
      '/api/p/hours/admin/periods',
    ]) {
      const res = await page.request.get(`${cmsBase}${path}`, { maxRedirects: 0 })
      expect(res.status(), `${cmsBase}${path}`).toBe(404)
    }
  })

  test('сценарий 2: после входа страница называет email сессии', async ({ page }) => {
    test.skip(!idpUsername || !idpPassword, 'set E2E_IDP_USERNAME / E2E_IDP_PASSWORD to run')
    test.slow() // полный OIDC round-trip

    await signIn(page, '/p/hours', { username: idpUsername!, password: idpPassword! })
    await expect(page.locator(HOURS_ROOT)).toBeVisible()
    await expect(page.getByRole('heading', { name: HOURS_HEADING })).toBeVisible()
    // Наличие email-claim'а у прод-клиента Zitadel — то, на чём держится
    // идентификация участника (спека 081 п.8). С 2026-07-30 строки «Вошёл как»
    // нет: приёмочную роль несёт блок под заголовком — имя участника из
    // participants, а для незаведённого в списке — его email.
    await expect(page.locator('.hours-person')).toBeVisible()
    const person = (await page.locator('.hours-person').textContent()) ?? ''
    expect(person.trim().length, 'под заголовком обязано стоять имя или email').toBeGreaterThan(0)
  })

  test('spec 311: rates table and edit page work at both accepted desktop viewports', async ({
    page,
  }) => {
    test.skip(
      !hoursAdminUsername || !hoursAdminPassword,
      'set E2E_HOURS_ADMIN_USERNAME / E2E_HOURS_ADMIN_PASSWORD to run',
    )
    test.slow()

    await page.setViewportSize({ width: 1189, height: 838 })
    await signIn(page, '/p/admin/hours/participants', {
      username: hoursAdminUsername!,
      password: hoursAdminPassword!,
    })

    for (const viewport of [
      { width: 1189, height: 838 },
      { width: 1564, height: 1061 },
    ]) {
      await page.setViewportSize(viewport)
      await page.reload({ waitUntil: 'domcontentloaded' })

      const table = page.getByRole('table')
      await expect(table.getByRole('columnheader', { name: 'Вилка' })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: 'Ставка' })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: 'Действие' })).toBeVisible()

      const overflow = await page.evaluate(() => {
        const table = document.querySelector('table') as HTMLElement
        const wrapper = table.parentElement as HTMLElement
        return {
          wrapper: [wrapper.scrollWidth, wrapper.clientWidth],
          table: [table.scrollWidth, table.clientWidth],
          document: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
        }
      })
      expect(overflow.wrapper[0], `${viewport.width}px wrapper overflow`).toBeLessThanOrEqual(
        overflow.wrapper[1],
      )
      expect(overflow.table[0], `${viewport.width}px table overflow`).toBeLessThanOrEqual(
        overflow.table[1],
      )
      expect(overflow.document[0], `${viewport.width}px document overflow`).toBeLessThanOrEqual(
        overflow.document[1],
      )
    }

    const edit = page.getByRole('button', { name: 'Открыть' }).first()
    await edit.click()
    await expect(page.getByLabel('Email')).toHaveAttribute('readonly')
  })
})
