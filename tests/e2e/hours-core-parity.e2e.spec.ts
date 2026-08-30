import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { isAllowedE2EIdpOrigin } from './support/idp-origin'

/**
 * EARS-7 — the parity smoke of the storage swap (spec 124, `/p/hours` on `core`).
 *
 * EARS-7 is an UMBRELLA clause: «the two surfaces keep spec 081/100 behaviour with
 * no UI change». Most of it is held by the unit and integration tiers, which is
 * why the storage swap could land at all. What no lower tier can say is that the
 * whole stack still works END TO END on the new storage — a real session, a real
 * server action, a real transaction under the module advisory lock, a real
 * re-render. That is this file, and it is deliberately small: two flows that touch
 * every layer once each.
 *
 *   1. participant: `/p/hours` renders the participants table and the open-period
 *      calculator; a self-assessment saves and appears in the summary
 *      (acceptance scenario 1 of the spec — EARS-1, EARS-10, EARS-21);
 *   2. admin: `/p/admin/hours/participants/create` upserts a participant from a brand-new email with a
 *      NAME ONLY, and the row appears — which is the same statement as «a `member`
 *      was created inside that save» (acceptance scenario 2 — EARS-9).
 *
 * **It MUTATES the stand it runs against.** Scenario 1 writes a real assessment for
 * the logged-in user in the open period, and scenario 2 creates a real `member` +
 * `hours_participant` row (neither surface supports deletion — 081 §16, so the fake
 * participant stays until the owner removes it through the SQL escape hatch). That
 * is acceptable on a dev/acceptance stand and is the reason this file self-skips
 * unless credentials are named: it must never run against production by accident.
 *
 * Where it points: RELATIVE paths only, resolved against Playwright's `baseURL` —
 * `E2E_BASE_URL` / `E2E_PORT`, the one resolution in `tests/helpers/base-url.ts`
 * (`.claude/rules/parallel-sessions.md`: naming a port is the operator asserting
 * the stand is theirs). No origin is spelled here.
 *
 *   E2E_PORT=3005 E2E_IDP_USERNAME=… E2E_IDP_PASSWORD=… \
 *   E2E_HOURS_ADMIN_USERNAME=… E2E_HOURS_ADMIN_PASSWORD=… \
 *   pnpm test:e2e tests/e2e/hours-core-parity.e2e.spec.ts
 *
 * The sign-in flow is a local copy of the one in `hours-prod.e2e.spec.ts` rather
 * than a shared helper: that file drives a DEPLOYED stand through an absolute
 * `PORTAL_E2E_BASE_URL` and this one drives a named stand through `baseURL`, and
 * #255 part 3 is not allowed to reshape the prod suite. Extracting one helper for
 * both is a small follow-up, not a silent edit of an acceptance-critical file.
 *
 * That follow-up now has a destination: `tests/e2e/support/zitadel-sign-in.ts`
 * holds the hardened version (it waits for login-v2 to hydrate instead of racing
 * it). The copy below still presses Enter at the pre-hydration form and carries
 * the flake that fix removes; migrating it needs a run of THIS file, which
 * mutates the stand, so it is left to the task that next touches it.
 */

const idpUsername = process.env.E2E_IDP_USERNAME
const idpPassword = process.env.E2E_IDP_PASSWORD
const idpHost = process.env.E2E_IDP_HOST
const adminUsername = process.env.E2E_HOURS_ADMIN_USERNAME
const adminPassword = process.env.E2E_HOURS_ADMIN_PASSWORD

/** Markers of the rendered hours page — the same ones the prod suite asserts on. */
const HOURS_ROOT = '.hours-root'
const HOURS_HEADING = 'Сколько было отработано'

