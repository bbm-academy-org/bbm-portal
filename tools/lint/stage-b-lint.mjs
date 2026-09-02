#!/usr/bin/env node
// bbm-portal — pre-merge Stage-B gate (#138, task 7.7 of epic #117).
//
// WHY THIS EXISTS. task-cycle stage 5 says an owner-visible change does not
// merge without the owner's «принято» on a LIVE stand. Until now that rule was
// pure prose: nothing mechanically noticed a UI diff reaching merge with no
// recorded verdict. This guard reads the PR the way a reviewer would — which
// files it touches, what its body (and the linked issue's comments) claim — and
// reports whether the Stage-B record is actually there.
//
// WHAT IT CHECKS. If the PR touches a view-layer file (`*.tsx` / `*.css` under
// `src/`, exactly the «UI diff» definition of task-cycle stage 3), then the PR
// body OR a comment on a `Closes #N` issue MUST carry a `Stage-B:` line in one
// of three sanctioned shapes:
//   Stage-B: GO — <owner, date>                        (the owner's live verdict)
//   Stage-B: batched at #<gate>                        (a batched acceptance gate)
//   Stage-B: N/A (no visual surface) — lead-certified  (lead self-certification)
// A missing marker, or a placeholder value (`TBD`, the unfilled PR-template
// angle-bracket line), is a violation. A PR with no UI diff is skipped.
//
// SEVERITY: BLOCK since 2026-09-02 (#438). The severity of record is the §5 row
// in docs/ci-guardrails.md plus the job in .github/workflows/pr-body-guards.yml
// — read the plane off those, not off this comment. This SCRIPT still defaults to
// reporting a violation and exiting 0; `--severity block` (or
// `STAGE_B_SEVERITY=block`) makes the same violation exit 1. Note the two WARNs
// are different mechanisms: HERE it means "exit 0 with a WARN line", while in
// #136's canon WARN means `continue-on-error: true` on the CI job. The `stage-b`
// job passes `--severity block` — it always did, so the script gives a REAL
// signal (canon §4 clause 1: a guard that prints and exits 0 is a stub and is not
// promotable) — and the promotion dropped its `continue-on-error` and its `if:`
// fence. No code change was needed here.
//
// An `error` (the PR cannot be read at all — gh auth, a fork without token
// scope, an API blip) is NOT a violation and does NOT follow the severity dial:
// it exits 1 under every severity, by design. A violation is a finding about the
// PR, which WARN may absorb; an unreadable PR means the guard never ran, and a
// guard that exits 0 when it never ran is indistinguishable from a clean check.
// Masking THAT is a job-level `continue-on-error` decision. #136 made it one way
// while the guard was WARN — the job carried `continue-on-error`, so an unreadable
// PR showed in the job log rather than blocking — and the 2026-09-02 promotion
// (#438) reversed it: the job carries no `continue-on-error`, so the exit 1 from an
// unreadable PR now turns `pnpm pr:land` RED. That is the INTENDED outcome under
// BLOCK, not a regression to route around. A BLOCK guard that cannot read the PR
// has not cleared it, and a gate that goes green when it never ran is the exact
// failure the canon's §4 clause 1 exists to prevent. The fix is to make the PR
// readable (gh auth, token scope) and re-run — the workflow's `edited` trigger
// re-runs this check without a rebuild.
//
// CI: the `stage-b` job of `.github/workflows/pr-body-guards.yml` (wired by #136
// after this guard landed — the two ran in parallel, so the wiring is not in this
// file’s history). Run locally before merge: `pnpm lint:stage-b <PR>`.
//
// Pattern source: ds-platform `tools/lint/stage-b-lint.ts` (adapted — bbm has no
// design-system package, no spec frontmatter and no `pr:preflight` runner, so
// surface detection is by touched path only and the gh access is bbm's own
// argv-array convention, `tools/gh/lib/gh.mjs`).

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { pagePrFiles, prFilesArgs, prFilesPageSize } from './lib/gh.mjs'
import { extractPartOfIssues, stripNonEvidence } from './lib/guard.mjs'

const TAG = '[stage-b]'

export const REPO = 'bbm-academy-org/bbm-portal'

/**
 * The view layer, per task-cycle stage 3: «UI diff (`*.css`, view-layer
 * `*.tsx`)». Everything the owner can see in this repo is rendered from one of
 * those two under `src/`; API routes, collections and libs are `.ts`.
 */
