// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getPlatformDb } from '@/lib/platform/db/client'
import { FINANCE_INTAKE_STATUSES } from '@/lib/platform/db/schema/finance/finance-intake-item'

import { DevDatabaseRefusal } from '../../../tools/platform/dev-database-guard.mjs'
import { DEV_SEED_MEMBERS, DEV_SEED_REQUESTS } from '../../../tools/platform/dev-seed-plan'
import { seedDevData } from '../../../tools/platform/dev-seed'

import { asMigrator, truncateAsFixture } from './privilege-helpers'

/**
 * `pnpm dev:seed` against a real, freshly migrated platform database (#436).
 *
 * Three properties, and only the third is about the fixtures themselves:
 *
 *  - it **applies from empty**. The acceptance criterion says «a fresh database
 *    created by `pnpm platform:migrate` from empty», and the closest honest
 *    equivalent inside the tier is a full fixture TRUNCATE of the migrated
 *    schema — the same starting state, without re-running drizzle-kit per suite;
 *  - it is **idempotent**. Not «the second run does not crash»: the second run
 *    leaves the database in the SAME state, which is asserted as a digest over
 *    every seeded table. An agent re-running the seed on a live acceptance stand
 *    must not double the members list;
 *  - it covers **every spec-339 status** and the volume the owner ruled on.
 *
 * The suite runs against this worktree's branch DB (`platform_<N>`), the same
 * one every other `tests/int/platform` suite uses, and truncates before it
 * starts. It is skipped, loudly, where there is no platform database at all.
 */

const HAS_DB = (process.env.PLATFORM_DATABASE_URL ?? '').trim() !== ''

/** Everything the seed writes — the digest below is taken over exactly this. */
const SEEDED_TABLES = [
  'core.member',
  'core.member_alias',
  'core.hours_period',
  'core.hours_participant',
  'core.hours_assessment',
  'core.finance_currency',
  'core.finance_account',
  'core.finance_project',
  'core.finance_product',
  'core.finance_category',
  'core.finance_purpose',
  'core.finance_counterparty',
  'core.finance_operation',
  'core.finance_posting',
  'core.finance_intake_item',
  'core.finance_document',
  'core.finance_document_link',
] as const

/**
 * A content digest of the seeded estate.
 *
 * Row COUNTS alone would pass a second run that rewrote every row in place, and
 * that is precisely the failure «upsert by stable slug» exists to prevent — so
 * the whole content of every seeded table is hashed, ordered by primary key.
 * The volatile columns are excluded by name rather than by guesswork: a
 * `created_at` default and an audit `id` legitimately differ between runs of
 * DIFFERENT rows, but they must not differ for the SAME row, which is what a
 * per-row hash of the remaining columns states.
 */
async function seededDigest(): Promise<Record<string, { rows: number; digest: string }>> {
  const db = getPlatformDb()
  const out: Record<string, { rows: number; digest: string }> = {}
  for (const table of SEEDED_TABLES) {
    const result = await db.execute(
      `select md5(string_agg(row_hash, '' order by row_hash)) as digest, count(*)::int as rows
         from (select md5(t::text) as row_hash from ${table} t) hashed`,
    )
    const row = result.rows[0] as { digest: string | null; rows: number }
    out[table] = { rows: Number(row.rows), digest: row.digest ?? '' }
  }
  return out
}

async function countRows(table: string, where = 'true'): Promise<number> {
  const result = await getPlatformDb().execute(
    `select count(*)::int as n from ${table} where ${where}`,
  )
  return Number((result.rows[0] as { n: number }).n)
}

/**
 * The starting state of the acceptance criterion: «a fresh database created by
 * `pnpm platform:migrate` from empty».
 *
 * A TRUNCATE gets closer to that than any other reset available inside the tier
 * — but not all the way by itself: `core.finance_project` carries ONE row that
 * migration 0008 creates rather than the application (the `is_fund` singleton,
 * EARS-304), and a truncate takes it with everything else. Putting it back is
 * what makes this state «freshly migrated» instead of merely «empty», and it is
 * the same restore `finance-helpers.ts` performs for the finance suites.
 */
async function resetToFreshlyMigrated(): Promise<void> {
  await truncateAsFixture(
    `truncate ${SEEDED_TABLES.join(', ')} restart identity cascade;
     insert into core.finance_project (name, is_fund) values ('Фонд BBM', true)`,
  )
}

