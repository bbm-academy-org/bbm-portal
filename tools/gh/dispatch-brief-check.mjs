#!/usr/bin/env node
// bbm-portal — `pnpm dispatch:brief-check <N> <file>`: validate a dispatch brief
// before it is handed to a subagent (task 7.3, #134; port of ds-platform
// `tools/gh/dispatch-brief-check.mjs`).
//
// Why: a brief that names a different file surface than the issue's Acceptance
// criteria costs a full round-trip — the mismatch surfaces only after the
// subagent returns with the wrong thing edited. Same for an undeclared staging
// pipeline: `tools/hooks/dispatch-guard.mjs` warns about it at dispatch time,
// i.e. after the brief is already written. This check moves both verdicts to
// where they are cheap: before the `Agent` call.
//
// Three checks, three machine-parseable row families:
//   1. SKILL       — the brief names its governing skill
//                    (`.claude/skills/<name>/SKILL.md`), or declares the one
//                    escape `kind: engineering-task`. Every tracked task runs
//                    under `task-cycle`, so this row is nearly free to satisfy;
//                    it exists because a brief that cannot name its governing
//                    document is a brief whose task class was never decided.
//   2. PASS/MISSING <path> — every repo-path-like surface the issue's
//                    `## Acceptance criteria` block names is named by the brief
//                    too (heading level `##`/`###` both accepted, canon §1).
//   3. STAGING     — THE alignment with our guard: the STAGING_RE / STAGED_TOKEN_RE
//                    pair is IMPORTED from `tools/hooks/dispatch-guard.mjs`
//                    rather than re-typed, so this check passes exactly the
//                    briefs the guard would accept and can never drift from it.
//                    A brief that stages its output must carry a FILLED
//                    `STAGED: irreversible|conflicting|owner-preapproval` token;
//                    the scaffold's unfilled `STAGED: <…>` placeholder
//                    deliberately satisfies neither this check nor the guard.
//
// Usage:
//   pnpm dispatch:brief-check <issue-N> <brief-file>
//   <emit brief> | pnpm dispatch:brief-check <issue-N>     # stdin
//
// Exit codes: 0 = every check green (an AC block naming zero paths is green —
// there is nothing to cover); 1 = ≥1 MISSING / MISSING-SKILL / MISSING-STAGED;
// 2 = usage or input error (missing/non-numeric <N>, unreadable brief, `gh`
// failure). Auto-editing the brief is deliberately out of scope: the verdict
// informs the lead, the wording stays the lead's.
//
// Pure node, no bash-isms. The extraction/coverage logic is exported for
// tests/unit/dispatch-scripts.spec.ts; the `gh` call goes through an injectable
// runner so the tests never shell out.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Read-only import of the guard's own regexes — ONE source of truth for what
// "this brief stages its output" and "staging is declared" mean.
import { STAGED_TOKEN_RE, STAGING_RE } from '../hooks/dispatch-guard.mjs'
import { REPO } from './lib/gh.mjs'

const TAG = '[dispatch:brief-check]'
const MAX_BUFFER = 16 * 1024 * 1024

// ── pure seams (unit-tested in tests/unit/dispatch-scripts.spec.ts) ──────────

/**
 * The markdown under the `## Acceptance criteria` heading, up to the next
 * heading or the end of the body. Heading level is not significant (canon §1:
 * `pnpm issue:create` writes `##`, GitHub issue forms render `###`), and the
 * phrase match is case-insensitive. No such heading → `''`.
 * @param {string} body
 * @returns {string}
 */
export function extractAcSection(body) {
  const lines = String(body ?? '').split(/\r?\n/)
  const headingRe = /^#{1,4}\s+/
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i]) && /acceptance\s+criteria/i.test(lines[i])) {
      start = i + 1
      break
    }
  }
  if (start === -1) return ''
  const collected = []
  for (let i = start; i < lines.length; i++) {
    if (headingRe.test(lines[i])) break
    collected.push(lines[i])
  }
  return collected.join('\n')
}

/** A host-looking first segment — the token is a URL, not a file in this repo. */
const HOSTNAME_SEGMENT_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.(com|org|net|io|dev|ru|academy|sh)$/i

/**
 * Repo-path-like tokens, deduped and in order of first appearance. This is THE
 * definition of "a surface the brief must name" — `dispatch-brief.mjs` imports
 * it rather than keeping a second copy, because a seeder that disagreed with
 * the checker would emit briefs its own gate rejects.
 *
 * A candidate `(?:seg/)+seg` survives only if its last segment has a file
 * extension OR it holds ≥2 separators, and its first segment is not a hostname:
 * `.claude/skills/task-canon/SKILL.md` and `tools/gh/pr-land.mjs` stay, prose
 * like `and/or`, a bare `tools/` and `github.com/org/repo/issues/117` go.
 * @param {string} text
 * @returns {string[]}
 */
