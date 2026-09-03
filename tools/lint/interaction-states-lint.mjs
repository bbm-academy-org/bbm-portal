#!/usr/bin/env node
// bbm-portal — interaction-states guard for the platform app (#435).
//
// WHY THIS EXISTS. The states half of the owner ruling `primitives-first`
// covers (Антон, 2026-09-02): an element you can click has to LOOK clickable and
// has to show keyboard focus, and that contract is owned ONCE by the `src/ui`
// kit rather than hand-assembled per screen. #435's measurement is the reason:
// under `src/app/(platform)`, `onClick` appears 27 times against 6 `hover:`
// occurrences, and `cursor-pointer` appears ZERO times anywhere in `src`.
//
// WHAT IT CHECKS, on the ADDED lines of ONE PR's diff, in non-test `*.tsx` under
// `src/app/(platform)`: an opening tag carrying `onClick` must carry the
// interaction treatment in its own attributes —
//   * a hover affordance (`hover:` / `group-hover:` / `peer-hover:`), and
//   * a visible keyboard focus (`focus-visible:` and its group/peer variants),
//   * plus, ONLY when the element can be disabled (it carries a `disabled`
//     attribute), a `disabled:` treatment.
// A tag whose name starts with a capital is a COMPONENT and is skipped: the kit
// primitives (`src/ui/button.tsx`, …) carry these states themselves, which is
// the whole point of adopting them, and a component whose import is not in the
// diff cannot be classified from the diff alone. That is the conservative
// direction — the guard can miss, it cannot invent (canon §8).
//
// TWO DELIBERATE DIVERGENCES from the ds-platform original this is ported from
// (`tools/lint/interaction-states-lint.ts`):
//
//   1. Scope is one PR's DIFF, not the tree. Reasoning and its honest limit:
//      `tools/lint/lib/ui-diff.mjs` header, and #435 «Out of scope».
//   2. Its scopes (a) and (b) are DROPPED, not ported. They assert a layer-1
//      `@layer base` reset in `packages/design-system/src/styles/globals.css`
//      and an `interactiveBase` fragment in that package's primitives. This repo
//      has neither: the kit is stock shadcn/ui vendored through Refine (#360,
//      #434, `src/ui/README.md`), whose primitives carry their states inline and
//      whose theme entry is `src/ui/theme.css`. Porting those checks would mean
//      inventing a contract nobody agreed to; what survives is scope (c) — the
//      app-level rule — generalised from raw styled LINKS to every `onClick`
//      host, which is what #435 asks for.
//
// RELATIONSHIP TO `primitives-first`. A raw `<button onClick>` with no hover can
// be a finding of BOTH guards, and that is intended: they answer different
// questions with different fixes at different times. `primitives-first` says
// «this control should be `src/ui/button.tsx`»; this guard says «whatever this
// element ends up being, it currently gives the user no feedback». An allow-list
// entry for one is not an allow-list entry for the other.
//
// THE ALLOW-LIST: `interaction-states-ok: <reason>` in a comment on the flagged
// tag's line or within 5 lines above it. The reason is REQUIRED.
//
// SEVERITY: WARN. Same dial and same reasoning as `primitives-first` — see its
// header, and the row of record in docs/ci-guardrails.md §5. `--severity block`
// (or `INTERACTION_STATES_SEVERITY=block`) makes a violation exit 1; the CI job
// passes that flag and carries `continue-on-error: true`, so the script gives a
// REAL signal (canon §4 clause 1) while the CI plane stays WARN.
//
// An `error` (the PR cannot be read at all) exits 1 under every severity: a
// guard that exits 0 when it never ran is indistinguishable from a clean check
// (#435 AC5).
//
// Run locally before merge: `pnpm lint:interaction-states <PR>`.

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { prFilesArgs, prFilesPageSize, PR_FILES_MAX_PAGES } from './lib/gh.mjs'
import {
  addedLines,
  addedSource,
  findTagEnd,
  isPlatformUiFile,
  isSuppressed,
  normalizePatchPage,
} from './lib/ui-diff.mjs'

const TAG = '[interaction-states]'

export const REPO = 'bbm-academy-org/bbm-portal'

/** The inline allow-list marker; the reason is required. */
const SUPPRESS_RE = /interaction-states-ok:[ \t]*[^\s*/}]/

