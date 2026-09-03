#!/usr/bin/env node
// bbm-portal — primitives-first guard for the platform app (#435).
//
// WHY THIS EXISTS. Owner ruling, Антон, 2026-09-02: the ready libraries are
// sufficient and nothing is to be reinvented. A ruling without a mechanism
// decays — PR #430 hand-rolled a `NativeSelect` around a raw `<select>` while
// `src/ui/select.tsx` sat next to it and the reuse ladder of
// `.claude/skills/build-ui-from-design-system/SKILL.md` was already in force,
// and every form under `src/app/(platform)` drives its field state from
// hand-rolled `useState` while `src/ui/form.tsx` (react-hook-form) is in the kit
// adopted by #434.
//
// WHAT IT CHECKS, on the ADDED lines of ONE PR's diff, in non-test `*.tsx` under
// `src/app/(platform)`:
//
//   (1) RAW CONTROL. An added raw `<button>` / `<table>` / `<select>` /
//       `<input>` opening tag, when the kit HAS the equivalent
//       (`src/ui/<tag>.tsx` exists in the checked-out tree). The kit-existence
//       test is not decoration: the rule the issue states is «a raw tag is a
//       violation WHEN an `src/ui` equivalent exists», so a tag the kit does not
//       cover is not this guard's business, and a kit file that is later removed
//       stops the finding by itself instead of stranding it.
//
//       `<form>` is NOT in that set, and the omission is the rule, not an
//       exemption (review of PR #459). `src/ui/form.tsx` is
//       `const Form = FormProvider` — a CONTEXT provider that renders no element,
//       and no file in `src/ui/` renders a `<form>`. The documented shadcn shape
//       is `<Form {...form}><form onSubmit={form.handleSubmit(…)}>`: the raw tag
//       is MANDATORY inside the kit block, so for the `<form>` ELEMENT no
//       `src/ui` equivalent exists and the issue's antecedent is false. Flagging
//       it reported the #434 reference migration — the model every future screen
//       copies — as a canon violation, exactly the false-positive class §4 says
//       stops a WARN guard from ever being promoted. The real defect the issue
//       names is field state, and rule (2) owns it.
//   (2) FORM STATE. An added `useState(` in a file whose added lines also open a
//       `<form>` and do NOT compose the kit `Form` block — hand-rolled field
//       state where `src/ui/form.tsx` applies. Both halves must be in the SAME
//       diff: a `useState` next to a `<Sheet>` is an open/closed flag, not field
//       state, and flagging it would be the false-positive class that gets a
//       guard routed around. The kit-composition test is the other half of the
//       same care: a diff that already drives its fields from `useForm` keeps
//       `loading` / `pending` / `editing` in `useState` beside it (the #434
//       `AliasPanel.tsx`), and those hooks are not field state either.
//
// SCOPE IS THE DIFF, NOT THE TREE — the one deliberate divergence from the
// ds-platform original this is ported from (`tools/lint/primitives-first-lint.ts`,
// which sweeps `apps/**` with fast-glob). Reasoning and its honest limit:
// `tools/lint/lib/ui-diff.mjs` header. #435 «Out of scope» settles it — the
// existing backlog of violations is worked off by the per-screen migration tasks,
// not reported by this guard on every unrelated PR.
//
// THE ALLOW-LIST is the ladder's third rung, written INLINE at the call site:
// `primitives-first-ok: <reason>` in a comment on the flagged tag's line or
// within 5 lines above it. The reason is REQUIRED — a bare marker suppresses
// nothing, and the window is deliberately narrow so one exception cannot silence
// a second defect further down the file.
//
// SEVERITY: WARN. A violation is reported and the process exits 0 by default;
// `--severity block` (or `PRIMITIVES_FIRST_SEVERITY=block`) makes the same
// violation exit 1. The `primitives-first` job in
// `.github/workflows/pr-body-guards.yml` passes `--severity block` and carries
// `continue-on-error: true` — the wiring `ux-record` uses and `stage-b` used
// while IT was WARN: the script gives a REAL signal (canon §4 clause 1 — a guard
// that prints and exits 0 is a stub and is not promotable) while the CI plane
// stays WARN. WARN is deliberate here for the reason #435 names: the existing
// corpus is full of violations, and a BLOCK guard landing on a red corpus gets
// routed around rather than obeyed. The severity of record is
// docs/ci-guardrails.md §5, row `primitives-first`, plus the job itself.
//
// An `error` (the PR cannot be read at all) is NOT a violation and does NOT
// follow the severity dial: it exits 1 under every severity. A guard that exits 0
// when it never ran is indistinguishable from a clean check (#435 AC5).
//
// Run locally before merge: `pnpm lint:primitives-first <PR>`.

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { prFilesArgs, prFilesPageSize, PR_FILES_MAX_PAGES } from './lib/gh.mjs'
import {
  addedLines,
  addedSource,
  existingPaths,
  findTagEnd,
  isPlatformUiFile,
  isSuppressed,
  normalizePatchPage,
} from './lib/ui-diff.mjs'

