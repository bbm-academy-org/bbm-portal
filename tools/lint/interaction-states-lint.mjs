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
//
// KIT COMPONENTS (#483). A capitalised tag is a COMPONENT, and until #483 every
// one of them was skipped. PR #470's finance requests table walked straight
// through that gap: its clickable row is `<TableRow onClick={…}
// className="cursor-pointer">` — a kit component — and the owner had to report
// the unstyled clickable by hand on the 2026-09-15 stand (#481, «why round 1 was
// not enough», item 2). A clickable is a clickable whether its tag is `<div>` or
// `<TableRow>`, so a capitalised tag is judged by the SAME rule when all of the
// following hold:
//
//   * the name is a KIT component — exported by `src/ui/*.tsx` in the checked-out
//     tree, or imported from `@/ui/…` in the diff's own added lines. Anything
//     else (an app-local component, a third-party one) is skipped: its states
//     cannot be classified from the diff, which is the conservative direction
//     — the guard can miss, it cannot invent (canon §8);
//   * the diff does not SHADOW that name with a non-kit import or a local
//     declaration (`import { Card } from './RequestCard'` is not `@/ui/card`);
//   * the tag carries no `asChild`: such a tag renders its CHILD, and the child
//     is where the states live (`<DropdownMenuTrigger asChild><Button…`);
//   * the name is not one of `STATE_OWNING_KIT_CONTROLS` below.
//
// WHERE THIS RULE CAN INVENT, NAMED RATHER THAN DISCOVERED. Shadow detection
// reads the diff's ADDED lines only, so a file whose import lines are NOT in the
// diff and which renders an APP-LOCAL component sharing a name the kit also
// exports (`Card`, `Table`, `Badge`, `Alert` are all plausible local names) is
// judged as if it were the kit's. That is a finding about a component the guard
// cannot classify — the one place this family's «can miss, cannot invent»
// promise (canon §8) does not hold, and it is stated here rather than left to be
// discovered. It is bounded: the names must collide, the dial is WARN, and
// `interaction-states-ok: <reason>` closes it at the call site. The tree lookup
// is NOT weakened to remove it — that lookup is what catches the #470 row when
// the import line is not in the diff. Recorded in DEBT.md
// (`2026-09-15-483-samename-collision`), which also carries the opposite-direction
// hole (`2026-09-03-435-uppercase-hole`: a wrapper DECLARED in the file is a
// shadowed name and is skipped).
//
// `src/ui/refine-ui/**` IS OUT OF SCOPE, BY DECISION — not by accident of
// `readdirSync` being non-recursive. The #434 block set vendored there
// (`buttons`, `data-table`, `layout`, `notification`, `views`) is composed of
// Refine's own state-owning controls, so reading it would mostly add exempt names
// to maintain; a clickable block from there is therefore a MISS, which is the
// safe direction. The day a block from that tree is found rendering an untreated
// clickable, the fix is a recursive read plus the exemptions that come with it.
//
// The judgement is of the CALL SITE, and it stays that way on purpose. The kit's
// `TableRow` does carry `hover:bg-muted/50` (`src/ui/table.tsx:48`), and that is
// exactly what it is — the row tint EVERY row of EVERY table gets, clickable or
// not. It cannot say «this row opens something», and there is no focus treatment
// and no keyboard reach on it at all. So the finding's wording for a component is
// «declares no … treatment at the CALL SITE», which is what is true and what the
// fix has to change.
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
// SEVERITY: WARN, and the promotion clock RESTARTED with #483. Same dial and
// same reasoning as `primitives-first` — see its header, and the row of record
// in docs/ci-guardrails.md §5. §4 clause 2 counts the four weeks from the guard
// landing «or since the last substantive change to its rule — a wording change to
// a message is not substantive; a change to what it matches is». Widening the
// rule to kit components is a change to WHAT IT MATCHES, so the clock restarts on
// 2026-09-15 and the earliest promotion moves from 2026-10-01 to
// `EARLIEST_PROMOTION` below. Precedent, one row down the same §5 table:
// `ears-naming` was narrowed by #447/#465 and restarted at the day it landed. `--severity block`
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
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { prFilesArgs, prFilesPageSize, PR_FILES_MAX_PAGES } from './lib/gh.mjs'
import {
  addedLines,
  addedSource,
  findTagEnd,
  isPlatformUiFile,
  isSuppressed,
  normalizePatchPage,
  repoRootForUiDiff,
} from './lib/ui-diff.mjs'

const TAG = '[interaction-states]'

