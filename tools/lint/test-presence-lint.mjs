#!/usr/bin/env node
// test-presence — production code changed, no test anywhere near it.
//
// Canon: docs/ci-guardrails.md §5, which is the severity of record. WARN from
// 2026-08-05, promoted to BLOCK on 2026-09-02 (#438) under the §4 clauses. It soaked as a
// heuristic per §3; the 2026-08-27 rename (#355) changed no rule and so did not
// restart that clock — §4 clause 2 counts from the last change to WHAT a guard
// matches, and this guard matches exactly what it matched the day it landed. The
// job carries no `continue-on-error` and is in the `ci` meta-job needs-list.
//
// KNOWN LIMIT carried INTO the BLOCK plane: the changed set comes from the
// page-limited `gh pr view --json files` array (100 files), which canon §8 says a
// BLOCK guard must page first. It does not yet — DEBT.md line
// `2026-09-02-438-unpaged-files-array`. The failure mode is a false NEGATIVE on a
// >100-file PR (under-read, green), not a false denial.
//
// ── Why this guard is no longer called `tdd-signal` (#355) ───────────────────
// It was, until 2026-08-27, and the name was a lie of exactly the kind a guard
// is supposed to prevent. PR #354 shipped one commit carrying its tests and its
// implementation together; the implementer's own record confirms the
// implementation was written FIRST and the specs after, with no RED run per
// spec file. This guard was GREEN throughout — correctly, by its own rule,
// because a test was present. A reviewer reading a green `tdd-signal` check
// read it as an attestation that TDD had happened. It never checked that.
//
// PRESENCE is what this guard owns, and presence is all it claims. The ORDER
// half — a new module's test must land in a strictly earlier COMMIT than its
// implementation — is `tools/lint/tdd-order-lint.mjs`, which reads the PR's
// commit graph rather than its file set. Neither guard is the other's
// duplicate: a module with no test at all is this guard's finding and is
// deliberately silent in `tdd-order`.
//
// Why it exists: task-cycle stage 3 makes TDD a hard rule for platform-module
// code ("no production module code without a failing test first"). A rule stated
// in a skill is invisible at review time — this is the signal that makes it
// visible on the PR, for a human to judge.
//
// The rule (exact). For the PR's changed file set:
//   PASS  if any test file is in the diff, OR
//   PASS  per production file, if a test in the tree already imports it, OR
//   WARN  otherwise — production changed, and nothing tests it.
//
// The "already tested" escape is this repo's substitute for ds-platform's
// colocated-test glob: tests live centrally in `tests/**` (plus the guard specs
// in `tools/lint/guard-tests/**`), so coverage is established by finding the
// changed file's import path inside a test source — both the relative form
// (`../../src/lib/okr/rollup`) and the `@/` alias form (`@/lib/okr/rollup`).
//
// PR-event-gated: the changed set comes from `gh pr view <N> --json files`,
// because the Actions checkout is shallow and has no base ref to diff against.
// On a push to `main` there is no PR and the guard exits 0 — the TDD signal only
// means something at review time (canon §4: greenness on push runs is vacuous).
//
// Guard-test FIXTURES are excluded from the coverage scan (`isTestSource`): a
// fixture is a spec-shaped file describing a fake repo, and counting one as
// coverage let a genuinely untested module pass while the promotion clock ran on
// evidence this guard's own fixtures manufactured (review of PR #154).
//
// Known blind spots, accepted to keep the false-positive rate low: coverage
// DEPTH is not measured (any test importing the module counts); a new file added
// beside an already-imported one passes; a test living only in an unmerged
// sibling branch is invisible. And — the one the rename exists to stop hiding —
// WHEN the test was written relative to the code is not this guard's question.
//
// Run: `pnpm lint:test-presence`. Findings: stderr + exit 1. Clean/skip: exit 0.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ghViewJson } from './lib/gh.mjs'
import {
  isEntryPoint,
  isFixturePath,
  isPrEvent,
  reporter,
  repoRoot,
  resolvePrNumber,
  runMain,
  toPosix,
  walkFiles,
} from './lib/guard.mjs'

const TAG = 'test-presence'

