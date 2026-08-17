#!/usr/bin/env node
// ears-test — the COVERAGE half of the EARS↔test contract (#157, guard tranche 2).
//
// Canon: docs/specs/README.md ("EARS — ADOPTED", 2026-08-05: the clause is the
// unit of testing, the test covering `EARS-3` is named `it('EARS-3: …')`) and
// docs/ci-guardrails.md §8 (the guard contract). Companion:
// `ears-naming-lint.mjs` owns the FORMAT direction (a malformed id).
//
// Traceability is BIDIRECTIONAL, and this guard owns both coverage directions:
//   FORWARD — a clause declared in a spec that no test title references.
//   ORPHAN  — a test title citing a clause no spec declares (a dangling id, the
//             failure the canon's "never renumbered" rule exists to prevent).
// Only requirement-level tests carry an id; a plain unit test is never flagged.
//
// ── Two adaptations of the ds-platform original ──────────────────────────────
// 1. IDS COME FROM THE `## Requirements` SECTION, not from the whole document.
//    ds scans the whole spec because its specs are single-purpose
//    `NNN-requirements.md` files. Ours are multi-section (docs/specs/README.md
//    template: Why / Prior decisions / Requirements / Acceptance scenarios /
//    Out of scope) and the acceptance scenarios NAME the clauses they exercise —
//    a whole-doc scan would read those pointers as second declarations. The
//    template's own example lives in docs/specs/README.md, which is an index and
//    is excluded by `SPEC_FILE_RE`.
// 2. ds's SPEC-SCOPED deferral machinery is dropped, not ported dead. It keys a
//    deferral to a feature by reading a `NNN EARS-…` prefix off test titles; this
//    repo's canon is a bare `it('EARS-3: …')`, so that scope can never be
//    resolved here and every code path would degenerate to "compatible". The
//    deferral allowlist itself stays, with flat keys.
//
// ── Id keyspace (inherited from ds, deliberately) ────────────────────────────
// EARS numbering is flat PER SPEC, so `EARS-1` is only unique within its file,
// and the guard resolves coverage in a single GLOBAL keyspace: an `EARS-1` test
// satisfies `EARS-1` wherever it is declared. That is the canon's own contract —
// the test name it prescribes carries no spec scope — and the looser direction
// is the safe one: it can only fail to flag, never flag falsely. Tightening it
// means changing the naming canon first, not the guard.
//
// ── Fold-matching ────────────────────────────────────────────────────────────
// A flat `EARS-N` and its nested children `EARS-N.M` describe the same
// requirement at different granularities, so ids match by component-wise dotted
// PREFIX ancestry rather than string equality: `EARS-18` ↔ `EARS-18.1` match,
// `EARS-3.1` ↔ `EARS-3.2` (siblings) do NOT — folding siblings together would
// hide a real gap — and `EARS-1` never folds into `EARS-18`.
//
// ── Two empty states, only one of them clean ─────────────────────────────────
// Zero CLAUSES across a real spec corpus exits 0 with an explicit note: it is
// not the "check that never ran" class, because docs/specs/README.md adopts EARS
// with "No mass rewrite pass. Existing specs are upgraded ON TOUCH", so an
// un-upgraded corpus is the DOCUMENTED state of the migration. The orphan
// direction still runs in it — a test citing `EARS-7` with no spec anywhere is a
// finding whether or not any spec has clauses.
// Zero spec FILES is the opposite: `docs/specs/` is a committed directory, so
// scanning none of it means the guard was pointed at the wrong tree and cleared
// nothing. That exits 1 (canon §8 gives a CI guard only 0 and 1 — the §2.3
// "exit 2, not a verdict" code belongs to the CLI plane, which is why
// instruction-budget can use it for the same class of input problem and this
// guard cannot).
//
// SEVERITY: WARN — docs/ci-guardrails.md §5, job in `.github/workflows/ci.yml`
// with `continue-on-error: true`; the script exits 1 on a finding (canon §4
// clause 1). Promotion per §4, earliest 2026-09-02.
//
// Run: `pnpm lint:ears-test`. Findings: stderr + exit 1. Clean: stdout + exit 0.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isEntryPoint,
  isFixturePath,
  reporter,
  repoRoot,
  runMain,
  walkFiles,
} from './lib/guard.mjs'

const TAG = 'ears-test'

/**
 * The two spec trees of this repo. `README.md` is excluded by name in both: an
 * index carrying the TEMPLATE's example clauses is not a declaration.
 */
export const SPEC_FILE_RE = /^docs\/(?:specs|superpowers\/specs)\/(?!README\.md$)[^/]+\.md$/

/** Same file set `ears-naming` scans — see that guard's header for why. */
export const TEST_FILE_RE = /^(?:tests|src)\/.*\.(?:spec|test)\.(?:ts|tsx)$/

