#!/usr/bin/env node
// tdd-order — a new platform module whose test did not land in an earlier commit.
//
// Canon: docs/ci-guardrails.md §5. Severity: BLOCK from day 0 under the §3
// class-1 mandate, recorded in that row. The input is the PR's own commit
// graph — which commit introduced which file, and which commit's patch first
// cites the module — and a commit graph is a fact, not a heuristic. There is no
// false-positive class for a WARN soak to discover, which is the same reasoning
// that put `guard-test-coverage` and `design-fidelity` at BLOCK on day 0.
//
// ── The incident this guard exists for (#355) ────────────────────────────────
// PR #354 shipped ONE commit carrying its tests and its implementation together.
// The implementer's own record on that PR confirms the implementation was
// written FIRST and the specs after, with no RED run per spec file. The
// `tdd-signal` job (now `test-presence`) was green the whole time — correctly,
// by its own rule: a test was present. Presence was never the question
// task-cycle stage 3 asks. ORDER is, and until this guard nothing read it.
//
// ── The rule (exact) ─────────────────────────────────────────────────────────
// For every NEW production file the PR introduces under the platform-module
// paths (`src/lib/**`, `src/app/(platform)/p/**`):
//
//   PASS    if some EARLIER commit of this PR introduces a test citing it
//   FINDING if the citing commit is the SAME commit (`same-commit`)
//   FINDING if the citing commit is a LATER one   (`impl-first`)
//   SILENT  if NO commit of this PR cites it at all
//
// The last line is deliberate and is not a hole: "no test anywhere" is
// `test-presence`'s finding, and reporting it twice would make one violation
// look like two and put the same PR in front of two guards with two different
// fixes. Each guard owns one question.
//
// NEW means git said `added` on the EARLIEST commit that touched the path. A
// `renamed` status is therefore not new — moving a tracked module does not
// re-open its TDD obligation — and neither is `modified`.
//
// ── Known blind spots, named rather than discovered ──────────────────────────
//   * MODIFIED-ONLY files are out of scope in v1. Adding a function to an
//     existing module is a real TDD obligation and this guard does not see it;
//     catching it means diffing exported symbols, which is a different guard
//     with a real false-positive class. Named here so nobody reads a green
//     `tdd-order` as "TDD happened" — the exact misreading the #355 rename of
//     `test-presence` was about.
//   * TOOLING is out of scope: `tools/**` is production code by
//     `test-presence`'s reckoning but not a platform module, so a guard like
//     this one is not itself subject to the ordering rule. That is a scope
//     decision, not an exemption anybody may invoke.
//   * A test that cites the module only in a LATER commit's patch, having been
//     added earlier without the citation, dates from the citing commit. The
//     needle has to appear in an ADDED patch line, so a pre-existing test file
//     that gains the import later is ordered by the import, not by the file.
//   * `needlesFor` is substring matching (the DEBT.md entry `test-presence`
//     carries), narrowed here by only reading ADDED patch lines.
//
// PR-event-gated: the commit sequence comes from the REST API through `gh`,
// because the Actions checkout is shallow and carries no base ref to walk. On a
// push to `main` there is no PR and the guard exits 0 — the same reasoning as
// `test-presence` (canon §4: greenness on push runs is vacuous).
//
// Run: `pnpm lint:tdd-order`. Findings: stderr + exit 1. Clean/skip: exit 0.

import { ghCommit, ghPrCommits } from './lib/gh.mjs'
import {
  isEntryPoint,
  isFixturePath,
  isPrEvent,
  reporter,
  repoRoot,
  resolvePrNumber,
  runMain,
  toPosix,
} from './lib/guard.mjs'
import { isTestSource, needlesFor, PROD_EXEMPT_RE } from './test-presence-lint.mjs'

const TAG = 'tdd-order'

/**
 * The platform-module paths task-cycle stage 3 makes TDD a hard rule for. Not
 * every production path: `src/collections/**` is Payload's CMS contract and
 * `tools/**` is tooling, both out of scope by the header's scope decision.
 */
const PLATFORM_MODULE_RE = /^(?:src\/lib\/|src\/app\/\(platform\)\/p\/)/
/** Only real sources carry a TDD obligation. */
const SOURCE_EXT_RE = /\.(?:ts|tsx|mjs)$/

/**
 * True for a path this guard's NEW-file rule applies to: inside the platform
 * modules, a real source, and neither a test nor a fixture nor an exempt file
 * (generated types, migrations, declarations, configs — `PROD_EXEMPT_RE`, owned
 * by `test-presence-lint.mjs` so the two guards cannot drift apart on what
 * counts as code).
 *
 * @param {string} rel
 * @returns {boolean}
 */
export function isPlatformModule(rel) {
  const p = toPosix(rel)
  return (
    PLATFORM_MODULE_RE.test(p) &&
    SOURCE_EXT_RE.test(p) &&
    !isFixturePath(p) &&
    !isTestSource(p) &&
    !PROD_EXEMPT_RE.test(p)
  )
}

