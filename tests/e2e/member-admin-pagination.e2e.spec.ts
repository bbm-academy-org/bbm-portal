import { expect, test } from '@playwright/test'

import { closePlatformDb } from '@/lib/platform/db/client'

import { DEV_SEED_MEMBERS } from '../../tools/platform/dev-seed-plan'

import { signInAsPlatformMember } from './support/platform-session'

/**
 * The approved pager on `/p/admin/member/members`, read off the SEEDED registry
 * (#436).
 *
 * This spec used to insert 51 members of its own into `core.member` under a
 * timestamped prefix and delete them afterwards. It no longer does, and the
 * reason is the acceptance criterion of #436: the stand an owner is shown and
 * the stand the suite asserts against must be the SAME one, or the suite proves
 * nothing about what the owner will see. The seed puts 64 members in — a full
 * 50-row page plus a partial second one — and that is exactly the shape this
 * test needs.
 *
 * The search box matches «Имя или email», so the seeded cohort is selected by
 * its reserved e-mail domain: every seeded member is `seed-NN@dev.bbm.invalid`
 * and nobody else on the stand can be.
 */

const databaseUrl = process.env.PLATFORM_DATABASE_URL
const SEEDED_DOMAIN = 'dev.bbm.invalid'
const TOTAL = DEV_SEED_MEMBERS.length
const PAGE_SIZE = 50

test.afterAll(async () => {
  await closePlatformDb()
})

test('an admin can reach the last seeded member through the approved pager', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!databaseUrl, 'PLATFORM_DATABASE_URL is not set — no branch database to read')

  await signInAsPlatformMember(context, baseURL as string, {
    email: 'e2e-pagination-admin@bbm.academy',
    roles: ['platform-user', 'platform-admin'],
  })

  await page.goto('/p/admin/member/members')
  await page.getByRole('searchbox', { name: 'Поиск участников' }).fill(SEEDED_DOMAIN)

  // The row COUNT rather than a named member: the list's sort order is the
  // screen's business, so asserting «Ольга Ушакова is on page 2» would be a
  // test of the ordering dressed up as a test of the pager.
  const rows = page.getByRole('row').filter({ hasText: SEEDED_DOMAIN })

  await expect(page.getByText(`1–${PAGE_SIZE} из ${TOTAL}`, { exact: true })).toBeVisible()
  await expect(rows).toHaveCount(PAGE_SIZE)

  await page.getByRole('button', { name: 'Следующая страница' }).click()

  await expect(
    page.getByText(`${PAGE_SIZE + 1}–${TOTAL} из ${TOTAL}`, { exact: true }),
  ).toBeVisible()
  await expect(rows).toHaveCount(TOTAL - PAGE_SIZE)
  await expect(page.getByRole('button', { name: 'Следующая страница' })).toBeDisabled()
})
