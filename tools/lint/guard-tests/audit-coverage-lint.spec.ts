import { describe, expect, it } from 'vitest'

import { AUDIT_COLUMN_EXCLUSIONS, AUDIT_TABLE_ALLOWLIST } from '../audit-coverage-allowlist.mjs'
import {
  MIGRATION_FILE_RE,
  SCHEMA_FILE_RE,
  attachedTriggers,
  evaluateCoverage,
  loadAllowlist,
  parseSchemaTables,
} from '../audit-coverage-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * audit-coverage — the migration-chain half of spec 201's coverage clauses
 * (EARS-19, EARS-20, EARS-22, EARS-29; issue #276).
 *
 * The truth-level half lives in `tests/int/platform/audit-coverage.int.spec.ts`
 * and reads `pg_trigger` against the really-migrated database. Both read ONE
 * list — `tools/lint/audit-coverage-allowlist.mjs` — so the allowlist cannot
 * say one thing to the guard and another to the integration tier.
 */

describe('SCHEMA_FILE_RE / MIGRATION_FILE_RE', () => {
  it('matches the platform schema tree and the migration chain', () => {
    expect(SCHEMA_FILE_RE.test('src/lib/platform/db/schema/member/member.ts')).toBe(true)
    expect(SCHEMA_FILE_RE.test('src/lib/platform/db/schema/core.ts')).toBe(true)
    expect(
      MIGRATION_FILE_RE.test('src/lib/platform/db/migrations/0003_universal_edit_audit.sql'),
    ).toBe(true)
  })

  it('never matches a README, a test, or drizzle’s own snapshot bookkeeping', () => {
    expect(SCHEMA_FILE_RE.test('src/lib/platform/db/schema/README.md')).toBe(false)
    expect(SCHEMA_FILE_RE.test('src/lib/platform/db/client.ts')).toBe(false)
    expect(MIGRATION_FILE_RE.test('src/lib/platform/db/migrations/meta/0000_snapshot.json')).toBe(
      false,
    )
  })
})

describe('parseSchemaTables', () => {
  const src = [
    "import { core } from '../core'",
    '',
    'export const member = core.table(',
    "  'member',",
    '  {',
    "    id: serial('id').primaryKey(),",
    "    memberId: integer('member_id').notNull().references(() => other.id, { onDelete: 'cascade' }),",
    "    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),",
    '  },',
    '  (table) => [',
    "    uniqueIndex('member_slug_unique').on(table.slug),",
    "    check('member_status_allowed', sql`${table.status} in ('active')`),",
    '  ],',
    ')',
  ].join('\n')

  it('reads the SQL table name and every SQL column name', () => {
    expect(parseSchemaTables(src)).toEqual([
      { table: 'member', columns: ['id', 'member_id', 'created_at'] },
    ])
  })

  it('never mistakes an index or a CHECK for a column — they live outside the column object', () => {
    const [{ columns }] = parseSchemaTables(src)
    expect(columns).not.toContain('member_slug_unique')
    expect(columns).not.toContain('member_status_allowed')
  })

  it('returns nothing for a file that declares no table', () => {
    expect(parseSchemaTables("export const core = pgSchema('core')")).toEqual([])
  })
})

describe('attachedTriggers', () => {
  const attach = (table: string, args: string) =>
    `CREATE OR REPLACE TRIGGER "${table}_audit"\n\tAFTER INSERT OR UPDATE OR DELETE ON "core"."${table}"\n\tFOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(${args});`

  it('captures the whitelist arguments, not just the attachment', () => {
    const attached = attachedTriggers([attach('member', "'id', 'slug'")])
    expect([...attached.keys()]).toEqual(['member'])
    expect(attached.get('member')).toEqual(['id', 'slug'])
  })

  it('records an attachment with an EMPTY whitelist as attached with no columns', () => {
    const attached = attachedTriggers([attach('member', '')])
    expect(attached.get('member')).toEqual([])
  })

  it('never reads the ledger’s own append-only trigger as a capture attachment', () => {
    const sql = [
      'CREATE OR REPLACE TRIGGER "audit_event_append_only_row"',
      '\tBEFORE UPDATE OR DELETE ON "core"."audit_event"',
      '\tFOR EACH ROW EXECUTE FUNCTION "core"."audit_event_append_only"();',
      attach('member', "'id'"),
    ].join('\n')
    expect([...attachedTriggers([sql]).keys()]).toEqual(['member'])
  })

  it('ignores the function BODY, which names audit_row_change in prose and comments', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION "core"."audit_row_change"() RETURNS trigger AS $$',
      'BEGIN',
      '\t-- ON "core"."member" EXECUTE FUNCTION "core"."audit_row_change"(\'nope\');',
      '\tRETURN NULL;',
      'END;',
      '$$;',
      attach('member', "'id'"),
    ].join('\n')
    expect([...attachedTriggers([sql]).keys()]).toEqual(['member'])
  })

  it('honours a later DROP TRIGGER in the chain — coverage is the END state', () => {
    const chain = [
      attach('member', "'id'"),
      'DROP TRIGGER IF EXISTS "member_audit" ON "core"."member";',
    ]
    expect([...attachedTriggers(chain).keys()]).toEqual([])
  })

  it('drops only the named trigger, not every trigger on that table', () => {
    const chain = [
      attach('member', "'id'"),
      `CREATE OR REPLACE TRIGGER "member_audit_extra"\n\tAFTER INSERT ON "core"."member"\n\tFOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"('slug');`,
      'DROP TRIGGER "member_audit" ON "core"."member";',
    ]
    expect(attachedTriggers(chain).get('member')).toEqual(['slug'])
  })
})

