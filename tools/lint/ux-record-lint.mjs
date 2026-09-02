#!/usr/bin/env node
// bbm-portal — pre-merge UX-record gate (#433).
//
// WHY THIS EXISTS. Owner ruling, Антон, 2026-09-02: composition, control
// choice, grouping, states, feedback and post-submit behaviour are the AGENT's
// decisions — taken by the agent and RECORDED in the PR, escalated to the owner
// only on a product fork. The visual language and the product forks stay the
// owner's (`.claude/rules/design-process.md` §1).
//
// Until this guard, the agent half of that split existed only as step 4 of
// `.claude/skills/build-ui-from-design-system/SKILL.md` — an unsigned checklist
// nobody had to sign and nothing read. What that cost is in #433's body: spec
// 339's request form shipped as eleven ungrouped fields because no one was
// licensed to group them, and PR #430 hand-rolled a select next to
// `src/ui/select.tsx`. Every input was present; the RECORD was absent.
//
// WHAT IT CHECKS. If the PR is a UI diff — a non-test `*.tsx` / `*.css` under
// `src/`, the definition `lint:stage-b` owns and this guard IMPORTS rather than
// restates — then the PR body OR a comment on a linked issue must carry a
// `UX-record:` block covering all six facets:
//
//   UX-record:
//   - Composition: …
//   - Controls: …
//   - Grouping: …
//   - States: …
//   - Feedback: …
//   - Post-submit: …
//
// The one marker-level escape is the lead self-certification, symmetric with
// `Stage-B:` — `UX-record: N/A (no UX decisions) — lead-certified`, for a diff
// that touches the view layer and decides no UX (a rename, a prop rewire). A
// BARE `N/A` is not evidence: the certification has to be claimed, because it is
// the lead putting its name on the absence of the decisions.
//
// A facet whose value is an unfilled placeholder (`<…>`, `TBD`, `todo`) counts
// as missing — the PR template ships exactly those, so accepting them would make
// the template itself a passing record.
//
// SEVERITY: WARN. A violation is reported and the process exits 0 by default;
// `--severity block` (or `UX_RECORD_SEVERITY=block`) makes the same violation
// exit 1. The `ux-record` job in `.github/workflows/pr-body-guards.yml` passes
// `--severity block` and carries `continue-on-error: true` — the wiring `stage-b`
// used while IT was still WARN (it was promoted to BLOCK on 2026-09-02, #438, and
// dropped the flag): the script gives a REAL signal (canon §4 clause 1 — a guard
// that prints and exits 0 is a stub and is not promotable) while the CI plane stays
// WARN. Promotion is then a one-line workflow change. The severity of record is
// docs/ci-guardrails.md §5, row `ux-record`, plus the job itself — not this
// comment.
//
// An `error` (the PR cannot be read at all) is NOT a violation and does NOT
// follow the severity dial: it exits 1 under every severity. A guard that exits
// 0 when it never ran is indistinguishable from a clean check.
//
// Run locally before merge: `pnpm lint:ux-record <PR>`.

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { stripNonEvidence } from './lib/guard.mjs'
import { extractLinkedIssues, renderFiles } from './stage-b-lint.mjs'

const TAG = '[ux-record]'

export const REPO = 'bbm-academy-org/bbm-portal'

/**
 * The six facets of the record, in the order the canon lists them
 * (`build-ui-from-design-system` step 4). Lower-case ids: the labels in a PR
 * body are matched case-insensitively and reported by these ids.
 */
export const FACETS = ['composition', 'controls', 'grouping', 'states', 'feedback', 'post-submit']

/**
 * The `UX-record:` marker line, through list/quote/emphasis decoration. The
 * separator is optional and may be a space: `UX record` is how the PR
 * template's own heading spells it, so an author following the heading must
 * not fall through the gate.
 */
const MARKER_RE = /^[ \t>*_-]*\*{0,2}ux[-\s]?record\*{0,2}\s*:\s*(.*)$/gim

/** A markdown heading — the end of the block a marker opens. */
const HEADING_RE = /^ {0,3}#{1,6}\s/

/**
 * One facet line: `- Composition: …`, `**Controls:** …`, `> States: …`. The
 * trailing `behaviour` variant is accepted for `Post-submit`, which is how the
 * canon says it in prose.
 */
const FACET_RE = new RegExp(
  `^[ \\t>*_+-]*\\*{0,2}(${FACETS.join('|')})(?:\\s+behaviou?r)?\\*{0,2}\\s*:\\s*(.*)$`,
  'i',
)

