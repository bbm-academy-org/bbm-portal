import { getPayload } from 'payload'

import config from '../payload.config'

/**
 * Production seed-admin bootstrap (BBMP-29).
 *
 * Non-interactively creates the first admin user on a headless prod VPS
 * (BBMP-30) from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Idempotent: if a
 * user with that email already exists it does nothing — never overwrites or
 * deletes. This is the prod counterpart to the destructive dev-only
 * `tests/helpers/seedUser.ts`; do not merge the two.
 *
 * Run with: `pnpm seed:admin` (Node 22 required for Payload's tsx loader).
 */
export async function seedAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL
  const password = process.env.SEED_ADMIN_PASSWORD

  if (!email || !password) {
    throw new Error(
      'seed:admin requires SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to be set in the environment.',
    )
  }

  const payload = await getPayload({ config })

  // overrideAccess defaults to true here (local API, no req), so the find
  // guard runs regardless of the collection's access control.
  const existing = await payload.count({
    collection: 'users',
    where: { email: { equals: email } },
  })

  if (existing.totalDocs > 0) {
    payload.logger.info(`seed:admin — user ${email} already exists, skipping.`)
    return
  }

  await payload.create({
    collection: 'users',
    data: { email, password },
  })

  payload.logger.info(`seed:admin — created admin user ${email}.`)
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