/** A flat or arbitrarily nested id, as it appears in a spec clause. */
const EARS_ID_RE = /\bEARS-\d+(?:\.\d+)*\b/g
/** In a TITLE an id may also be compound (`EARS-3/4`); the whole token is captured. */
const EARS_TOKEN_RE = /\bEARS-\d+(?:[./]\d+)*\b/g
/** An `it(` / `test(` / `describe(` title — the first string-literal argument. */
const TITLE_RE = /\b(?:it|test|describe)\s*\(\s*(['"`])([\s\S]*?)\1/g

/**
 * Clauses whose real test genuinely cannot be written yet, each tracked by an
 * OPEN issue: reported as a note instead of a finding, so `main` runs clean while
 * the obligation stays visible. Keep it SHORT; the stale check below makes it a
 * ratchet that only tightens. Seam: `LINT_EARS_DEFERRALS` (JSON) replaces it.
 *
 * @type {Record<string, {issue: number, reason: string}>}
 */
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `EARS-${from + i}`)

/** Spec 124 (/p/hours on core), accepted 2026-08-17: clauses per owning implementation issue. */
const HOURS_ON_CORE_DEFERRALS = {
  255: {
    /**
     * All that is left of #255's deferral is **EARS-7**, the umbrella parity
     * clause, whose named test is an E2E smoke on a live stand — it lands with
     * the acceptance run, not with the implementation.
     *
     * Everything else #255 owns is now covered by a titled test, and the ids are
     * struck off here as they land, because the ratchet only tightens: a
     * deferral that has become covered is reported as STALE. What covers what —
     * EARS-2/8/17..19 with the member module (`tests/int/platform/member.int.spec.ts`,
     * the dependency-cruiser fixtures in `tests/unit/platform-boundaries.spec.ts`);
     * EARS-1/3..6/9..12/20..22/28..31 with the hours tables and the core-backed
     * store (`tests/int/platform/hours-core*.int.spec.ts`,
     * `tests/unit/hours-core-refusals.spec.ts`); EARS-32 in
     * `tests/unit/hours-actions.spec.ts`.
     */
    ids: ['EARS-7'],
    reason:
      'spec 124 EARS-7 is the umbrella parity clause — its named E2E smoke runs on the live acceptance stand',
  },
  256: {
    ids: [...range(13, 16), ...range(25, 27)],
    reason: 'spec 124 production cutover tooling and runbook — tests land with the cutover task',
  },
}

export const BUILTIN_DEFERRALS = Object.fromEntries(
  Object.entries(HOURS_ON_CORE_DEFERRALS).flatMap(([issue, { ids, reason }]) =>
    ids.map((id) => [id, { issue: Number(issue), reason }]),
  ),
)

/**
 * The `## Requirements` section of a spec, or '' when it declares none.
 * Terminated by the next `##`-or-higher heading, so a `###` sub-heading inside
 * Requirements stays in.
 *
 * @param {string} text
 * @returns {string}
 */
export function requirementsSection(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s+Requirements\s*$/i.test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^#{1,2}\s+\S/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * The clause ids a spec DECLARES — its `## Requirements` section only.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function specEarsIds(text) {
  const section = requirementsSection(text)
  return [...new Set([...section.matchAll(EARS_ID_RE)].map((m) => m[0]))]
}

/** Expand a title token into its component ids (`EARS-3/4` → `EARS-3`, `EARS-4`). */
function expandToken(token) {
  return token
    .slice('EARS-'.length)
    .split('/')
    .map((part) => `EARS-${part}`)
}

/**
 * The clause ids a test file CITES — from `it`/`test`/`describe` titles only, so
 * a fixture datum or an assertion string is never mistaken for a reference.
 *
 * @param {string} src
 * @returns {string[]}
 */
export function titleEarsIds(src) {
  const ids = new Set()
  for (const title of String(src ?? '').matchAll(TITLE_RE)) {
    for (const tok of title[2].matchAll(EARS_TOKEN_RE)) {
      for (const id of expandToken(tok[0])) ids.add(id)
    }
  }
  return [...ids]
}

/** Numeric dotted components of an id: `EARS-18.1` → [18, 1]. */
function components(id) {
  return String(id)
    .slice('EARS-'.length)
    .split('.')
    .map((n) => Number.parseInt(n, 10))
}

/** True iff `a` is a component-wise prefix of `b` (equal length counts). */
function isPrefix(a, b) {
  return a.length <= b.length && a.every((v, i) => v === b[i])
}

/**
 * Two ids trace to the same requirement iff one is a dotted-prefix ancestor of
 * the other. Component-wise, so `EARS-1` (=[1]) never matches `EARS-18` (=[18]).
 *
 * @param {string} idA
 * @param {string} idB
 * @returns {boolean}
 */
export function matches(idA, idB) {
  const a = components(idA)
  const b = components(idB)
  return isPrefix(a, b) || isPrefix(b, a)
}

/**
 * The pure decision seam. No IO.
 *
 * @param {{specIds: Map<string,string[]>, testIds: Map<string,string[]>,
 *          deferrals?: Record<string,{issue:number,reason:string}>}} input
 * @returns {{findings: number, empty: boolean,
 *           uncovered: {id: string, specs: string[]}[],
 *           orphans: {id: string, tests: string[]}[],
 *           stale: {id: string, issue: number}[],
 *           deferred: {id: string, issue: number, reason: string}[]}}
 */
export function evaluateTraceability({ specIds, testIds, deferrals = {} }) {
  const specList = [...specIds.keys()]
  const testList = [...testIds.keys()]
  const isCovered = (id) => testList.some((t) => matches(id, t))
  const isDeclared = (id) => specList.some((s) => matches(id, s))

  const uncovered = []
  const deferred = []
  for (const [id, specs] of specIds) {
    const deferral = deferrals[id]
    if (deferral) {
      if (!isCovered(id)) deferred.push({ id, ...deferral })
      continue // a covered deferral is reported by the stale loop, not here
    }
    if (!isCovered(id)) uncovered.push({ id, specs })
  }

  const stale = []
  for (const [id, deferral] of Object.entries(deferrals)) {
    if (isCovered(id)) stale.push({ id, issue: deferral.issue })
  }

  const orphans = []
  for (const [id, tests] of testIds) {
    if (!isDeclared(id)) orphans.push({ id, tests })
  }

  return {
    findings: uncovered.length + stale.length + orphans.length,
    empty: specList.length === 0 && testList.length === 0,
    uncovered,
    orphans,
    stale,
    deferred,
  }
}

function loadDeferrals(out) {
  const raw = process.env.LINT_EARS_DEFERRALS
  if (!raw) return process.env.LINT_FIXTURE_ROOT ? {} : BUILTIN_DEFERRALS
  try {
    return JSON.parse(raw)
  } catch (e) {
    out.info(`ignoring malformed LINT_EARS_DEFERRALS: ${String(e?.message ?? e).split('\n')[0]}`)
    return BUILTIN_DEFERRALS
  }
}

/** Read every matching file under `root` into an id map: id -> [files]. */
function collect(root, fileRe, extract) {
  const index = new Map()
  const files = walkFiles(root, { include: (rel) => fileRe.test(rel) && !isFixturePath(rel) })
  for (const rel of files) {
    let text
    try {
      text = readFileSync(resolve(root, rel), 'utf8')
    } catch {
      continue // an unreadable file declares nothing; it is not a traceability finding
    }
    for (const id of extract(text)) {
      index.set(id, [...(index.get(id) ?? []), rel])
    }
  }
  return { index, scanned: files.length }
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()

  const specs = collect(root, SPEC_FILE_RE, specEarsIds)
  const tests = collect(root, TEST_FILE_RE, titleEarsIds)

  // Zero CLAUSES and zero spec FILES are different states, and only the first is
  // legitimate (review of PR #160, MINOR). `docs/specs/` is a committed
  // directory: scanning zero files means the wrong tree, so the guard cleared
  // nothing and must not print the reassuring on-touch message. Canon §8 gives a
  // CI guard only exit 0 and exit 1, so fail-closed here is exit 1 — the same
  // reasoning as instruction-budget's empty-corpus decision, adjusted for a
  // plane that has no exit 2.
  if (specs.scanned === 0) {
    out.fail(
      'no spec files found under docs/specs or docs/superpowers/specs. This run cleared ' +
        'nothing — an input problem (wrong tree), not an un-upgraded corpus. A corpus that ' +
        'HAS specs but no EARS clauses yet is the documented on-touch state and exits 0.',
    )
    return
  }

  out.info(
    `${specs.scanned} spec file(s) -> ${specs.index.size} clause id(s); ` +
      `${tests.scanned} test file(s) -> ${tests.index.size} referenced id(s)`,
  )

  const verdict = evaluateTraceability({
    specIds: specs.index,
    testIds: tests.index,
    deferrals: loadDeferrals(out),
  })

  for (const d of verdict.deferred) {
    out.info(`deferred: ${d.id} uncovered — tracked in #${d.issue} (${d.reason})`)
  }

  if (verdict.findings === 0) {
    out.ok(
      verdict.empty
        ? 'no EARS clauses declared and none referenced — EARS is adopted on touch ' +
            '(docs/specs/README.md), so an un-upgraded corpus is the expected state, not a gap.'
        : `every declared clause has a test and no test cites an undeclared clause ` +
            `(${specs.index.size} clause id(s)).`,
    )
  }

  for (const u of verdict.uncovered) {
    out.finding(`uncovered  ${u.id}  declared in ${u.specs.join(', ')}  ->  no test title cites it`)
  }
  for (const o of verdict.orphans) {
    out.finding(`orphan     ${o.id}  cited in ${o.tests.join(', ')}  ->  no spec declares it`)
  }
  for (const s of verdict.stale) {
    out.finding(`stale defer ${s.id}  is now covered  ->  drop it from the allowlist (#${s.issue})`)
  }
  out.fail(
    `${verdict.findings} traceability finding(s): ${verdict.uncovered.length} uncovered clause(s), ` +
      `${verdict.orphans.length} orphan reference(s), ${verdict.stale.length} stale deferral(s). ` +
      "Name the clause in the test title (`it('EARS-N: …')`) or declare it in the spec's " +
      '`## Requirements` — docs/specs/README.md, "EARS — ADOPTED".',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