describe('evaluateCoverage', () => {
  const tables = (entries: [string, string[]][]) =>
    entries.map(([table, columns]) => ({ table, columns, file: `schema/${table}.ts` }))

  it('is clean when every table is attached and every column is whitelisted', () => {
    const verdict = evaluateCoverage({
      tables: tables([['member', ['id', 'slug']]]),
      attached: new Map([['member', ['id', 'slug']]]),
      tableAllowlist: {},
      columnExclusions: {},
    })
    expect(verdict.findings).toEqual([])
  })

  it('EARS-19: reports a table with no trigger and no allowlist entry', () => {
    const verdict = evaluateCoverage({
      tables: tables([['member', ['id']]]),
      attached: new Map(),
      tableAllowlist: {},
      columnExclusions: {},
    })
    expect(verdict.findings.map((f) => f.kind)).toEqual(['uncovered-table'])
    expect(verdict.findings[0].subject).toBe('member')
  })

  it('EARS-19: an allowlist entry with a rationale takes the table out of the audited set', () => {
    const verdict = evaluateCoverage({
      tables: tables([['hours_publication', ['period_id']]]),
      attached: new Map(),
      tableAllowlist: { hours_publication: 'blocked on EARS-31' },
      columnExclusions: {},
    })
    expect(verdict.findings).toEqual([])
  })

  it('EARS-19: a bare or empty rationale is itself a finding, not an exemption', () => {
    for (const rationale of ['', '   ', undefined]) {
      const verdict = evaluateCoverage({
        tables: tables([['hours_publication', ['period_id']]]),
        attached: new Map(),
        tableAllowlist: rationale === undefined ? {} : { hours_publication: rationale },
        columnExclusions: {},
      })
      expect(verdict.findings).toHaveLength(1)
      expect(verdict.findings[0].kind).toBe(
        rationale === undefined ? 'uncovered-table' : 'blank-table-rationale',
      )
    }
  })

  it('EARS-22: an allowlisted table that GOT its trigger is a stale entry', () => {
    const verdict = evaluateCoverage({
      tables: tables([['member', ['id']]]),
      attached: new Map([['member', ['id']]]),
      tableAllowlist: { member: 'was blocked once' },
      columnExclusions: {},
    })
    expect(verdict.findings.map((f) => f.kind)).toEqual(['stale-allowlist'])
  })

  it('EARS-29: a column in neither the whitelist nor the exclusions is a finding', () => {
    const verdict = evaluateCoverage({
      tables: tables([['member', ['id', 'nickname']]]),
      attached: new Map([['member', ['id']]]),
      tableAllowlist: {},
      columnExclusions: {},
    })
    expect(verdict.findings.map((f) => f.kind)).toEqual(['uncovered-column'])
    expect(verdict.findings[0].subject).toBe('member.nickname')
  })

  it('EARS-29: an exclusion with a rationale covers the column; a bare one does not', () => {
    const withReason = evaluateCoverage({
      tables: tables([['member_alias', ['value']]]),
      attached: new Map([['member_alias', []]]),
      tableAllowlist: {},
      columnExclusions: { 'member_alias.value': 'ПДн — ст. 5 ч. 5 152-ФЗ' },
    })
    expect(withReason.findings).toEqual([])

    const bare = evaluateCoverage({
      tables: tables([['member_alias', ['value']]]),
      attached: new Map([['member_alias', []]]),
      tableAllowlist: {},
      columnExclusions: { 'member_alias.value': '  ' },
    })
    expect(bare.findings.map((f) => f.kind)).toEqual(['blank-column-rationale'])
  })

  it('EARS-29: a column that is BOTH whitelisted and excluded is a stale exclusion', () => {
    const verdict = evaluateCoverage({
      tables: tables([['member', ['id']]]),
      attached: new Map([['member', ['id']]]),
      tableAllowlist: {},
      columnExclusions: { 'member.id': 'no longer true' },
    })
    expect(verdict.findings.map((f) => f.kind)).toEqual(['stale-exclusion'])
  })

  it('never asks column questions about a table that left the audited set', () => {
    const verdict = evaluateCoverage({
      tables: tables([['hours_publication', ['messages']]]),
      attached: new Map(),
      tableAllowlist: { hours_publication: 'blocked on EARS-31' },
      columnExclusions: {},
    })
    expect(verdict.findings).toEqual([])
  })

  it('EARS-22: the rule is by construction — a table nobody enumerated is covered like any other', () => {
    const verdict = evaluateCoverage({
      tables: tables([
        ['member', ['id']],
        ['hours_publication_message', ['id', 'body']],
      ]),
      attached: new Map([
        ['member', ['id']],
        ['hours_publication_message', ['id', 'body']],
      ]),
      tableAllowlist: {},
      columnExclusions: {},
    })
    expect(verdict.findings).toEqual([])
  })
})

