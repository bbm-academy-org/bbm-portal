#!/usr/bin/env node
// bbm-portal — `pnpm lint:instruction-budget` (#139): the deterministic half of
// the wrap's «compact, never just append» rule
// (`.claude/skills/wrap/SKILL.md` phase 3).
//
// Why: every /wrap adds signal to the always-on corpus — CLAUDE.md, AGENTS.md,
// the `.claude/rules/*.md` files and the `MEMORY.md` index are read at the start
// of EVERY session, so growth there is a tax on every future session. The prose
// rule «prune before adding» has no observable outcome; this script gives it
// one: a budget per file, a NEAR warning while there is still headroom, and a
// non-zero exit once a file is over. It measures, it never edits — what to
// relocate is a judgement call the wrap makes with the owner.
//
// Scope note (#139, re-scoped by #596): every file below is measured against the
// per-file budget, but only what a Claude session really loads at start counts
// toward the corpus total — CLAUDE.md, the AGENTS.md it imports (`@AGENTS.md`),
// and the PATH-LESS `.claude/rules/*.md` files. A rule with `paths:` frontmatter
// is lazy (loaded when the session touches a matching file) and the MEMORY.md
// index is machine-local (absent in CI, so a total that counted it would differ
// between the box and the gate); both stay per-file BLOCK, off the total. Two
// neighbours are deliberately outside the guard altogether: the lazy
// `memory/<topic>.md` files (loaded only when the index line sends a session
// there — they obey the same prune-before-add discipline, but what is budgeted
// is their one-line index entry), and the session transcript
// (`~/.claude/projects/<slug>/*.jsonl`), which is read-only evidence and is
// never rewritten, compacted or pruned by anything in this repo.
//
// What it measures (two budgets since #157):
//   PER FILE  — 200 lines / 25 KB, the Anthropic CLAUDE.md target and the
//               MEMORY.md auto-load cutoff.
//   CORPUS    — the SUM over the always-on set, capped at AGGREGATE_BUDGET
//               (#596: 400 lines / 32 KB, owner go, Anton, 2026-11-24). Without
//               it the per-file rule is satisfiable by a corpus nobody can
//               afford: six files at 199 lines each pass individually while the
//               session pays for 1194 at every start.
//
// Severity — CLI guard, `docs/ci-guardrails.md` §2.3, where the exit code IS the
// severity: 0 = clean or NEAR-only, 1 = a BLOCK-class finding (a file, or the
// corpus, over budget), 2 = NOT A VERDICT — the input was unreadable, or the
// corpus was empty (#157: measuring zero always-on files clears nothing, and a
// check that never ran must not look clean). A caller that reads 2 as "clean"
// has skipped the check. It lands BLOCK on day 0 under the §3 mandate, class 1 —
// deterministic tree check: the only inputs are files in the checked-out tree
// plus the memory index, there is no network, no PR metadata, no heuristic and
// no regex over prose, so the false-positive class is empty by construction.
// Recorded in §6.1; promotion/demotion clauses are §4.
//
// CI: wired into `.github/workflows/ci.yml` by #157 as a WARN job, soaked its §4
// clock, and was promoted to BLOCK on 2026-09-02 (#438) — no `continue-on-error`,
// and in the `ci` meta-job's needs-list. The §5 row in docs/ci-guardrails.md and
// the job itself are the severity of record; read the plane off those, not off
// this comment. Both planes now agree: the CLI plane is BLOCK by exit code
// (§6.1) and the CI plane blocks the merge gate. Unlike `stage-b`
// and `spec-link`, this guard needs no `--severity block` flag: those two default
// to exit 0 on a finding and the flag buys them a real signal, whereas this one
// has exited 1 on a finding since day 0.
//
// Usage:
//   pnpm lint:instruction-budget          # report + exit 1 when a file is OVER
//   pnpm lint:instruction-budget --json   # machine-readable report

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** Per-file budget for an always-on file. Mirrors ds-platform's #250 numbers. */
export const BUDGET = { lines: 200, bytes: 25 * 1024 }

