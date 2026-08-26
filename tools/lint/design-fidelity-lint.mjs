#!/usr/bin/env node
// bbm-portal — the design-FIDELITY gate (#359).
//
// WHY THIS EXISTS. `stage-b` asks whether an owner ACCEPTED a surface. This guard
// asks the question one step earlier: was the surface ever DESIGNED? Retro
// 2026-08-26 — `design-source/p-launcher.html`, a Stage-A LAYOUT wireframe, was
// treated as the fidelity source of truth across #312/#314: the kit's tokens were
// derived from its greys, PR #354 shipped its idioms as UI, and the reviewer
// blocked deviations FROM it. The owner rejected the stand. Every input was
// present — the README row literally said "wireframe" — and nothing checked it.
//
// THE AXIS. `fidelity` is orthogonal to the original/export/build lineage the
// provenance row already carries:
//   wireframe — a LAYOUT choice only. It says where things sit, never how they
//               look. Building visual language from one is the #354 incident.
//   visual    — a visual decision is fixed: a visual mockup, OR a named standard
//               design system + version (`system: shadcn/ui via ui.refine.dev @
//               default theme`), which needs no vendored file at all (owner
//               decision on #359/#360, 2026-08-26).
//   canvas    — a visual design that lives as a Claude Design canvas.
// `visual` and `canvas` satisfy the gate; `wireframe` does not.
//
// WHAT IT CHECKS, given a PR:
//   1. wireframe    — a UI diff file whose covering row is `fidelity: wireframe`
//                     and no owner GO on the visual language is recorded.
//   2. no-source    — a file ADDED under `src/app` that is a route file (page /
//                     layout / template / default / error / not-found / loading)
//                     and no `design-source/` row covers it at all.
//   3. batched-scope— a `batched at #N` marker whose `covers` globs do not reach
//                     the file it is supposed to excuse.
//   4. bad-row      — an index row whose `Fidelity` cell is missing or unknown;
//                     reported when the PR ships a UI diff or touches the index
//                     itself, so a typo cannot silently disable the whole gate
//                     while also not reddening an unrelated backend PR.
// The UI-diff definition is `lint:stage-b`'s own (`renderFiles`, imported rather
// than re-written — one rule, one copy; the lesson of `stripNonEvidence`).
//
// THE RECORD. The two sanctioned marker shapes, in the PR body or a comment on a
// linked (`Closes #N` / `Part of #N`) issue:
//   Design-fidelity: GO — <owner, date> — <what visual language was approved>
//   Design-fidelity: batched at #<gate> covers `<glob>`[, `<glob>`]
// A bare `GO` is not a record, for the reason `stage-b` spells out: the value
// stands in for a decision a named person took on a named day. The GO may cite an
// owner decision adopting a standard system's default theme — it does not have to
// be a per-mockup «принято». Text that only TALKS ABOUT the marker — an HTML
// comment, a fenced example — is stripped before extraction (`stripNonEvidence`).
//
// SEVERITY: BLOCK, from day one, and with NO severity dial — a flag here could
// only ever weaken the gate (the reasoning `instruction-budget` records in canon
// §6.1). Register row: docs/ci-guardrails.md §5. Job: the `design-fidelity` job of
// .github/workflows/ci.yml, in the `ci` meta-job's needs-list, no
// `continue-on-error` — which is what §2.1 says BLOCK *is*.
//
// An `error` (the PR or the index cannot be read) exits 1 too: a guard that never
// ran must not be indistinguishable from a clean check.
//
// Run locally before merge: `pnpm lint:design-fidelity <PR>`.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  extractPartOfIssues,
  isEntryPoint,
  repoRoot,
  stripNonEvidence,
  toPosix,
} from './lib/guard.mjs'
import { extractClosedIssues, renderFiles } from './stage-b-lint.mjs'

const TAG = '[design-fidelity]'

export const REPO = 'bbm-academy-org/bbm-portal'

/** The index that carries the rows, relative to the repo root. */
export const INDEX_PATH = 'design-source/README.md'

/** The fidelity axis. The first value is the one that stops a build. */
export const FIDELITY_VALUES = ['wireframe', 'visual', 'canvas']

/** The fidelity values that ARE a visual decision, and therefore clear the gate. */
const VISUAL_FIDELITY = new Set(['visual', 'canvas'])