describe('loadAllowlist', () => {
  it('falls back to the shared list — one source with the integration tier', () => {
    const { tableAllowlist, columnExclusions } = loadAllowlist({})
    expect(tableAllowlist).toBe(AUDIT_TABLE_ALLOWLIST)
    expect(columnExclusions).toBe(AUDIT_COLUMN_EXCLUSIONS)
  })

  it('lets the seam replace both maps for a fixture run', () => {
    const seam = JSON.stringify({ tables: { widget: 'why' }, columns: { 'member.note': 'ПДн' } })
    expect(loadAllowlist({ LINT_AUDIT_ALLOWLIST: seam })).toEqual({
      tableAllowlist: { widget: 'why' },
      columnExclusions: { 'member.note': 'ПДн' },
    })
  })

  it('throws on malformed seam data instead of judging against an empty list', () => {
    expect(() => loadAllowlist({ LINT_AUDIT_ALLOWLIST: '{not json' })).toThrow()
  })
})

describe('audit-coverage (spawned)', () => {
  const COLUMNS = { 'member.note': 'free-text context around a person — ПДн' }
  const seam = (value: Record<string, unknown>) => ({ LINT_AUDIT_ALLOWLIST: JSON.stringify(value) })
  const runCase = (name: string, allowlist: Record<string, unknown> = { columns: COLUMNS }) =>
    runGuard('audit-coverage-lint.mjs', caseDir('audit-coverage', name), { env: seam(allowlist) })

  it('exits 0 on a tree where every table is attached and every column decided', () => {
    const res = runCase('clean')
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('[audit-coverage]')
  })

  it('EARS-19: exits 1 and names a table that landed with no trigger', () => {
    const res = runCase('missing-trigger')
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('uncovered-table')
    expect(res.stderr).toContain('widget')
  })

  it('EARS-19: exits 0 once that table is allowlisted WITH a rationale', () => {
    const res = runCase('allowlisted', {
      tables: { widget: 'a scratch table with no domain truth in it' },
      columns: COLUMNS,
    })
    expect(res.code).toBe(0)
  })

  it('EARS-19: exits 1 when the allowlist entry carries a bare rationale', () => {
    const res = runCase('blank-rationale', { tables: { widget: '   ' }, columns: COLUMNS })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('blank-table-rationale')
  })

  it('EARS-29: exits 1 and names a column in neither the whitelist nor the exclusions', () => {
    const res = runCase('uncovered-column', {})
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('member.nickname')
  })

  it('EARS-29: exits 1 when a column exclusion carries a bare rationale', () => {
    const res = runCase('blank-column-rationale', { columns: { 'member.note': '  ' } })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('member.note')
  })

  it('EARS-22: exits 1 when a later migration drops the trigger an earlier one attached', () => {
    const res = runCase('dropped-trigger')
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('uncovered-table')
    expect(res.stderr).toContain('member')
  })

  it('exits 1 on a tree with no platform schema files at all — the wrong-tree class', () => {
    const res = runCase('no-schema')
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('no platform schema files')
  })

  /**
   * Fail-closed (canon §8): the allowlist IS the guard's data, so a run that
   * cannot read it cleared nothing. The exception surfaces with its stack and
   * exit 1 — never a reassuring exit 0 against an empty list.
   */
  it('exits 1 with the error when the allowlist data cannot be read', () => {
    const res = runGuard('audit-coverage-lint.mjs', caseDir('audit-coverage', 'clean'), {
      env: { LINT_AUDIT_ALLOWLIST: '{not json' },
    })
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('unexpected error')
  })

  it('exits 0 on the real repo tree — the guard must be green at merge', () => {
    const res = runGuard('audit-coverage-lint.mjs', null, { realTree: true })
    expect(res.code).toBe(0)
  })
})