const TAG = '[primitives-first]'

export const REPO = 'bbm-academy-org/bbm-portal'

/**
 * The raw tags #435 names that the kit really owns AS AN ELEMENT, each mapped to
 * the kit file that owns it. The set is the issue's set minus `form`, and no
 * wider: widening a guard's rule past the issue that filed it is how a WARN guard
 * collects the false positives that stop it from ever being promoted (canon §4).
 * Why `form` is absent: the header, rule (1).
 */
export const KIT_EQUIVALENTS = Object.freeze({
  button: 'src/ui/button.tsx',
  table: 'src/ui/table.tsx',
  select: 'src/ui/select.tsx',
  input: 'src/ui/input.tsx',
})

/**
 * The kit file whose absence would make rule (2) meaningless. It owns field
 * state, validation and error wiring — not the `<form>` element — so it is a
 * constant of rule (2) rather than a `KIT_EQUIVALENTS` row.
 */
export const FORM_KIT_FILE = 'src/ui/form.tsx'

/** The added lines compose the kit `Form` block — `<Form …>` or an `@/ui/form` import. */
const KIT_FORM_RE = /<Form(?=[\s/>])|['"`]@\/ui\/form['"`]/

/**
 * The inline allow-list marker. The reason is required and must be real text: a
 * comment CLOSER does not count as one, so a bare marker followed straight by the
 * closing delimiter suppresses nothing.
 */
const SUPPRESS_RE = /primitives-first-ok:[ \t]*[^\s*/}]/