/**
 * The corpus-wide cap over what a Claude session loads at start (#157; lowered
 * by #596 toward ds-platform's 30 KB — owner go, Anton, 2026-11-24).
 *
 * It is an explicit number, not a multiple of the per-file budget: the old
 * four-slot derivation (800 lines / 100 KB) described a corpus that also counted
 * the machine-local memory index and every rule file, lazy or not. Why a cap is
 * needed at all: the per-file budget alone is satisfiable by a corpus nobody can
 * afford — six files at 199 lines each pass individually while the session pays
 * for 1194 lines at every start. Splitting a file in two does not move it, and a
 * rule escapes it only by becoming genuinely lazy (`paths:` frontmatter).
 */
export const AGGREGATE_BUDGET = { lines: 400, bytes: 32 * 1024 }

/** Share of the budget above which a file (or the corpus) is NEAR — still passing. */
export const NEAR_RATIO = 0.8

/**
 * Does this rules file carry REAL `paths:` frontmatter — i.e. is it lazy? Strict
 * on purpose (ds-platform #1371): the block must open on the file's first line,
 * be terminated by a second `---`, and declare `paths` as a top-level key at
 * column 0. The word `paths:` in the body, an unterminated block, an indented or
 * commented key — none of those makes Claude Code load the file lazily, so none
 * of them takes the file off the total.
 *
 * The key must also SCOPE the file: at least one glob, and no match-all glob
 * (`**`, `**\/*`). An empty list may load unconditionally and a match-all glob
 * fires on every file a session touches — both are always-on in effect (#596).
 *
 * @param {string} content
 * @returns {boolean}
 */
export function isPathScoped(content) {
  const lines = String(content ?? '').split(/\r?\n/)
  if (lines[0] !== '---') return false
  const close = lines.indexOf('---', 1)
  if (close === -1) return false
  const block = lines.slice(1, close)
  const at = block.findIndex((l) => /^paths\s*:/.test(l))
  if (at === -1) return false
  const globs = pathsGlobs(block, at)
  return globs.length > 0 && !globs.some(isMatchAllGlob)
}

/** Globs that match every path in the repo, after a leading `./` or `/` is dropped. */
const MATCH_ALL_GLOBS = new Set(['**', '**/*', '**/**'])

