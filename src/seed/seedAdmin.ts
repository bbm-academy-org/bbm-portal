import { pathToFileURL } from 'url'

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

/**
 * Self-invoke only when run directly, not on import — otherwise the module
 * can't be imported in tests without a stray process.exit.
 *
 * Two direct-run shapes are accepted:
 *  - `node src/seed/seedAdmin.ts` — `process.argv[1]` is this module (standard
 *    ESM entrypoint check).
 *  - `payload run src/seed/seedAdmin.ts` (what `pnpm seed:admin` runs) — Payload
 *    loads the script via `import()` and rewrites `process.argv[1]` to its own
 *    `bin.js`, so the standard check never matches. We additionally treat the
 *    payload bin as a direct-run signal.
 *
 * Under vitest `process.argv[1]` is the vitest runner (neither this module nor
 * payload's bin), so the import stays side-effect-free.
 */
const argv1 = process.argv[1]
const isDirectEntrypoint = Boolean(argv1) && import.meta.url === pathToFileURL(argv1).href
const isPayloadRun = Boolean(argv1) && /[\\/]payload[\\/]bin\.js$/.test(argv1)

if (isDirectEntrypoint || isPayloadRun) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