/**
 * An unfilled value — the PR template's own angle-bracket line, or a stand-in.
 * Byte-identical to `stage-b-lint.mjs`'s set on purpose: `n/a` is NOT a
 * placeholder at the facet level (`Post-submit: n/a` on a read-only screen is a
 * recorded decision), and a fully parenthesised value is a real answer too.
 * `n/a` is only refused at the MARKER level, by `isLeadCertified` below.
 */
const PLACEHOLDER_RE = /^(<.*>|tbd|pending.*|todo.*|\?+)$/i

/**
 * `N/A (no UX decisions) — lead-certified` — the lead self-certification, the
 * shape `Stage-B:` uses for the same purpose and for the same reason. Any dash
 * the shape is written with is accepted; a bare `N/A` is not.
 */
const LEAD_CERTIFIED_RE = /^\**n\/a\b[\s\S]*[-–—]\s*lead-certified\b/i

/** Is this marker value the lead self-certification? */
export function isLeadCertified(value) {
  return LEAD_CERTIFIED_RE.test(String(value ?? '').trim())
}

/**
 * Every `UX-record:` block in a text blob. Text that TALKS ABOUT the block
 * without recording one — HTML comments, fenced code blocks — is stripped first
 * by the shared `stripNonEvidence` (lib/guard.mjs), the same rule `stage-b`,
 * `spec-link` and `spec-deletion` run on their own markers. Without it the
 * realistic failure is the PR template's own instruction comment reading as a
 * filled record.
 *
 * A block runs from its marker line to the next markdown heading, the next
 * marker, or the end of the text — so a later `## Notes` section cannot lend
 * facets to a record that does not have them.
 *
 * @param {string|null|undefined} text
 * @returns {{value: string, facets: Record<string, string>}[]}
 */
export function extractRecords(text) {
  const semantic = stripNonEvidence(text)
  const lines = semantic.split(/\r?\n/)
  const starts = []
  for (let i = 0; i < lines.length; i++) {
    MARKER_RE.lastIndex = 0
    const m = MARKER_RE.exec(lines[i])
    if (m) starts.push({ index: i, value: (m[1] ?? '').replace(/^[\s*_]+/, '').trim() })
  }

  return starts.map((start, n) => {
    const end = starts[n + 1]?.index ?? lines.length
    const facets = {}
    for (let i = start.index + 1; i < end; i++) {
      if (HEADING_RE.test(lines[i])) break
      const m = FACET_RE.exec(lines[i])
      if (!m) continue
      const key = m[1].toLowerCase()
      const value = (m[2] ?? '').trim()
      if (facets[key] === undefined) facets[key] = value
    }
    return { value: start.value, facets }
  })
}

/** The facets a record leaves unrecorded, in canon order. */
export function missingFacetsOf(record) {
  return FACETS.filter((facet) => {
    const value = record?.facets?.[facet]
    return value === undefined || value === '' || PLACEHOLDER_RE.test(value)
  })
}

const SHAPE = [
  '    UX-record:',
  ...FACETS.map((f) => `    - ${f[0].toUpperCase()}${f.slice(1)}: <the decision>`),
  '',
  '  or, for a view-layer diff that decides no UX at all:',
  '',
  '    UX-record: N/A (no UX decisions) — lead-certified',
]

/**
 * The pure seam: given a `gh pr view --json number,body,files` payload and the
 * comment bodies of its linked issues, decide the verdict. No IO.
 *
 * @param {{number?: number, body?: string, files?: ({path: string}|string)[]}} pr
 * @param {string[]} [issueComments]
 * @returns {{userFacing: boolean, verdict: 'skip'|'pass'|'violation',
 *            renderFiles: string[], missingFacets: string[], evidence: string|null,
 *            message: string}}
 */
