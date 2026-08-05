#!/usr/bin/env node
// assignee-milestone — an open PR carries ≥1 assignee AND a milestone.
//
// Canon: docs/ci-guardrails.md §5. Severity: WARN since 2026-08-05; earliest
// promotion 2026-09-02 under the §4 clauses.
//
// Why it exists: the board shows every open PR as a row, and a row with no
// assignee and no milestone is un-triageable at a glance — nobody can tell who
// owns it or which theme it belongs to. The issue side is already fail-closed
// (`pnpm issue:create` refuses a missing milestone — task-canon); this is the PR
// mirror, so a missing field surfaces at the author's keyboard instead of in a
// later board cleanup.
//
// Deviation from ds-platform, recorded in canon §7: there the script and its
// spec exist with no workflow job and no package script at all — an orphan that
// calls itself a hard gate and never runs. It is wired here, and it is WARN, not
// a day-0 BLOCK: canon §3 has no exception for "the fields are easy to set".
//
// The rule (exact): `gh pr view <N>` — assignees non-empty AND milestone
// non-null. Either missing is a finding naming the one-line fix. A PR that
// cannot be read is a finding too (fail-closed): an unreadable PR is not a
// cleared PR.
//
// Run: `pnpm lint:assignee-milestone`. Findings: stderr + exit 1. Clean: exit 0.

import { ghViewJson } from './lib/gh.mjs'
import {
  isEntryPoint,
  isPrEvent,
  reporter,
  repoRoot,
  resolvePrNumber,
  runMain,
} from './lib/guard.mjs'

const TAG = 'assignee-milestone'

/** Pure decision seam: PR metadata in, the names of the missing fields out. */
export function missingFields(pr) {
  const missing = []
  if (!(pr?.assignees ?? []).length) missing.push('assignee')
  if (!pr?.milestone?.title) missing.push('milestone')
  return missing
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
  const res = ghViewJson('pr', prNumber, 'number,assignees,milestone', root)
  if (!res.ok) out.fail(`could not fetch PR #${prNumber} metadata: ${res.error}`)

  const pr = res.data
  const missing = missingFields(pr)
  if (missing.length === 0) {
    out.ok(
      `PR #${pr.number} OK — assignee(s): ${pr.assignees.map((a) => a.login).join(', ')}; milestone: "${pr.milestone.title}".`,
    )
  }
  out.fail(
    `PR #${pr.number} is missing ${missing.join(' + ')} — the board row cannot be triaged. Fix in one line:\n` +
      `    gh pr edit ${pr.number} --add-assignee @me --milestone "<milestone>"\n` +
      'Canon: docs/ci-guardrails.md §5.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