/**
 * A Next.js route file: the files that MAKE a route exist. A new one of these
 * with no design source is the «built from prose» class outright, whereas a
 * shared component under `src/ui` or `src/components` is not a surface of its own.
 */
const ROUTE_FILE_RE =
  /^src\/app\/(?:.*\/)?(page|layout|template|default|error|not-found|loading)\.tsx$/

/** The `Design-fidelity:` line, anywhere in a body/comment, through decoration. */
const MARKER_RE = /^[ \t>*_-]*design-?fidelity\s*:\s*(.+?)\s*$/gim

/** `GO — Антон, 2026-08-26 …` — the attribution tail is REQUIRED (see header). */
const GO_RE = /^\**go\b\**\s*[-–—:,(]\s*\S/i
/** `batched at #360 covers \`src/app/(platform)/p/**\`` */
const BATCHED_RE = /^\**batched\s+at\s+#(\d+)\b/i
/** An unfilled placeholder — reported distinctly from a missing marker. */
const PLACEHOLDER_RE = /^(<.*>|\(.*\)|tbd|pending.*|todo.*|\?+)$/i

// ── the index ────────────────────────────────────────────────────────────────

/** `\`x\`` -> `x`; a bare `—` / `-` cell -> ''. */
function unquote(cell) {
  const bare = String(cell ?? '')
    .trim()
    .replace(/^`|`$/g, '')
    .trim()
  return bare === '—' || bare === '-' ? '' : bare
}

/** A markdown table row -> its cells, the row's outer pipes dropped. */
function cellsOf(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((c) => c.trim())
}

/**
 * Parse the `## Index` table of `design-source/README.md`.
 *
 * @returns {{found: boolean, rows: object[], badRows: {file: string, fidelity: string,
 *            reason: 'missing-fidelity'|'unknown-fidelity'}[]}}
 */
export function parseIndex(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const start = lines.findIndex((l) => /^#{1,6}\s+Index\b/i.test(l))
  if (start === -1) return { found: false, rows: [], badRows: [] }

  const table = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,6}\s/.test(line)) break
    if (line.trim().startsWith('|')) table.push(line)
  }
  if (table.length < 3) return { found: false, rows: [], badRows: [] }

  const header = cellsOf(table[0]).map((h) => h.toLowerCase())
  const col = (name) => header.findIndex((h) => h.startsWith(name))
  const iFile = col('file')
  const iSurface = col('surface')
  const iCovers = col('covers')
  const iFidelity = col('fidelity')
  const iProvenance = col('provenance')
  if (iFile === -1 || iCovers === -1 || iFidelity === -1)
    return { found: false, rows: [], badRows: [] }

  const rows = []
  const badRows = []
  for (const line of table.slice(1)) {
    const cells = cellsOf(line)
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue // the separator row
    const fileCell = cells[iFile] ?? ''
    const fidelity = (cells[iFidelity] ?? '').trim().toLowerCase()
    if (!fidelity) {
      badRows.push({ file: fileCell, fidelity: '', reason: 'missing-fidelity' })
      continue
    }
    if (!FIDELITY_VALUES.includes(fidelity)) {
      badRows.push({ file: fileCell, fidelity, reason: 'unknown-fidelity' })
      continue
    }
    const systemMatch = /^system\s*:\s*(.+)$/i.exec(unquote(fileCell))
    rows.push({
      file: systemMatch ? null : fileCell,
      system: systemMatch ? systemMatch[1].trim() : null,
      surface: cells[iSurface] ?? '',
      covers: unquote(cells[iCovers] ?? '')
        .split(/[,\s]+/)
        .map((g) => g.replace(/^`|`$/g, '').trim())
        .filter((g) => g && g !== '—' && g !== '-'),
      fidelity,
      provenance: iProvenance === -1 ? '' : (cells[iProvenance] ?? ''),
    })
  }
  return { found: true, rows, badRows }
}

// ── globs ────────────────────────────────────────────────────────────────────

/** `**` -> any depth, `*` -> one segment; everything else is literal (parens too). */
export function globToRegExp(glob) {
  let out = ''
  const g = toPosix(glob)
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        out += '.*'
        i++
        if (g[i + 1] === '/') i++ // `a/**/b` also matches `a/b`
      } else {
        out += '[^/]*'
      }
      continue
    }
    out += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