export const RENDER_RE = /^src\/.*\.(tsx|css)$/

/**
 * Non-render files that must not trip the gate on their own: tests, generated
 * artefacts and migrations carry no rendered surface.
 */
export const EXEMPT_RE =
  /(\.spec\.[tj]sx?$|\.test\.[tj]sx?$|^src\/migrations\/|^src\/payload-types\.|^src\/payload-generated-schema\.)/

/** The `Stage-B:` line, anywhere in a body/comment, through list/quote decoration. */
const MARKER_RE = /^[ \t>*_-]*stage-?b\s*:\s*(.+?)\s*$/gim

// Text that TALKS ABOUT the marker but does not record one — HTML comments and
// fenced code blocks — is stripped before extraction (review PR #151, blocker 1).
// The stripper itself now lives in `lib/guard.mjs` as `stripNonEvidence`, shared
// with `spec-link` and `spec-deletion`, because the rule is one rule and three
// copies drift (review PR #160: `spec-deletion` shipped without it).
//
// This is not cosmetic. The PR template's own instruction block lives inside
// `<!-- … -->` and spells out all three sanctioned shapes verbatim, so without
// this the realistic failure — an author fills What/Why and never touches the
// Stage B section — read as a recorded owner GO. Same class on the issue-comment
// path: a handoff or a review note quoting the shapes in a fence became evidence.

/**
 * `GO — Антон, 2026-08-05` — the owner's live verdict. The attribution tail is
 * REQUIRED: this value stands in for a «принято» said by a named person on a
 * named day, so a bare `GO` records nothing anyone can check later. Symmetric
 * with `N/A`, whose bare form is rejected for the same reason (review PR #151,
 * minor 4). Any separator the shapes use is accepted — `—`, `-`, `:`, `,`, `(`.
 */
