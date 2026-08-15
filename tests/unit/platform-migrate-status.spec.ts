// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  MIGRATIONS_DIR,
  PLATFORM_MIGRATIONS_TABLE_FQN,
  formatMigrationStatus,
  readAppliedWhen,
  readJournalEntries,
  statusExitCode,
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

  it('labels an applied row by the migration timestamp, not by an apply time', () => {
    // drizzle stores `folderMillis` — when the migration was GENERATED — and
    // nothing else. Calling that "applied <ts>" reads as an apply time the
    // database never recorded.
    const status = formatMigrationStatus({ entries, appliedWhen: [1786421540315] })
    expect(status.lines[0]).toMatch(/migration ts/i)
  })
})

/**
 * The silent-skip hazard of parallel sessions (#125, review major 6).
 *
 * drizzle's migrator applies a migration only when
 * `Number(lastDbMigration.created_at) < migration.folderMillis`. So a migration
 * generated in worktree A BEFORE — but merged AFTER — one generated in worktree
 * B is never applied: `drizzle-kit migrate` exits 0 having done nothing, and a
 * naive status reports it PENDING forever, indistinguishable from "not applied
 * yet". In a repo whose canon opens with «parallel sessions are the norm here»,
 * and where #124 and the hours migration will generate migrations from separate
 * worktrees, a state that looks pending but can never apply must be named.
 */
describe('formatMigrationStatus — unreachable migrations', () => {
  const reordered = [
    { idx: 0, version: '7', when: 1000, tag: '0000_create_core_schema', breakpoints: true },
    { idx: 1, version: '7', when: 3000, tag: '0001_from_worktree_b', breakpoints: true },
    { idx: 2, version: '7', when: 2000, tag: '0002_from_worktree_a', breakpoints: true },
  ]

  it('flags a pending migration older than the newest applied one as UNREACHABLE', () => {
    const status = formatMigrationStatus({ entries: reordered, appliedWhen: [1000, 3000] })
    expect(status.unreachable).toEqual(['0002_from_worktree_a'])
    expect(status.pending).toEqual([])
    expect(status.lines.join('\n')).toMatch(/UNREACHABLE/)
  })

  it('names the remedy — regenerate, do not re-merge', () => {
    const status = formatMigrationStatus({ entries: reordered, appliedWhen: [1000, 3000] })
    expect(status.lines.join('\n')).toMatch(/regenerat/i)
  })

  it('keeps genuinely-pending migrations pending', () => {
    const status = formatMigrationStatus({ entries: reordered, appliedWhen: [1000] })
    expect(status.pending.sort()).toEqual(['0001_from_worktree_b', '0002_from_worktree_a'])
    expect(status.unreachable).toEqual([])
  })

  it('reports nothing unreachable on a database that has never been migrated', () => {
    expect(formatMigrationStatus({ entries: reordered, appliedWhen: [] }).unreachable).toEqual([])
  })
})

describe('statusExitCode', () => {
  it('is 0 when everything is applied or legitimately pending', () => {
    expect(statusExitCode({ unreachable: [], orphans: [] })).toBe(0)
    expect(statusExitCode({ unreachable: [], orphans: [], pending: ['0001_x'] })).toBe(0)
  })

  it('is non-zero when a migration can never be applied — silence would be the bug', () => {
    expect(statusExitCode({ unreachable: ['0002_x'], orphans: [] })).not.toBe(0)
  })

  it('is non-zero on an orphan row the journal cannot explain', () => {
    expect(statusExitCode({ unreachable: [], orphans: [1700000000000] })).not.toBe(0)
  })
})

describe('readAppliedWhen', () => {
  const rows = [{ created_at: '1000' }, { created_at: '3000' }]

  it('reads the ledger and normalises created_at to numbers', async () => {
    const client = { query: async () => ({ rows }) }
    expect(await readAppliedWhen(client)).toEqual([1000, 3000])
  })

  it('treats a missing ledger table (42P01) as "never migrated", not as an error', async () => {
    // The first-run path on every fresh database: the table does not exist until
    // the first successful migrate.
    const client = {
      query: async () => {
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' })
      },
    }
    expect(await readAppliedWhen(client)).toEqual([])
  })

  it('still propagates a real database error', async () => {
    const client = {
      query: async () => {
        throw Object.assign(new Error('permission denied'), { code: '42501' })
      },
    }
    await expect(readAppliedWhen(client)).rejects.toThrow('permission denied')
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