export function matchesGlob(glob, path) {
  return globToRegExp(glob).test(toPosix(path))
}

/** How specific a glob is: the literal prefix before its first wildcard. */
function specificity(glob) {
  const star = glob.indexOf('*')
  return star === -1 ? glob.length + 1 : star
}

/**
 * The row that OWNS a path: the most specific covering row, so a screen's own row
 * overrides the shell row whose glob it sits inside.
 */
export function coveringRow(rows, path) {
  let best = null
  let bestScore = -1
  for (const row of rows ?? []) {
    for (const glob of row.covers ?? []) {
      if (!matchesGlob(glob, path)) continue
      const score = specificity(glob)
      if (score > bestScore) {
        best = row
        bestScore = score
      }
    }
  }
  return best
}

// ── the marker ───────────────────────────────────────────────────────────────

/** Every `Design-fidelity:` VALUE in a text blob; quoted text never counts. */
export function extractMarkerValues(text) {
  if (!text) return []
  return [...stripNonEvidence(text).matchAll(MARKER_RE)].map((m) =>
    (m[1] ?? '').replace(/^[\s*_]+/, '').trim(),
  )
}

/**
 * Classify one marker value.
 * @returns {{kind: 'go'|'batched'|'placeholder'|'unrecognized', gate?: number, covers?: string[]}}
 */
export function classifyMarker(value) {
  const v = String(value ?? '').trim()
  if (GO_RE.test(v)) return { kind: 'go' }
  const batched = BATCHED_RE.exec(v)
  if (batched) {
    const coversClause = /\bcovers\b[:\s]*(.+)$/i.exec(v)
    const covers = coversClause
      ? coversClause[1]
          .split(/[,\s]+/)
          .map((g) =>
            g
              .replace(/^`|`$/g, '')
              .replace(/[.,;]$/, '')
              .trim(),
          )
          .filter(Boolean)
      : []
    return { kind: 'batched', gate: Number(batched[1]), covers }
  }
  if (PLACEHOLDER_RE.test(v)) return { kind: 'placeholder' }
  return { kind: 'unrecognized' }
}

const SHAPES = [
  '    Design-fidelity: GO — <owner, date> — <the visual language that was approved>',
  '    Design-fidelity: batched at #<gate issue> covers `<path glob>`',
]

// ── the decision ─────────────────────────────────────────────────────────────

/**
 * The pure seam. No IO.
 *
 * @param {{pr: {number?: number, body?: string, files?: {path: string, status?: string}[]},
 *          rows?: object[], badRows?: object[], issueComments?: string[]}} input
 */
