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
 * **Today: spec 201's EARS-23, plus spec 311's whole clause set.** The first
 * list stayed short because the guard's id namespace is FLAT: spec 124 declares
 * EARS-1..22 and EARS-25..32 and its own tests cite every one of those ids, so
 * the guard reads spec 201's clauses sharing them as covered and a deferral for
 * them would be reported stale. EARS-23, EARS-24 and EARS-33 are the only ids
 * spec 124 skips (it stops at EARS-32), which is why they were the whole list
 * while spec 201 was `Draft`. #273 landed EARS-24 and EARS-33 with real tests
 * (`tests/int/platform/audit-*.int.spec.ts`), so they left the list; EARS-23 —
 * the read path, «SQL run by an agent» — has no automated counterpart until a
 * surface over the ledger exists.
 * That conflation is recorded as decision debt in `DEBT.md`; the entries here
 * are only the ids the guard genuinely reports uncovered.
 *
 * **The 2026-08-25 round is a new state for this repo and is why the list is no
 * longer short.** `docs/specs/311-portal-workspace.md` (epic #112, the portal
 * workspace frame) was approved by the owner BEFORE its first line of code —
 * a spec that leads its implementation rather than following it — and it is
 * decomposed into six issues that each build one slice of it. Its 70 live
 * clauses are numbered EARS-401..478 precisely so the flat keyspace above does
 * NOT swallow them (they would otherwise read as covered by spec 124's and
 * spec 201's tests), which means they are all genuinely uncovered on the day
 * the spec lands. Every one of them is keyed below to the OPEN issue that
 * implements it, taken from that spec's own «Follow-up tasks» and
 * «Frame-level work that must be budgeted inside those issues» tables. The
 * ratchet works as designed: each issue's PR writes the tests, the stale check
 * then fails until that issue's ids are dropped from this list, and the list
 * shrinks back to short as epic #112 lands.
 *
 * The previous round was spec 124's
 * **EARS-15** — «archive the JSON and delete its code path» — which could not be
 * tested before it happened: its trigger was the owner accepting a live stand.
 * The stand was accepted on 2026-08-18, PR-2 of #256 deleted
 * `src/lib/hours/store.ts`, `HOURS_DATA_FILE` and the import command, and
 * `tests/unit/hours-json-store-removed.spec.ts` asserts the absence. The shape
 * below is kept (keyed by OWNING ISSUE, ids inside) because that is how the two
 * previous rounds of this list were written and how the next one should be.
 *
 * @type {Record<number, {ids: string[], reason: string}>}
 */
const DEFERRALS_BY_ISSUE = {
  339: {
    ids: [
      'EARS-508',
      'EARS-509',
      'EARS-510',
      'EARS-511',
      'EARS-512',
      'EARS-517',
      'EARS-518',
      'EARS-519',
      'EARS-520',
      'EARS-521',
      'EARS-531',
    ],
    reason:
      'spec 339 (docs/specs/339-ledger-intake.md, finance F2 — filling the ledger) is the same shape as spec 311 above: owner-approved and `In dev` BEFORE its first line of code, numbered EARS-501… precisely so the flat keyspace does not swallow it, so every clause is genuinely uncovered on the day the spec lands. #339 is the parent issue; as its sub-tasks land their TDD slices these ids drain from this entry and the stale check fails until they are dropped — #380 drained the first four (EARS-501/502/529/530: the two flow roles, the submitter carve-out and the narrowing of spec 338 EARS-330). #381 drained the spine four (EARS-503/504/524/525: the source_ref semantics, the duplicate refusal that answers with the existing item, the status machine and producer isolation) — the finance_intake_item table, src/lib/finance/intake/ and tests/unit/finance-intake-spine.spec.ts + tests/int/platform/finance-intake.int.spec.ts. #382 drained the document four (EARS-514/515/516/523: private storage with the dev disk fallback, the kind as data rather than a gate, immutability once a linked item has posted, and the authorized read that is the only address document content has) — the finance_document / finance_document_link tables, src/lib/finance/documents/, the two handlers under src/app/(platform)/p/finance/api/documents/ and tests/unit/finance-documents.spec.ts + tests/int/platform/finance-documents.int.spec.ts + tests/e2e/finance-documents.e2e.spec.ts. #383 drained EARS-526/532: the audited counterparty reference, the request-bound purpose proposal and its admin resolution/dismissal path — src/lib/finance/counterparties.ts + src/lib/finance/purpose-proposals.ts + tests/int/platform/finance-references.int.spec.ts. The list has no entry for the one number spec 339 retired before the go: that clause is a process note under its §G and the spec deliberately does not write it as an id token, so the guard never counts it as declared and a deferral for it would sit here forever',
  },
  357: {
    ids: ['EARS-324', 'EARS-325', 'EARS-326'],
    reason:
      'spec 338 §C, the SURFACE half: the workspace declaration, /p/finance and the /p/admin/finance/* resources. #356 landed everything else in that spec — §A, §B, EARS-323 and EARS-330…334 — and drained them from this entry as their tests appeared under tests/unit/finance-*.spec.ts and tests/int/platform/finance-*.int.spec.ts. These three have no code to assert on until the surfaces exist: the write gate they describe is already enforced and tested in the module (EARS-330), what is missing is the route that renders and refuses. #357 is blocked by #356 and by the portal-workspace frame (#314, #315)',
  },
  201: {
    ids: ['EARS-23'],
    reason:
      'spec 201 EARS-23 is the READ path — «SQL run by an agent, result pasted into the issue» — which has no automated counterpart by construction: there is no route, no UI and no code to assert on until a surface over the ledger exists. EARS-24 and EARS-33 left this list when #273 landed their tests under tests/int/platform/audit-*.int.spec.ts',
  },
  333: {
    ids: ['EARS-459'],
    reason:
      'spec 311 §B, the REVOCATION half: «when a role is revoked, the next request lands in EARS-418». #313 landed the rest of §B and stopped here on purpose — the roles are read once, at sign-in, and then ride the Auth.js JWT session cookie, so a revoke in Zitadel is invisible until that session ends. The grant direction (EARS-460) is satisfied as written; «next request» is not something a claim carried in a cookie can promise, and picking a staleness window nobody chose would put a number into the security boundary. #333 decides the mechanism or amends the clause',
  },
  315: {
    ids: [],
    reason:
      "spec 311 §D (the /p/admin Refine shell, its navigation, breadcrumbs, save answers and attribution) and §G (the OKR cabinet section and the one read-only accessor it needs), which the spec's Follow-up tasks both assign to #315. The list is EMPTY because #315 landed: §D and §G are asserted in tests/unit/cabinet-shell.spec.ts, cabinet-data-provider.spec.ts, okr-cabinet-section.spec.ts and platform-module-api.spec.ts, and EARS-463..465 (the /api/p/* host-allowlist change and its Host-matrix rows) in platform-host-allowlist.spec.ts. One id did NOT stay here and did not become covered either: EARS-439, cabinet WRITE attribution, moved to the #316 entry — #315 opens no write at all (the OKR section is read-only by EARS-455), so a test for it here could only re-read a type, which is the green light for a surface nobody built that EARS-409/EARS-410 were moved OUT of #314 to avoid",
  },
  316: {
    ids: [],
    reason:
      'spec 311 §E — the members resource, its aliases, the read-only email and deactivation-instead-of-delete. The list is EMPTY because #316 landed: EARS-439 and EARS-441…445 are asserted by the member contract, handler, UI and core.audit_event integration tests.',
  },
  317: {
    ids: ['EARS-451'],
    reason:
      "spec 311 §F — moving the hours administration into the cabinet and retiring /p/hours/admin. EARS-421 (HOURS_ADMIN_EMAILS gone from the shipped code) sits here rather than in §B because the spec's «Frame-level work» table gives #317 the rewrite-or-retire of the five unit specs that assert the old env gate",
  },
}

export const BUILTIN_DEFERRALS = Object.fromEntries(
  Object.entries(DEFERRALS_BY_ISSUE).flatMap(([issue, { ids, reason }]) =>
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
