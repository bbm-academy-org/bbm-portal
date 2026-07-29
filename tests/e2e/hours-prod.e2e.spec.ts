import { expect, test } from '@playwright/test'

/**
 * Browser E2E для acceptance-сценариев спеки 081 (issue #81) — против РЕАЛЬНОГО
 * задеплоенного стенда, не против локального dev-сервера. Обязательный зелёный
 * прогон — ДО приглашения владельца на приёмку (task-cycle, стадия 5).
 *
 * Автоматизируется только то, что можно проверить без изменения прод-данных:
 *   - сценарий 1 (логин): анониму контент не отдаётся;
 *   - сценарий 9 (не-админ): админка и выгрузка JSON закрыты — здесь в самом
 *     жёстком виде, для полностью анонимного вызова, который проходит мимо
 *     layout'а группы (route handler своим гейтом отвечает сам);
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

/** Маркеры отрисованной страницы часов — их ОТСУТСТВИЕ и есть доказательство. */
const HOURS_ROOT = '.hours-root'
const HOURS_HEADING = 'Сколько ты отработал?'

test.describe('portal.bbm.academy · модуль часов (спека 081, сценарии 1, 9, 11)', () => {
  test.skip(
    !portalBase || !cmsBase,
    'deployed-stand suite: set PORTAL_E2E_BASE_URL and CMS_E2E_BASE_URL to run',
  )

  test('сценарий 1: аноним на /p/hours уезжает на логин — данные не отдаются', async ({
    page,
  }) => {
    await page.goto(`${portalBase}/p/hours`, { waitUntil: 'domcontentloaded' })
    const url = new URL(page.url())
    expect(url.pathname, 'анонима обязано унести с /p/hours').not.toBe('/p/hours')
    expect(
      url.hostname === 'id.bbm.academy' || url.pathname.startsWith('/api/auth/signin'),
      `ожидался логин IdP или хоп Auth.js, получено ${page.url()}`,
    ).toBe(true)
    // Ни ставок, ни имён, ни начислений в анонимном контексте.
    await expect(page.locator(HOURS_ROOT)).toHaveCount(0)
    await expect(page.getByText(HOURS_HEADING)).toHaveCount(0)
  })

  test('сценарий 9: админка и выгрузка JSON закрыты для не-админа', async ({ page }) => {
    // Страница админки — за OIDC-гейтом группы: анонима уносит на логин.
    await page.goto(`${portalBase}/p/hours/admin`, { waitUntil: 'domcontentloaded' })
    expect(new URL(page.url()).pathname).not.toBe('/p/hours/admin')
    await expect(page.locator(HOURS_ROOT)).toHaveCount(0)

    // Выгрузка — route handler: он идёт МИМО layout'а, поэтому обязан
    // отказывать сам. Ни при каких условиях не 200 с данными.
    const res = await page.request.get(`${portalBase}/p/hours/admin/export`, { maxRedirects: 0 })
    expect(res.status(), 'выгрузка JSON не должна открываться анониму').not.toBe(200)
    const body = await res.text().catch(() => '')
    expect(body).not.toContain('"participants"')
    expect(body).not.toContain('"assessments"')
  })

  test('сценарий 11: CMS-хост не знает про /p/hours', async ({ page }) => {
    for (const path of ['/p/hours', '/p/hours/admin', '/p/hours/admin/export']) {
      const res = await page.request.get(`${cmsBase}${path}`, { maxRedirects: 0 })
      expect(res.status(), `${cmsBase}${path}`).toBe(404)
    }
  })

  test('сценарий 2: после входа страница называет email сессии', async ({ page }) => {
    test.skip(!idpUsername || !idpPassword, 'set E2E_IDP_USERNAME / E2E_IDP_PASSWORD to run')
    test.slow() // полный OIDC round-trip

    await page.goto(`${portalBase}/p/hours`, { waitUntil: 'domcontentloaded' })

    if (new URL(page.url()).pathname.startsWith('/api/auth/signin')) {
      await page.getByRole('button', { name: /zitadel|sign in/i }).first().click()
      await page.waitForURL(/id\.bbm\.academy/)
    }

    const loginName = page.locator('input[name="loginName"], input#loginName').first()
    await loginName.fill(idpUsername!)
    await page.keyboard.press('Enter')
    const password = page.locator('input[type="password"]').first()
    await password.waitFor({ state: 'visible' })
    await password.fill(idpPassword!)
    await page.keyboard.press('Enter')

    await page.waitForURL(`${portalBase}/p/hours`, { timeout: 45_000 })
    await expect(page.locator(HOURS_ROOT)).toBeVisible()
    // Наличие email-claim'а у прод-клиента Zitadel — это то, на чём держится
    // идентификация участника (спека 081 п.8). Проверяется явно.
    await expect(page.getByText(/ошёл как/).first()).toBeVisible()
    await expect(page.getByText(new RegExp(idpUsername!, 'i')).first()).toBeVisible()
  })
})
