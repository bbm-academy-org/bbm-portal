#!/usr/bin/env node
// epic-autoclose — `Closes #<epic>` would auto-close a live parent on merge.
//
// Canon: docs/ci-guardrails.md §5. Severity: WARN since 2026-08-05; earliest
// promotion 2026-09-02, and a promotion to BLOCK additionally needs the
// cross-workflow decision recorded in canon §2.1 (this guard lives in
// pr-body-guards.yml, which cannot be in the `ci` needs-list).
//
// Why it exists: GitHub closes every issue named by a `Closes #N` line the
// moment the PR merges — it does not look at the native sub-issue graph. A child
// PR that writes `Closes #<epic>` therefore closes the whole epic while its
// other children are still open, and the tracker silently loses the umbrella
// that was coordinating them. The repo's own memory carries the inverse failure
// too ("closing your phase, close the umbrellas upward — they do not close
// themselves"), so both directions are manual today; this guard mechanises the
// one that destroys information.
//
// The rule (exact): read the PR body, collect every `Closes/Fixes/Resolves #N`,
// and for each target read its native sub-issue graph. A target with ≥1 OPEN
// sub-issue is a finding: link the specific child instead. A target with no
// sub-issues, or with all of them closed, passes.
//
// PR-event-gated. Needs `issues: read` on the job for the sub-issues endpoint,
// on top of the usual `contents`/`pull-requests` (workflow-auth enforces the
// pair; the extra scope is on the job).
//
// Run: `pnpm lint:epic-autoclose`. Findings: stderr + exit 1. Clean/skip: exit 0.

import { ghSubIssues, ghViewJson } from './lib/gh.mjs'
import {
  isEntryPoint,
  isPrEvent,
  reporter,
  repoRoot,
  resolvePrNumber,
  runMain,
} from './lib/guard.mjs'

const TAG = 'epic-autoclose'

// GitHub's own closing-keyword set, restricted to the same-repo `#N` form.
const CLOSES_RE = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

/** Pure decision seam: PR body in, deduped list of closed issue numbers out. */
export function closesTargets(body) {
  const text = String(body ?? '').replace(HTML_COMMENT_RE, '')
  const out = []
  for (const m of text.matchAll(CLOSES_RE)) {
    const n = Number(m[2])
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/** Pure decision seam: sub-issue list in, the still-open ones out. */
export function openChildren(subIssues) {
  return (subIssues ?? []).filter((s) => String(s?.state).toLowerCase() === 'open')
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
  const res = ghViewJson('pr', prNumber, 'number,body', root)
  if (!res.ok) out.fail(`could not fetch PR #${prNumber} metadata: ${res.error}`)

  const targets = closesTargets(res.data.body)
  if (targets.length === 0) {
    out.ok(`PR #${prNumber} closes no issue by keyword, rule does not apply`)
  }
  out.info(`PR #${prNumber} closes ${targets.map((n) => `#${n}`).join(', ')}`)

  const findings = []
  for (const target of targets) {
    const sub = ghSubIssues(target, root)
    if (!sub.ok) out.fail(`could not read the sub-issue graph of #${target}: ${sub.error}`)
    const open = openChildren(sub.data)
    if (open.length > 0) findings.push({ target, open })
  }

  if (findings.length === 0) {
    out.ok('PASS — no closing keyword points at an issue with open sub-issues.')
  }
  for (const f of findings) {
    out.finding(
      `\`Closes #${f.target}\` would auto-close a parent with ${f.open.length} OPEN sub-issue(s): ` +
        f.open.map((c) => `#${c.number}`).join(', '),
    )
  }
  out.fail(
    `${findings.length} closing keyword(s) point at a live parent. Merging this PR would close the ` +
      'umbrella while its children are still open, and the tracker loses what was coordinating them. ' +
      'Point `Closes #N` at the specific child sub-issue this PR delivers, and close the parent ' +
      'deliberately when the last child lands. Canon: docs/ci-guardrails.md §5.',
  )
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