/**
 * The earliest date §4's four-week window can yield for a WARN→BLOCK promotion.
 * #483 changed WHAT THE GUARD MATCHES (§4 clause 2: «a change to what it matches
 * is» substantive), so the clock restarted the day the widening landed,
 * 2026-09-15, and 28 days later is 2026-10-13 — the same arithmetic the
 * `ears-naming` row of docs/ci-guardrails.md §5 records for its own restart
 * (landed 2026-09-03, earliest 2026-10-01). Exported so the printed WARN line,
 * `usage()` and the guard's test cannot drift apart.
 */
export const EARLIEST_PROMOTION = '2026-10-13'

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
 * The kit controls that OWN the full interactive contract themselves, so an
 * `onClick` written on them is a pass-through to a control that already shows
 * hover/selection, keyboard focus and a disabled state. They are enumerated
 * rather than guessed (#483 scope), each with the line in the vendored kit that
 * carries the treatment — a row whose citation stops being true is a row to
 * delete, not to trust.
 *
 *   Button                    src/ui/button.tsx:8  `buttonVariants` — `focus-visible:ring-3`,
 *                             `disabled:opacity-50`, per-variant `hover:`
 *   InputGroupButton          src/ui/input-group.tsx:80  renders `<Button>`
 *   PaginationLink            src/ui/pagination.tsx:38  renders `<Button asChild>`
 *                             (and `PaginationPrevious`/`PaginationNext` render IT)
 *   AlertDialogAction/Cancel  src/ui/alert-dialog.tsx:133 / :151  render `<Button asChild>`
 *   CalendarDayButton         src/ui/calendar.tsx:147  renders `<Button>`
 *   DropdownMenuItem          src/ui/dropdown-menu.tsx:66  `focus:bg-accent`,
 *                             `data-disabled:pointer-events-none`; and the same shape in
 *   DropdownMenuCheckboxItem / DropdownMenuRadioItem / DropdownMenuSubTrigger
 *   SelectItem                src/ui/select.tsx  `focus:bg-accent`
 *   SelectTrigger             src/ui/select.tsx:27  `hover:bg-input/50`, `focus-visible:ring-3`
 *   CommandItem               src/ui/command.tsx:131  `data-selected:bg-muted` — cmdk drives
 *                             selection from the keyboard, so THAT is its focus treatment
 *   TabsTrigger               src/ui/tabs.tsx:54  `hover:text-foreground`, `focus-visible:ring-[3px]`
 *   Checkbox / Switch         src/ui/checkbox.tsx:9 / src/ui/switch.tsx:8  `focus-visible:ring-3`
 *   SidebarMenuButton         src/ui/sidebar.tsx:13  `sidebarMenuButtonVariants` — `hover:`,
 *                             `focus-visible:ring-2`, `disabled:opacity-50`; and
 *   SidebarMenuSubButton / SidebarMenuAction  src/ui/sidebar.tsx:612 / :514
 *
 * A menu/list item styles its highlight through `focus:` or `data-selected:`
 * rather than `focus-visible:` because a roving-focus widget moves selection with
 * the arrow keys: the `TREATMENTS` test below would fail them for a contract they
 * do satisfy, which is the second reason this list exists.
 */
export const STATE_OWNING_KIT_CONTROLS = Object.freeze([
  'Button',
  'InputGroupButton',
  'PaginationLink',
  'PaginationPrevious',
  'PaginationNext',
  'AlertDialogAction',
  'AlertDialogCancel',
  'CalendarDayButton',
  'DropdownMenuItem',
  'DropdownMenuCheckboxItem',
  'DropdownMenuRadioItem',
  'DropdownMenuSubTrigger',
  'SelectItem',
  'SelectTrigger',
  'CommandItem',
  'TabsTrigger',
  'Checkbox',
  'Switch',
  'SidebarMenuButton',
  'SidebarMenuSubButton',
  'SidebarMenuAction',
])

const EXEMPT_COMPONENTS = new Set(STATE_OWNING_KIT_CONTROLS)

/** `<Tag asChild …>` renders its child; the child is the element that needs states. */
const AS_CHILD_RE = /\basChild(?:\s*=|[\s/>])/

/** A named-import statement: `import { A, B as C } from '<module>'`. */
const NAMED_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"`]([^'"`]+)['"`]/g

/** The kit's module specifier, as every platform view writes it. */
const KIT_MODULE_RE = /^@\/ui(?:\/|$)/

/** A component DECLARED in the diff itself — a local name, not the kit's. */
const LOCAL_COMPONENT_RE = /\b(?:function|class|const|let|var)\s+([A-Z][\w$]*)/g

/**
 * The capitalised names `src/ui/*.tsx` exports in the checked-out tree — the
 * same «ask the tree, do not hard-code» seam `primitives-first` uses for
 * `KIT_EQUIVALENTS`, so a kit file that is removed or renamed stops producing
 * findings by itself. Read once per process; injectable through
 * `checkInteractionStates`'s `kitComponents` option for tests.
 */
