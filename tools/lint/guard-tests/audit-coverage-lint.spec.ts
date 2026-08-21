import { readFileSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AUDIT_COLUMN_EXCLUSIONS,
  AUDIT_TABLE_ALLOWLIST,
  AUDIT_VALUE_WHITELIST,
} from '../audit-coverage-allowlist.mjs'
import {
  MIGRATION_FILE_RE,
  SCHEMA_FILE_RE,
  attachedTriggers,
  evaluateCoverage,
  loadAllowlist,
  parseSchemaTables,
} from '../audit-coverage-lint.mjs'
import { REPO_ROOT, caseDir, runGuard } from './run-guard'

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
      { table: 'member', columns: ['id', 'member_id', 'created_at'], nameless: [] },
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

  /**
   * The regression that the nine original fixtures could not see, because all of
   * them were comment-free: an apostrophe in ordinary prose («the team's
   * default») opened a phantom string literal, the brace scan never closed, and
   * `core.member` / `core.hours_assessment` parsed with ZERO columns — which
   * `evaluateCoverage` treats exactly like full coverage.
   */
  describe('comments', () => {
    const commented = [
      "import { core } from '../core'",
      '',
      "/** The registry — one row per person, the team's own list. */",
      'export const member = core.table(',
      "  'member',",
      '  {',
      "    /** Surrogate PK; the email is an attribute, never the row's business key. */",
      "    id: serial('id').primaryKey(),",
      "    // IANA zone name; the team's default, not a per-request preference.",
      "    timezone: text('timezone').notNull().default('Europe/Moscow'),",
      "    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`),",
      "    // id: text('legacy_id'), <- commented out, not a column",
      '  },',
      ')',
    ].join('\n')

    it('reads every column even when a comment inside the object carries an apostrophe', () => {
      expect(parseSchemaTables(commented)).toEqual([
        { table: 'member', columns: ['id', 'timezone', 'created_at'], nameless: [] },
      ])
    })

    it('never reads a commented-out declaration as a real column', () => {
      const [{ columns }] = parseSchemaTables(commented)
      expect(columns).not.toContain('legacy_id')
    })

    it('leaves an apostrophe that is really inside a string literal alone', () => {
      const [{ columns }] = parseSchemaTables(
        "export const t = core.table('t', { note: text('note').default('it\\'s fine') })",
      )
      expect(columns).toEqual(['note'])
    })
  })

  it('reports a nameless column separately — its SQL name is not in the source', () => {
    expect(
      parseSchemaTables("export const t = core.table('t', { id: serial('id'), handle: text() })"),
    ).toEqual([{ table: 't', columns: ['id'], nameless: ['handle'] }])
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

  it('never credits `core.<t>` for a trigger attached to another schema’s table', () => {
    const sql =
      'CREATE OR REPLACE TRIGGER "member_audit"\n\tAFTER INSERT ON "public"."member"\n\tFOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(\'id\');'
    expect([...attachedTriggers([sql]).keys()]).toEqual([])
  })

  it('never lets a DROP in another schema un-attach a `core` trigger', () => {
    const chain = [attach('member', "'id'"), 'DROP TRIGGER "member_audit" ON "public"."member";']
    expect(attachedTriggers(chain).get('member')).toEqual(['id'])
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

  /**
   * Fail-closed at the TABLE level (canon §8). Every `core` table has at least
   * one column, so zero parsed columns is a parse failure — and without this
   * class it is byte-for-byte identical to full coverage, which is how the
   * apostrophe bug stayed green.
   */
  it('a table that parsed with ZERO columns is a finding, not silence', () => {
    const verdict = evaluateCoverage({
      tables: [{ table: 'member', columns: [], nameless: [], file: 'schema/member.ts' }],
      attached: new Map([['member', ['id', 'slug']]]),
      tableAllowlist: {},
      columnExclusions: {},
    })
    expect(verdict.findings.map((f) => f.kind)).toEqual(['unparsed-table'])
    expect(verdict.findings[0].subject).toBe('member')
  })

  it('reports the unparsed table even when it is allowlisted — reading it is a different question', () => {
    const verdict = evaluateCoverage({
      tables: [{ table: 'hours_publication', columns: [], nameless: [] }],
      attached: new Map(),
      tableAllowlist: { hours_publication: 'blocked on EARS-31' },
      columnExclusions: {},
    })
    expect(verdict.findings.map((f) => f.kind)).toEqual(['unparsed-table'])
  })

  it('a nameless column is a finding, and does not count as an unparsed table', () => {
    const verdict = evaluateCoverage({
      tables: [{ table: 'member', columns: [], nameless: ['handle'] }],
      attached: new Map([['member', []]]),
      tableAllowlist: {},
      columnExclusions: {},
    })
    expect(verdict.findings.map((f) => f.kind)).toEqual(['nameless-column'])
    expect(verdict.findings[0].subject).toBe('member.handle')
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

  /**
   * The apostrophe regression, end to end. Before the comment-aware tokenizer
   * this tree parsed with zero columns and the guard exited 0 — the exact state
   * `core.member` and `core.hours_assessment` were in on the real repo.
   */
  it('sees through comments carrying apostrophes and reports the uncovered column', () => {
    const res = runCase('comment-apostrophe')
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('uncovered-column')
    expect(res.stderr).toContain('member.nickname')
    // the commented-out declaration must not become a column of its own
    expect(res.stderr).not.toContain('legacy_id')
    // and the table must not read as unparsed either
    expect(res.stderr).not.toContain('unparsed-table')
  })

  it('exits 1 on a table whose column object yields nothing — fail-closed per table', () => {
    const res = runCase('unparsed-table')
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('unparsed-table')
    expect(res.stderr).toContain('member')
  })

  it('exits 1 on a column declared without its explicit SQL name', () => {
    const res = runCase('nameless-column')
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('nameless-column')
    expect(res.stderr).toContain('member.handle')
  })

  /**
   * Not an exit-code-only assertion. Exit 0 on the live tree cannot tell
   * «covered» from «parsed nothing» — which is precisely how the EARS-29 half of
   * this guard was inert on half the audited set while 34 tests were green. The
   * census and the per-table column counts are what make the green mean
   * something.
   */
  describe('the real repo tree', () => {
    const schemaFiles = readdirSync(resolve(REPO_ROOT, 'src/lib/platform/db/schema'), {
      recursive: true,
      encoding: 'utf8',
    })
      .map((rel) => rel.split(sep).join('/'))
      .filter((rel) => SCHEMA_FILE_RE.test(`src/lib/platform/db/schema/${rel}`))

    const parsed = schemaFiles.flatMap((rel) =>
      parseSchemaTables(
        readFileSync(resolve(REPO_ROOT, 'src/lib/platform/db/schema', rel), 'utf8'),
      ),
    )

    it('exits 0 — the guard must be green at merge', () => {
      const res = runGuard('audit-coverage-lint.mjs', null, { realTree: true })
      expect(res.code).toBe(0)
      expect(res.stdout).toMatch(/\d+ core table\(s\) in \d+ schema file\(s\)/)
    })

    /**
     * `audit_event` and `__drizzle_migrations` are SQL-only (the ledger and
     * drizzle's bookkeeping declare no drizzle table), so the drizzle-visible
     * set is exactly the audited tables — since #275 there is no allowlisted
     * product table left to add to it (EARS-33).
     */
    it('declares every drizzle-visible `core` table the allowlist and whitelist name', () => {
      const known = Object.keys(AUDIT_VALUE_WHITELIST)
      const parsedNames = parsed.map((t) => t.table)
      for (const table of known) expect(parsedNames).toContain(table)
    })

    it('parses EVERY declared table with at least one column — no silently empty table', () => {
      expect(parsed.length).toBeGreaterThan(0)
      for (const { table, columns } of parsed) {
        expect(`${table}: ${columns.length} column(s)`).not.toBe(`${table}: 0 column(s)`)
      }
    })

    it('parses the whitelisted columns of every audited table, name for name', () => {
      for (const [table, whitelisted] of Object.entries(AUDIT_VALUE_WHITELIST)) {
        const declared = parsed.find((t) => t.table === table)?.columns ?? []
        for (const column of whitelisted) expect(declared).toContain(column)
      }
    })
  })
})
