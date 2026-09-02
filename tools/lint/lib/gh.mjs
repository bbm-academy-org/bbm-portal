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
//       gh api .../pulls/<n>/commits              -> <dir>/pr-commits-<n>.json
//       gh api .../commits/<sha>                  -> <dir>/commit-<sha>.json
//       gh api .../commits/<sha>?page=<N>         -> <dir>/commit-<sha>-page<N>.json
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
import { existsSync, readFileSync } from 'node:fs'
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
 * The PR's commits, oldest first: `[{ sha, … }]`.
 *
 * There is no `gh pr view --json` field carrying per-commit FILES, so a guard
 * that reasons about commit ORDER (`tdd-order`) needs the REST pair — this call
 * for the sequence, `ghCommit` below for each commit's file list. `gh` resolves
 * `{owner}/{repo}` from the cwd.
 *
 * Fixture seam: `<LINT_GH_FIXTURE_DIR>/pr-commits-<n>.json`.
 *
 * Known limit, inherited from the endpoint and worth naming rather than
 * discovering: the commits endpoint pages at 250 commits. A PR that long is its
 * own review problem, but a guard reading this must not assume completeness
 * silently.
 */
export function ghPrCommits(number, cwd) {
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR
  const res = fixtureDir
    ? fixtureRead(resolve(fixtureDir, `pr-commits-${number}.json`))
    : ghRun(['api', '--paginate', `repos/{owner}/{repo}/pulls/${number}/commits`], cwd)
  if (!res.ok) return res
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] }
}

/**
 * ONE PAGE of a commit: `{ sha, parents, files: [{ filename, status, patch }] }`.
 * `status` is git's own verdict for that commit (`added` / `modified` /
 * `renamed` / …), which is what lets a caller tell a NEW file from a rename
 * without re-deriving it; `parents` is what tells a merge from a commit.
 *
 * The endpoint pages its `files` array and caps it at 300 entries however you
 * page, so this is deliberately a SINGLE-PAGE primitive: the caller owns the
 * loop and owns what to do when the cap is hit. `--paginate` is not usable here
 * — it concatenates whole JSON objects for an object-shaped response rather
 * than merging their arrays.
 *
 * Fixture seam: `<LINT_GH_FIXTURE_DIR>/commit-<sha>.json` for page 1, and
 * `commit-<sha>-page<N>.json` for each page after it.
 *
 * @param {string} sha
 * @param {string} cwd
 * @param {number} page 1-based page number
 * @param {number} perPage page size (the endpoint's own maximum is 100)
 */
