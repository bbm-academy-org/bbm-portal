// @vitest-environment node
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { HoursDataError, mutateHoursDocument, readHoursDocument } from '@/lib/hours'
import { closePlatformDb } from '@/lib/platform/db/client'

import { seedMember, seedParticipant, truncateHoursTables } from './hours-core-helpers'

/**
 * Кто пишет в этих сюитах (спека 201 EARS-7, EARS-25). `portal` + непустой
 * actor — ровно то, что приходит из Server Action после гейта сессии; без
 * контекста запись отклонит `core.audit_row_change()` на помеченном пуле.
 */
const TEST_ACTOR = { actorEmail: 'anton@bbm.academy', source: 'portal' } as const

/**
 * No JSON fallback, ever (spec 124 EARS-12).
 *
 * This spec lives in its own file because it closes the platform pool and takes
 * `PLATFORM_DATABASE_URL` away — vitest runs suite files serially here
 * (`fileParallelism: false`), so the neighbours never see the missing variable.
 *
 * Until #256 this suite staged a perfectly readable JSON document at
 * `HOURS_DATA_FILE` and proved the module ignored it. After the cutover was
 * accepted there is nothing left to stage: the store module and the variable are
 * both deleted, and the absence itself is pinned by
 * `tests/unit/hours-json-store-removed.spec.ts` (EARS-15). What this file still
 * owns is the OTHER half of EARS-12 — with the database gone, the module refuses
 * out loud instead of degrading into zeros or an empty document.
 */

const originalUrl = process.env.PLATFORM_DATABASE_URL

afterEach(async () => {
  process.env.PLATFORM_DATABASE_URL = originalUrl
  await closePlatformDb()
})

afterAll(async () => {
  await closePlatformDb()
})

describe('the module has no JSON fallback (EARS-12)', () => {
  it('EARS-12: a read is served by core — the module has exactly one storage', async () => {
    const { getPlatformDb } = await import('@/lib/platform/db/client')
    const db = getPlatformDb()
    await truncateHoursTables(db)
    const id = await seedMember({ email: 'anton@bbm.academy', name: 'Антон' })
    await seedParticipant(id, { sortKey: 0 })

    const doc = await readHoursDocument()
    expect(doc.participants.map((participant) => participant.email)).toEqual(['anton@bbm.academy'])
  })

  it('EARS-12: an unset PLATFORM_DATABASE_URL makes a read throw HoursDataError instead of reading JSON', async () => {
    await closePlatformDb()
    delete process.env.PLATFORM_DATABASE_URL

    await expect(readHoursDocument()).rejects.toBeInstanceOf(HoursDataError)
  })

  it('EARS-12: an unset PLATFORM_DATABASE_URL makes a mutation refuse loudly', async () => {
    await closePlatformDb()
    delete process.env.PLATFORM_DATABASE_URL

    await expect(
      mutateHoursDocument(TEST_ACTOR, (doc) => ({ ok: true, doc, warnings: [], saved: null })),
    ).rejects.toBeInstanceOf(HoursDataError)
  })

  it('EARS-12: an unreachable database is a HoursDataError, not a fallback and not a crash', async () => {
    await closePlatformDb()
    // A syntactically valid URL nothing listens on: the module must say the data
    // is unavailable, which is what makes `/p/hours` render 081 §17 instead of
    // zeros.
    process.env.PLATFORM_DATABASE_URL = 'postgres://nobody:nobody@127.0.0.1:1/absent'

    await expect(readHoursDocument()).rejects.toBeInstanceOf(HoursDataError)
  })
})
