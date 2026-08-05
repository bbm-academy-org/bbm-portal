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
// Scope note (the ambiguity #139 had to settle): the budget covers the four
// ALWAYS-ON files — CLAUDE.md, AGENTS.md, every `.claude/rules/*.md`, and the
// MEMORY.md index. Two neighbours are deliberately outside it: the lazy
// `memory/<topic>.md` files (loaded only when the index line sends a session
// there — they obey the same prune-before-add discipline, but what is budgeted
// is their one-line index entry), and the session transcript
// (`~/.claude/projects/<slug>/*.jsonl`), which is read-only evidence and is
// never rewritten, compacted or pruned by anything in this repo.
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

/** Share of the budget above which a file is reported NEAR (still passing). */
export const NEAR_RATIO = 0.8

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
 * Render the report. A single OVER file fails the run; NEAR is informational —
 * it is the signal to compact while compaction is still cheap.
 *
 * @param {ReturnType<typeof evaluateFile>[]} results
 * @param {string[]} [skipped]
 * @returns {{verdict:'PASS'|'FAIL', exitCode:number, text:string, results:any[]}}
 */
export function formatReport(results, skipped = []) {
  const rows = Array.isArray(results) ? results : []
  const failed = rows.filter((r) => r.status === 'OVER')
  const verdict = failed.length > 0 ? 'FAIL' : 'PASS'

  const lines = [`instruction budget — ${BUDGET.lines} lines / ${BUDGET.bytes} bytes per file`, '']

  if (rows.length === 0) {
    lines.push('no always-on files found — nothing to measure')
  }

  for (const r of rows) {
    const pct = Math.max(r.lines / BUDGET.lines, r.bytes / BUDGET.bytes)
    lines.push(
      `${r.status.padEnd(4)} ${String(Math.round(pct * 100)).padStart(3)}%  ` +
        `${String(r.lines).padStart(4)} lines ${String(r.bytes).padStart(6)} bytes  ${r.path}` +
        (r.over.length > 0 ? `  (over: ${r.over.join(', ')})` : ''),
    )
  }

  for (const s of skipped) lines.push(`SKIP       unreadable: ${s}`)

  lines.push('')
  if (verdict === 'FAIL') {
    lines.push(
      `VERDICT: FAIL — ${failed.length} file(s) over budget. Do not trim by eye: compact by ` +
        'RELOCATING detail out of the always-on core (long detail → a `.claude/rules/*.md` ' +
        'file or a skill; a settled fact → a `memory/<topic>.md` file + one index line), then ' +
        're-run. Appending without relocating is the banned outcome.',
    )
  } else {
    const near = rows.filter((r) => r.status === 'NEAR')
    lines.push(
      `VERDICT: PASS${near.length > 0 ? ` — ${near.length} file(s) NEAR the budget: compact them at the next /wrap` : ''}`,
    )
  }

  return { verdict, exitCode: verdict === 'FAIL' ? 1 : 0, text: lines.join('\n'), results: rows }
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
  for (const target of targets) {
    try {
      results.push(evaluateFile(target, readFile(target)))
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
