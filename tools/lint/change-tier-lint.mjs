#!/usr/bin/env node
// change-tier — the PR body declares exactly one `Change-tier: Ship|Show|Ask`
// line, and the declared tier is not below the minimum the PR's changed-file
// set determines (#597).
//
// Canon: the rule is `.claude/rules/change-tiers.md`; the classifier is
// `tools/lint/lib/change-tier.mjs`; the guard's row is docs/ci-guardrails.md §5.
//
// SEVERITY: WARN since 2026-11-25. The script gives a REAL signal — a finding
// exits 1 (canon §4 clause 1: a guard that prints and exits 0 is a stub and is
// not promotable) — and the CI job carries `continue-on-error`, so the plane is
// WARN. Promotion to BLOCK is the second slice of #597, together with routing
// `pr:land` and `stage-b` by tier.
//
// Findings (exit 1): no `Change-tier:` line, more than one, a malformed value,
// a Ship/Show line with no reason, or a declared tier below the minimum.
// An unreadable PR also exits 1 — the guard never ran, which is not a pass.
//
// Run: `pnpm lint:change-tier <PR>` locally, or on a `pull_request` event with
// `PR_NUMBER` set (CI).

import { ghPrFiles, ghViewJson } from './lib/gh.mjs'
import { classifyChangeTier, meetsMinimum, parseDeclaration } from './lib/change-tier.mjs'
import {
  isEntryPoint,
  isPrEvent,
  reporter,
  repoRoot,
  resolvePrNumber,
  runMain,
} from './lib/guard.mjs'

const TAG = 'change-tier'

const PROBLEM_TEXT = {
  missing: 'no `Change-tier:` line in the PR body',
  duplicate: 'more than one `Change-tier:` line in the PR body',
  malformed: 'the `Change-tier:` value is not `Ship`, `Show` or `Ask`',
  'no-reason': 'a Ship/Show declaration must say why (`Change-tier: Show — <reason>`)',
}

/**
 * Pure decision seam: PR body + changed files in, the whole verdict out.
 *
 * @param {{ body: string, files: import('./lib/change-tier.mjs').ChangeTierFile[], changedFiles?: number }} pr
 */
export function verdict({ body, files, changedFiles }) {
  const declaration = parseDeclaration(body)
  const { minimum, reasons, testOnly } = classifyChangeTier(files, changedFiles)
  const problems = []
  if (declaration.problem) problems.push(PROBLEM_TEXT[declaration.problem])
  const declared = declaration.problem ? null : declaration.tier
  if (declared && !meetsMinimum(declared, minimum)) {
    problems.push(`declared ${declared} is below the minimum ${minimum} its changes require`)
  }
  return {
    ok: problems.length === 0,
    declared,
    minimum,
    reasons,
    testOnly: Boolean(testOnly),
    problems,
  }
}

async function main() {
  const out = reporter(TAG)
  const cliPr = process.argv.slice(2).find((a) => /^\d+$/.test(a))
  if (!cliPr && !isPrEvent()) {
    out.ok(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? 'unset'}) and no PR number given, nothing to check`,
    )
  }
  const prNumber = cliPr ?? resolvePrNumber()
  if (!prNumber) out.ok('cannot resolve a PR number from the environment, nothing to check')

  const root = repoRoot()
  const res = ghViewJson('pr', prNumber, 'number,body,changedFiles', root)
  if (!res.ok) out.fail(`could not fetch PR #${prNumber} metadata: ${res.error}`)
  const filesRes = ghPrFiles(prNumber, root)
  if (!filesRes.ok) out.fail(`could not fetch PR #${prNumber} files: ${filesRes.error}`)

  const changedFiles = typeof res.data.changedFiles === 'number' ? res.data.changedFiles : undefined
  const v = verdict({ body: res.data.body ?? '', files: filesRes.data, changedFiles })
  const summary = `minimum ${v.minimum}${v.testOnly ? ', test-only' : ''}`
  if (v.ok) out.ok(`PR #${prNumber} declares Change-tier ${v.declared} (${summary}).`)

  for (const p of v.problems) out.finding(`PR #${prNumber}: ${p}`)
  out.fail(
    `PR #${prNumber} — ${summary}, because:\n` +
      v.reasons.map((r) => `  - ${r}`).join('\n') +
      '\nDeclare exactly one `Change-tier: Ship|Show|Ask — <reason>` line at or above the minimum. ' +
      'Rule: .claude/rules/change-tiers.md.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
