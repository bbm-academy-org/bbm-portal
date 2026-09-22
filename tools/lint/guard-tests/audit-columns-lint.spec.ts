import { describe, expect, it } from 'vitest'

import { AUDIT_COLUMNS, AUDIT_COLUMNS_EXEMPT_TABLES } from '../audit-coverage-allowlist.mjs'
import { evaluateAuditColumns } from '../audit-columns-lint.mjs'
import { parseSchemaTables } from '../audit-coverage-lint.mjs'
import { caseDir, runGuard } from './run-guard'

/**
 * audit-columns — the owner's hard rule of #516: `created_at`, `created_by`,
 * `updated_at`, `updated_by` on EVERY `core` table, by default.
 *
 * The sibling half of `audit-coverage`. They read the same schema tree through
 * the same parser and are two scripts only because they carry two severities:
 * this one is BLOCK from day 0 (a missing column is a structural fact of the
 * declaration, with no regex-over-SQL false-positive class to soak), while
 * `audit-coverage` soaks at WARN. One script cannot report two severities
 * through one exit code.
 */

describe('evaluateAuditColumns', () => {
  it('passes a table that carries all four audit columns', () => {
    const tables = [{ table: 'widget', columns: ['id', ...AUDIT_COLUMNS], file: 'a.ts' }]
    expect(evaluateAuditColumns({ tables, exemptTables: {} }).findings).toEqual([])
  })

  it('reports EVERY missing audit column, naming the table and the column', () => {
    const tables = [{ table: 'widget', columns: ['id', 'created_at'], file: 'a.ts' }]
    const { findings } = evaluateAuditColumns({ tables, exemptTables: {} })
    expect(findings.map((f) => f.subject)).toEqual([
      'widget.created_by',
      'widget.updated_at',
      'widget.updated_by',
    ])
    expect(findings.every((f) => f.kind === 'missing-audit-column')).toBe(true)
  })

  it('fails closed on a table whose column object parsed to nothing', () => {
    const { findings } = evaluateAuditColumns({
      tables: [{ table: 'widget', columns: [], file: 'a.ts' }],
      exemptTables: {},
    })
    expect(findings.map((f) => f.kind)).toEqual(['unparsed-table'])
  })

  it('excuses a table named in the exempt list with a written rationale', () => {
    const tables = [{ table: 'audit_event', columns: ['id'], file: 'a.ts' }]
    expect(
      evaluateAuditColumns({ tables, exemptTables: { audit_event: 'the journal itself' } })
        .findings,
    ).toEqual([])
  })

  it('refuses a blank rationale — an exemption has to SAY why', () => {
    const tables = [{ table: 'audit_event', columns: ['id'], file: 'a.ts' }]
    const { findings } = evaluateAuditColumns({ tables, exemptTables: { audit_event: '  ' } })
    expect(findings.map((f) => f.kind)).toEqual(['blank-exemption-rationale'])
  })
})

describe('the `...auditColumns()` spread is visible to the shared parser', () => {
  it('expands the spread into the four SQL column names', () => {
    const src = [
      'export const widget = core.table(',
      "  'widget',",
      '  {',
      "    id: serial('id').primaryKey(),",
      '    ...auditColumns(),',
      '  },',
      ')',
    ].join('\n')
    expect(parseSchemaTables(src)).toEqual([
      { table: 'widget', columns: ['id', ...AUDIT_COLUMNS], nameless: [] },
    ])
  })

  it('never invents the columns for a table that does not spread the helper', () => {
    const src = "export const widget = core.table('widget', { id: serial('id') })"
    expect(parseSchemaTables(src)[0].columns).toEqual(['id'])
  })
})

describe('the real guard script', () => {
  it('exits 0 on a fixture tree whose table spreads the helper', () => {
    const res = runGuard('audit-columns-lint.mjs', caseDir('audit-columns', 'clean'))
    expect(res.code).toBe(0)
  })

  it('exits 1 — BLOCK — on a table lacking the columns', () => {
    const res = runGuard('audit-columns-lint.mjs', caseDir('audit-columns', 'missing-column'))
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('widget')
  })

  it('fails closed when the schema tree yielded no file at all', () => {
    const res = runGuard('audit-columns-lint.mjs', caseDir('audit-columns', 'no-schema'))
    expect(res.code).toBe(1)
  })

  it('exits 0 against the REAL repository tree — the rule holds on main', () => {
    const res = runGuard('audit-columns-lint.mjs', null, { realTree: true })
    expect(res.code).toBe(0)
  })
})

describe('the exempt list', () => {
  it('is structural only — no product table leaves the rule', () => {
    expect(Object.keys(AUDIT_COLUMNS_EXEMPT_TABLES).sort()).toEqual([
      '__drizzle_migrations',
      'audit_event',
    ])
  })
})