describe.skipIf(!HAS_DB)('pnpm dev:seed against a migrated platform database', () => {
  let first: Record<string, { rows: number; digest: string }>

  beforeAll(async () => {
    await resetToFreshlyMigrated()
    await seedDevData()
    first = await seededDigest()
  }, 240_000)

  afterAll(async () => {
    // Leave the branch database SEEDED, not empty. This suite runs against the
    // same `platform_<N>` the session's acceptance stand is pointed at, and a
    // tier that silently empties the stand it borrowed turns «the stand comes up
    // populated» into a lie the next `pnpm dev` discovers.
    await resetToFreshlyMigrated()
    await seedDevData()
  }, 240_000)

  it('applies cleanly on a freshly migrated, empty database', () => {
    for (const table of SEEDED_TABLES) {
      expect(first[table].rows, `${table} is empty after the seed`).toBeGreaterThan(0)
    }
  })

  it('seeds at least 30 members, so the list has real density', async () => {
    expect(await countRows('core.member')).toBeGreaterThanOrEqual(30)
    expect(await countRows('core.member')).toBe(DEV_SEED_MEMBERS.length)
  })

  it('leaves at least one request in every status of the spec-339 machine', async () => {
    for (const status of FINANCE_INTAKE_STATUSES) {
      const n = await countRows('core.finance_intake_item', `status = '${status}'`)
      expect(n, `no intake item in status «${status}»`).toBeGreaterThan(0)
    }
    expect(await countRows('core.finance_intake_item', `source = 'request'`)).toBe(
      DEV_SEED_REQUESTS.length,
    )
  })

  it('posts the ledger through the real posting path, documents and all', async () => {
    const posted = await countRows('core.finance_intake_item', `status = 'posted'`)
    expect(await countRows('core.finance_document')).toBeGreaterThanOrEqual(posted)
    expect(await countRows('core.finance_posting')).toBeGreaterThan(posted)
  })

  it('run twice leaves the database in the same state', async () => {
    await seedDevData()
    const second = await seededDigest()
    expect(second).toEqual(first)
  }, 240_000)

  /**
   * The half-applied request (review of PR #451, finding 1).
   *
   * A request's walk is several module acts — `create → submit → (upload) →
   * approve` — and each of them opens its OWN transaction, because that is the
   * only door the finance module offers. So a process death between two acts is
   * representable and leaves the row in a TRANSIENT status. Matching the fixture
   * on its slug alone would then call that row `reused` for ever, and the «every
   * spec-339 status is populated» property would degrade silently — which is the
   * one property #437's acceptance protocol leans on.
   *
   * The rewind below is exactly that state: an `approved` fixture put back to
   * `submitted` with its decision cleared, the way `approve` dying mid-flight
   * would leave it. The rerun must REPAIR it, not count it.
   */
  it('repairs a request a crashed walk left in a transient status', async () => {
    const fixture = DEV_SEED_REQUESTS.find((request) => request.status === 'approved')!
    const marker = `%[seed:${fixture.slug}]%`
    await asMigrator((client) =>
      client.query(
        `update core.finance_intake_item
            set status = 'submitted', decided_by = null, decided_at = null
          where note like $1`,
        [marker],
      ),
    )
    expect(
      await countRows('core.finance_intake_item', `status = 'approved' and note like '${marker}'`),
    ).toBe(0)

    const summary = await seedDevData()

    expect(summary.requests.created).toBe(0)
    expect(summary.requests.repaired).toBe(1)
    expect(
      await countRows('core.finance_intake_item', `status = 'approved' and note like '${marker}'`),
    ).toBe(1)
    for (const status of FINANCE_INTAKE_STATUSES) {
      const n = await countRows('core.finance_intake_item', `status = '${status}'`)
      expect(n, `no intake item in status «${status}» after the repair`).toBeGreaterThan(0)
    }
  }, 240_000)

  /**
   * The other half of the same key: a row whose status can no longer REACH the
   * fixture's target must fail loudly and name the slug, rather than be counted
   * `reused` or be silently left wrong. `cancelled` is terminal, so a `posted`
   * fixture sitting there is a stand a human has to look at.
   */
  it('fails loudly, naming the slug, when the row can no longer reach its target', async () => {
    const fixture = DEV_SEED_REQUESTS.find((request) => request.status === 'draft')!
    const marker = `%[seed:${fixture.slug}]%`
    await asMigrator((client) =>
      client.query(`update core.finance_intake_item set status = 'cancelled' where note like $1`, [
        marker,
      ]),
    )
    await expect(seedDevData()).rejects.toThrow(fixture.slug)

    // Put the stand back: the suite that follows must not inherit the wreckage.
    await asMigrator((client) =>
      client.query(`update core.finance_intake_item set status = 'draft' where note like $1`, [
        marker,
      ]),
    )
  }, 240_000)
})

describe('the seed refuses a database it cannot classify as dev', () => {
  it('refuses a production-shaped connection string before writing anything', async () => {
    await expect(
      seedDevData({ connectionString: 'postgres://app:pw@postgres:5432/platform', env: {} }),
    ).rejects.toBeInstanceOf(DevDatabaseRefusal)
  })

  it('refuses a production-marked environment even on this dev stand', async () => {
    await expect(
      seedDevData({
        connectionString: 'postgres://app:pw@127.0.0.1:5444/platform_9',
        env: { NODE_ENV: 'production' },
      }),
    ).rejects.toBeInstanceOf(DevDatabaseRefusal)
  })
})
