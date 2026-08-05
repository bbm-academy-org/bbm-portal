#!/usr/bin/env node
// The `gh` seam for PR-metadata guards (docs/ci-guardrails.md §8).
//
// A guard that reads the PR's own metadata reaches GitHub through the `gh` CLI.
// That call cannot be exercised by the `LINT_FIXTURE_ROOT` filesystem seam, so
// this module centralises it and adds one injectable seam:
//
//   TEST SEAM `LINT_GH_FIXTURE_DIR` — when set, a view is served from a canned
//   JSON file in that dir instead of spawning `gh`, so a guard's whole decision
//   path runs under test with no GitHub round-trip, no auth, and deterministic
//   output in CI. File naming mirrors the subcommand:
//       gh pr view <n>                            -> <dir>/pr-view-<n>.json
//       gh issue view <n>                         -> <dir>/issue-view-<n>.json
//       gh api .../issues/<n>/sub_issues          -> <dir>/sub-issues-<n>.json
//   A missing or invalid fixture resolves to `{ ok: false }`, matching the real
//   CLI's failure path, so a guard's fail-closed branch is testable too.
//
// CI SEAM `PR_BODY`: when the workflow passes the event payload's body
// (`PR_BODY: ${{ github.event.pull_request.body }}`), it overrides the `body`
// field of `gh pr view` FOR THAT PR. Rationale: the payload body is always
// current for the event that triggered the run, while a REST read right after
// PR creation has returned a stale or absent body — a retry cannot fix that
// class, because a stale read still succeeds. Deliberately narrow: PR views
// only, only the PR named by `PR_NUMBER`, and only when `body` was requested.
//
// Returns a discriminated result instead of throwing, so each guard keeps its
// own tagged diagnostics and its own fail-closed branch.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function fixtureRead(file) {
  try {
    return { ok: true, data: JSON.parse(readFileSync(file, 'utf8')) }
  } catch (e) {
    return { ok: false, error: `fixture ${file} unavailable: ${String(e?.message).split('\n')[0]}` }
  }
}

function ghRun(args, cwd) {
  try {
    const res = spawnSync('gh', args, {
      cwd,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    if (res.status !== 0) {
      return { ok: false, error: (res.stderr || `gh exited ${res.status}`).split('\n')[0] }
    }
    return { ok: true, data: JSON.parse(res.stdout) }
  } catch (e) {
    return { ok: false, error: String(e?.message).split('\n')[0] }
  }
}

/** Apply the `PR_BODY` event-payload override. Exported for its unit test. */
export function withEventBody(kind, number, fields, data, env = process.env) {
  const body = env.PR_BODY
  const wantsBody = String(fields)
    .split(',')
    .map((f) => f.trim())
    .includes('body')
  if (kind !== 'pr' || body === undefined || String(number) !== env.PR_NUMBER || !wantsBody) {
    return data
  }
  return { ...data, body }
}

/**
 * `gh <kind> view <number> --json <fields>`, parsed. `fields` is ignored under
 * the fixture seam (the file already holds the projected shape) and passed
 * verbatim to the real CLI.
 */
export function ghViewJson(kind, number, fields, cwd) {
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR
  const res = fixtureDir
    ? fixtureRead(resolve(fixtureDir, `${kind}-view-${number}.json`))
    : ghRun([kind, 'view', String(number), '--json', fields], cwd)
  if (!res.ok) return res
  return { ok: true, data: withEventBody(kind, number, fields, res.data) }
}

/**
 * The native sub-issue graph of an issue: `[{ number, state, title }]`.
 * There is no `gh issue view --json` field for it — the sub-issues REST endpoint
 * is the only source, and `{owner}/{repo}` is resolved by `gh` from the cwd.
 */
export function ghSubIssues(number, cwd) {
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR
  const res = fixtureDir
    ? fixtureRead(resolve(fixtureDir, `sub-issues-${number}.json`))
    : ghRun(['api', `repos/{owner}/{repo}/issues/${number}/sub_issues`], cwd)
  if (!res.ok) return res
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] }
}