export function checkDesignFidelity({ pr, rows = [], badRows = [], issueComments = [] }) {
  const files = (pr?.files ?? []).map((f) =>
    typeof f === 'string' ? { path: f, status: 'modified' } : { path: f?.path, status: f?.status },
  )
  const paths = files.map((f) => f.path).filter(Boolean)
  const uiFiles = renderFiles(paths)
  const indexTouched = paths.some((p) => toPosix(p) === INDEX_PATH)
  const number = pr?.number ?? '?'

  const findings = []
  if (uiFiles.length > 0 || indexTouched) {
    for (const bad of badRows) {
      findings.push({
        kind: 'bad-row',
        path: INDEX_PATH,
        source: bad.file,
        detail:
          bad.reason === 'missing-fidelity'
            ? `row ${bad.file} declares no \`fidelity\``
            : `row ${bad.file} declares fidelity "${bad.fidelity}"`,
      })
    }
  }

  if (uiFiles.length === 0) {
    if (findings.length === 0) {
      return {
        verdict: 'skip',
        uiFiles: [],
        findings: [],
        evidence: null,
        message: `PR #${number}: no UI diff (no non-test *.tsx / *.css under src/), the design-fidelity gate does not apply`,
      }
    }
    return {
      verdict: 'violation',
      uiFiles: [],
      findings,
      evidence: null,
      message: renderMessage(number, findings, []),
    }
  }

  const markers = [
    ...extractMarkerValues(pr?.body ?? ''),
    ...issueComments.flatMap((c) => extractMarkerValues(c)),
  ]
  const classified = markers.map((value) => ({ value, ...classifyMarker(value) }))
  const evidence = classified.find((m) => m.kind === 'go')?.value ?? null
  const batched = classified.filter((m) => m.kind === 'batched')
  const placeholder = classified.find((m) => m.kind === 'placeholder')?.value ?? null

  for (const path of uiFiles) {
    const row = coveringRow(rows, path)
    if (!row) {
      const file = files.find((f) => f.path === path)
      if (file?.status === 'added' && ROUTE_FILE_RE.test(toPosix(path))) {
        findings.push({
          kind: 'no-source',
          path,
          source: null,
          detail: `new route ${path} — no row in ${INDEX_PATH} covers it`,
        })
      }
      continue
    }
    if (VISUAL_FIDELITY.has(row.fidelity)) continue
    if (evidence) continue
    const gate = batched.find((b) => (b.covers ?? []).some((g) => matchesGlob(g, path)))
    if (gate) continue
    const source = row.file ?? `system: ${row.system}`
    findings.push({
      kind: batched.length > 0 ? 'batched-scope' : 'wireframe',
      path,
      source,
      detail:
        batched.length > 0
          ? `${path} is sourced from ${source} (fidelity: wireframe); the batched gate(s) ${batched
              .map((b) => `#${b.gate}`)
              .join(', ')} do not cover it`
          : `${path} is sourced from ${source} (fidelity: wireframe)`,
    })
  }

  if (findings.length === 0) {
    return {
      verdict: 'pass',
      uiFiles,
      findings,
      evidence,
      message: evidence
        ? `PR #${number}: design fidelity recorded — "${evidence.slice(0, 80)}"`
        : `PR #${number}: every touched surface has a visual design source (${uiFiles.length} view file(s))`,
    }
  }

  return {
    verdict: 'violation',
    uiFiles,
    findings,
    evidence: null,
    message: renderMessage(number, findings, classified, placeholder),
  }
}

function renderMessage(number, findings, classified, placeholder = null) {
  const head = `PR #${number}: ${findings.length} design-fidelity finding(s).`
  const body = findings.map((f) => `  - ${f.kind}: ${f.detail}`)
  const tail = []
  if (findings.some((f) => f.kind === 'wireframe' || f.kind === 'batched-scope')) {
    tail.push(
      'A WIREFRAME is a layout choice, not a visual design: a surface whose only source is one is not ready to build.',
      'That is a stop-state question to the owner (.claude/rules/design-process.md §1) — the correct verdict is STOP,',
      'not «make the build match the wireframe». Record the owner decision on the visual language in the PR body or a',
      'linked-issue comment, in one of:',
      ...SHAPES,
      'A standard design system + version named as the source in the index row (fidelity: visual) needs no marker at all.',
    )
  }
  if (findings.some((f) => f.kind === 'no-source')) {
    tail.push(
      `A new route with no row in ${INDEX_PATH} is built from prose. Vendor its design source (or name the standard`,
      'system it adopts) and add the row, with its `Covers` globs and its `Fidelity`, before the build.',
    )
  }
  if (findings.some((f) => f.kind === 'bad-row')) {
    tail.push(
      `Every row of ${INDEX_PATH} declares \`Fidelity\`: one of ${FIDELITY_VALUES.join(' | ')}.`,
    )
  }
  if (placeholder)
    tail.push(`The marker is still the unfilled placeholder "${placeholder.slice(0, 60)}".`)
  else if (classified.some((m) => m.kind === 'unrecognized'))
    tail.push(
      `A \`Design-fidelity:\` marker is present but records nothing: "${classified
        .find((m) => m.kind === 'unrecognized')
        .value.slice(0, 60)}".`,
    )
  return [head, ...body, ...tail].join('\n')
}

// ── gh access (argv arrays, never a shell string — `tools/gh/lib/gh.mjs` canon) ─

export function ghPrArgs(prNumber) {
  return ['pr', 'view', String(prNumber), '--repo', REPO, '--json', 'number,body']
}

/**
 * The file list comes from the REST endpoint rather than `gh pr view --json
 * files`, because the gate needs each file's `status`: «a NEW route with no design
 * source» is a different finding from «this route was touched», and `gh pr view`
 * reports additions/deletions but never added/modified.
 */
