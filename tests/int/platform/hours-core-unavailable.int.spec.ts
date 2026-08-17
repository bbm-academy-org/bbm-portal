// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HoursDataError, mutateHoursDocument, readHoursDocument } from '@/lib/hours'
import type { HoursDocument } from '@/lib/hours'
import { closePlatformDb } from '@/lib/platform/db/client'

import { seedMember, seedParticipant, truncateHoursTables } from './hours-core-helpers'

/**
 * No JSON fallback, ever (spec 124 EARS-12).
 *
 * This spec lives in its own file because it closes the platform pool and takes
 * `PLATFORM_DATABASE_URL` away — vitest runs suite files serially here
 * (`fileParallelism: false`), so the neighbours never see the missing variable.
 *
 * The JSON document is not merely absent from these cases: a perfectly READABLE
 * `HOURS_DATA_FILE` sits on disk holding a participant that exists nowhere in the
 * database. If a single code path still fell back to it, the assertions below
 * would see that participant instead of a refusal — which is the failure mode
 * EARS-12 exists to forbid («never fall back to the JSON file after cutover»).
 */

const dir = mkdtempSync(join(tmpdir(), 'bbm-hours-core-nofallback-'))
const file = join(dir, 'hours.json')
const originalDataFile = process.env.HOURS_DATA_FILE
const originalUrl = process.env.PLATFORM_DATABASE_URL

const jsonOnly: HoursDocument = {
  participants: [{ email: 'json-only@bbm.academy', name: 'Только в JSON' }],
  periods: [],
  assessments: [],
  publications: [],
}

beforeEach(() => {
  process.env.HOURS_DATA_FILE = file
  writeFileSync(file, JSON.stringify(jsonOnly, null, 2), 'utf8')
})

afterEach(async () => {
  process.env.PLATFORM_DATABASE_URL = originalUrl
  await closePlatformDb()
})

afterAll(async () => {
  if (originalDataFile === undefined) delete process.env.HOURS_DATA_FILE
  else process.env.HOURS_DATA_FILE = originalDataFile
  rmSync(dir, { recursive: true, force: true })
  await closePlatformDb()
})

describe('the module never reads the JSON document (EARS-12)', () => {
  it('EARS-12: a read with the database configured ignores a readable HOURS_DATA_FILE', async () => {
    const { getPlatformDb } = await import('@/lib/platform/db/client')
    const db = getPlatformDb()
    await truncateHoursTables(db)
    const id = await seedMember(db, { email: 'anton@bbm.academy', name: 'Антон' })
    await seedParticipant(db, id, { sortKey: 0 })

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
      mutateHoursDocument((doc) => ({ ok: true, doc, warnings: [], saved: null })),
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