export function kitComponentNames(root = repoRootForUiDiff()) {
  const dir = resolve(root, 'src', 'ui')
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return new Set()
  }
  const names = new Set()
  for (const entry of entries) {
    if (!entry.endsWith('.tsx')) continue
    let text = ''
    try {
      text = readFileSync(resolve(dir, entry), 'utf8')
    } catch {
      continue
    }
    for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = (part.split(/\s+as\s+/).pop() ?? '').trim()
        if (/^[A-Z][\w$]*$/.test(name)) names.add(name)
      }
    }
    for (const m of text.matchAll(/export\s+(?:const|function|class)\s+([A-Z][\w$]*)/g))
      names.add(m[1])
  }
  return names
}

let kitCache = null
function defaultKitComponents() {
  if (kitCache === null) kitCache = kitComponentNames()
  return kitCache
}

/**
 * Per-file name resolution over the ADDED lines: which capitalised names come
 * from the kit, and which are shadowed by a non-kit import or a local
 * declaration. A shadowed name is never judged — `<Card>` from `./RequestCard`
 * is not `src/ui/card.tsx`, whatever the kit happens to export.
 */
export function resolveComponentNames(text) {
  const fromKit = new Set()
  const shadowed = new Set()
  for (const m of String(text ?? '').matchAll(NAMED_IMPORT_RE)) {
    const kit = KIT_MODULE_RE.test(m[2].trim())
    for (const part of m[1].split(',')) {
      const name = (part.split(/\s+as\s+/).pop() ?? '').trim()
      if (!/^[A-Z][\w$]*$/.test(name)) continue
      if (kit) fromKit.add(name)
      else shadowed.add(name)
    }
  }
  for (const m of String(text ?? '').matchAll(LOCAL_COMPONENT_RE)) shadowed.add(m[1])
  return { fromKit, shadowed }
}

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
 * @param {{kitComponents?: Iterable<string>}} [opts] `kitComponents` defaults to
 *   the names `src/ui/*.tsx` exports in the real tree.
 * @returns {{verdict: 'skip'|'pass'|'violation', scanned: string[],
 *            findings: {file: string, line: number, tag: string,
 *                       missing: string[], message: string}[],
 *            message: string}}
 */
export function checkInteractionStates(files, opts = {}) {
  const kit = opts.kitComponents ? new Set(opts.kitComponents) : defaultKitComponents()
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
    const { fromKit, shadowed } = resolveComponentNames(src.text)
    const seen = new Set()

    for (const m of src.text.matchAll(ON_CLICK_RE)) {
      const start = enclosingTagStart(src.text, m.index ?? 0)
      if (start === -1 || seen.has(start)) continue
      seen.add(start)
      const end = findTagEnd(src.text, start)
      if (end === -1) continue
      const name = tagNameAt(src.text, start)
      if (!name) continue
      const tagText = src.text.slice(start, end + 1)
      const isComponent = name[0] !== name[0].toLowerCase()
      // A capitalised tag is judged only when it is a KIT component this diff
      // does not shadow, is not a pass-through to a state-owning control, and
      // renders itself rather than its child (#483 — the guard's header).
      if (isComponent) {
        if (EXEMPT_COMPONENTS.has(name)) continue
        if (shadowed.has(name)) continue
        if (!fromKit.has(name) && !kit.has(name)) continue
        if (AS_CHILD_RE.test(tagText)) continue
      }
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
        message: isComponent
          ? `\`<${name} onClick=…>\` is a clickable kit component and declares no ` +
            `${missing.join(' / ')} treatment at the CALL SITE — the kit's own default styling is ` +
            `what every instance gets, clickable or not, so it cannot say «this opens something» ` +
            `and it carries no keyboard focus. Compose the kit control that owns these states ` +
            `(\`src/ui/button.tsx\` and the rest of the #434 block set), or declare the states on ` +
            `this tag. For a deliberate exception write \`interaction-states-ok: <reason>\` inline.`
          : `\`<${name} onClick=…>\` carries no ${missing.join(' / ')} treatment — a clickable that ` +
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
      lines.push(
        `${TAG} WARN severity (docs/ci-guardrails.md §5 — earliest promotion ${EARLIEST_PROMOTION}, ` +
          `§4 clause 2 restarted the clock when #483 widened what this guard matches)`,
      )
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
    'Checks that every clickable a PR adds under src/app/(platform) — a raw tag or a',
    'kit component (#483) — shows hover, keyboard focus and (when it can be disabled)',
    'a disabled treatment (#435).',
    `Severity is WARN today (docs/ci-guardrails.md §5 — earliest promotion ${EARLIEST_PROMOTION}).`,
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
