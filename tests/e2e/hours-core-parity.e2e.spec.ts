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
 *   2. admin: `/p/hours/admin` upserts a participant from a brand-new email with a
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

    await signIn(page, '/p/hours/admin', { username: adminUsername!, password: adminPassword! })
    await expect(page.locator(HOURS_ROOT)).toBeVisible()

    // A fake, obviously non-human email, unique per run: the surfaces support no
    // deletion (081 §16), so the row this creates is expected to stay behind.
    const email = `e2e-parity-${Date.now()}@bbm.academy`
    const name = 'E2E Проверка Паритета'

    await page.locator('input[name="email"]:not([readonly])').first().fill(email)
    await page.locator('input[name="name"]').first().fill(name)
    await page.getByRole('button', { name: 'Сохранить участника' }).click()

    // The row appearing IS the statement that a `core.member` now exists for that
    // email — the participant row's PK is the FK to the registry (EARS-9).
    const row = page.locator('.hours-participants-table tbody tr').filter({ hasText: name })
    await expect(row).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: `Изменить ${name}` })).toBeVisible()
  })
})