/** `useState(` — a call, not the identifier in an import list. */
const USE_STATE_RE = /\buseState\s*[(<]/g

/**
 * The pure seam: given the `{ filename, patch }` entries of a PR's changed files
 * and the kit files that exist, decide the verdict. No IO.
 *
 * @param {{filename?: string, path?: string, patch?: string}[]} files
 * @param {{kitFiles?: string[]}} [opts] `kitFiles` defaults to the real tree.
 * @returns {{verdict: 'skip'|'pass'|'violation', scanned: string[],
 *            findings: {file: string, line: number, tag: string|null,
 *                       rule: 'raw-control'|'form-state', message: string}[],
 *            message: string}}
 */
export function checkPrimitivesFirst(files, opts = {}) {
  const kit = new Set(
    opts.kitFiles ?? existingPaths([...Object.values(KIT_EQUIVALENTS), FORM_KIT_FILE]),
  )
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

    // ── (1) raw controls the kit already owns ────────────────────────────────
    const covered = Object.keys(KIT_EQUIVALENTS).filter((t) => kit.has(KIT_EQUIVALENTS[t]))
    if (covered.length > 0) {
      const rawTag = new RegExp(`<(${covered.join('|')})(?=[\\s/>])`, 'g')
      for (const m of src.text.matchAll(rawTag)) {
        const start = m.index ?? 0
        if (findTagEnd(src.text, start) === -1) continue
        const tag = m[1]
        const line = src.lineAt(start)
        if (isSuppressed(markers, line)) continue
        findings.push({
          file: file.path,
          line,
          tag,
          rule: 'raw-control',
          message:
            `raw \`<${tag}>\` under src/app/(platform) while the kit owns it — compose ` +
            `\`${KIT_EQUIVALENTS[tag]}\` instead of hand-rolling the control (owner ruling, Антон, ` +
            `2026-09-02: the ready libraries are sufficient; reuse ladder rung 1, ` +
            `.claude/skills/build-ui-from-design-system/SKILL.md). For a case the kit genuinely ` +
            `does not cover, write the justification inline: \`primitives-first-ok: <reason>\`.`,
        })
      }
    }
    // Rule (2) only needs to know that the diff builds a form at all, and that it
    // does NOT do so through the kit block.
    const sawForm = /<form(?=[\s/>])/.test(src.text)
    const composesKitForm = KIT_FORM_RE.test(src.text)

    // ── (2) useState-driven field state where the form block applies ─────────
    // ONE finding per file, not one per hook. A hand-rolled form adds a dozen
    // `useState` calls and they are ONE decision with ONE fix (adopt the `form`
    // block) — a dozen identical lines is noise that gets a WARN guard skimmed
    // past rather than read.
    if (sawForm && !composesKitForm && kit.has(FORM_KIT_FILE)) {
      const hooks = [...src.text.matchAll(USE_STATE_RE)]
        .map((m) => src.lineAt(m.index ?? 0))
        .filter((line) => !isSuppressed(markers, line))
      if (hooks.length > 0) {
        findings.push({
          file: file.path,
          line: hooks[0],
          tag: null,
          rule: 'form-state',
          count: hooks.length,
          message:
            `a \`<form>\` built with no kit \`Form\` composition, beside ${hooks.length} ` +
            `\`useState\` call(s) — field state, validation and error wiring are owned by ` +
            `\`${FORM_KIT_FILE}\` (react-hook-form, the #434 block set), not re-implemented per ` +
            `screen. Whichever of those hooks hold fields belong in \`useForm\`. For a deliberate ` +
            `exception write \`primitives-first-ok: <reason>\` inline.`,
        })
      }
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const scanned = inScope.map((f) => f.path)

  if (findings.length === 0) {
    return {
      verdict: 'pass',
      scanned,
      findings,
      message: `${scanned.length} platform view file(s) in the diff: no hand-rolled control the kit already owns`,
    }
  }

  return {
    verdict: 'violation',
    scanned,
    findings,
    message: [
      `${findings.length} primitives-first finding(s) across ${scanned.length} platform view file(s):`,
      ...findings.map((f) => `  ${f.file}:${f.line}: ${f.message}`),
    ].join('\n'),
  }
}

// ── gh access (argv arrays, never a shell string — `tools/gh/lib/gh.mjs` canon) ─

/**
 * ONE page of the PR's changed files, WITH the patch. `lib/gh.mjs`'s
 * `normalizeFilesPage` drops `patch` because every guard before this one needed
 * only the path list; this guard needs the diff CONTENT, so it keeps its own
 * normaliser (`normalizePatchPage`) over the same argv builder and the same page
 * bound (canon docs/ci-guardrails.md §8).
 */
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

/**
 * Every changed file of the PR, with its patch, paged. Exhausting the page bound
 * is an ERROR rather than a truncated success: a guard that read part of the diff
 * has not cleared the diff (§8).
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

/** `--severity block` / `--severity=block` / `PRIMITIVES_FIRST_SEVERITY=block`; WARN by default. */
export function severityFromArgv(argv = [], env = {}) {
  const args = argv ?? []
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a.startsWith('--severity='))
      return a.slice('--severity='.length) === 'block' ? 'block' : 'warn'
    if (a === '--severity') return String(args[i + 1] ?? '') === 'block' ? 'block' : 'warn'
  }
  return env.PRIMITIVES_FIRST_SEVERITY === 'block' ? 'block' : 'warn'
}

/**
 * Full CLI parse: the PR number (positional, else `PR_NUMBER` from env) and the
 * severity. The flag's VALUE is consumed, so `--severity block` does not eat the
 * env fallback's place (the regression `stage-b` fixed in review of PR #151).
 */
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
export function runPrimitivesFirstLint({ prNumber, severity = 'warn', gh = defaultGh, kitFiles }) {
  const lines = []
  const filesRes = fetchPrPatches(gh, prNumber)
  if (!filesRes.ok) {
    lines.push(`${TAG} ERROR: cannot read the diff of PR #${prNumber}: ${filesRes.error}`)
    return { verdict: 'error', exitCode: 1, lines }
  }

  const result = checkPrimitivesFirst(filesRes.data, kitFiles ? { kitFiles } : {})
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
    'Usage: pnpm lint:primitives-first <PR number> [--severity warn|block]',
    '',
    'Checks that a PR does not hand-roll UI the `src/ui` kit already owns (#435).',
    'Severity is WARN today (docs/ci-guardrails.md §5 — earliest promotion 2026-10-01).',
  ].join('\n')
}

function main(argv) {
  const { prNumber, severity } = parseArgs(argv, process.env)
  if (prNumber === null) {
    process.stderr.write(`${usage()}\n`)
    return 2
  }
  const { exitCode, lines } = runPrimitivesFirstLint({ prNumber: Number(prNumber), severity })
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
