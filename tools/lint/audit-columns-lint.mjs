#!/usr/bin/env node
// audit-columns — the four audit columns on every `core` table (issue #516;
// owner rule, Антон, 2026-09-22; ADR-004 amendment A2).
//
// `created_at`, `created_by`, `updated_at`, `updated_by` are mandatory on every
// platform table BY DEFAULT, as a hard rule. They are not the append-only
// journal `core.audit_event` (spec 201) and do not replace it: the journal is
// the diff HISTORY, these four are the row's own current facts — «when and by
// whom was this created / last changed» — which every screen and every query
// asks without joining the journal. The concrete pain that produced the rule:
// the finance intake item had no submission timestamp at all, so the owner could
// not see when a request was filed (#517).
//
// ── Sibling of `audit-coverage`, and why they are two scripts ───────────────
// Both read the same tree through the SAME parser — `parseSchemaTables` is
// imported from `audit-coverage-lint.mjs`, never re-implemented, so the two
// halves of «is this table properly recorded» cannot disagree about what a
// table's columns are. They are separate scripts because they carry separate
// SEVERITIES, and one exit code cannot report two:
//
//   * `audit-coverage` — WARN. It matches REGEXES OVER SQL TEXT (the migration
//     chain's trigger attach lines), so it has a real false-positive class.
//   * this guard — BLOCK from day 0. It reads a DECLARATION: a column object
//     either spreads `auditColumns()` / names the column, or it does not. There
//     is no SQL text to mis-parse and nothing to soak.
//
// ── What it reads ───────────────────────────────────────────────────────────
//   * the SCHEMA — every `core.table('<name>', { … })` under
//     `src/lib/platform/db/schema/**/*.ts`, with its SQL column names, the
//     `...auditColumns()` spread expanded (the shared parser does that);
//   * `tools/lint/audit-coverage-allowlist.mjs` — `AUDIT_COLUMNS` (the four
//     names) and `AUDIT_COLUMNS_EXEMPT_TABLES` (structural absences with their
//     written rationale). One list, shared with
//     `tests/int/platform/audit-columns.int.spec.ts`.
//
// It never reaches a database. The truth-level counterpart does:
// `tests/int/platform/audit-columns.int.spec.ts` reads `information_schema` and
// `pg_trigger` against the really-migrated database from the BLOCK
// `platform-int` job, and asserts the stamping behaviour on top.
//
// ── Finding classes ─────────────────────────────────────────────────────────
//   missing-audit-column        a `core` table without one of the four columns
//   unparsed-table              a `core` table whose column object yielded NOTHING
//   blank-exemption-rationale   an exempt entry that says nothing
//
// SEVERITY: BLOCK — docs/ci-guardrails.md §5, job in `.github/workflows/ci.yml`
// with no `continue-on-error`. The script exits 1 on a finding (canon §4
// clause 1) and 0 when clean.
//
// Run: `pnpm lint:audit-columns`. Findings: stderr + exit 1. Clean: stdout + 0.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  AUDIT_COLUMNS,
  AUDIT_COLUMNS_EXEMPT_TABLES,
  rationaleIsBlank,
} from './audit-coverage-allowlist.mjs'
import { SCHEMA_FILE_RE, parseSchemaTables } from './audit-coverage-lint.mjs'
import {
  isEntryPoint,
  isFixturePath,
  reporter,
  repoRoot,
  runMain,
  walkFiles,
} from './lib/guard.mjs'

const TAG = 'audit-columns'

/** The helper every compliant table spreads, named in the findings. */
const HELPER = 'auditColumns()'
/** Where the rule's data and the exempt list live, named in the findings. */
const ALLOWLIST_REL = 'tools/lint/audit-coverage-allowlist.mjs'

/**
 * The pure decision seam. No IO.
 *
 * @param {{tables: {table: string, columns: string[], file?: string}[],
 *          exemptTables: Record<string, string>}} input
 * @returns {{findings: {kind: string, subject: string, detail: string}[]}}
 */
