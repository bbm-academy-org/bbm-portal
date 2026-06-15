import { getPayload, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { seedAdmin } from '@/seed/seedAdmin'

/**
 * Admin-auth access-control + seed-admin behaviour (BBMP-29).
 *
 *  (a) The `users` collection is locked to authenticated users: an
 *      unauthenticated read (overrideAccess: false, no req.user) is rejected
 *      instead of returning the world-readable default.
 *  (b) The real `seedAdmin` function throws when its env vars are missing.
 *  (c) `seedAdmin` is idempotent: running it twice yields exactly one user for
 *      the configured email.
 *
 * Local-only (needs the dev DB); mirrors the getPayload pattern of the other
 * int suites. Importing the seed module must NOT self-invoke (the guard in
 * seedAdmin.ts only fires under `payload run` / a direct entrypoint), so we can
 * exercise the exported function directly here.
 */

const SEED_EMAIL = 'seed-admin-int@bbm.academy'
const SEED_PASSWORD = 'int-test-strong-password'

let payload: Payload

/** Snapshot the seed env vars so each test can mutate them in isolation. */
const ORIGINAL_EMAIL = process.env.SEED_ADMIN_EMAIL
const ORIGINAL_PASSWORD = process.env.SEED_ADMIN_PASSWORD

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('admin auth (BBMP-29)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await payload.delete({ collection: 'users', where: { email: { equals: SEED_EMAIL } } })
  })

  afterEach(() => {
    restoreEnv('SEED_ADMIN_EMAIL', ORIGINAL_EMAIL)
    restoreEnv('SEED_ADMIN_PASSWORD', ORIGINAL_PASSWORD)
  })

  afterAll(async () => {
    await payload.delete({ collection: 'users', where: { email: { equals: SEED_EMAIL } } })
  })

  it('denies unauthenticated read of users (access control, not world-readable)', async () => {
    // Ensure at least one user exists so a missing access guard would leak it.
    process.env.SEED_ADMIN_EMAIL = SEED_EMAIL
    process.env.SEED_ADMIN_PASSWORD = SEED_PASSWORD
    await seedAdmin()

    // access.read returns `false` (not a Where filter) for an anonymous caller,
    // so Payload rejects the read outright — the collection is not exposed.
    await expect(
      payload.find({
        collection: 'users',
        overrideAccess: false, // simulate an unauthenticated REST/local-API caller
        user: undefined,
      }),
    ).rejects.toThrow(/Forbidden|not allowed/i)
  })

  it('throws when SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are unset (env guard)', async () => {
    delete process.env.SEED_ADMIN_EMAIL
    delete process.env.SEED_ADMIN_PASSWORD

    await expect(seedAdmin()).rejects.toThrow(/SEED_ADMIN_EMAIL/)
  })

  it('is idempotent (running twice yields exactly one user)', async () => {
    await payload.delete({ collection: 'users', where: { email: { equals: SEED_EMAIL } } })

    process.env.SEED_ADMIN_EMAIL = SEED_EMAIL
    process.env.SEED_ADMIN_PASSWORD = SEED_PASSWORD

    await seedAdmin()
    await seedAdmin()

    // overrideAccess defaults to true for the local API → the count guard itself
    // runs regardless of the collection's access control.
    const found = await payload.count({
      collection: 'users',
      where: { email: { equals: SEED_EMAIL } },
    })
    expect(found.totalDocs).toBe(1)
  })
})