/**
 * The ADDED lines of a unified diff, with the leading `+` stripped. The `+++`
 * file header is dropped — it names the file, and reading it as content would
 * make every test file cite itself.
 *
 * @param {string|undefined|null} patch
 * @returns {string[]}
 */
export function addedLines(patch) {
  return String(patch ?? '')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
}

/**
 * The GitHub commit shape (`files[].filename`) mapped onto the guard's shape
 * (`files[].path`), so the decision seam never sees an API field name.
 *
 * @param {{sha?: string, files?: {filename?: string, status?: string, patch?: string}[]}} commit
 */
export function normaliseCommit(commit) {
  return {
    sha: commit?.sha,
    files: (commit?.files ?? []).map((f) => ({
      path: toPosix(f.filename ?? ''),
      status: f.status,
      patch: f.patch,
    })),
  }
}

/**
 * The pure decision seam. No IO.
 *
 * @param {{sha: string, files: {path: string, status: string, patch?: string}[]}[]} commits
 *   the PR's commits, OLDEST FIRST — the order is the whole rule.
 * @returns {{path: string, implIndex: number, implSha: string, testIndex: number,
 *            testSha: string, kind: 'same-commit'|'impl-first'}[]}
 */
export function findOrderViolations(commits) {
  // The EARLIEST commit that touched each path, and what git called it there.
  // Newness is judged on that first touch: a file `added` in commit 1 and
  // `modified` in commit 2 is one new module, and a `renamed` first touch is
  // not a new module at all.
  const firstTouch = new Map()
  for (const [index, commit] of commits.entries()) {
    for (const file of commit.files ?? []) {
      if (!firstTouch.has(file.path)) {
        firstTouch.set(file.path, { index, sha: commit.sha, status: file.status })
      }
    }
  }

  const violations = []
  for (const [path, touch] of firstTouch) {
    if (touch.status !== 'added' || !isPlatformModule(path)) continue

    const needles = needlesFor(path)
    const citing = commits.findIndex((commit) =>
      (commit.files ?? []).some(
        (file) =>
          isTestSource(file.path) &&
          addedLines(file.patch).some((line) => needles.some((n) => line.includes(n))),
      ),
    )
    // No commit of this PR cites the module: `test-presence`'s question, not
    // this guard's. Silent on purpose — see the header.
    if (citing === -1) continue
    if (citing < touch.index) continue

    violations.push({
      path,
      implIndex: touch.index,
      implSha: touch.sha,
      testIndex: citing,
      testSha: commits[citing].sha,
      kind: citing === touch.index ? 'same-commit' : 'impl-first',
    })
  }
  return violations
}

/** A short sha for a human-readable finding line. */
const short = (sha) => String(sha ?? '').slice(0, 8)

async function main() {
  const out = reporter(TAG)
  if (!isPrEvent()) {
    out.ok(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? 'unset'}), nothing to check`,
    )
  }
  const prNumber = resolvePrNumber()
  if (!prNumber) out.ok('cannot resolve a PR number from the environment, nothing to check')

  const root = repoRoot()
  const listed = ghPrCommits(prNumber, root)
  if (!listed.ok) out.fail(`could not fetch the commits of PR #${prNumber}: ${listed.error}`)

  if (listed.data.length === 0) {
    out.ok(`PR #${prNumber} lists no commits, nothing to check`)
  }

  // Fail closed on a commit that cannot be read: a partial sequence would make
  // an impl-first PR look test-first by simply losing the commit that proves it.
  const commits = []
  for (const entry of listed.data) {
    const detail = ghCommit(entry.sha, root)
    if (!detail.ok) {
      out.fail(`could not fetch commit ${short(entry.sha)} of PR #${prNumber}: ${detail.error}`)
    }
    commits.push(normaliseCommit({ sha: entry.sha, ...detail.data }))
  }

  const violations = findOrderViolations(commits)
  out.info(`PR #${prNumber}: ${commits.length} commit(s) read in order`)

  if (violations.length === 0) {
    out.ok(
      'PASS — every new platform module in this PR was preceded by the commit introducing its test.',
    )
  }

  for (const v of violations) {
    out.finding(
      v.kind === 'same-commit'
        ? `same commit    ${v.path}  introduced together with its test in ${short(v.implSha)}  ->  the test needed its own EARLIER commit`
        : `implementation first  ${v.path}  introduced in ${short(v.implSha)}, first cited by a test in ${short(v.testSha)}`,
    )
  }
  out.fail(
    `${violations.length} new platform module(s) whose test did not land in an earlier commit. ` +
      'task-cycle stage 3: no production module code without a FAILING TEST FIRST — which means ' +
      'a tests-only commit whose RED run is real, then the implementation on top of it. Rewrite ' +
      'the branch so the test commit precedes the implementation commit (an interactive rebase ' +
      'splitting the offending commit is the usual fix). Canon: docs/ci-guardrails.md §5.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
