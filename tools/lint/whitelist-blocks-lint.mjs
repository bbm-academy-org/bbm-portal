#!/usr/bin/env node
// bbm-portal — whitelist-blocks guard: a settled row is IMPORTED, bespoke needs
// an OWNER record (#482, child of the round-2 block #481).
//
// WHY THIS EXISTS. `docs/design/ui-whitelist.md` has carried three settled rows
// since #434 (Form / List / Feedback) and nothing in CI read it: rung 2 of the
// reuse ladder (`.claude/skills/build-ui-from-design-system/SKILL.md`) was prose
// only, and rung 3's bespoke justification was satisfiable by the agent alone.
// PR #470's `RequestsTable.tsx` hand-built a table out of `@/ui/table`
// primitives instead of the List row's Refine `data-table` block, wrote the
// justification into its OWN doc-comment (`RequestsTable.tsx:41-48`) and into
// the `design-source/README.md` provenance row — i.e. self-certified — and every
// round-1 guard was green. `primitives-first` sees only a RAW `<table>` tag
// (`KIT_EQUIVALENTS`), so a kit-primitive table is invisible to it. The owner
// (Антон) rejected the live stand on 2026-09-15.
//
// This guard makes rung 2 mechanical and moves rung 3's escape hatch into the
// OWNER's hands, exactly as `Design-fidelity:` already does for the visual
// language (`.claude/rules/design-process.md` §1).
//
// WHAT IT CHECKS, on the ADDED lines of ONE PR's diff, in non-test `*.tsx` under
// `src/` outside the kit (`isWhitelistScopeFile`):
//
//   (1) WHITELIST DEPARTURE. A file that BUILDS an element class the registry
//       has settled, without importing that row's settled implementation. Each
//       row's two signals are the table below. When one or more departures are
//       found, the PR body (or a comment on a linked issue) must carry the owner
//       record — otherwise it is a violation.
//   (2) REGISTRY DRIFT. The table below and `docs/design/ui-whitelist.md` name
//       the same element classes. Reported only on a PR that TOUCHES the
//       registry (the `design-fidelity` precedent: a row is checked when the PR
//       ships a UI diff or touches the index itself), so growing the registry
//       teaches the guard in the same PR instead of turning every later PR red.
//       A drift finding is NOT clearable by the owner record: it is a statement
//       about this guard, not about the surface.
//
// THE OWNER RECORD, in the PR body or a linked-issue comment:
//
//     Bespoke-UI: GO — <owner, date> — <what was approved>
//
// The tail is part of the record, exactly as with `Stage-B:` and
// `Design-fidelity:`: a bare `Bespoke-UI: GO`, a `TBD`, an unfilled
// angle-bracket slot, an HTML comment and a fenced example are all refused. The
// non-record token set is the CLOSED set `design-fidelity` settled on in review
// of PR #371 — a heuristic «a record must look like a name plus a date» cannot
// be written without guessing at name and date formats, and every guess refuses
// a real owner GO, which on a BLOCK gate is the expensive failure.
//
// ── THE ROW TABLE ────────────────────────────────────────────────────────────
// One table, derived from `docs/design/ui-whitelist.md`'s `## Entries`, so the
// guard and the registry cannot drift silently — and check (2) proves they have
// not. Each row's DEPARTURE signal is deliberately an added IMPORT (or, for
// `Form` / `Feedback`, an added call/tag that has no import of its own), never a
// bare JSX usage: an import is what says «this diff introduces this build here»,
// while `<TableRow>` alone appears in one-line edits to screens that already
// compose the block, which would be a false positive on a BLOCK gate.
//
//   | Class    | Settled implementation (registry)                   | Departure signal          |
//   | -------- | --------------------------------------------------- | ------------------------- |
//   | Form     | `@/ui/form` over react-hook-form + zod              | a raw `<form>` opening tag |
//   | List     | `@/ui/refine-ui/data-table/*` over `useTable`        | an `@/ui/table` import / raw `<table>` |
//   | Feedback | Refine notification provider → `@/ui/sonner` toasts  | `alert()` / `confirm()`   |
//
// THE HONEST LIMIT, named rather than discovered. The Feedback row is the weak
// one: a bespoke in-component banner is not detectable from imports (an inline
// `Alert` is LEGITIMATE per the registry's own note — a state the reader must
// keep looking at), so the departure signal is narrowed to the browser dialog
// used as the outcome channel. The guard can therefore miss a Feedback
// departure; it cannot invent one. `#482`'s regression target is the List row,
// and that one is exact. Same conservative direction as the whole family
// (docs/ci-guardrails.md §8).
//
// `*.css` is deliberately OUT of scope even though the stage-3 «UI diff»
// definition includes it: a stylesheet imports no block, so no rule here can
// have anything to say about one.
//
// SEVERITY: BLOCK from day one — `docs/ci-guardrails.md` §5 (row
// `whitelist-blocks`) is the severity of record, under the §3 **class 3** day-0
// mandate, the `design-fidelity` precedent. As with `stage-b` and
// `primitives-first`, the SCRIPT still defaults to reporting a violation and
// exiting 0; `--severity block` (or `WHITELIST_BLOCKS_SEVERITY=block`) makes the
// same violation exit 1, and the CI job passes that flag.
//
// An `error` (the PR cannot be read at all) is NOT a violation and does NOT
// follow the severity dial: it exits 1 under every severity. A guard that exits
// 0 when it never ran is indistinguishable from a clean check (canon §8).
//
// Run locally before merge: `pnpm lint:whitelist-blocks <PR>`.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { prFilesArgs, prFilesPageSize, PR_FILES_MAX_PAGES } from './lib/gh.mjs'
import { extractPartOfIssues, isEntryPoint, repoRoot, stripNonEvidence } from './lib/guard.mjs'
import { addedLines, addedSource, findTagEnd, normalizePatchPage } from './lib/ui-diff.mjs'