export function extractPathTokens(text) {
  const out = []
  const seen = new Set()
  const candidateRe = /(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g
  for (const m of String(text ?? '').matchAll(candidateRe)) {
    const tok = m[0].replace(/^[`('"<[]+/, '').replace(/[`)'">\].,;:]+$/, '')
    if (!tok) continue
    const segments = tok.split('/')
    if (HOSTNAME_SEGMENT_RE.test(segments[0])) continue
    const slashes = segments.length - 1
    // A file extension starts with a LETTER: `SKILL.md` is a file, `v2.1/v2.2`
    // is a version range someone wrote in prose.
    const hasExt = /\.[A-Za-z][A-Za-z0-9]*$/.test(segments[segments.length - 1] ?? '')
    if (!hasExt && slashes < 2) continue
    if (seen.has(tok)) continue
    seen.add(tok)
    out.push(tok)
  }
  return out
}

/** Normalize for substring coverage: drop backticks, collapse whitespace. */
function normalizeForCoverage(text) {
  return String(text ?? '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Per AC surface: does the brief name it? Coverage is substring containment on
 * the normalized text, so a directory token (`tools/hooks`) counts as covered
 * by a brief naming a file beneath it (`tools/hooks/dispatch-guard.mjs`).
 * @param {string[]} pathTokens
 * @param {string} briefText
 * @returns {{path: string, covered: boolean}[]}
 */
export function checkCoverage(pathTokens, briefText) {
  const haystack = normalizeForCoverage(briefText)
  return pathTokens.map((path) => ({
    path,
    covered: haystack.includes(normalizeForCoverage(path)),
  }))
}

/** A governing skill of THIS repo — skills live in `.claude/skills/<name>/SKILL.md`. */
export const SKILL_PATH_RE = /\.claude\/skills\/[A-Za-z0-9._-]+\/SKILL\.md/

/**
 * The one escape: work no skill governs. Declared, never assumed — an
 * undeclared brief is a brief whose task class nobody decided.
 */
export const ENGINEERING_TASK_ESCAPE_RE = /kind\s*:\s*engineering-task/i

/**
 * The governing-skill gate. A skill path wins when both signals appear.
 * @param {string} briefText
 * @returns {{verdict: 'skill', skillPath: string}|{verdict: 'engineering-task'}|{verdict: 'missing'}}
 */
export function checkSkillRequirement(briefText) {
  const haystack = normalizeForCoverage(briefText)
  const m = haystack.match(SKILL_PATH_RE)
  if (m) return { verdict: 'skill', skillPath: m[0] }
  if (ENGINEERING_TASK_ESCAPE_RE.test(haystack)) return { verdict: 'engineering-task' }
  return { verdict: 'missing' }
}

/**
 * The staging gate, decided with the guard's OWN regexes (imported above) on
 * the RAW brief text — the guard reads the raw prompt, so normalizing here
 * would make the two disagree on briefs containing backticks.
 *
 * - no staging phrasing            → `direct-apply` (the default and the norm);
 * - staging phrasing + filled token → `staged` (+ the declared reason);
 * - staging phrasing, no token      → `undeclared` — this is the brief
 *   `dispatch-guard.mjs` would warn about at dispatch time.
 * @param {string} briefText
 * @returns {{verdict: 'direct-apply'}|{verdict: 'staged', reason: string}|{verdict: 'undeclared'}}
 */
export function checkStagingDeclaration(briefText) {
  const text = typeof briefText === 'string' ? briefText : ''
  if (!STAGING_RE.test(text)) return { verdict: 'direct-apply' }
  const m = text.match(STAGED_TOKEN_RE)
  if (m) return { verdict: 'staged', reason: m[1] }
  return { verdict: 'undeclared' }
}

/**
 * The skill row. MISSING-SKILL names both remedies so the lead self-serves.
 * @param {ReturnType<typeof checkSkillRequirement>} skill
 * @returns {string}
 */
export function formatSkillRow(skill) {
  if (skill.verdict === 'skill') return `SKILL ${skill.skillPath}`
  if (skill.verdict === 'engineering-task') return 'SKILL engineering-task (no governing skill)'
  return (
    'MISSING-SKILL the brief names no governing skill — name ' +
    '.claude/skills/<name>/SKILL.md (every tracked task runs under ' +
    '.claude/skills/task-cycle/SKILL.md), or declare the escape `kind: engineering-task`'
  )
}

/**
 * The staging row, phrased so the failing case names the exact token the guard
 * demands — and the unfilled `STAGED: <…>` placeholder counts as absent.
 * @param {ReturnType<typeof checkStagingDeclaration>} staging
 * @returns {string}
 */
export function formatStagingRow(staging) {
  if (staging.verdict === 'direct-apply') return 'STAGING direct-apply'
  if (staging.verdict === 'staged') return `STAGING staged (${staging.reason})`
  return (
    'MISSING-STAGED the brief stages its output instead of applying it, with no ' +
    'justification — add a FILLED `STAGED: irreversible|conflicting|owner-preapproval` ' +
    'token (a `<…>` placeholder does not count), or re-word the brief as direct-apply. ' +
    'This is exactly what tools/hooks/dispatch-guard.mjs warns about at dispatch time.'
  )
}

/** Default runner — real `gh`. `shell` on win32: `gh` is a `.cmd` shim there. */
export function defaultRunner() {
  return {
    gh: (args) => {
      const res = spawnSync('gh', args, {
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        shell: process.platform === 'win32',
      })
      if (res.error) throw new Error(`could not run gh: ${res.error.message} (gh CLI in PATH?)`)
      return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
    },
  }
}

/**
 * Fetch the issue body, extract its AC surfaces and check the brief against
 * them. The injectable `runner` is the seam the end-to-end test drives.
 * @param {{issueNumber: number|string, briefText: string, runner: {gh: Function}}} args
 * @returns {{rows: {path: string, covered: boolean}[], missing: number}}
 */
export function verifyBrief({ issueNumber, briefText, runner }) {
  const res = runner.gh(['issue', 'view', String(issueNumber), '--repo', REPO, '--json', 'body'])
  if (res.status !== 0) {
    throw new Error(
      `gh issue view ${issueNumber} failed (status ${res.status}): ${res.stderr?.trim() || 'no stderr'}`,
    )
  }
  let body
  try {
    body = String(JSON.parse(res.stdout).body ?? '')
  } catch (e) {
    throw new Error(`could not parse the gh JSON for issue #${issueNumber}: ${e.message}`)
  }
  const rows = checkCoverage(extractPathTokens(extractAcSection(body)), briefText)
  return { rows, missing: rows.filter((r) => !r.covered).length }
}

// ── impure CLI (skipped on import) ───────────────────────────────────────────

function usage() {
  process.stderr.write(
    `${TAG} usage: pnpm dispatch:brief-check <issue-N> <brief-file>   (or pipe the brief via stdin)\n`,
  )
  process.exit(2)
}

function main() {
  const issueArg = process.argv[2]
  const fileArg = process.argv[3]
  if (!issueArg || !/^\d+$/.test(issueArg)) usage()

  let briefText
  try {
    if (fileArg) briefText = readFileSync(fileArg, 'utf8')
    else if (!process.stdin.isTTY)
      briefText = readFileSync(0, 'utf8') // fd 0 works on Windows too
    else usage()
  } catch (e) {
    process.stderr.write(`${TAG} cannot read the brief: ${e.message}\n`)
    process.exit(2)
  }

  let result
  try {
    result = verifyBrief({ issueNumber: issueArg, briefText, runner: defaultRunner() })
  } catch (e) {
    process.stderr.write(`${TAG} ${e.message}\n`)
    process.exit(2)
  }

  const { rows, missing } = result
  const skill = checkSkillRequirement(briefText)
  const staging = checkStagingDeclaration(briefText)
  const skillOk = skill.verdict !== 'missing'
  const stagingOk = staging.verdict !== 'undeclared'

  process.stdout.write(`${formatSkillRow(skill)}\n`)
  for (const r of rows) process.stdout.write(`${r.covered ? 'PASS' : 'MISSING'} ${r.path}\n`)
  process.stdout.write(`${formatStagingRow(staging)}\n`)

  const pass = rows.length - missing
  const acSummary =
    rows.length === 0
      ? 'no path-like AC surfaces to check'
      : `${rows.length} path(s): ${pass} PASS, ${missing} MISSING`
  const problems = []
  if (missing > 0) problems.push('the brief omits AC surface(s) — name them before dispatching')
  if (!skillOk) problems.push('no governing skill declared')
  if (!stagingOk) problems.push('undeclared staging — see MISSING-STAGED above')
  process.stdout.write(
    `${TAG} #${issueArg}: ${acSummary} — ${problems.length > 0 ? `${problems.join('; ')}.` : 'OK'}\n`,
  )
  process.exit(missing > 0 || !skillOk || !stagingOk ? 1 : 0)
}

// Run only as the entry point — the guard keeps the pure seams importable from
// the unit tests without firing main()'s gh subprocess.
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : ''
const SELF = resolve(fileURLToPath(import.meta.url))
if (INVOKED === SELF) {
  main()
}
