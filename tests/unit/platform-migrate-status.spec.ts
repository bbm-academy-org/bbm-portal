// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  MIGRATIONS_DIR,
  PLATFORM_MIGRATIONS_TABLE_FQN,
  formatMigrationStatus,
  readJournalEntries,
} from '../../tools/platform/migrate-status.mjs'
import {
  PLATFORM_MIGRATIONS_DIR,
  PLATFORM_MIGRATIONS_TABLE,
  PLATFORM_SCHEMA,
} from '../../src/lib/platform/db/config'

/**
 * `pnpm platform:migrate:status` (#125). drizzle-kit ships `generate`, `migrate`
 * and `check` but no status command, so this is ours — and its whole job is to
 * answer "what would `platform:migrate` do next" without running it.
 *
 * The join is on the journal's `when` timestamp, which drizzle writes verbatim
 * into `created_at` when it applies a migration. Matching on the tag would look
 * more natural and be wrong: the tag is not stored in the migrations table.
 */

const entries = [
  { idx: 0, version: '7', when: 1786421540315, tag: '0000_create_core_schema', breakpoints: true },
  { idx: 1, version: '7', when: 1786500000000, tag: '0001_member', breakpoints: true },
]

describe('formatMigrationStatus', () => {
  it('splits the journal into applied and pending on the created_at join', () => {
    const status = formatMigrationStatus({ entries, appliedWhen: [1786421540315] })
    expect(status.applied).toEqual(['0000_create_core_schema'])
    expect(status.pending).toEqual(['0001_member'])
    expect(status.total).toBe(2)
  })

  it('reports every migration as pending on a database that has never been migrated', () => {
    const status = formatMigrationStatus({ entries, appliedWhen: [] })
    expect(status.pending).toEqual(['0000_create_core_schema', '0001_member'])
    expect(status.applied).toEqual([])
  })

  it('marks each line so a human can read the verdict, not count it', () => {
    const status = formatMigrationStatus({ entries, appliedWhen: [1786421540315] })
    expect(status.lines[0]).toContain('0000_create_core_schema')
    expect(status.lines[0]).toMatch(/applied/i)
    expect(status.lines[1]).toMatch(/pending/i)
  })

  it('flags a row in the database that no journal entry explains', () => {
    const status = formatMigrationStatus({ entries, appliedWhen: [1786421540315, 1700000000000] })
    expect(status.orphans).toEqual([1700000000000])
    expect(status.lines.join('\n')).toMatch(/orphan/i)
  })

  it('survives an empty journal', () => {
    const status = formatMigrationStatus({ entries: [], appliedWhen: [] })
    expect(status).toMatchObject({ total: 0, applied: [], pending: [], orphans: [] })
  })
})

describe('readJournalEntries', () => {
  it('reads the migrations the repo actually ships', () => {
    const journal = readJournalEntries(PLATFORM_MIGRATIONS_DIR)
    expect(journal.length).toBeGreaterThan(0)
    expect(journal[0].tag).toBe('0000_create_core_schema')
  })

  it('returns nothing (rather than throwing) when the directory has no journal', () => {
    expect(readJournalEntries('./src/lib/platform/db/does-not-exist')).toEqual([])
  })
})

/**
 * The tool is plain `.mjs` (repo convention for `tools/**`) and therefore cannot
 * import the TypeScript config seam, so it restates two values. This block is
 * what keeps the restatement from becoming a second source of truth: change
 * either side alone and the suite goes red.
 */
describe('the .mjs tool and the TypeScript config agree', () => {
  it('reads the same migrations directory drizzle-kit writes', () => {
    expect(MIGRATIONS_DIR).toBe(PLATFORM_MIGRATIONS_DIR)
  })

  it('queries the migrations table inside `core`, never beside payload_migrations', () => {
    expect(PLATFORM_MIGRATIONS_TABLE_FQN).toBe(`${PLATFORM_SCHEMA}.${PLATFORM_MIGRATIONS_TABLE}`)
    expect(PLATFORM_MIGRATIONS_TABLE_FQN).toBe('core.__drizzle_migrations')
  })
})