const TAG = '[whitelist-blocks]'

export const REPO = 'bbm-academy-org/bbm-portal'

/** The registry this guard reads; also the path whose touch arms the drift check. */
export const REGISTRY_PATH = 'docs/design/ui-whitelist.md'

/**
 * The settled rows of `docs/design/ui-whitelist.md`, as the guard reads them.
 * `departure` — the shapes a HAND-BUILT instance of the class takes in a diff.
 * `settled` — importing (or composing) any of these clears the file for that row.
 * See the header's table and its «honest limit» paragraph for why each signal is
 * what it is.
 */
export const WHITELIST_ROWS = Object.freeze([
  Object.freeze({
    class: 'Form',
    settledImplementation: '`@/ui/form` (shadcn `form` block over react-hook-form + zod)',
    departure: /<form(?=[\s/>])/m,
    settled:
      /['"`]@\/ui\/form['"`]|<Form(?=[\s/>])|['"`]react-hook-form['"`]|['"`]@hookform\/resolvers/,
    hint: 'compose the kit `Form` block — `@/ui/form` (`Form`, `FormField`, `FormItem`, `FormControl`, `FormMessage`) with one zod schema per form',
  }),
  Object.freeze({
    class: 'List',
    settledImplementation:
      '`@/ui/refine-ui/data-table/data-table` + `data-table-pagination`, driven by `useTable`',
    departure: /['"`]@\/ui\/table['"`]|<table(?=[\s/>])/m,
    settled:
      /['"`]@\/ui\/refine-ui\/data-table|['"`]@refinedev\/react-table['"`]|<DataTable(?=[\s/>])/,
    hint: 'compose the Refine `data-table` block — `@/ui/refine-ui/data-table/data-table` + `data-table-pagination` over `useTable`; the screen owns only its `ColumnDef[]`',
  }),
  Object.freeze({
    class: 'Feedback',
    settledImplementation:
      "Refine's notification provider rendering into the shadcn `sonner` `Toaster` (`@/ui/sonner`)",
    departure: /(?:^|[^.\w])(?:window\.)?(?:alert|confirm)\s*\(/m,
    settled:
      /['"`]@\/ui\/sonner['"`]|['"`]sonner['"`]|useNotificationProvider|['"`]@\/ui\/refine-ui\/notification/,
    hint: 'report the outcome through the ONE settled channel — Refine’s `successNotification` / `errorNotification`, or `toast.*` from `sonner` for a component that does not go through Refine',
  }),
])

// ── scope ────────────────────────────────────────────────────────────────────

/** The view layer this guard judges: `*.tsx` under `src/`. */
export const SCOPE_RE = /^src\/.*\.tsx$/

/**
 * Inside the scope but carrying no whitelist obligation: tests, and `src/ui`
 * itself — the kit is WHERE both the blocks and the primitives live, so a kit
 * file importing `@/ui/table` is the settled implementation, not a departure.
 */
export const EXEMPT_RE = /(\.spec\.tsx?$|\.test\.tsx?$|^src\/ui\/)/

/** Is this repo-relative path a view file the whitelist rows apply to? */
export function isWhitelistScopeFile(path) {
  const p = String(path ?? '').replace(/\\/g, '/')
  return SCOPE_RE.test(p) && !EXEMPT_RE.test(p)
}

// ── the registry, and the drift check ────────────────────────────────────────

/** A row of the registry's `## Entries` table: `| **<Class>** — …` */
const REGISTRY_ROW_RE = /^\|\s*\*\*([^*|]+?)\*\*/gm

/**
 * The element classes the shipped registry settles, in table order. Only the
 * `## Entries` table is read: the sections below it name classes in prose.
 */
export function registryClasses(markdown) {
  const text = String(markdown ?? '')
  const start = text.search(/^##\s+Entries\s*$/m)
  if (start === -1) return []
  const rest = text.slice(start)
  const end = rest.slice(1).search(/^##\s+/m)
  const table = end === -1 ? rest : rest.slice(0, end + 1)
  return [...table.matchAll(REGISTRY_ROW_RE)].map((m) => m[1].trim())
}

/** The shipped registry, read from the tree (`LINT_FIXTURE_ROOT` honoured via `repoRoot`). */
export function readRegistry() {
  try {
    return readFileSync(resolve(repoRoot(), REGISTRY_PATH), 'utf8')
  } catch {
    return null
  }
}

// ── the owner record ─────────────────────────────────────────────────────────

/** The `Bespoke-UI:` line, anywhere in a body/comment, through list/quote decoration. */
const MARKER_RE = /^[ \t>*_-]*bespoke-?ui\s*:\s*(.+?)\s*$/gim

/** `GO — Антон, 2026-09-15 — <what>` — the tail is REQUIRED (see the header). */
const GO_RE = /^\**go\b\**\s*[-–—:,(]\s*(\S.*)$/i

/**
 * A token that ANNOUNCES the absence of a decision. The CLOSED set
 * `design-fidelity` settled on (review of PR #371) — copied rather than shared
 * because widening it would silently change that guard, which is a different
 * decision than this PR's. Extend the set when a new one is observed.
 */
const NON_RECORD_RE =
  /^(?:tbd|to-?do|pending|later|none|wip|n\s*\/\s*a|n\.\s*a\.?|\?+|[-–—]+)(?:\W[\s\S]*)?$/i

/** An unfilled placeholder — reported distinctly from a missing marker. */
const PLACEHOLDER_RE = /^(?:<.*>|\(.*\))$/i

/** An angle-bracket slot of the printed shape: `<owner, date>`, `<what was approved>`. */
const ANGLE_SLOT_RE = /<[^<>]*>/g

/** Does anything survive removing the printed shape's unfilled slots? */
function filledRemainder(text) {
  return (
    String(text ?? '')
      .replace(ANGLE_SLOT_RE, '')
      .replace(/[\s—–\-:,.()]+/g, '').length > 0
  )
}

/** Neither a filled slot nor a decision: the two shapes that are not a record. */
function isNonRecord(text) {
  const v = String(text ?? '').trim()
  return v === '' || PLACEHOLDER_RE.test(v) || NON_RECORD_RE.test(v)
}

/** Every `Bespoke-UI:` VALUE in a text blob; quoted text never counts. */
export function extractMarkerValues(text) {
  if (!text) return []
  return [...stripNonEvidence(text).matchAll(MARKER_RE)].map((m) =>
    (m[1] ?? '').replace(/^[\s*_]+/, '').trim(),
  )
}

/**
 * Classify one marker value.
 * @returns {{kind: 'go'|'placeholder'|'unrecognized'}}
 */
export function classifyMarker(value) {
  const v = String(value ?? '').trim()
  // PLACEHOLDER FIRST: the violation message hands the blocked session the
  // marker SHAPE, and pasting it back unfilled must not clear the gate.
  if (isNonRecord(v)) return { kind: 'placeholder' }
  const go = GO_RE.exec(v)
  if (go)
    return filledRemainder(go[1]) && !isNonRecord(go[1]) ? { kind: 'go' } : { kind: 'placeholder' }
  return { kind: 'unrecognized' }
}

const SHAPES = ['    Bespoke-UI: GO — <owner, date> — <what was approved>']

// ── the decision ─────────────────────────────────────────────────────────────

/**
 * The pure seam: given the `{ filename, patch }` entries of a PR's changed
 * files, its body, its linked issues' comments and (optionally) the registry
 * markdown, decide the verdict. No IO.
 *
 * @param {{pr: {number?: number, body?: string, files?: {filename?: string, path?: string, patch?: string}[]},
 *          issueComments?: string[], registry?: string|null}} input
 * @returns {{verdict: 'skip'|'pass'|'violation', scanned: string[],
 *            findings: {file: string|null, line: number|null, class: string|null,
 *                       rule: 'whitelist-departure'|'registry-drift', message: string}[],
 *            marker: 'go'|'placeholder'|'unrecognized'|null, message: string}}
 */
export function checkWhitelistBlocks({ pr, issueComments = [], registry = null }) {
  const number = pr?.number ?? '?'
  const files = (pr?.files ?? []).map((f) => ({
    path: String(f?.filename ?? f?.path ?? ''),
    patch: f?.patch ?? '',
  }))
  const inScope = files.filter((f) => isWhitelistScopeFile(f.path))
  const touchesRegistry = files.some((f) => f.path.replace(/\\/g, '/') === REGISTRY_PATH)

  // ── (2) registry drift — only on a PR that touches the registry ───────────
  const driftFindings = []
  if (registry !== null && touchesRegistry) {
    const known = new Set(WHITELIST_ROWS.map((r) => r.class))
    const settled = registryClasses(registry)
    for (const cls of settled) {
      if (!known.has(cls))
        driftFindings.push({
          file: REGISTRY_PATH,
          line: null,
          class: cls,
          rule: 'registry-drift',
          message:
            `${REGISTRY_PATH} settles the element class "${cls}" and this guard's row table does ` +
            `not cover it — a row nothing reads is the state #482 exists to end. Add a ` +
            `\`WHITELIST_ROWS\` entry (departure signal + settled import) in ` +
            `tools/lint/whitelist-blocks-lint.mjs, in THIS PR.`,
        })
    }
    const settledSet = new Set(settled)
    for (const cls of known) {
      if (!settledSet.has(cls))
        driftFindings.push({
          file: REGISTRY_PATH,
          line: null,
          class: cls,
          rule: 'registry-drift',
          message:
            `this guard's row table covers the element class "${cls}" and ${REGISTRY_PATH} no ` +
            `longer settles it — drop the \`WHITELIST_ROWS\` entry, or restore the row.`,
        })
    }
  }

  // ── (1) whitelist departures ─────────────────────────────────────────────
  const departures = []
  for (const f of inScope) {
    const lines = addedLines(f.patch)
    if (lines.length === 0) continue
    const src = addedSource(lines)
    for (const row of WHITELIST_ROWS) {
      const m = row.departure.exec(src.text)
      if (!m) continue
      // A raw tag that never closes its opening bracket in the added lines is a
      // fragment of a larger edit, not a tag this diff opened.
      if (m[0].startsWith('<') && findTagEnd(src.text, m.index ?? 0) === -1) continue
      if (row.settled.test(src.text)) continue
      departures.push({
        file: f.path,
        line: src.lineAt(m.index ?? 0),
        class: row.class,
        rule: 'whitelist-departure',
        message:
          `builds the "${row.class}" element class out of primitives while ` +
          `${REGISTRY_PATH} settles it on ${row.settledImplementation} — ${row.hint}. ` +
          `Departing from a settled row is the OWNER's call, not the component's own ` +
          `doc-comment (.claude/rules/design-process.md §1, #481/#482).`,
      })
    }
  }

  const scanned = inScope.map((f) => f.path)

  if (departures.length === 0 && driftFindings.length === 0) {
    return {
      verdict: inScope.length === 0 && !touchesRegistry ? 'skip' : 'pass',
      scanned,
      findings: [],
      marker: null,
      message:
        inScope.length === 0
          ? `PR #${number}: no view code in scope (non-test *.tsx under src/, outside src/ui)`
          : `PR #${number}: ${scanned.length} view file(s) in the diff: every settled whitelist row it builds is imported`,
    }
  }

  // The owner record clears DEPARTURES only. Drift is about this guard's table.
  let marker = null
  if (departures.length > 0) {
    const values = [
      ...extractMarkerValues(pr?.body ?? ''),
      ...issueComments.flatMap((c) => extractMarkerValues(c)),
    ]
    const kinds = values.map((v) => classifyMarker(v).kind)
    marker = kinds.includes('go') ? 'go' : (kinds[0] ?? null)
  }

  const unresolved = marker === 'go' ? [] : departures
  const findings = [...unresolved, ...driftFindings].sort(
    (a, b) => String(a.file).localeCompare(String(b.file)) || (a.line ?? 0) - (b.line ?? 0),
  )

  if (findings.length === 0) {
    return {
      verdict: 'pass',
      scanned,
      findings: [],
      marker,
      message:
        `PR #${number}: ${departures.length} whitelist departure(s) recorded by the owner ` +
        `(\`Bespoke-UI: GO\`) — ${departures.map((d) => `${d.file} (${d.class})`).join(', ')}`,
    }
  }

  const head =
    unresolved.length === 0
      ? `PR #${number} touches ${REGISTRY_PATH} and this guard's row table no longer matches it.`
      : marker === null
        ? `PR #${number} departs from ${unresolved.length} settled whitelist row(s) and records NO owner decision.`
        : `PR #${number} departs from ${unresolved.length} settled whitelist row(s) and its \`Bespoke-UI:\` marker is not a record (${marker}).`

  return {
    verdict: 'violation',
    scanned,
    findings,
    marker,
    message: [
      head,
      ...findings.map((f) => `  ${f.file}${f.line ? `:${f.line}` : ''}: ${f.message}`),
      ...(unresolved.length > 0
        ? [
            'Either import the settled block, or record the OWNER’s decision in the PR body',
            '(or a comment on the linked issue), tail included:',
            ...SHAPES,
          ]
        : []),
    ].join('\n'),
  }
}

// ── gh access (argv arrays, never a shell string — `tools/gh/lib/gh.mjs` canon) ─

export function ghPrArgs(prNumber) {
  return ['pr', 'view', String(prNumber), '--repo', REPO, '--json', 'number,body']
}

/**
 * ONE page of the PR's changed files, WITH the patch. `lib/gh.mjs`'s
 * `normalizeFilesPage` drops `patch`; this guard reads the diff CONTENT, so it
 * keeps `normalizePatchPage` over the same argv builder and page bound (§8).
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

/**
 * Every changed file of the PR, with its patch, paged. Exhausting the page bound
 * is an ERROR rather than a truncated success: a guard that read part of the
 * diff has not cleared the diff (§8).
 */
export function fetchPrPatches(gh, prNumber) {
  const perPage = prFilesPageSize()
  const all = []
  for (let page = 1; page <= PR_FILES_MAX_PAGES; page++) {
    const res = ghJson(gh, ghFilesArgs(prNumber, page, perPage))
    if (!res.ok) return res
    const entries = normalizePatchPage(res.data)
    all.push(...entries)
    if (entries.length < perPage) return { ok: true, data: all }
  }
  return {
    ok: false,
    error: `PR has more than ${PR_FILES_MAX_PAGES * perPage} changed files — refusing to judge a truncated set`,
  }
}

/** GitHub auto-close keywords — the same set GitHub itself acts on. */
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi

/** Every issue whose comments may carry this PR's record: `Closes #N` plus `Part of #N`. */
export function extractLinkedIssues(body) {
  const out = []
  for (const m of String(body ?? '').matchAll(CLOSE_RE)) {
    const n = Number(m[1])
    if (!out.includes(n)) out.push(n)
  }
  for (const n of extractPartOfIssues(body)) if (!out.includes(n)) out.push(n)
  return out
}

/** `--severity block` / `--severity=block` / `WHITELIST_BLOCKS_SEVERITY=block`; WARN by default. */
export function severityFromArgv(argv = [], env = {}) {
  const args = argv ?? []
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a.startsWith('--severity='))
      return a.slice('--severity='.length) === 'block' ? 'block' : 'warn'
    if (a === '--severity') return String(args[i + 1] ?? '') === 'block' ? 'block' : 'warn'
  }
  return env.WHITELIST_BLOCKS_SEVERITY === 'block' ? 'block' : 'warn'
}

/**
 * Full CLI parse: the PR number (positional, else `PR_NUMBER` from env), the
 * severity, and `--help`. The flag's VALUE is consumed, so `--severity block`
 * does not eat the env fallback's place (the regression `stage-b` fixed in
 * review of PR #151).
 */
export function parseArgs(argv = [], env = {}) {
  const severity = severityFromArgv(argv, env)
  const help = (argv ?? []).map(String).some((a) => a === '--help' || a === '-h')
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i])
    if (a === '--severity') {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    positional.push(a)
  }
  const candidate = positional[0] ?? env.PR_NUMBER ?? ''
  return { prNumber: /^\d+$/.test(String(candidate)) ? String(candidate) : null, severity, help }
}

/**
 * Fetch the PR, its diff and its linked issues' comments, and run the check.
 *
 * @returns {{verdict: 'skip'|'pass'|'violation'|'error', exitCode: number, lines: string[]}}
 */
export function runWhitelistBlocksLint({
  prNumber,
  severity = 'warn',
  gh = defaultGh,
  registry = readRegistry(),
}) {
  const lines = []
  const prRes = ghJson(gh, ghPrArgs(prNumber))
  if (!prRes.ok) {
    lines.push(`${TAG} ERROR: cannot read PR #${prNumber}: ${prRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }
  const filesRes = fetchPrPatches(gh, prNumber)
  if (!filesRes.ok) {
    lines.push(`${TAG} ERROR: cannot read the diff of PR #${prNumber}: ${filesRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }

  const body = prRes.data?.body ?? ''
  const comments = []
  for (const issue of extractLinkedIssues(body)) {
    const issueRes = ghJson(gh, ghIssueArgs(issue))
    if (!issueRes.ok) {
      lines.push(
        `${TAG} note: linked issue #${issue} unreadable (${issueRes.error}) — not evidence`,
      )
      continue
    }
    comments.push(...(issueRes.data?.comments ?? []).map((c) => c?.body ?? ''))
  }

  const result = checkWhitelistBlocks({
    pr: { number: prRes.data?.number ?? prNumber, body, files: filesRes.data },
    issueComments: comments,
    registry,
  })

  if (result.verdict === 'violation') {
    const level = severity === 'block' ? 'BLOCK' : 'WARN'
    lines.push(`${TAG} ${level}: ${result.message}`)
    if (level === 'WARN')
      lines.push(
        `${TAG} WARN severity here only because --severity warn was passed (docs/ci-guardrails.md §5 — BLOCK on the CI plane since 2026-09-15)`,
      )
    return { verdict: 'violation', exitCode: severity === 'block' ? 1 : 0, lines }
  }
  lines.push(`${TAG} OK: ${result.message}`)
  return { verdict: result.verdict, exitCode: 0, lines }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  return [
    'Usage: pnpm lint:whitelist-blocks <PR number> [--severity warn|block]',
    '',
    'Fails a UI PR that builds an element class `docs/design/ui-whitelist.md` has',
    'already settled (Form / List / Feedback) out of primitives instead of importing',
    "that row's block, unless the PR body or a linked-issue comment records the",
    "OWNER's decision (#482):",
    '',
    ...SHAPES,
    '',
    'Exit codes:',
    '  0  clean, or nothing to check (no view code in scope; a violation under',
    '     --severity warn, which is the local default)',
    '  1  findings under --severity block (the flag CI passes), or an ERROR — the PR',
    '     could not be read, which exits 1 under EVERY severity',
    '  2  usage: no PR number could be resolved from argv or PR_NUMBER',
    '',
    'Severity of record: docs/ci-guardrails.md §5, row `whitelist-blocks` (BLOCK).',
  ].join('\n')
}

function main(argv) {
  const { prNumber, severity, help } = parseArgs(argv, process.env)
  if (help) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  if (prNumber === null) {
    process.stderr.write(`${usage()}\n`)
    return 2
  }
  const { exitCode, lines } = runWhitelistBlocksLint({ prNumber: Number(prNumber), severity })
  for (const line of lines) {
    if (line.includes('BLOCK') || line.includes('WARN') || line.includes('ERROR')) {
      process.stderr.write(`${line}\n`)
    } else {
      process.stdout.write(`${line}\n`)
    }
  }
  return exitCode
}

if (isEntryPoint(import.meta.url)) process.exit(main(process.argv.slice(2)))
