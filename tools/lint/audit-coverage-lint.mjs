#!/usr/bin/env node
// audit-coverage — no `core` table without a capture trigger, no column without
// a whitelist decision (issue #276; spec `docs/specs/201-universal-edit-audit.md`
// §Coverage: EARS-19, EARS-20, EARS-22, EARS-29).
//
// Coverage of the universal edit audit is defined BY CONSTRUCTION, not by
// enumeration (owner decision Q6): every platform domain table in `core` —
// present and future — carries `core.audit_row_change()`, and a table that lands
// without one turns this red without anyone editing a list. One level down, the
// same holds per COLUMN: under default-deny (EARS-27) a column the trigger's
// arguments do not name records `{"changed": true}` and nothing else, so without
// this check «no values are recorded at all because nobody updated the trigger
// arguments» would pass for a working audit.
//
// ── What this guard reads, and what it deliberately does not ────────────────
//   * the SCHEMA — every `core.table('<name>', { … })` under
//     `src/lib/platform/db/schema/**/*.ts`, with its SQL column names;
//   * the MIGRATION CHAIN — every
//     `CREATE [OR REPLACE] TRIGGER … EXECUTE FUNCTION core.audit_row_change(<args>)`
//     in file order, with the whitelist ARGUMENTS captured (EARS-29 has to read
//     them), minus later `DROP TRIGGER`s: coverage is the chain's END state;
//   * the shared allowlist `tools/lint/audit-coverage-allowlist.mjs` — data, not
//     a guard, IMPORTED rather than re-declared (the seam below replaces it only
//     under a fixture run). Its other reader is
//     `tests/int/platform/audit-coverage.int.spec.ts`, so the two halves of
//     coverage cannot disagree about who is exempt and why.
//
// It never reaches a database. The truth-level counterpart (EARS-21) does, from
// the BLOCK `platform-int` job: it reads `pg_trigger` against the really-migrated
// database. The two check different things on purpose — this one sees the
// allowlist and its WRITTEN RATIONALE, that one sees reality.
//
// ── Finding classes ─────────────────────────────────────────────────────────
//   uncovered-table         a `core` table with no trigger and no allowlist entry
//   blank-table-rationale   an allowlist entry whose rationale says nothing
//   stale-allowlist         an allowlisted table that GOT its trigger (EARS-22)
//   uncovered-column        a column in neither the whitelist nor the exclusions
//   blank-column-rationale  an exclusion whose rationale says nothing
//   stale-exclusion         a column that is BOTH whitelisted and excluded
//   unparsed-table          a `core` table whose column object yielded NOTHING
//   nameless-column         a column declared without its explicit SQL name
//
// The last two are fail-closed classes at the TABLE level, and they exist
// because of the way this guard failed silently once: an apostrophe in a JSDoc
// line inside the column object opened a phantom string literal, the brace scan
// never closed, and `core.member` was reported with zero columns — which reads
// exactly like «every column is whitelisted». A parse that produced nothing is
// now a FINDING rather than silence (canon §8 applied per table, not only per
// tree), so the next tokenizer gap says so instead of going green.
//
// SEVERITY: WARN — docs/ci-guardrails.md §5, job in `.github/workflows/ci.yml`
// with `continue-on-error: true`; the script itself exits 1 on a finding (canon
// §4 clause 1). No day-0 BLOCK mandate is claimed and none applies: the guard
// matches REGEXES OVER SQL TEXT, so it has a real false-positive class to soak
// (EARS-20). Promotion per §4, earliest four weeks after it lands.
//
// Run: `pnpm lint:audit-coverage`. Findings: stderr + exit 1. Clean: stdout + 0.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  AUDIT_COLUMN_EXCLUSIONS,
  AUDIT_TABLE_ALLOWLIST,
  rationaleIsBlank,
} from './audit-coverage-allowlist.mjs'
import {
  isEntryPoint,
  isFixturePath,
  reporter,
  repoRoot,
  runMain,
  walkFiles,
} from './lib/guard.mjs'

const TAG = 'audit-coverage'

