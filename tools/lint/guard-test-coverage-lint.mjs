#!/usr/bin/env node
// guard-test-coverage — every guard has a test, mechanically (issue #136).
//
// Canon: docs/ci-guardrails.md §5. Severity: BLOCK from day 0 under the §3
// class-1 mandate (deterministic tree check — the only input is the checked-out
// tree, so there is no false-positive class to soak for). BLOCK means: no
// `continue-on-error` on the job, and the job IS in the `ci` meta-job needs-list.
//
// Why it exists: in ds-platform "a guard without a test does not get merged" is
// a convention, held up by review plus a hand-maintained coverage list in a
// README. Conventions of exactly that shape are what epic #117 exists to
// replace — an untested guard is worse than no guard, because it reports green
// while proving nothing, and its WARN->BLOCK promotion clock (canon §4) runs on
// evidence nobody ever produced.
//
// The rule (exact):
//   * every `tools/lint/<name>-lint.<ext>` has `tools/lint/guard-tests/<name>-lint.spec.ts`
//   * every `tools/lint/guard-tests/<name>-lint.spec.ts` has a guard to cover
// Extension-agnostic on the guard side (`.mjs` here, `.ts` if a port arrives) so
// the rule does not have to be re-edited to keep holding. Everything else in
// both dirs — `lib/`, the harness, fixtures, notes — is not a guard and is
// ignored: the pairing is keyed on the `-lint` suffix, which is the naming
// contract of §8.
//
// Run: `pnpm lint:guard-test-coverage`. Findings: stderr + exit 1. Clean: exit 0.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { isEntryPoint, reporter, repoRoot, runMain, walkFiles } from './lib/guard.mjs'

const TAG = 'guard-test-coverage'
const GUARD_RE = /^(.+-lint)\.(mjs|ts)$/
const SPEC_RE = /^(.+-lint)\.spec\.ts$/

/**
 * Pure decision seam: file NAMES in (not paths), pairing verdict out.
 * `guards` — direct entries of `tools/lint/`; `specs` — of `tools/lint/guard-tests/`.
 */
export function checkCoverage({ guards, specs }) {
  const specNames = new Set()
  const orphans = []
  for (const file of specs) {
    const m = SPEC_RE.exec(file)
    if (m) specNames.add(m[1])
  }
  const guardNames = new Set()
  const missing = []
  for (const file of guards) {
    const m = GUARD_RE.exec(file)
    if (!m) continue
    guardNames.add(m[1])
    if (!specNames.has(m[1])) {
      missing.push({
        guard: `tools/lint/${file}`,
        spec: `tools/lint/guard-tests/${m[1]}.spec.ts`,
      })
    }
  }
  for (const file of specs) {
    const m = SPEC_RE.exec(file)
    if (m && !guardNames.has(m[1])) orphans.push(`tools/lint/guard-tests/${file}`)
  }
  return { missing, orphans, paired: guardNames.size - missing.length }
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()
  const lintDir = resolve(root, 'tools', 'lint')
  if (!existsSync(lintDir)) out.ok('no tools/lint directory in this tree, nothing to check')

  // Direct entries only: a nested dir (lib/, guard-tests/) never holds a guard.
  const topLevel = (dir) =>
    walkFiles(dir, { include: (rel) => !rel.includes('/') }).map((rel) => rel)

  const guards = topLevel(lintDir)
  const specsDir = resolve(lintDir, 'guard-tests')
  const specs = existsSync(specsDir) ? topLevel(specsDir) : []

  const { missing, orphans, paired } = checkCoverage({ guards, specs })

  if (missing.length === 0 && orphans.length === 0) {
    out.ok(`${paired} guard(s) in tools/lint, each paired with its spec in tools/lint/guard-tests.`)
  }

  for (const m of missing) {
    out.finding(`untested guard  ${m.guard}  ->  expected spec ${m.spec}`)
  }
  for (const o of orphans) {
    out.finding(`orphaned spec   ${o}  ->  no matching tools/lint/<name>-lint.{mjs,ts}`)
  }
  out.fail(
    `${missing.length} untested guard(s) + ${orphans.length} orphaned spec(s). ` +
      'A guard without a test reports green while proving nothing, and its promotion clock ' +
      '(docs/ci-guardrails.md §4) would run on evidence nobody produced. Add the spec next to ' +
      'the guard — harness: tools/lint/guard-tests/run-guard.ts, contract: canon §8.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