export function ghCommit(sha, cwd, page = 1, perPage = 100) {
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR
  const res = fixtureDir
    ? fixtureRead(
        resolve(fixtureDir, page === 1 ? `commit-${sha}.json` : `commit-${sha}-page${page}.json`),
      )
    : ghRun(['api', `repos/{owner}/{repo}/commits/${sha}?per_page=${perPage}&page=${page}`], cwd)
  if (!res.ok) return res
  return { ok: true, data: res.data ?? {} }
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

// ── The PR's changed files, PAGED (canon docs/ci-guardrails.md §8) ───────────
//
// `gh pr view <N> --json files` returns at most 100 entries and says nothing
// when it truncates, so a guard deriving a verdict from it under-reads a large
// PR and goes green — the false NEGATIVE §8 forbids on the BLOCK plane. The
// REST endpoint `repos/{owner}/{repo}/pulls/<N>/files` pages, so the whole
// changed set is reachable; this is the one place that loop lives.
//
// `--paginate` is deliberately NOT used: it is fine for an array-shaped
// response, but the loop below has to stay symmetrical with the fixture seam
// (one file per page) and with the guards that own their own `gh` runner
// (`stage-b`, `ux-record`), which page through `pagePrFiles` with the same
// bound. One loop, three call shapes.

/** The endpoint's own maximum page size. */
export const PR_FILES_PAGE_SIZE = 100
/** Bound on the loop: 30 × 100 = 3000 files is far past «its own review problem». */
export const PR_FILES_MAX_PAGES = 30

/**
 * TEST SEAM `LINT_PR_FILES_PAGE_SIZE` — shrinks the page so a spec can prove the
 * loop crosses a page boundary with a two-entry fixture instead of 101 of them.
 * Unset in production, where the endpoint's own maximum applies.
 */
export function prFilesPageSize(env = process.env) {
  const raw = Number(env.LINT_PR_FILES_PAGE_SIZE)
  return Number.isInteger(raw) && raw > 0 ? raw : PR_FILES_PAGE_SIZE
}

/** `gh api` argv for ONE page of a PR's files. `repo` defaults to the cwd's. */
export function prFilesArgs(
  number,
  page,
  { repo = '{owner}/{repo}', perPage = PR_FILES_PAGE_SIZE } = {},
) {
  return ['api', `repos/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`]
}

/**
 * One REST page → the `gh pr view --json files` entry shape the guards already
 * read (`{ path, additions, deletions, status }`). REST calls the path
 * `filename`; `spec-link` needs the counts, `tdd-order`-style callers need
 * `status`, so nothing is dropped. Bare strings are accepted because the pure
 * seams of `stage-b` / `ux-record` are specified for them.
 */
export function normalizeFilesPage(data) {
  return (Array.isArray(data) ? data : [])
    .map((f) =>
      typeof f === 'string'
        ? { path: f }
        : {
            path: f?.path ?? f?.filename,
            additions: Number(f?.additions ?? 0),
            deletions: Number(f?.deletions ?? 0),
            status: f?.status,
          },
    )
    .filter((f) => f.path)
}

/**
 * The paging loop. `fetchPage(page)` returns this module's `{ ok, data }` shape.
 *
 * A short page ends the walk. Exhausting `maxPages` is an ERROR, not a truncated
 * success: a BLOCK guard that read part of the diff has not cleared the diff,
 * and every consumer already fails closed on `{ ok: false }`.
 */
export function pagePrFiles(
  fetchPage,
  { perPage = PR_FILES_PAGE_SIZE, maxPages = PR_FILES_MAX_PAGES } = {},
) {
  const all = []
  for (let page = 1; page <= maxPages; page++) {
    const res = fetchPage(page)
    if (!res.ok) return res
    const entries = normalizeFilesPage(res.data)
    all.push(...entries)
    if (entries.length < perPage) return { ok: true, data: all }
  }
  return {
    ok: false,
    error: `PR has more than ${maxPages * perPage} changed files — refusing to judge a truncated set`,
  }
}

/**
 * Fixture seam for one page: `<dir>/pr-files-<n>.json` (page 1) and
 * `pr-files-<n>-page<N>.json` after it. A case that predates paging keeps
 * working: page 1 falls back to the `files` array of `pr-view-<n>.json`, and a
 * missing later page is an empty page (end of the walk), not an error.
 */
function fixturePrFilesPage(dir, number, page) {
  const named = resolve(
    dir,
    page === 1 ? `pr-files-${number}.json` : `pr-files-${number}-page${page}.json`,
  )
  if (existsSync(named)) return fixtureRead(named)
  if (page > 1) return { ok: true, data: [] }
  const view = fixtureRead(resolve(dir, `pr-view-${number}.json`))
  return view.ok ? { ok: true, data: view.data?.files ?? [] } : view
}

/**
 * The PR's COMPLETE changed-file list. This is what a guard on the BLOCK plane
 * must read instead of `gh pr view --json files` (§8).
 */
export function ghPrFiles(number, cwd) {
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR
  const perPage = prFilesPageSize()
  return pagePrFiles(
    (page) =>
      fixtureDir
        ? fixturePrFilesPage(fixtureDir, number, page)
        : ghRun(prFilesArgs(number, page, { perPage }), cwd),
    { perPage },
  )
}
