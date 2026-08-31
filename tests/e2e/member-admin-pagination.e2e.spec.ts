import { sql } from 'drizzle-orm'

import { expect, test } from '@playwright/test'

import { closePlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'

import { signInAsPlatformMember } from './support/platform-session'

const databaseUrl = process.env.PLATFORM_DATABASE_URL
const stamp = `${Date.now()}-${process.pid}`
const emailPrefix = `e2e-pager-${stamp}`
const namePrefix = `E2E Pager ${stamp}`
const fixtureDoor = { actorEmail: null, source: 'cli:e2e-fixture' } as const

test.beforeAll(async () => {
  test.skip(!databaseUrl, 'PLATFORM_DATABASE_URL is not set — no branch database to seed')
  await platformTransaction(fixtureDoor, async (tx) => {
    for (let index = 1; index <= 51; index += 1) {
      const suffix = String(index).padStart(2, '0')
      await tx.execute(sql`
        insert into core.member (slug, email, name)
        values (
          ${`${emailPrefix}-${suffix}`},
          ${`${emailPrefix}-${suffix}@bbm.academy`},
          ${`${namePrefix} ${suffix}`}
        )
      `)
    }
  })
})

test.afterAll(async () => {
  if (databaseUrl) {
    await platformTransaction(fixtureDoor, (tx) =>
      tx.execute(sql`delete from core.member where email like ${`${emailPrefix}-%@bbm.academy`}`),
    )
  }
  await closePlatformDb()
})

test('an admin can reach member 51 through the approved pager', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsPlatformMember(context, baseURL as string, {
    email: 'e2e-pagination-admin@bbm.academy',
    roles: ['platform-user', 'platform-admin'],
  })

  await page.goto('/p/admin/member/members')
  await page.getByRole('searchbox', { name: 'Поиск участников' }).fill(namePrefix)

  await expect(page.getByText('1–50 из 51', { exact: true })).toBeVisible()
  await expect(page.getByText(`${namePrefix} 51`, { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Следующая страница' }).click()

  await expect(page.getByText('51–51 из 51', { exact: true })).toBeVisible()
  await expect(page.getByText(`${namePrefix} 51`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Следующая страница' })).toBeDisabled()
})