/** @param {string} glob */
function isMatchAllGlob(glob) {
  return MATCH_ALL_GLOBS.has(glob.replace(/^\.?\//, ''))
}

/**
 * Strip one YAML scalar of its quotes, or of a trailing ` # comment` when bare.
 *
 * @param {string} raw
 */
function yamlScalar(raw) {
  const s = raw.trim()
  const quoted = /^(['"])(.*)\1(?:\s+#.*)?$/.exec(s)
  if (quoted) return quoted[2].trim()
  return s.replace(/\s+#.*$/, '').trim()
}

/**
 * The globs a `paths:` key declares — the inline scalar, the inline flow list
 * (`[a, b]`) or the block list of `- item` lines under it. Empty items drop out.
 *
 * @param {string[]} block frontmatter lines between the two `---`
 * @param {number} at index of the `paths:` line
 * @returns {string[]}
 */
function pathsGlobs(block, at) {
  const inline = block[at].replace(/^paths\s*:/, '').trim()
  /** @type {string[]} */
  let items
  if (inline && !inline.startsWith('#')) {
    const flow = /^\[(.*)\]\s*(?:#.*)?$/.exec(inline)
    items = flow ? flow[1].split(',') : [inline]
  } else {
    items = []
    for (const line of block.slice(at + 1)) {
      if (/^\S/.test(line)) break
      const item = /^\s+-(?:\s+(.*))?$/.exec(line)
      if (item) items.push(item[1] ?? '')
    }
  }
  return items.map(yamlScalar).filter((g) => g.length > 0)
}

/** The always-on repo files, in the order a session meets them. */
export const CORE_FILES = ['CLAUDE.md', 'AGENTS.md']

/**
 * The Claude-project slug of a repo root: the absolute path with every
 * separator and drive colon folded to `-` (`C:\Users\...` →
 * `C--Users-...`). Same derivation the session log dirs use.
 *
 * @param {string} repoRoot
 * @returns {string}
 */
export function projectSlug(repoRoot) {
  return String(repoRoot).replace(/[\\/:]/g, '-')
}

/**
 * Where the project's memory index lives for this repo root.
 *
 * @param {string} repoRoot
 * @param {string} home
 * @returns {string}
 */
export function memoryIndexPath(repoRoot, home) {
  return path.join(home, '.claude', 'projects', projectSlug(repoRoot), 'memory', 'MEMORY.md')
}

/**
 * Measure one file against the budget. Bytes — not characters — are what the
 * context window pays for, and this corpus is half Cyrillic, so the two differ
 * by ~2x on prose lines.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {{path:string, lines:number, bytes:number, chars:number, status:'PASS'|'NEAR'|'OVER', over:string[]}}
 */
export function evaluateFile(filePath, content) {
  const text = String(content ?? '')
  const chars = text.length
  const bytes = Buffer.byteLength(text, 'utf8')
  const newlines = (text.match(/\n/g) || []).length
  const lines = text.length > 0 && !text.endsWith('\n') ? newlines + 1 : newlines

  const over = []
  if (lines > BUDGET.lines) over.push('lines')
  if (bytes > BUDGET.bytes) over.push('bytes')

  const near = lines >= BUDGET.lines * NEAR_RATIO || bytes >= BUDGET.bytes * NEAR_RATIO
  const status = over.length > 0 ? 'OVER' : near ? 'NEAR' : 'PASS'

  return { path: filePath, lines, bytes, chars, status, over }
}

/**
 * Default lister of the path-less rule files.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
function defaultListRules(repoRoot) {
  const dir = path.join(repoRoot, '.claude', 'rules')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => path.join(dir, name))
}

/**
 * The always-on corpus: the two repo instruction files, every rule file, and
 * the project memory index. Anything absent is skipped, not failed — a fresh
 * clone has no memory dir and that is not a budget violation.
 *
 * `repoRoot` is the tree being edited (a worktree during a task); `memoryRoot`
 * is the main checkout, because the memory dir is keyed by the MAIN repo slug
 * whatever worktree the session runs in.
 *
 * @param {{repoRoot:string, home:string, memoryRoot?:string, exists?:(p:string)=>boolean, listRules?:(root:string)=>string[]}} deps
 * @returns {string[]}
 */
export function collectTargets({
  repoRoot,
  home,
  memoryRoot = repoRoot,
  exists = existsSync,
  listRules = defaultListRules,
}) {
  const candidates = [
    ...CORE_FILES.map((name) => path.join(repoRoot, name)),
    ...listRules(repoRoot),
    memoryIndexPath(memoryRoot, home),
  ]
  return candidates.filter((p) => exists(p))
}

/**
 * Render the report. A single OVER file fails the run, and so does a corpus SUM
 * past `AGGREGATE_BUDGET` even when every file passes on its own (#157). NEAR is
 * informational — the signal to compact while compaction is still cheap.
 *
 * Two non-verdicts, both exit 2 (`docs/ci-guardrails.md` §2.3 — a CLI guard
 * fails closed, and a check that never ran must not look clean):
 *   UNREADABLE — a target could not be read, so nothing was cleared.
 *   EMPTY      — nothing was measured at all (#157). `CLAUDE.md`/`AGENTS.md` are
 *                not optional; zero targets means the guard was pointed at the
 *                wrong tree, which is an input problem, not a clean corpus.
 * A real finding outranks both: one file over budget is exit 1 regardless.
 *
 * @param {ReturnType<typeof evaluateFile>[]} results
 * @param {string[]} [skipped]
 * @returns {{verdict:'PASS'|'FAIL'|'UNREADABLE'|'EMPTY', exitCode:number, text:string,
 *            results:any[], total:{lines:number, bytes:number}}}
 */
export function formatReport(results, skipped = []) {
  const rows = Array.isArray(results) ? results : []
  const failed = rows.filter((r) => r.status === 'OVER')
  const onTotal = (r) => r.scope === undefined || r.scope === 'always-on'
  const total = rows
    .filter(onTotal)
    .reduce((acc, r) => ({ lines: acc.lines + r.lines, bytes: acc.bytes + r.bytes }), {
      lines: 0,
      bytes: 0,
    })
  const corpusOver = []
  if (total.lines > AGGREGATE_BUDGET.lines) corpusOver.push('lines')
  if (total.bytes > AGGREGATE_BUDGET.bytes) corpusOver.push('bytes')
  const corpusNear =
    corpusOver.length === 0 &&
    (total.lines >= AGGREGATE_BUDGET.lines * NEAR_RATIO ||
      total.bytes >= AGGREGATE_BUDGET.bytes * NEAR_RATIO)

  const verdict =
    failed.length > 0 || corpusOver.length > 0
      ? 'FAIL'
      : skipped.length > 0
        ? 'UNREADABLE'
        : rows.length === 0
          ? 'EMPTY'
          : 'PASS'

  const lines = [
    `instruction budget — ${BUDGET.lines} lines / ${BUDGET.bytes} bytes per file, ` +
      `${AGGREGATE_BUDGET.lines} lines / ${AGGREGATE_BUDGET.bytes} bytes for the corpus`,
    '',
  ]

  if (rows.length === 0) {
    lines.push('no always-on files found — nothing to measure')
  }

  for (const r of rows) {
    const pct = Math.max(r.lines / BUDGET.lines, r.bytes / BUDGET.bytes)
    lines.push(
      `${r.status.padEnd(4)} ${String(Math.round(pct * 100)).padStart(3)}%  ` +
        `${String(r.lines).padStart(4)} lines ${String(r.bytes).padStart(6)} bytes  ${r.path}` +
        (onTotal(r) ? '' : `  [${r.scope}, off the total]`) +
        (r.over.length > 0 ? `  (over: ${r.over.join(', ')})` : ''),
    )
  }

  for (const s of skipped) lines.push(`SKIP       unreadable: ${s}`)

  if (rows.length > 0) {
    const pct = Math.max(total.lines / AGGREGATE_BUDGET.lines, total.bytes / AGGREGATE_BUDGET.bytes)
    const label = corpusOver.length > 0 ? 'OVER' : corpusNear ? 'NEAR' : 'ok'
    lines.push(
      '',
      `TOTAL ${String(Math.round(pct * 100)).padStart(3)}%  ` +
        `${String(total.lines).padStart(4)} lines ${String(total.bytes).padStart(6)} bytes  ` +
        `always-on corpus (${rows.filter(onTotal).length} of ${rows.length} file(s), ${label})` +
        (corpusOver.length > 0 ? `  (over: ${corpusOver.join(', ')})` : ''),
    )
  }

  lines.push('')
  if (verdict === 'FAIL') {
    const what = [
      failed.length > 0 ? `${failed.length} file(s) over budget` : null,
      corpusOver.length > 0
        ? `the corpus over its ${AGGREGATE_BUDGET.lines}-line / ${AGGREGATE_BUDGET.bytes}-byte cap ` +
          `(over: ${corpusOver.join(', ')})`
        : null,
    ]
      .filter(Boolean)
      .join(' + ')
    lines.push(
      `VERDICT: FAIL — ${what}. Do not trim by eye: compact by ` +
        'RELOCATING detail out of the always-on core (long detail → a `paths:`-scoped ' +
        '`.claude/rules/*.md` file or a skill; a settled fact → its owning repo file), then ' +
        're-run. Appending without relocating is the banned outcome. Note the corpus cap does ' +
        'NOT move by splitting one file into two — relocation has to leave the always-on set.',
    )
  } else if (verdict === 'UNREADABLE') {
    lines.push(
      `VERDICT: UNREADABLE — ${skipped.length} target(s) could not be read, so this run ` +
        'cleared nothing. Not a pass and not a finding (exit 2): fix the input and re-run.',
    )
  } else if (verdict === 'EMPTY') {
    lines.push(
      'VERDICT: EMPTY — zero always-on files were measured, so this run cleared nothing. ' +
        'CLAUDE.md and AGENTS.md are not optional: an empty corpus means the guard was pointed ' +
        'at the wrong tree. Not a pass and not a finding (exit 2): fix the input and re-run.',
    )
  } else {
    const near = rows.filter((r) => r.status === 'NEAR')
    const notes = [
      near.length > 0 ? `${near.length} file(s) NEAR the budget` : null,
      corpusNear ? 'the corpus NEAR its cap' : null,
    ].filter(Boolean)
    lines.push(
      `VERDICT: PASS${notes.length > 0 ? ` — ${notes.join(', ')}: compact at the next /wrap` : ''}`,
    )
  }

  const exitCode = verdict === 'FAIL' ? 1 : verdict === 'PASS' ? 0 : 2
  return { verdict, exitCode, text: lines.join('\n'), results: rows, total }
}

/**
 * Measure the whole corpus. Every filesystem touch is injected so the seam is
 * unit-testable without a real repo.
 *
 * @param {{repoRoot:string, home:string, memoryRoot?:string, exists?:(p:string)=>boolean, readFile?:(p:string)=>string, listRules?:(root:string)=>string[]}} deps
 */
export function runBudgetLint({
  repoRoot,
  home,
  memoryRoot = repoRoot,
  exists = existsSync,
  readFile = (p) => readFileSync(p, 'utf8'),
  listRules = defaultListRules,
}) {
  const targets = collectTargets({ repoRoot, home, memoryRoot, exists, listRules })
  const results = []
  const skipped = []
  const memoryIndex = path.normalize(memoryIndexPath(memoryRoot, home))
  const rulesDir = path.normalize(path.join(repoRoot, '.claude', 'rules'))
  for (const target of targets) {
    try {
      const content = readFile(target)
      const scope =
        path.normalize(target) === memoryIndex
          ? 'machine-local'
          : path.dirname(path.normalize(target)) === rulesDir && isPathScoped(content)
            ? 'lazy'
            : 'always-on'
      results.push({ ...evaluateFile(target, content), scope })
    } catch {
      skipped.push(target)
    }
  }
  return formatReport(results, skipped)
}

function git(args, fallback) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim() || fallback
  } catch {
    return fallback
  }
}

/**
 * The tree being measured is the one being EDITED — a task worktree during a
 * task, the main checkout otherwise. The memory dir, by contrast, is keyed by
 * the main checkout's path (`--git-common-dir`), because that is the slug the
 * project's memory lives under whatever worktree the session runs in.
 *
 * @returns {{repoRoot:string, memoryRoot:string}}
 */
function resolveRoots() {
  const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd())
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], '')
  return { repoRoot, memoryRoot: commonDir ? path.dirname(commonDir) : repoRoot }
}

function main(argv) {
  const report = runBudgetLint({ ...resolveRoots(), home: homedir() })
  if (argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ verdict: report.verdict, results: report.results }, null, 2)}\n`,
    )
  } else {
    process.stdout.write(`${report.text}\n`)
  }
  process.exitCode = report.exitCode
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main(process.argv.slice(2))
}
