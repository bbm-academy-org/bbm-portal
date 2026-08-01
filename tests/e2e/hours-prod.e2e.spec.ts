import { expect, test, type Page } from '@playwright/test'

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
    await page.waitForURL(/id\.bbm\.academy/)
  }

  if (new URL(page.url()).hostname === 'id.bbm.academy') {
    const loginName = page.locator('input[name="loginName"], input#loginName').first()
    await loginName.fill(credentials.username)
    await page.keyboard.press('Enter')
    const password = page.locator('input[type="password"]').first()
    await password.waitFor({ state: 'visible' })
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

  test('spec 102: grouped admin table fits both approved desktop viewports', async ({ page }) => {
    test.skip(
      !hoursAdminUsername || !hoursAdminPassword,
      'set E2E_HOURS_ADMIN_USERNAME / E2E_HOURS_ADMIN_PASSWORD to run',
    )
    test.slow()

    await page.setViewportSize({ width: 1189, height: 838 })
    await signIn(page, '/p/hours/admin', {
      username: hoursAdminUsername!,
      password: hoursAdminPassword!,
    })

    for (const viewport of [
      { width: 1189, height: 838 },
      { width: 1564, height: 1061 },
    ]) {
      await page.setViewportSize(viewport)
      await page.reload({ waitUntil: 'domcontentloaded' })

      const wrapper = page.locator('.hours-table-scroll').first()
      const table = wrapper.locator('table')
      await expect(table.getByRole('columnheader', { name: 'Ставка, ₽/ч' })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: 'Правка' })).toBeVisible()

      const overflow = await page.evaluate(() => {
        const wrapper = document.querySelector('.hours-table-scroll') as HTMLElement
        const table = wrapper.querySelector('table') as HTMLElement
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

      const longestRole = page.locator('.hours-participant-role').filter({ hasText: /\S/ })
      await expect(longestRole.first()).toBeVisible()
      const roleGeometry = await longestRole.evaluateAll((roles) => {
        const role = roles.reduce((longest, candidate) =>
          (candidate.textContent?.length ?? 0) > (longest.textContent?.length ?? 0)
            ? candidate
            : longest,
        ) as HTMLElement
        const style = getComputedStyle(role)
        const range = document.createRange()
        range.selectNodeContents(role)
        const textLines = new Set(
          [...range.getClientRects()].map((rect) => Math.round(rect.top * 10) / 10),
        ).size
        const lineHeight = Number.parseFloat(style.lineHeight)
        const visibleLines = Number.isFinite(lineHeight)
          ? Math.max(1, Math.round(role.getBoundingClientRect().height / lineHeight))
          : textLines
        return {
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
          textOverflow: style.textOverflow,
          overflowX: style.overflowX,
          textLines,
          visibleLines,
          clippedVertically: role.scrollHeight > role.clientHeight + 1,
        }
      })
      expect(roleGeometry.whiteSpace, `${viewport.width}px role white-space`).toBe('normal')
      expect(roleGeometry.overflowWrap, `${viewport.width}px role wrapping`).toBe('anywhere')
      expect(roleGeometry.textOverflow, `${viewport.width}px role ellipsis`).not.toBe('ellipsis')
      expect(roleGeometry.overflowX, `${viewport.width}px role clipping`).toBe('visible')
      expect(roleGeometry.textLines, `${viewport.width}px role line boxes`).toBeGreaterThanOrEqual(
        1,
      )
      expect(roleGeometry.visibleLines, `${viewport.width}px visible role lines`).toBe(
        roleGeometry.textLines,
      )
      if (roleGeometry.textLines > 1) {
        expect(roleGeometry.visibleLines, `${viewport.width}px multiline role`).toBeGreaterThan(1)
      }
      expect(roleGeometry.clippedVertically, `${viewport.width}px vertical clipping`).toBe(false)
    }

    const edit = page.getByRole('button', { name: /^Изменить / }).first()
    await edit.click()
    await expect(page.locator('input[name="email"][readonly]')).not.toHaveValue('')
  })
})