export function evaluateAuditColumns({ tables, exemptTables }) {
  const findings = []
  const add = (kind, subject, detail) => findings.push({ kind, subject, detail })

  for (const { table, columns, file } of tables) {
    const where = file ? ` (declared in ${file})` : ''

    if (table in exemptTables) {
      if (rationaleIsBlank(exemptTables[table])) {
        add(
          'blank-exemption-rationale',
          table,
          '`core.' +
            table +
            '` is exempt from the audit columns with a blank rationale — the entry in ' +
            ALLOWLIST_REL +
            ' has to SAY why the table carries none, and is reviewed in the diff that adds it',
        )
      }
      continue
    }

    // Fail-closed per table, the same clause `audit-coverage` applies: every
    // `core` table has at least one column, so a column object that yielded
    // nothing is a PARSE FAILURE — and an unparsed table is indistinguishable
    // from a fully compliant one (canon §8).
    if (columns.length === 0) {
      add(
        'unparsed-table',
        table,
        '`core.' +
          table +
          '`' +
          where +
          ' parsed with ZERO columns — every `core` table has at least one, so this is a parse ' +
          'failure in the guard, not compliance. A table the guard cannot read is reported ' +
          'rather than passed',
      )
      continue
    }

    for (const column of AUDIT_COLUMNS) {
      if (columns.includes(column)) continue
      add(
        'missing-audit-column',
        table + '.' + column,
        '`core.' +
          table +
          '`' +
          where +
          ' declares no `' +
          column +
          '` — spread `...' +
          HELPER +
          '` into its column object (`src/lib/platform/db/schema/audit-columns.ts`). The four ' +
          'audit columns are mandatory on every platform table by default (owner rule, Антон, ' +
          '2026-09-22; #516). A table that genuinely carries none needs an entry with a written ' +
          'rationale in ' +
          ALLOWLIST_REL,
      )
    }
  }

  return { findings }
}

/**
 * Read every schema file under `root`, in path order.
 *
 * A read error is NOT swallowed: skipping an unreadable schema file removes its
 * tables from the checked set entirely, which fails OPEN. The throw reaches
 * `runMain` and becomes exit 1 with the stack (canon §8).
 */
function readSchemaFiles(root) {
  const files = walkFiles(root, {
    include: (rel) => SCHEMA_FILE_RE.test(rel) && !isFixturePath(rel),
  })
  return files.map((rel) => ({ rel, text: readFileSync(resolve(root, rel), 'utf8') }))
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()

  const schemaFiles = readSchemaFiles(root)

  // Wrong-tree, not a clean sweep: the schema directory is committed, so
  // scanning zero files means this run cleared nothing (canon §8).
  if (schemaFiles.length === 0) {
    out.fail(
      'no platform schema files found under src/lib/platform/db/schema — this run cleared ' +
        'nothing, which is an input problem (wrong tree), not a compliant schema.',
    )
    return
  }

  const tables = schemaFiles.flatMap(({ rel, text }) =>
    parseSchemaTables(text).map((t) => ({ ...t, file: rel })),
  )
  if (tables.length === 0) {
    out.fail(
      `${schemaFiles.length} schema file(s) scanned and not one \`core.table(…)\` declaration ` +
        'found — the schema tree is committed, so this is a parse/input problem, not an empty ' +
        'set of tables.',
    )
    return
  }

  out.info(
    `${tables.length} core table(s) in ${schemaFiles.length} schema file(s); ` +
      `${AUDIT_COLUMNS.length} mandatory column(s); ` +
      `${Object.keys(AUDIT_COLUMNS_EXEMPT_TABLES).length} exempt table(s)`,
  )

  const { findings } = evaluateAuditColumns({
    tables,
    exemptTables: AUDIT_COLUMNS_EXEMPT_TABLES,
  })

  if (findings.length === 0) {
    out.ok(
      `every \`core\` table carries ${AUDIT_COLUMNS.join(', ')} — or is a structural exemption ` +
        'with a written rationale (#516).',
    )
  }

  for (const f of findings) out.finding(`${f.kind}  ${f.subject}  ->  ${f.detail}`)
  out.fail(
    `${findings.length} audit-column finding(s). The four audit columns are mandatory on every ` +
      `platform table by default: spread \`...${HELPER}\` into the column object, or record the ` +
      `exemption with a rationale in ${ALLOWLIST_REL}.`,
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