const TEST_RE = /(^tests\/|^tools\/lint\/guard-tests\/|\.(spec|test)\.[tj]sx?$)/
const PROD_RE = /^(src|tools)\/.+\.(ts|tsx|mjs)$/
/**
 * Files that are production sources by path but carry no testable behaviour —
 * generated types, migrations, declaration files, configs. Exported because
 * `tdd-order-lint.mjs` scopes its NEW-file rule with the same list: one
 * definition of "not really code", not two that drift.
 */
export const PROD_EXEMPT_RE =
  /(\.d\.ts$|^src\/payload-types\.ts$|^src\/payload-generated-schema\.ts$|^src\/migrations\/|\.config\.[mc]?[jt]sx?$)/

/**
 * A real test source — and NOT a guard-test fixture. The exclusion is the whole
 * point: fixtures under `tools/lint/guard-tests/fixtures/` are spec-shaped files
 * describing a FAKE repo, so counting one as coverage made a genuinely untested
 * module pass and measured this guard's own promotion window on evidence its
 * fixtures manufactured (review of PR #154, blocker 2).
 */
export function isTestSource(rel) {
  const p = toPosix(rel)
  return !isFixturePath(p) && TEST_RE.test(p)
}

/**
 * Split a changed-file list into production sources and tests. A fixture is
 * neither: it is input under test, so changing one is not a production change
 * and does not discharge the TDD obligation either.
 */
export function classifyChanges(files) {
  const rels = files.map(toPosix).filter((p) => !isFixturePath(p))
  return {
    prod: rels.filter((p) => PROD_RE.test(p) && !TEST_RE.test(p) && !PROD_EXEMPT_RE.test(p)),
    tests: rels.filter((p) => TEST_RE.test(p)),
  }
}

/** Import-path needles a test would contain if it covered this file. */
export function needlesFor(rel) {
  const noExt = toPosix(rel).replace(/\.[^./]+$/, '')
  const needles = [noExt]
  if (noExt.startsWith('src/')) needles.push(noExt.slice('src/'.length))
  return needles
}

/**
 * Pure decision seam. `testSources` is `[{ path, text }]` of every test in the
 * tree; `diffHasTest` short-circuits the whole rule.
 */
export function findUntested(prodFiles, testSources, diffHasTest) {
  if (diffHasTest) return []
  return prodFiles.filter(
    (rel) => !needlesFor(rel).some((n) => testSources.some((t) => t.text.includes(n))),
  )
}

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
  const res = ghViewJson('pr', prNumber, 'number,files', root)
  if (!res.ok) out.fail(`could not fetch PR #${prNumber} metadata: ${res.error}`)

  const files = (res.data.files ?? []).map((f) => toPosix(f.path))
  const { prod, tests } = classifyChanges(files)

  if (prod.length === 0) {
    out.ok(`PR #${prNumber} changes no production source under src/ or tools/, rule does not apply`)
  }
  out.info(
    `PR #${prNumber} changes ${prod.length} production file(s); the diff ${tests.length ? 'INCLUDES' : 'includes NO'} test file(s)`,
  )
  if (tests.length > 0) out.ok('PASS — the changeset ships a test alongside the production change.')

  const testSources = walkFiles(root, { include: isTestSource }).map((rel) => ({
    path: rel,
    text: readFileSync(resolve(root, rel), 'utf8'),
  }))
  const untested = findUntested(prod, testSources, false)

  if (untested.length === 0) {
    out.ok('PASS — no test in the diff, but every changed file is already reached by a test.')
  }
  for (const rel of untested) {
    out.finding(
      `untested change  ${rel}  (no test in tests/** or tools/lint/guard-tests/** imports it)`,
    )
  }
  out.fail(
    `${untested.length} production file(s) changed with no test in the diff and no test in the tree. ` +
      'task-cycle stage 3: no production module code without a failing test first. This guard is ' +
      'BLOCK (canon: docs/ci-guardrails.md §5), so a finding cannot be left standing: add the test, ' +
      'or if the change is genuinely test-exempt (pure types, config, generated) widen the ' +
      'exemption list in this file with the reason in the PR.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