/** The platform schema tree — drizzle table files only, so `.md` is out. */
export const SCHEMA_FILE_RE = /^src\/lib\/platform\/db\/schema\/(?:.*\/)?[^/]+\.ts$/
/** The migration chain. `meta/` is drizzle's snapshot bookkeeping, not SQL. */
export const MIGRATION_FILE_RE = /^src\/lib\/platform\/db\/migrations\/[^/]+\.sql$/

/** The allowlist file, relative to the scanned tree — the guard's shared data. */
const ALLOWLIST_REL = 'tools/lint/audit-coverage-allowlist.mjs'

/** `core.table('<name>', {` — the head of a drizzle table declaration. */
const TABLE_HEAD_RE = /\bcore\.table\(\s*(['"])([A-Za-z0-9_]+)\1\s*,\s*\{/g
/** `<prop>: <builder>('<sql_name>'` inside the column object. */
const COLUMN_RE =
  /(?:^|[\s{,])[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$]*\s*\(\s*(['"])([A-Za-z0-9_]+)\1/g
/**
 * `<prop>: <builder>()` / `<builder>({ … })` — drizzle's casing-inferred form,
 * where the SQL name is not in the source at all. Static parsing cannot know it
 * (it depends on the `casing` option of the drizzle config), so such a column is
 * reported rather than skipped: an invisible column is an uncheckable one.
 */
const NAMELESS_COLUMN_RE = /(?:^|[\s{,])([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$]*\s*\(\s*(?:\)|\{)/g

/**
 * An attach line, once statements have been isolated (see `sqlStatements`).
 *
 * The `ON` clause's schema qualifier is CAPTURED, not assumed away: a trigger on
 * `"public"."member"` says nothing about `core.member`, and the old optional
 * `(?:"?core"?\.)?` group silently mis-read such a clause. `qualifiedTable()`
 * below is what rejects a foreign schema.
 */
const ATTACH_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?([A-Za-z0-9_]+)"?[\s\S]*?\bON\s+(?:"?([A-Za-z0-9_]+)"?\s*\.\s*)?"?([A-Za-z0-9_]+)"?[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+"?core"?\s*\.\s*"?audit_row_change"?\s*\(([\s\S]*)\)/i
/** `DROP TRIGGER [IF EXISTS] "<name>" ON "core"."<table>"` — same schema rule. */
const DROP_RE =
  /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s+ON\s+(?:"?([A-Za-z0-9_]+)"?\s*\.\s*)?"?([A-Za-z0-9_]+)"?/i
/** A single-quoted SQL literal — the trigger's whitelist arguments. */
const SQL_STRING_RE = /'((?:[^']|'')*)'/g

/**
 * The source with every `//` and `/* … *\/` comment blanked to spaces, run
 * BEFORE any other scan.
 *
 * This is the fix for the guard's one silent failure. Prose is full of
 * apostrophes («the team's default»), and a tokenizer that tracks string
 * literals but not comments reads such a one as an opening quote: from there the
 * brace scan is inside a phantom string to the end of the file, the column
 * object never closes, and the table is reported with ZERO columns — which
 * `evaluateCoverage` cannot tell apart from «every column is whitelisted».
 * `core.member` and `core.hours_assessment` were in exactly that state.
 *
 * Blanking also removes the mirror-image false positive: a commented-out
 * `id: text('legacy_id')` no longer parses as a real column.
 *
 * Comments become spaces rather than disappearing (newlines are kept) so every
 * offset and line in the returned text still matches the source.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripComments(text) {
  const src = String(text ?? '')
  let out = ''
  let quote = ''
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += src[i + 1] ?? ''
        i += 1
      } else if (ch === quote) quote = ''
      continue
    }
    // A comment can only OPEN where no string literal is open — which is exactly
    // here, so the apostrophe inside it never reaches the quote tracker.
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      const stop = nl === -1 ? src.length : nl
      out += ' '.repeat(stop - i)
      i = stop - 1
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      const stop = close === -1 ? src.length : close + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop - 1
      continue
    }
    out += ch
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
  }
  return out
}

/**
 * The `{ … }` block starting at `open`, brace-balanced and string-aware, so a
 * nested option object (`timestamp('created_at', { withTimezone: true })`) and a
 * brace inside a string literal both stay inside the column object instead of
 * ending it early. Comments are already blanked by `stripComments` before this
 * runs — see there for why that ordering is the whole point.
 *
 * @param {string} text
 * @param {number} open index of the opening `{`
 * @returns {string} the block's contents, or '' when it never closes
 */
function balancedBlock(text, open) {
  let depth = 0
  let quote = ''
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return ''
}

/**
 * Every `core` table a schema file declares, with its SQL column names.
 *
 * Only the COLUMN OBJECT is read — the third argument (indexes, CHECKs) is
 * outside it, so `uniqueIndex('member_slug_unique')` is never mistaken for a
 * column. Static parsing rather than an import: the schema is TypeScript and
 * this guard is plain ESM, and a guard that has to build the app before it can
 * judge it is not a guard.
 *
 * Comments are blanked first (`stripComments`), which is what keeps an
 * apostrophe in a JSDoc line from turning the whole column object into a string
 * literal. `nameless` carries the columns declared WITHOUT an explicit SQL name
 * (`slug: text()`), whose name static parsing cannot know — reported by the
 * caller rather than dropped.
 *
 * @param {string} text
 * @returns {{table: string, columns: string[], nameless: string[]}[]}
 */
export function parseSchemaTables(text) {
  const src = stripComments(text)
  const out = []
  TABLE_HEAD_RE.lastIndex = 0
  for (const head of src.matchAll(TABLE_HEAD_RE)) {
    const open = head.index + head[0].length - 1
    const block = balancedBlock(src, open)
    const columns = [...block.matchAll(COLUMN_RE)].map((m) => m[2])
    const nameless = [...block.matchAll(NAMELESS_COLUMN_RE)].map((m) => m[1])
    out.push({
      table: head[2],
      columns: [...new Set(columns)],
      nameless: [...new Set(nameless)],
    })
  }
  return out
}

/**
 * A migration file's statements, with the two things that would otherwise make
 * a `;` split lie removed first: dollar-quoted function BODIES (which contain
 * both `;` and the words this guard matches on — the capture function's own
 * comments name `audit_row_change` and `ON core.member`) and `--` comments.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function sqlStatements(text) {
  return String(text ?? '')
    .replace(/\$([A-Za-z_][\w]*)?\$[\s\S]*?\$\1?\$/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * The END state of the migration chain: table -> the trigger's whitelist
 * arguments. `sqlTexts` is the chain IN ORDER (file name order — drizzle's
 * numeric prefix is the order it applies them in), so a `DROP TRIGGER` in a
 * later file removes what an earlier one attached, and a table whose only
 * trigger was dropped is uncovered again.
 *
 * Keyed per TRIGGER, not per table: dropping one trigger must not be read as
 * un-auditing a table that carries another.
 *
 * @param {string[]} sqlTexts
 * @returns {Map<string, string[]>}
 */
export function attachedTriggers(sqlTexts) {
  /**
   * The table name when the statement really names a `core` table — an
   * unqualified name (the migrations run with `core` reachable) or an explicit
   * `core.` — and `null` for any other schema, so `ON "public"."member"` neither
   * credits nor un-credits `core.member`.
   *
   * @param {string | undefined} schema
   * @param {string} table
   * @returns {string | null}
   */
  const qualifiedTable = (schema, table) =>
    schema === undefined || schema.toLowerCase() === 'core' ? table : null

  /** @type {Map<string, {table: string, args: string[]}>} */
  const live = new Map()
  for (const text of sqlTexts) {
    for (const statement of sqlStatements(text)) {
      const drop = DROP_RE.exec(statement)
      if (drop) {
        const table = qualifiedTable(drop[2], drop[3])
        if (table) live.delete(`${table}.${drop[1]}`)
        continue
      }
      const attach = ATTACH_RE.exec(statement)
      if (!attach) continue
      const table = qualifiedTable(attach[2], attach[3])
      if (!table) continue
      const args = [...attach[4].matchAll(SQL_STRING_RE)].map((m) => m[1].replace(/''/g, "'"))
      live.set(`${table}.${attach[1]}`, { table, args })
    }
  }

  /** @type {Map<string, string[]>} */
  const byTable = new Map()
  for (const { table, args } of live.values()) {
    byTable.set(table, [...new Set([...(byTable.get(table) ?? []), ...args])])
  }
  return byTable
}

/**
 * The pure decision seam. No IO.
 *
 * @param {{tables: {table: string, columns: string[], nameless?: string[], file?: string}[],
 *          attached: Map<string, string[]>,
 *          tableAllowlist: Record<string, string>,
 *          columnExclusions: Record<string, string>}} input
 * @returns {{findings: {kind: string, subject: string, detail: string}[]}}
 */
export function evaluateCoverage({ tables, attached, tableAllowlist, columnExclusions }) {
  const findings = []
  const add = (kind, subject, detail) => findings.push({ kind, subject, detail })

  for (const { table, columns, nameless = [], file } of tables) {
    const where = file ? ` (declared in ${file})` : ''
    const args = attached.get(table)

    // Fail-closed PER TABLE (canon §8, the same reasoning the wrong-tree class
    // below applies to the whole run): every `core` table has at least one
    // column, so a column object that yielded nothing is a PARSE FAILURE — and
    // an unparsed table is silently identical to a fully covered one. This runs
    // before the allowlist branch on purpose: whether the table is exempt from
    // the trigger is a different question from whether the guard could read it.
    if (columns.length === 0 && nameless.length === 0) {
      add(
        'unparsed-table',
        table,
        `\`core.${table}\`${where} parsed with ZERO columns — every \`core\` table has at ` +
          'least one, so this is a parse failure in the guard, not coverage. A table the guard ' +
          'cannot read is reported rather than passed: zero parsed columns reads exactly like ' +
          '«every column is whitelisted» (canon §8, fail-closed)',
      )
      continue
    }

    for (const prop of nameless) {
      add(
        'nameless-column',
        `${table}.${prop}`,
        `\`${table}.${prop}\` is declared without an explicit SQL name (\`${prop}: builder()\`), ` +
          "so its column name depends on drizzle's `casing` inference and this guard cannot " +
          "compare it to the trigger's whitelist arguments. Give the column its SQL name " +
          "explicitly — the repo's convention — so coverage stays checkable",
      )
    }

    if (!args) {
      if (!(table in tableAllowlist)) {
        add(
          'uncovered-table',
          table,
          `\`core.${table}\`${where} carries no \`core.audit_row_change()\` trigger in the ` +
            'migration chain and is not on the allowlist — attach the trigger, or add an entry ' +
            `with a written rationale to ${ALLOWLIST_REL}`,
        )
      } else if (rationaleIsBlank(tableAllowlist[table])) {
        add(
          'blank-table-rationale',
          table,
          `\`core.${table}\` is allowlisted with a blank rationale — the entry has to SAY why ` +
            'the table is outside the audited set, and is reviewed in the diff that adds it',
        )
      }
      continue // a table outside the audited set has no columns to whitelist
    }

    if (table in tableAllowlist) {
      add(
        'stale-allowlist',
        table,
        `\`core.${table}\` now carries the capture trigger, so its allowlist entry is stale — ` +
          `drop it from ${ALLOWLIST_REL} (EARS-22)`,
      )
    }

    for (const column of columns) {
      const key = `${table}.${column}`
      const excluded = key in columnExclusions
      if (args.includes(column)) {
        if (excluded) {
          add(
            'stale-exclusion',
            key,
            `\`${key}\` is in the trigger's whitelist AND in the excluded-columns list — one of ` +
              'the two is wrong; the migration is the source of record',
          )
        }
        continue
      }
      if (!excluded) {
        add(
          'uncovered-column',
          key,
          `\`${key}\` is in neither the trigger's whitelist arguments nor the excluded-columns ` +
            `list — name it in the migration's whitelist, or exclude it in ${ALLOWLIST_REL} with ` +
            'a rationale. Default-deny means it records `{"changed": true}` until one of the two ' +
            'happens (EARS-27, EARS-29)',
        )
      } else if (rationaleIsBlank(columnExclusions[key])) {
        add(
          'blank-column-rationale',
          key,
          `\`${key}\` is excluded with a blank rationale — the entry has to SAY why the value ` +
            'never enters the ledger (EARS-29)',
        )
      }
    }
  }

  return { findings }
}

/**
 * The allowlist the guard judges against — the module imported at the top of
 * this file, one source shared with the integration tier.
 *
 * TEST SEAM `LINT_AUDIT_ALLOWLIST`: a JSON object
 * `{"tables": {…}, "columns": {…}}` REPLACES both maps, so a fixture case can
 * vary the data without a second copy of the list living in the fixture tree
 * (the shape `LINT_EARS_DEFERRALS` already established here). Inert in
 * production — unset means the real list. Malformed JSON is NOT ignored: the
 * allowlist is this guard's data, so a run that could not read it cleared
 * nothing and the throw becomes exit 1 with the stack (fail-closed, canon §8).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{tableAllowlist: Record<string,string>, columnExclusions: Record<string,string>}}
 */
export function loadAllowlist(env = process.env) {
  const raw = env.LINT_AUDIT_ALLOWLIST
  if (!raw) {
    return {
      tableAllowlist: AUDIT_TABLE_ALLOWLIST,
      columnExclusions: AUDIT_COLUMN_EXCLUSIONS,
    }
  }
  const parsed = JSON.parse(raw)
  const tableAllowlist = parsed?.tables ?? {}
  const columnExclusions = parsed?.columns ?? {}
  if (typeof tableAllowlist !== 'object' || typeof columnExclusions !== 'object') {
    throw new TypeError('LINT_AUDIT_ALLOWLIST: `tables` and `columns` must be objects')
  }
  return { tableAllowlist, columnExclusions }
}

/**
 * Read every matching file under `root`, in path order.
 *
 * A read error is NOT swallowed. Skipping an unreadable schema file removes its
 * tables from the audited set entirely, and skipping an unreadable migration
 * un-attaches triggers — both fail OPEN, which is the one thing the rest of this
 * guard refuses to do. The throw reaches `runMain` and becomes exit 1 with the
 * stack (canon §8): a run that could not read its inputs cleared nothing.
 */
function readAll(root, fileRe) {
  const files = walkFiles(root, { include: (rel) => fileRe.test(rel) && !isFixturePath(rel) })
  return files.map((rel) => ({ rel, text: readFileSync(resolve(root, rel), 'utf8') }))
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()

  const schemaFiles = readAll(root, SCHEMA_FILE_RE)
  const migrationFiles = readAll(root, MIGRATION_FILE_RE)

  // Wrong-tree, not a clean sweep. Both directories are committed, so scanning
  // zero of either means the guard cleared nothing — an input problem. Canon §8
  // gives a CI guard only 0 and 1, so fail-closed here is exit 1 (the same
  // reasoning as `ears-test`'s zero-spec-files class).
  if (schemaFiles.length === 0) {
    out.fail(
      'no platform schema files found under src/lib/platform/db/schema — this run cleared ' +
        'nothing, which is an input problem (wrong tree), not a covered schema.',
    )
    return
  }
  if (migrationFiles.length === 0) {
    out.fail(
      'no migration files found under src/lib/platform/db/migrations — this run cleared ' +
        'nothing, which is an input problem (wrong tree), not an unaudited schema.',
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
        'audited set.',
    )
    return
  }

  const attached = attachedTriggers(migrationFiles.map(({ text }) => text))
  const { tableAllowlist, columnExclusions } = loadAllowlist()

  out.info(
    `${tables.length} core table(s) in ${schemaFiles.length} schema file(s); ` +
      `${attached.size} attached by ${migrationFiles.length} migration(s); ` +
      `${Object.keys(tableAllowlist).length} allowlisted table(s), ` +
      `${Object.keys(columnExclusions).length} excluded column(s)`,
  )

  const { findings } = evaluateCoverage({ tables, attached, tableAllowlist, columnExclusions })

  if (findings.length === 0) {
    out.ok(
      'every `core` table is audited or allowlisted with a rationale, and every column of an ' +
        'audited table is whitelisted or excluded with one (EARS-19, EARS-22, EARS-29).',
    )
  }

  for (const f of findings) out.finding(`${f.kind}  ${f.subject}  ->  ${f.detail}`)
  out.fail(
    `${findings.length} coverage finding(s). Coverage is by construction (spec 201 EARS-22): a ` +
      '`core` table carries `core.audit_row_change()` unless an entry in ' +
      `${ALLOWLIST_REL} says in writing why it does not, and every column of an audited table is ` +
      "named either in that trigger's whitelist arguments or in the excluded-columns list.",
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