export function checkUxRecord(pr, issueComments = []) {
  const files = (pr?.files ?? []).map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
  const rendered = renderFiles(files)
  const number = pr?.number ?? '?'

  if (rendered.length === 0) {
    return {
      userFacing: false,
      verdict: 'skip',
      renderFiles: [],
      missingFacets: [],
      evidence: null,
      message: `PR #${number}: no UI diff (no non-test *.tsx / *.css under src/), the UX record does not apply`,
    }
  }

  const records = [
    ...extractRecords(pr?.body ?? ''),
    ...issueComments.flatMap((c) => extractRecords(c)),
  ]

  const certified = records.find((r) => isLeadCertified(r.value))
  if (certified) {
    return {
      userFacing: true,
      verdict: 'pass',
      renderFiles: rendered,
      missingFacets: [],
      evidence: certified.value,
      message: `PR #${number}: UX record lead-certified — "${certified.value.slice(0, 80)}"`,
    }
  }

  const scored = records.map((r) => ({ record: r, missing: missingFacetsOf(r) }))
  const complete = scored.find((s) => s.missing.length === 0)
  if (complete) {
    return {
      userFacing: true,
      verdict: 'pass',
      renderFiles: rendered,
      missingFacets: [],
      evidence: complete.record.facets.composition ?? '',
      message: `PR #${number}: UX record complete — all ${FACETS.length} facets recorded`,
    }
  }

  // The most complete attempt is the one worth reporting against: telling an
  // author who filled five facets that the whole block is missing sends them
  // to rewrite what is already there.
  const best = scored.slice().sort((a, b) => a.missing.length - b.missing.length)[0] ?? null
  const missing = best ? best.missing : [...FACETS]
  const head =
    best === null
      ? `PR #${number} is a UI diff (${rendered.length} view file(s), e.g. ${rendered.slice(0, 3).join(', ')}) and records NO UX-record block.`
      : `PR #${number} is a UI diff and its UX-record block leaves ${missing.length} of ${FACETS.length} facet(s) unrecorded: ${missing.join(', ')}.`

  return {
    userFacing: true,
    verdict: 'violation',
    renderFiles: rendered,
    missingFacets: missing,
    evidence: null,
    message: [
      head,
      'Composition, control choice, grouping, states, feedback and post-submit behaviour are the',
      "AGENT's decision (owner ruling, Антон, 2026-09-02) — taken by the agent and recorded here.",
      'Procedure: .claude/skills/build-ui-from-design-system/SKILL.md step 4.',
      'Record it in the PR body (or a comment on the linked issue), as:',
      ...SHAPE,
    ].join('\n'),
  }
}

// ── gh access (argv arrays, never a shell string — `tools/gh/lib/gh.mjs` canon) ─

export function ghPrArgs(prNumber) {
  return ['pr', 'view', String(prNumber), '--repo', REPO, '--json', 'number,body,files']
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

/** `--severity block` / `--severity=block` / `UX_RECORD_SEVERITY=block`; WARN by default. */
export function severityFromArgv(argv = [], env = {}) {
  const args = argv ?? []
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a.startsWith('--severity='))
      return a.slice('--severity='.length) === 'block' ? 'block' : 'warn'
    if (a === '--severity') return String(args[i + 1] ?? '') === 'block' ? 'block' : 'warn'
  }
  return env.UX_RECORD_SEVERITY === 'block' ? 'block' : 'warn'
}

/**
 * Full CLI parse: the PR number (positional, else `PR_NUMBER` from env) and the
 * severity. The flag's VALUE is consumed, so `--severity block` does not eat the
 * env fallback's place — the two documented invocation forms combine (the
 * regression `stage-b` fixed in review of PR #151, not re-introduced here).
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
export function runUxRecordLint({ prNumber, severity = 'warn', gh = defaultGh }) {
  const lines = []
  const prRes = ghJson(gh, ghPrArgs(prNumber))
  if (!prRes.ok) {
    lines.push(`${TAG} ERROR: cannot read PR #${prNumber}: ${prRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }

  const comments = []
  for (const issue of extractLinkedIssues(prRes.data?.body ?? '')) {
    const issueRes = ghJson(gh, ghIssueArgs(issue))
    if (!issueRes.ok) {
      lines.push(
        `${TAG} note: linked issue #${issue} unreadable (${issueRes.error}) — not evidence`,
      )
      continue
    }
    comments.push(...(issueRes.data?.comments ?? []).map((c) => c?.body ?? ''))
  }

  const result = checkUxRecord(prRes.data, comments)
  if (result.verdict === 'violation') {
    const level = severity === 'block' ? 'BLOCK' : 'WARN'
    lines.push(`${TAG} ${level}: ${result.message}`)
    if (level === 'WARN')
      lines.push(`${TAG} WARN severity (docs/ci-guardrails.md §5 — earliest promotion 2026-09-30)`)
    return { verdict: 'violation', exitCode: severity === 'block' ? 1 : 0, lines }
  }
  lines.push(`${TAG} OK: ${result.message}`)
  return { verdict: result.verdict, exitCode: 0, lines }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  return [
    'Usage: pnpm lint:ux-record <PR number> [--severity warn|block]',
    '',
    "Checks that a UI PR records the agent's UX decisions before merge (#433).",
    'Severity is WARN today (docs/ci-guardrails.md §5 — earliest promotion 2026-09-30).',
  ].join('\n')
}

function main(argv) {
  const { prNumber, severity } = parseArgs(argv, process.env)
  if (prNumber === null) {
    process.stderr.write(`${usage()}\n`)
    return 2
  }
  const { exitCode, lines } = runUxRecordLint({ prNumber: Number(prNumber), severity })
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