const GO_RE = /^\**go\b\**\s*[-–—:,(]\s*\S/i
/** `batched at #117` — the batched acceptance gate carve-out. */
const BATCHED_RE = /^\**batched\s+at\s+#\d+/i
/**
 * `N/A (no visual surface) — lead-certified` — the lead self-certification for a
 * PR whose diff touches the view layer but ships NO new/changed visual surface.
 * A bare `N/A` is NOT evidence: the certification has to be claimed, because it
 * is the lead putting its name on the absence of an owner verdict.
 */
const LEAD_CERTIFIED_RE = /^\**n\/a\b[\s\S]*[-–—]\s*lead-certified\b/i

/** An unfilled PR-template line — reported distinctly from a missing marker. */
const PLACEHOLDER_RE = /^(<.*>|\(.*\)|tbd|pending.*|todo.*|\?+)$/i

/** GitHub auto-close keywords — the same set GitHub itself acts on. */
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi

/** The render files of a touched-path list, exemptions removed. */
export function renderFiles(paths) {
  return (paths ?? []).filter((p) => RENDER_RE.test(p) && !EXEMPT_RE.test(p))
}

/**
 * Every `Stage-B:` VALUE in a text blob — classification happens in the caller.
 * Leading emphasis is stripped so a bold marker (`- **Stage-B:** GO`, the shape
 * the PR template renders) reads the same as a plain one.
 */
export function extractMarkerValues(text) {
  if (!text) return []
  const semantic = stripNonEvidence(text)
  return [...semantic.matchAll(MARKER_RE)].map((m) => (m[1] ?? '').replace(/^[\s*_]+/, '').trim())
}

/** Is this marker value one of the three sanctioned records? */
export function isEvidence(value) {
  return GO_RE.test(value) || BATCHED_RE.test(value) || LEAD_CERTIFIED_RE.test(value)
}

/** Issue numbers a PR body auto-closes, deduped in first-seen order. */
export function extractClosedIssues(body) {
  const out = new Set()
  for (const m of String(body ?? '').matchAll(CLOSE_RE)) out.add(Number(m[1]))
  return [...out]
}

/**
 * Every issue whose comments may carry this PR's Stage-B verdict: the ones it
 * CLOSES plus the parent(s) a partial PR names with `Part of #N` (#299). A slice
 * PR — the shape `pr-land` now lands — records its GO on the parent, so reading
 * only the closing keyword lost the evidence (review of PR #303, N1).
 */
export function extractLinkedIssues(body) {
  const out = [...extractClosedIssues(body)]
  for (const n of extractPartOfIssues(body)) if (!out.includes(n)) out.push(n)
  return out
}

const SHAPES = [
  '    Stage-B: GO — <owner, date>',
  '    Stage-B: batched at #<gate issue>',
  '    Stage-B: N/A (no visual surface) — lead-certified',
]

/**
 * The pure seam: given a `gh pr view --json number,body,files` payload and the
 * comment bodies of its linked issues, decide the verdict. No IO.
 *
 * @param {{number?: number, body?: string, files?: {path: string}[]}} pr
 * @param {string[]} [issueComments]
 * @returns {{userFacing: boolean, verdict: 'skip'|'pass'|'violation',
 *            renderFiles: string[], markerValues: string[], evidence: string|null,
 *            message: string}}
 */
export function checkStageB(pr, issueComments = []) {
  const files = (pr?.files ?? []).map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
  const rendered = renderFiles(files)
  const number = pr?.number ?? '?'

  if (rendered.length === 0) {
    return {
      userFacing: false,
      verdict: 'skip',
      renderFiles: [],
      markerValues: [],
      evidence: null,
      message: `PR #${number}: no UI diff (no non-test *.tsx / *.css under src/), Stage-B does not apply`,
    }
  }

  const markerValues = [
    ...extractMarkerValues(pr?.body ?? ''),
    ...issueComments.flatMap((c) => extractMarkerValues(c)),
  ]
  const evidence = markerValues.find(isEvidence) ?? null

  if (evidence) {
    return {
      userFacing: true,
      verdict: 'pass',
      renderFiles: rendered,
      markerValues,
      evidence,
      message: `PR #${number}: Stage-B recorded — "${evidence.slice(0, 80)}"`,
    }
  }

  const placeholder = markerValues.find((v) => PLACEHOLDER_RE.test(v))
  const head =
    markerValues.length === 0
      ? `PR #${number} is a UI diff (${rendered.length} view file(s), e.g. ${rendered.slice(0, 3).join(', ')}) but records NO Stage-B verdict.`
      : placeholder !== undefined
        ? `PR #${number} is a UI diff and its Stage-B marker is still the unfilled placeholder "${placeholder.slice(0, 60)}".`
        : `PR #${number} is a UI diff and its Stage-B marker value "${markerValues[0].slice(0, 60)}" is not a recorded verdict.`

  return {
    userFacing: true,
    verdict: 'violation',
    renderFiles: rendered,
    markerValues,
    evidence: null,
    message: [
      head,
      'task-cycle stage 5: an owner-visible change does not merge without «принято» on a LIVE stand.',
      'Record it in the PR body (or a comment on the linked issue), in one of:',
      ...SHAPES,
    ].join('\n'),
  }
}

// ── gh access (argv arrays, never a shell string — `tools/gh/lib/gh.mjs` canon) ─

export function ghPrArgs(prNumber) {
  return ['pr', 'view', String(prNumber), '--repo', REPO, '--json', 'number,body']
}
/**
 * ONE page of the PR's changed files. The `files` field of `gh pr view` stops at
 * 100 entries and says nothing when it truncates, so the verdict is derived from
 * the paged REST endpoint instead (canon docs/ci-guardrails.md §8). The loop and
 * the page bound live in `lib/gh.mjs`; this guard owns only its runner.
 */
export function ghFilesArgs(prNumber, page, perPage = prFilesPageSize()) {
  return prFilesArgs(prNumber, page, { repo: REPO, perPage })
}

export function ghIssueArgs(issueNumber) {
  return ['issue', 'view', String(issueNumber), '--repo', REPO, '--json', 'number,comments']
}

/** The real runner; replaced in tests. */
export function defaultGh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.error) return { status: -1, stdout: '', stderr: res.error.message }
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

function ghJson(gh, args) {
  const res = gh(args)
  if (res.status !== 0)
    return { ok: false, error: (res.stderr || '').trim() || `gh exit ${res.status}` }
  try {
    return { ok: true, data: JSON.parse(res.stdout) }
  } catch {
    return { ok: false, error: 'gh output is not JSON' }
  }
}

