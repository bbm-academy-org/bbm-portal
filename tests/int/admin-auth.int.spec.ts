import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'

/**
 * Admin-auth access-control + seed-admin idempotency (BBMP-29).
 *
 *  (a) The `users` collection is locked to authenticated users: an
 *      unauthenticated read (overrideAccess: false, no req.user) returns no
 *      docs instead of the world-readable default.
 *  (b) The seed-admin logic (count-guard + create) is idempotent: running the
 *      same create-if-absent twice yields exactly one user for that email.
 *
 * Local-only (needs the dev DB); mirrors the getPayload pattern of the other
 * int suites. The seed-admin *script* self-invokes + process.exit on import,
 * so we exercise its logic via the same local-API primitives here rather than
 * importing the module.
 */

const SEED_EMAIL = 'seed-admin-int@bbm.academy'
const SEED_PASSWORD = 'int-test-strong-password'

let payload: Payload

/** The create-if-absent core the seed script runs (sans env-read + exit). */
async function seedAdminOnce(email: string, password: string): Promise<void> {
  const existing = await payload.count({
    collection: 'users',
    where: { email: { equals: email } },
  })
  if (existing.totalDocs > 0) return
  await payload.create({ collection: 'users', data: { email, password } })
}

describe('admin auth (BBMP-29)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await payload.delete({ collection: 'users', where: { email: { equals: SEED_EMAIL } } })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'users', where: { email: { equals: SEED_EMAIL } } })
  })

  it('denies unauthenticated read of users (access control, not world-readable)', async () => {
    // Ensure at least one user exists so a missing access guard would leak it.
    await seedAdminOnce(SEED_EMAIL, SEED_PASSWORD)

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

  it('seed-admin logic is idempotent (running twice yields exactly one user)', async () => {
    await payload.delete({ collection: 'users', where: { email: { equals: SEED_EMAIL } } })

    await seedAdminOnce(SEED_EMAIL, SEED_PASSWORD)
    await seedAdminOnce(SEED_EMAIL, SEED_PASSWORD)

    // overrideAccess defaults to true for the local API → the guard itself
    // runs regardless of the collection's access control.
    const found = await payload.count({
      collection: 'users',
      where: { email: { equals: SEED_EMAIL } },
    })
    expect(found.totalDocs).toBe(1)
  })
})