export function ghFilesArgs(prNumber) {
  return ['api', `repos/${REPO}/pulls/${prNumber}/files?per_page=100`, '--paginate', '--slurp']
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

/** Issue numbers whose comments may carry this PR's record (`Closes` + `Part of`). */
export function extractLinkedIssues(body) {
  const out = [...extractClosedIssues(body)]
  for (const n of extractPartOfIssues(body)) if (!out.includes(n)) out.push(n)
  return out
}

/** The shipped index, read from the tree (`LINT_FIXTURE_ROOT` honoured via repoRoot). */
export function readIndex() {
  try {
    return readFileSync(resolve(repoRoot(), INDEX_PATH), 'utf8')
  } catch {
    return null
  }
}

/**
 * Fetch the PR, its file list and its linked issues' comments, and run the check.
 *
 * @returns {{verdict: 'skip'|'pass'|'violation'|'error', exitCode: number, lines: string[]}}
 */
export function runDesignFidelityLint({ prNumber, gh = defaultGh, index = readIndex() }) {
  const lines = []
  const parsed = parseIndex(index ?? '')
  if (!parsed.found) {
    lines.push(
      `${TAG} ERROR: cannot read the provenance index (${INDEX_PATH}: no parseable \`## Index\` table with File / Covers / Fidelity columns).`,
    )
    return { verdict: 'error', exitCode: 1, lines }
  }

  const prRes = ghJson(gh, ghPrArgs(prNumber))
  if (!prRes.ok) {
    lines.push(`${TAG} ERROR: cannot read PR #${prNumber}: ${prRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }
  const filesRes = ghJson(gh, ghFilesArgs(prNumber))
  if (!filesRes.ok) {
    lines.push(`${TAG} ERROR: cannot read the file list of PR #${prNumber}: ${filesRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }

  // `--paginate --slurp` returns one array per page; a single page may arrive flat.
  const raw = Array.isArray(filesRes.data) ? filesRes.data.flat() : []
  const files = raw
    .map((f) => ({ path: f?.filename, status: f?.status }))
    .filter((f) => Boolean(f.path))

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

  const result = checkDesignFidelity({
    pr: { number: prRes.data?.number ?? prNumber, body: prRes.data?.body ?? '', files },
    rows: parsed.rows,
    badRows: parsed.badRows,
    issueComments: comments,
  })

  if (result.verdict === 'violation') {
    lines.push(`${TAG} BLOCK: ${result.message}`)
    return { verdict: 'violation', exitCode: 1, lines }
  }
  lines.push(`${TAG} OK: ${result.message}`)
  return { verdict: result.verdict, exitCode: 0, lines }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  return [
    'Usage: pnpm lint:design-fidelity <PR number>',
    '',
    'Fails a UI PR whose touched surface has no VISUAL design source (#359):',
    'a `fidelity: wireframe` row with no recorded owner GO, a new src/app route',
    'with no row at all, or a `batched at #N` gate that does not cover the surface.',
    'Severity: BLOCK (docs/ci-guardrails.md §5) — there is no severity dial.',
  ].join('\n')
}

/** The PR number: positional argv first, then the CI env (`PR_NUMBER` / the ref). */
export function resolvePr(argv = [], env = {}) {
  const positional = argv.map(String).find((a) => /^\d+$/.test(a))
  if (positional) return positional
  const explicit = env.PR_NUMBER || env.GITHUB_PR_NUMBER || ''
  if (/^\d+$/.test(String(explicit))) return String(explicit)
  const m = String(env.GITHUB_REF || '').match(/refs\/pull\/(\d+)\//)
  return m ? m[1] : null
}

function main(argv) {
  const prNumber = resolvePr(argv, process.env)
  if (prNumber === null) {
    // A `push` run of the CI job has no PR to read: nothing to check, not a
    // finding. A human invocation with no argument gets the usage instead.
    if (process.env.GITHUB_ACTIONS) {
      process.stdout.write(`${TAG} OK: not a pull_request event, nothing to check\n`)
      return 0
    }
    process.stderr.write(`${usage()}\n`)
    return 2
  }
  const { exitCode, lines } = runDesignFidelityLint({ prNumber: Number(prNumber) })
  for (const line of lines) {
    if (line.includes('BLOCK') || line.includes('ERROR')) process.stderr.write(`${line}\n`)
    else process.stdout.write(`${line}\n`)
  }
  return exitCode
}

if (isEntryPoint(import.meta.url)) process.exit(main(process.argv.slice(2)))