/** `--severity block` / `--severity=block` / `STAGE_B_SEVERITY=block`; WARN by default. */
export function severityFromArgv(argv = [], env = {}) {
  const args = argv ?? []
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a.startsWith('--severity='))
      return a.slice('--severity='.length) === 'block' ? 'block' : 'warn'
    if (a === '--severity') return String(args[i + 1] ?? '') === 'block' ? 'block' : 'warn'
  }
  return env.STAGE_B_SEVERITY === 'block' ? 'block' : 'warn'
}

/**
 * Full CLI parse: the PR number (positional, else `PR_NUMBER` from env) and the
 * severity. The flag's VALUE is consumed, so `--severity block` no longer eats
 * the env fallback's place — the two documented invocation forms combine
 * (review PR #151, major 2: `PR_NUMBER=151 … --severity block` exited 2).
 */
export function parseArgs(argv = [], env = {}) {
  const severity = severityFromArgv(argv, env)
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i])
    if (a === '--severity') {
      i++ // its value is a flag argument, never a positional
      continue
    }
    if (a.startsWith('--')) continue
    positional.push(a)
  }
  const candidate = positional[0] ?? env.PR_NUMBER ?? ''
  return { prNumber: /^\d+$/.test(String(candidate)) ? String(candidate) : null, severity }
}

/**
 * Fetch the PR (and its linked issues' comments) and run the check.
 *
 * @returns {{verdict: 'skip'|'pass'|'violation'|'error', exitCode: number, lines: string[]}}
 */
export function runStageBLint({ prNumber, severity = 'warn', gh = defaultGh }) {
  const lines = []
  const prRes = ghJson(gh, ghPrArgs(prNumber))
  if (!prRes.ok) {
    lines.push(`${TAG} ERROR: cannot read PR #${prNumber}: ${prRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }

  // Fail-closed on a partial read: a guard that saw part of the diff has not
  // cleared the diff (canon §8, the same principle as an unreadable PR above).
  const perPage = prFilesPageSize()
  const filesRes = pagePrFiles((page) => ghJson(gh, ghFilesArgs(prNumber, page, perPage)), {
    perPage,
  })
  if (!filesRes.ok) {
    lines.push(`${TAG} ERROR: cannot read the files of PR #${prNumber}: ${filesRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }
  const prData = { ...prRes.data, files: filesRes.data }

  const comments = []
  for (const issue of extractLinkedIssues(prRes.data?.body ?? '')) {
    const issueRes = ghJson(gh, ghIssueArgs(issue))
    if (!issueRes.ok) {
      // A linked issue we cannot read is never counted as evidence — the
      // fetch failure is reported so a real verdict is not silently lost.
      lines.push(
        `${TAG} note: linked issue #${issue} unreadable (${issueRes.error}) — not evidence`,
      )
      continue
    }
    comments.push(...(issueRes.data?.comments ?? []).map((c) => c?.body ?? ''))
  }

  const result = checkStageB(prData, comments)
  if (result.verdict === 'violation') {
    const level = severity === 'block' ? 'BLOCK' : 'WARN'
    lines.push(`${TAG} ${level}: ${result.message}`)
    if (level === 'WARN')
      lines.push(
        `${TAG} WARN severity here only because --severity warn was passed (docs/ci-guardrails.md §5 — BLOCK on the CI plane since 2026-09-02)`,
      )
    return { verdict: 'violation', exitCode: severity === 'block' ? 1 : 0, lines }
  }
  lines.push(`${TAG} OK: ${result.message}`)
  return { verdict: result.verdict, exitCode: 0, lines }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  return [
    'Usage: pnpm lint:stage-b <PR number> [--severity warn|block]',
    '',
    'Checks that a UI PR records the owner Stage-B verdict before merge (#138).',
    'Severity of record: docs/ci-guardrails.md §5, row `stage-b` (BLOCK since 2026-09-02).',
  ].join('\n')
}

function main(argv) {
  const { prNumber, severity } = parseArgs(argv, process.env)
  if (prNumber === null) {
    process.stderr.write(`${usage()}\n`)
    return 2
  }
  const { exitCode, lines } = runStageBLint({ prNumber: Number(prNumber), severity })
  for (const line of lines) {
    if (line.includes('BLOCK') || line.includes('WARN') || line.includes('ERROR')) {
      process.stderr.write(`${line}\n`)
    } else {
      process.stdout.write(`${line}\n`)
    }
  }
  return exitCode
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(main(process.argv.slice(2)))
}
