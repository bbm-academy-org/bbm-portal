#!/usr/bin/env node
// guard-test-coverage — every guard has a test, mechanically (issue #136).
//
// Canon: docs/ci-guardrails.md §5. Severity: BLOCK from day 0 under the §3
// class-1 mandate (deterministic tree check — the only input is the checked-out
// tree, so there is no false-positive class to soak for). BLOCK means: no
// `continue-on-error` on its step, inside a batch job that IS in the `ci`
// meta-job needs-list (canon §2.1; the guards became steps of one job in #205).
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
//   * no guard EVADES that pairing by breaking the layout: any file under
//     `tools/lint/**` that imports `lib/guard.mjs` — i.e. is a guard by
//     behaviour — must sit directly in `tools/lint/` and be named
//     `<name>-lint.{mjs,ts}`. A guard in a subdirectory or without the suffix is
//     a finding in its own right (`nested` / `unsuffixed`).
// Extension-agnostic on the guard side (`.mjs` here, `.ts` if a port arrives) so
// the rule does not have to be re-edited to keep holding. Everything else in
// both dirs — `lib/`, the harness, fixtures, notes — is not a guard and is
// ignored.
//
// The third check exists because the first two were keyed on the naming
// convention alone: a guard evaded this BLOCK entirely by living one directory
// down, and `workflow-auth` derives its gh-consumer set with the same shape, so
// one misplaced file was invisible to BOTH meta-guards at once (review of PR
// #154). "Mechanical, not conventional" has to cover the convention itself.
//
// Run: `pnpm lint:guard-test-coverage`. Findings: stderr + exit 1. Clean: exit 0.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isEntryPoint,
  isFixturePath,
  reporter,
  repoRoot,
  runMain,
  walkFiles,
} from './lib/guard.mjs'

const TAG = 'guard-test-coverage'
const GUARD_RE = /^(.+-lint)\.(mjs|ts)$/
const SPEC_RE = /^(.+-lint)\.spec\.ts$/
// A file is a guard by BEHAVIOUR when it IMPORTS the shared guard plumbing. The
// match is anchored to an import statement, not to the bare path: a spec that
// merely names `tools/lint/lib/guard.mjs` inside its test data is describing a
// guard, not being one.
const IMPORTS_GUARD_LIB_RE =
  /^[ \t]*(?:import|export|const|let|var)[^\n]*['"][^'"]*lib\/guard\.mjs['"]/m
// Tests are never guards, whatever they import.
const SPEC_FILE_RE = /\.spec\.tsx?$/

/**
 * Pure decision seam: `[{ rel, text }]` for every source file under
 * `tools/lint/**`, the layout violations out. Fixtures are never reported —
 * they are input under test, and a fixture repo tree legitimately contains
 * guard-shaped files in odd places.
 * @param {{rel: string, text: string}[]} files
 * @returns {{path: string, reason: 'nested'|'unsuffixed'}[]}
 */
export function findStrays(files) {
  const out = []
  for (const { rel, text } of files) {
    if (isFixturePath(rel) || SPEC_FILE_RE.test(rel) || !IMPORTS_GUARD_LIB_RE.test(text)) continue
    const tail = rel.replace(/^tools\/lint\//, '')
    if (tail.includes('/')) out.push({ path: rel, reason: 'nested' })
    else if (!GUARD_RE.test(tail)) out.push({ path: rel, reason: 'unsuffixed' })
  }
  return out
}

/**
 * Pure decision seam: file NAMES in (not paths), pairing verdict out.
 * `guards` — direct entries of `tools/lint/`; `specs` — of `tools/lint/guard-tests/`;
 * `strays` — the layout violations from `findStrays`, passed through so the CLI
 * has one verdict object.
 *
 * @param {{ guards: string[], specs: string[], strays?: {path: string, reason: string}[] }} input
 */
export function checkCoverage({ guards, specs, strays = [] }) {
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
  return { missing, orphans, strays, paired: guardNames.size - missing.length }
}

async function main() {
  const out = reporter(TAG)
  const root = repoRoot()
  const lintDir = resolve(root, 'tools', 'lint')
  if (!existsSync(lintDir)) out.ok('no tools/lint directory in this tree, nothing to check')

  // Direct entries: the sanctioned home of a guard and of its spec.
  const topLevel = (dir) => walkFiles(dir, { include: (rel) => !rel.includes('/') })

  const guards = topLevel(lintDir)
  const specsDir = resolve(lintDir, 'guard-tests')
  const specs = existsSync(specsDir) ? topLevel(specsDir) : []

  // Recursive pass: a guard is anything under tools/lint/** that imports the
  // shared guard lib, wherever its author decided to put it.
  const sources = walkFiles(lintDir, { include: (rel) => /\.(mjs|ts|tsx)$/.test(rel) }).map(
    (rel) => ({ rel: `tools/lint/${rel}`, text: readFileSync(resolve(lintDir, rel), 'utf8') }),
  )

  const { missing, orphans, strays, paired } = checkCoverage({
    guards,
    specs,
    strays: findStrays(sources),
  })

  if (missing.length === 0 && orphans.length === 0 && strays.length === 0) {
    out.ok(
      `${paired} guard(s) in tools/lint, each paired with its spec in tools/lint/guard-tests; ` +
        `${sources.length} source file(s) scanned, none evading the layout.`,
    )
  }

  for (const m of missing) {
    out.finding(`untested guard  ${m.guard}  ->  expected spec ${m.spec}`)
  }
  for (const o of orphans) {
    out.finding(`orphaned spec   ${o}  ->  no matching tools/lint/<name>-lint.{mjs,ts}`)
  }
  for (const s of strays) {
    out.finding(
      s.reason === 'nested'
        ? `guard in a subdirectory  ${s.path}  ->  move it to tools/lint/<name>-lint.mjs (canon §8)`
        : `guard without the -lint suffix  ${s.path}  ->  rename to <name>-lint.mjs (canon §8)`,
    )
  }
  out.fail(
    `${missing.length} untested guard(s) + ${orphans.length} orphaned spec(s) + ` +
      `${strays.length} layout violation(s). ` +
      'A guard without a test reports green while proving nothing, and its promotion clock ' +
      '(docs/ci-guardrails.md §4) would run on evidence nobody produced. Add the spec next to ' +
      'the guard — harness: tools/lint/guard-tests/run-guard.ts, contract: canon §8.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