async function signIn(
  page: Page,
  targetPath: string,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.goto(targetPath, { waitUntil: 'domcontentloaded' })

  if (new URL(page.url()).pathname.startsWith('/api/auth/signin')) {
    await page
      .getByRole('button', { name: /zitadel|sign in/i })
      .first()
      .click()
  }

  if (new URL(page.url()).pathname !== targetPath) {
    const loginName = page.locator('input[name="loginName"], input#loginName').first()
    await loginName.waitFor({ state: 'visible', timeout: 30_000 })
    // Credentials are never typed into an origin the operator did not name.
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

  await page.waitForURL((url) => url.pathname === targetPath, { timeout: 45_000 })
}

test.describe('/p/hours on the core schema — parity smoke (spec 124)', () => {
  test('EARS-7: a participant sees the table and the open period, saves a self-assessment and finds it in the summary', async ({
    page,
  }) => {
    test.skip(!idpUsername || !idpPassword, 'set E2E_IDP_USERNAME / E2E_IDP_PASSWORD to run')
    test.slow() // full OIDC round-trip plus a write

    await signIn(page, '/p/hours', { username: idpUsername!, password: idpPassword! })

    await expect(page.locator(HOURS_ROOT)).toBeVisible()
    await expect(page.getByRole('heading', { name: HOURS_HEADING })).toBeVisible()

    // The participants table, rendered from `core.hours_participant` joined onto
    // `core.member`, in `sort_key` order (EARS-21).
    const participants = page.locator('.hours-participants-table')
    await expect(participants).toBeVisible()
    await expect(participants.locator('tbody tr').first()).toBeVisible()
    await expect(page.locator('.hours-participant-name').first()).not.toBeEmpty()

    // The open period and its calculator. No open period means the stand is not
    // set up for this smoke — a skip, not a false green.
    const save = page.getByRole('button', { name: 'Сохранить оценку' })
    test.skip(
      (await save.count()) === 0,
      'the stand has no open period — open one before running the parity smoke',
    )

    // Hours are declared through the «Часы за период» number input next to the
    // slider — the form's `hours` field is hidden and computed from it, so typing
    // into the visible control is also the only way to exercise the real path.
    const declared = page.locator('#hours-period-num')
    await expect(declared).toBeVisible()
    await declared.fill('7')
    await declared.blur()
    await save.click()

    // The saved card and the summary row are two different reads of the same
    // committed transaction — the mutation and the re-render.
    await expect(page.locator('.hours-saved')).toBeVisible({ timeout: 30_000 })
    // The summary names the PARTICIPANT (`row.name ?? email`, 081 requires a
    // name), never the email local part — so the row is identified by the same
    // display name the hero shows for this session, read off the page rather
    // than guessed from the login. Guessing broke this assertion on the dev
    // rehearsal stand, where the test user's member name is not their email.
    const person = (await page.locator('.hours-person').first().innerText()).trim()
    expect(person).not.toBe('')
    const summary = page.locator('.hours-table').last()
    await expect(summary).toContainText(person)
  })

  test('EARS-7: the admin upserts a brand-new participant with a name only and the row appears', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_HOURS_ADMIN_USERNAME / E2E_HOURS_ADMIN_PASSWORD to run',
    )
    test.slow()

    await signIn(page, '/p/admin/hours/participants/create', {
      username: adminUsername!,
      password: adminPassword!,
    })
    await expect(page.getByRole('heading', { name: 'Новый участник' })).toBeVisible()

    // A fake, obviously non-human email, unique per run: the surfaces support no
    // deletion (081 §16), so the row this creates is expected to stay behind.
    const email = `e2e-parity-${Date.now()}@bbm.academy`
    const name = 'E2E Проверка Паритета'

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Имя').fill(name)
    await page.getByRole('button', { name: 'Создать участника' }).click()

    // The row appearing IS the statement that a `core.member` now exists for that
    // email — the participant row's PK is the FK to the registry (EARS-9).
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel('Email')).toHaveValue(email)
    await expect(page.getByLabel('Email')).toHaveAttribute('readonly')
    await page.goto('/p/admin/hours/participants')
    await page.getByRole('searchbox', { name: 'Поиск участников' }).fill(email)
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row).toHaveCount(1, { timeout: 30_000 })
  })

  test('EARS-447/448/449/450: the cabinet preserves period lifecycle, read-only assessments, JSON export and publication preview', async ({
    page,
  }) => {
    test.skip(
      !adminUsername || !adminPassword,
      'set E2E_HOURS_ADMIN_USERNAME / E2E_HOURS_ADMIN_PASSWORD to run',
    )
    test.slow()

    const label = `E2E кабинет часов ${Date.now()}`
    const dateFrom = '2026-08-17'
    const initialDateTo = '2026-08-21'
    const updatedDateTo = '2026-08-24'
    let periodId = ''
    let publicationPosts = 0

    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/p/hours/admin/publication'
      ) {
        publicationPosts += 1
      }
    })

    await signIn(page, '/p/admin/hours/participants/create', {
      username: adminUsername!,
      password: adminPassword!,
    })

    // Make the signed-in admin a fully rated participant through the same
    // upsert seam the cabinet exposes. Re-runs deliberately update that record.
    await page.getByLabel('Email').fill(adminUsername!)
    await page.getByLabel('Имя').fill('BBM Test E2E')
    await page.getByLabel('Роль').fill('Acceptance')
    await page.getByLabel('Вилка от, ₽/мес').fill('120000')
    await page.getByLabel('Вилка до, ₽/мес').fill('180000')
    await page.getByLabel('Грейд').click()
    await page.getByRole('option', { name: 'II — середина вилки' }).click()
    await page.getByRole('button', { name: 'Создать участника' }).click()
    await expect(page.getByRole('heading', { name: 'BBM Test E2E' })).toBeVisible({
      timeout: 30_000,
    })

    // A failed prior rehearsal may have left an open period. The test owns the
    // isolated branch database, so restore the one-open-period invariant before
    // driving the lifecycle itself through the browser.
    const periodsResponse = await page.request.get('/api/p/hours/admin/periods')
    expect(periodsResponse.ok()).toBe(true)
    const periodsEnvelope = (await periodsResponse.json()) as {
      data: Array<{ id: string; status: 'open' | 'closed' }>
    }
    for (const period of periodsEnvelope.data) {
      if (period.status !== 'open') continue
      const closeResponse = await page.request.patch(`/api/p/hours/admin/periods/${period.id}`, {
        data: { status: 'closed' },
      })
      expect(closeResponse.ok()).toBe(true)
    }

    try {
      await page.goto('/p/admin/hours/periods/create')
      await page.getByLabel('Название').fill(label)
      await page.getByLabel('Начало').fill(dateFrom)
      await page.getByLabel('Окончание').fill(initialDateTo)
      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/p/hours/admin/periods',
      )
      await page.getByRole('button', { name: 'Создать период' }).click()
      const createResponse = await createResponsePromise
      expect(createResponse.ok()).toBe(true)
      const created = (await createResponse.json()) as { data: { id: string } }
      periodId = created.data.id
      await page.waitForURL(`/p/admin/hours/periods/edit/${periodId}`)
      await expect(page.getByText('Закрыт', { exact: true })).toBeVisible()

      await page.getByRole('button', { name: 'Открыть период' }).click()
      await expect(page.getByText('Период открыт.', { exact: true })).toBeVisible()
      await expect(page.getByText('Открыт', { exact: true })).toBeVisible()

      await page.goto('/p/hours')
      const declared = page.locator('#hours-period-num')
      await expect(declared).toBeVisible()
      await declared.fill('7')
      await declared.blur()
      await page.getByRole('button', { name: 'Сохранить оценку' }).click()
      await expect(page.locator('.hours-saved')).toBeVisible({ timeout: 30_000 })

      await page.goto(`/p/admin/hours/periods/edit/${periodId}`)
      const assessments = page.locator('[data-slot="card"]', {
        has: page.getByText('Самооценки', { exact: true }),
      })
      await expect(assessments).toContainText(adminUsername!)
      await expect(assessments.getByText('Только просмотр:', { exact: false })).toBeVisible()
      await expect(assessments.getByRole('button')).toHaveCount(0)
      await expect(assessments.getByRole('link')).toHaveCount(0)

      await page.getByLabel('Окончание').fill(updatedDateTo)
      await page.getByRole('button', { name: 'Сохранить период' }).click()
      await expect(page.getByText(/Пересчитано по новым датам: 1 оценка/)).toBeVisible()

      await page.getByRole('button', { name: 'Закрыть период' }).click()
      await expect(page.getByText('Период закрыт.', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Открыть период' }).click()
      await expect(page.getByText('Период открыт.', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Закрыть период' }).click()
      await expect(page.getByText('Период закрыт.', { exact: true })).toBeVisible()

      await page.goto('/p/admin/hours/export')
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('link', { name: 'Скачать JSON' }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe('hours.json')
      const downloadPath = await download.path()
      expect(downloadPath).not.toBeNull()
      const exported: unknown = JSON.parse(await readFile(downloadPath!, 'utf8'))
      expect(Object.keys(exported as object).sort()).toEqual([
        'assessments',
        'participants',
        'periods',
        'publications',
      ])
      const document = exported as {
        participants: Array<Record<string, unknown>>
        periods: Array<Record<string, unknown>>
        assessments: Array<Record<string, unknown>>
        publications: Array<Record<string, unknown>>
      }
      expect(document.participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ email: adminUsername!.toLowerCase(), grade: 'II' }),
        ]),
      )
      expect(document.periods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: periodId,
            label,
            date_from: dateFrom,
            date_to: updatedDateTo,
            status: 'closed',
          }),
        ]),
      )
      expect(document.assessments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ period_id: periodId, email: adminUsername!.toLowerCase() }),
        ]),
      )
      expect(Array.isArray(document.publications)).toBe(true)

      await page.goto('/p/admin/hours/publication')
      await page.getByLabel('Период').click()
      await page.getByRole('option', { name: label }).click()
      const preview = page.locator('[data-slot="card"]', {
        has: page.getByText('Предпросмотр', { exact: true }),
      })
      await expect(preview).toContainText(adminUsername!)
      await expect(preview.getByText('Готово', { exact: true })).toBeVisible()
      await expect(preview.getByRole('button', { name: 'Опубликовать в Mattermost' })).toBeEnabled()
      expect(publicationPosts, 'the acceptance pre-pass must stop before actual delivery').toBe(0)
    } finally {
      if (periodId) {
        const response = await page.request.get(`/api/p/hours/admin/periods/${periodId}`)
        if (response.ok()) {
          const envelope = (await response.json()) as { data: { status: 'open' | 'closed' } }
          if (envelope.data.status === 'open') {
            await page.request.patch(`/api/p/hours/admin/periods/${periodId}`, {
              data: { status: 'closed' },
            })
          }
        }
      }
    }
  })
})