/** `onClick` as a JSX attribute, not a word inside a string. */
const ON_CLICK_RE = /\bonClick\s*=/g

/**
 * The three treatments, each matched through its `group-` / `peer-` variants
 * (a group-hover IS a hover affordance) and behind any responsive/theme prefix
 * (`sm:hover:`, `dark:focus-visible:`).
 */
const TREATMENTS = [
  { id: 'hover', re: /(?:^|[\s"'`([{:])(?:group-|peer-)?hover:/ },
  { id: 'focus-visible', re: /(?:^|[\s"'`([{:])(?:group-|peer-)?focus-visible:/ },
]
const DISABLED_TREATMENT_RE = /(?:^|[\s"'`([{:])(?:group-|peer-)?disabled:/
/** The element can be disabled — a `disabled` attribute in the opening tag. */
const DISABLED_ATTR_RE = /\bdisabled(?:\s*=|[\s/>])/

/**
 * A `<` that really opens a JSX tag: the name follows IMMEDIATELY, with no space.
 * `{count < limit}` inside an attribute expression is therefore skipped rather
 * than taken for the enclosing tag — mistaking it for one slices the tag text
 * after the real `className` and invents a finding about a tag that does not
 * exist (review of PR #459, N5).
 */
const TAG_OPEN_RE = /^<[A-Za-z]/

/** The `<` index of the opening tag enclosing `offset`, or -1. */
function enclosingTagStart(src, offset) {
  for (let i = offset; i >= 0; i--) {
    if (src[i] !== '<') continue
    if (!TAG_OPEN_RE.test(src.slice(i, i + 2))) continue
    const end = findTagEnd(src, i)
    return end >= offset ? i : -1
  }
  return -1
}

/** The tag name at `start` (the `<`), or null when it is not an opening tag. */
function tagNameAt(src, start) {
  const m = /^<([A-Za-z][\w.$-]*)/.exec(src.slice(start, start + 64))
  return m ? m[1] : null
}

/**
 * The pure seam: given the `{ filename, patch }` entries of a PR's changed files,
 * decide the verdict. No IO.
 *
 * @param {{filename?: string, path?: string, patch?: string}[]} files
 * @returns {{verdict: 'skip'|'pass'|'violation', scanned: string[],
 *            findings: {file: string, line: number, tag: string,
 *                       missing: string[], message: string}[],
 *            message: string}}
 */
export function checkInteractionStates(files) {
  const inScope = (files ?? [])
    .map((f) => ({ path: String(f?.filename ?? f?.path ?? ''), patch: f?.patch ?? '' }))
    .filter((f) => isPlatformUiFile(f.path))

  if (inScope.length === 0) {
    return {
      verdict: 'skip',
      scanned: [],
      findings: [],
      message: 'no added platform view code (non-test *.tsx under src/app/(platform)) in this PR',
    }
  }

  const findings = []
  for (const file of inScope) {
    const lines = addedLines(file.patch)
    if (lines.length === 0) continue
    const src = addedSource(lines)
    const markers = src.markers(SUPPRESS_RE)
    const seen = new Set()

    for (const m of src.text.matchAll(ON_CLICK_RE)) {
      const start = enclosingTagStart(src.text, m.index ?? 0)
      if (start === -1 || seen.has(start)) continue
      seen.add(start)
      const end = findTagEnd(src.text, start)
      if (end === -1) continue
      const name = tagNameAt(src.text, start)
      // A component owns its own states — the kit primitives demonstrably do,
      // and a component whose import is outside the diff cannot be classified.
      if (!name || name[0] !== name[0].toLowerCase()) continue

      const tagText = src.text.slice(start, end + 1)
      const missing = TREATMENTS.filter((t) => !t.re.test(tagText)).map((t) => t.id)
      if (DISABLED_ATTR_RE.test(tagText) && !DISABLED_TREATMENT_RE.test(tagText)) {
        missing.push('disabled')
      }
      if (missing.length === 0) continue

      const line = src.lineAt(start)
      if (isSuppressed(markers, line)) continue
      findings.push({
        file: file.path,
        line,
        tag: name,
        missing,
        message:
          `\`<${name} onClick=…>\` carries no ${missing.join(' / ')} treatment — a clickable that ` +
          `gives no hover feedback and no visible keyboard focus reads as dead text. Compose the ` +
          `kit primitive that owns these states (\`src/ui/button.tsx\` and the rest of the #434 ` +
          `block set), or declare the states on this tag. For a deliberate exception write ` +
          `\`interaction-states-ok: <reason>\` inline.`,
      })
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const scanned = inScope.map((f) => f.path)

  if (findings.length === 0) {
    return {
      verdict: 'pass',
      scanned,
      findings,
      message: `${scanned.length} platform view file(s) in the diff: every added clickable carries its interaction states`,
    }
  }

  return {
    verdict: 'violation',
    scanned,
    findings,
    message: [
      `${findings.length} interaction-state finding(s) across ${scanned.length} platform view file(s):`,
      ...findings.map((f) => `  ${f.file}:${f.line}: ${f.message}`),
    ].join('\n'),
  }
}

// ── gh access (argv arrays, never a shell string — `tools/gh/lib/gh.mjs` canon) ─

/** ONE page of the PR's changed files, WITH the patch (see `primitives-first`). */
export function ghFilesArgs(prNumber, page, perPage = prFilesPageSize()) {
  return prFilesArgs(prNumber, page, { repo: REPO, perPage })
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

/** Every changed file of the PR with its patch, paged; a truncated read is an ERROR (§8). */
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

/** `--severity block` / `--severity=block` / `INTERACTION_STATES_SEVERITY=block`; WARN by default. */
export function severityFromArgv(argv = [], env = {}) {
  const args = argv ?? []
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a.startsWith('--severity='))
      return a.slice('--severity='.length) === 'block' ? 'block' : 'warn'
    if (a === '--severity') return String(args[i + 1] ?? '') === 'block' ? 'block' : 'warn'
  }
  return env.INTERACTION_STATES_SEVERITY === 'block' ? 'block' : 'warn'
}

/** The PR number (positional, else `PR_NUMBER`) and the severity; the flag's value is consumed. */
export function parseArgs(argv = [], env = {}) {
  const severity = severityFromArgv(argv, env)
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i])
    if (a === '--severity') {
      i++
      continue
    }
    if (a.startsWith('--')) continue
    positional.push(a)
  }
  const candidate = positional[0] ?? env.PR_NUMBER ?? ''
  return { prNumber: /^\d+$/.test(String(candidate)) ? String(candidate) : null, severity }
}

/**
 * Fetch the PR's diff and run the check.
 *
 * @returns {{verdict: 'skip'|'pass'|'violation'|'error', exitCode: number, lines: string[]}}
 */
export function runInteractionStatesLint({ prNumber, severity = 'warn', gh = defaultGh }) {
  const lines = []
  const filesRes = fetchPrPatches(gh, prNumber)
  if (!filesRes.ok) {
    lines.push(`${TAG} ERROR: cannot read the diff of PR #${prNumber}: ${filesRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }

  const result = checkInteractionStates(filesRes.data)
  if (result.verdict === 'violation') {
    const level = severity === 'block' ? 'BLOCK' : 'WARN'
    lines.push(`${TAG} ${level}: PR #${prNumber}: ${result.message}`)
    if (level === 'WARN')
      lines.push(`${TAG} WARN severity (docs/ci-guardrails.md §5 — earliest promotion 2026-10-01)`)
    return { verdict: 'violation', exitCode: severity === 'block' ? 1 : 0, lines }
  }
  lines.push(`${TAG} OK: PR #${prNumber}: ${result.message}`)
  return { verdict: result.verdict, exitCode: 0, lines }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage() {
  return [
    'Usage: pnpm lint:interaction-states <PR number> [--severity warn|block]',
    '',
    'Checks that every clickable a PR adds under src/app/(platform) shows hover,',
    'keyboard focus and (when it can be disabled) a disabled treatment (#435).',
    'Severity is WARN today (docs/ci-guardrails.md §5 — earliest promotion 2026-10-01).',
  ].join('\n')
}

function main(argv) {
  const { prNumber, severity } = parseArgs(argv, process.env)
  if (prNumber === null) {
    process.stderr.write(`${usage()}\n`)
    return 2
  }
  const { exitCode, lines } = runInteractionStatesLint({ prNumber: Number(prNumber), severity })
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
