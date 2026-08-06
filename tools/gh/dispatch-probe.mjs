#!/usr/bin/env node
// bbm-portal — `pnpm dispatch:probe <N>`: pre-dispatch / mid-dispatch liveness
// probe of a task worktree (task 7.3, #134; port of ds-platform
// `tools/gh/dispatch-probe.mjs`).
//
// Why: a background dispatch that produced nothing looks exactly like one that
// is working — from the lead's side both are silence. The standing rule ("after
// a bounded interval, probe the worktree; still clean ≈10 min in = kill and
// re-dispatch") left the lead hand-rolling `git -C <worktree> log/status`
// incantations, so in practice it was not run. This makes the checkpoint ONE
// deterministic command with a machine-parseable verdict, so the lead reports
// observed artifacts instead of waiting on a notification.
//
// It is equally the PRE-dispatch check: run before handing #N to a subagent and
// a non-STILL-CLEAN verdict means someone else already has work in that
// worktree — the claim signals of `.claude/skills/task-canon/SKILL.md` §4, read
// off disk. Never touch another session's worktree (`parallel-sessions.md`).
//
// What it observes in `.claude/worktrees/<N>` (all "since dispatch": the
// worktree is created off fresh `origin/main` with zero commits ahead):
//   • commits — `git rev-list --count origin/main..HEAD`, durable produced work;
//   • dirty   — non-empty `git status --porcelain` lines, edits in flight;
//   • age     — since the last commit if there are commits, else the newest
//     mtime among the dirty files, else the worktree `.git` link file, written
//     once at `git worktree add` (a dispatch-time proxy).
//
// Verdicts (pure `classifyVerdict` — this is the core):
//   ALIVE            commits exist, OR dirty files touched within the threshold;
//   QUIET <age>      no commits, dirty files, none touched within the threshold;
//   STILL-CLEAN <age> nothing at all; past the threshold the line carries
//                    `advice=kill+re-dispatch`.
// The single `thresholdSeconds` (default 600) does double duty: the freshness
// cutoff separating an actively-edited tree from a stalled one, and the
// kill-advice cutoff for a clean tree.
//
// Output, one line: `<VERDICT> #<N> age=<age> commits=<c> dirty=<d>[ advice=…]`
//
// Exit codes: 0 whenever the PROBE ran — for ALIVE, QUIET and STILL-CLEAN
// alike. The code reports whether the probe worked, not whether the task is
// healthy: STILL-CLEAN is a real advisory state read off stdout, and a non-zero
// there would poison any `&&`-chained scripting. 2 = usage/input error (missing
// or non-numeric <N>, no such worktree). Auto-kill is deliberately out of
// scope — killing a listener or a session you did not start is exactly what
// `parallel-sessions.md` forbids; the action stays a lead decision.
//
// Every git call names its tree with `git -C <abs>` (`.claude/rules/dev-env.md`:
// cwd drifts between calls and a probe must never read the wrong worktree). The
// classifier, age formatter, porcelain parser and evidence gatherer are exported
// for tests/unit/dispatch-scripts.spec.ts; git and fs go through injectable
// seams so the tests never shell out.

import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = '[dispatch:probe]'
const MAX_BUFFER = 16 * 1024 * 1024

/** The ≈10-minute rule: silence this long with nothing on disk is not progress. */
export const STALE_THRESHOLD_SECONDS = 10 * 60

// ── pure seams (unit-tested in tests/unit/dispatch-scripts.spec.ts) ──────────

/**
 * Classify liveness from three observed scalars.
 * @param {{commitCount: number, dirtyCount: number, ageSeconds: number, thresholdSeconds?: number}} o
 * @returns {{verdict: 'ALIVE'|'QUIET'|'STILL-CLEAN', killAdvised: boolean}}
 */
export function classifyVerdict({
  commitCount,
  dirtyCount,
  ageSeconds,
  thresholdSeconds = STALE_THRESHOLD_SECONDS,
}) {
  // Any commit since dispatch is durable evidence work was produced.
  if (commitCount > 0) return { verdict: 'ALIVE', killAdvised: false }
  // Dirty, no commits: fresh edits ⇒ still working; aged ⇒ it went quiet.
  if (dirtyCount > 0) {
    return ageSeconds < thresholdSeconds
      ? { verdict: 'ALIVE', killAdvised: false }
      : { verdict: 'QUIET', killAdvised: false }
  }
  // Nothing at all — advise kill + re-dispatch once past the cutoff.
  return { verdict: 'STILL-CLEAN', killAdvised: ageSeconds >= thresholdSeconds }
}

/** Compact, sortable age: `45s`, `9m`, `9m47s`, `1h5m`. */
export function formatAge(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return rem ? `${m}m${rem}s` : `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h}h${mm}m` : `${h}h`
}

/**
 * The working-tree path out of one `git status --porcelain` line: `XY <path>`,
 * and for a rename `XY <orig> -> <path>` — the destination is the live file to
 * stat. Git quotes paths with special characters; the quotes are dropped.
 * @param {string} line
 * @returns {string}
 */
export function parsePorcelainPath(line) {
  let p = String(line ?? '').slice(3)
  const arrow = p.indexOf(' -> ')
  if (arrow !== -1) p = p.slice(arrow + 4)
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  return p
}

/**
 * Gather the three scalars through injected seams.
 * @param {{worktreePath: string,
 *          runner: {git: (cwd: string, args: string[]) => {status: number, stdout: string, stderr: string}},
 *          statMtime: (p: string) => number|null, nowMs: number}} o
 * @returns {{commitCount: number, dirtyCount: number, ageSeconds: number}}
 */
export function gatherEvidence({ worktreePath, runner, statMtime, nowMs }) {
  // Commits since dispatch: reachable from HEAD but not from origin/main.
  let commitCount = 0
  const rl = runner.git(worktreePath, ['rev-list', '--count', 'origin/main..HEAD'])
  if (rl.status === 0) commitCount = Number(rl.stdout.trim()) || 0

  // Dirty files (modified / staged / untracked).
  const st = runner.git(worktreePath, ['status', '--porcelain'])
  const dirtyPaths =
    st.status === 0
      ? st.stdout
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0)
          .map(parsePorcelainPath)
      : []
  const dirtyCount = dirtyPaths.length

  // Last activity → age. A failed git call degrades to "just now" rather than
  // to a fake staleness: advising a kill because git hiccuped would be worse
  // than advising nothing.
  let lastActivityMs
  if (commitCount > 0) {
    const ct = runner.git(worktreePath, ['log', '-1', '--format=%ct', 'HEAD'])
    const secs = ct.status === 0 ? Number(ct.stdout.trim()) : NaN
    lastActivityMs = Number.isFinite(secs) ? secs * 1000 : nowMs
  } else if (dirtyCount > 0) {
    const mtimes = dirtyPaths
      .map((p) => statMtime(join(worktreePath, p)))
      .filter((m) => typeof m === 'number')
    lastActivityMs = mtimes.length > 0 ? Math.max(...mtimes) : nowMs
  } else {
    // Clean tree: the worktree `.git` link file is written once, at creation.
    lastActivityMs = statMtime(join(worktreePath, '.git')) ?? nowMs
  }
  const ageSeconds = Math.max(0, (nowMs - lastActivityMs) / 1000)
  return { commitCount, dirtyCount, ageSeconds }
}

/** The one-line verdict for stdout. */
export function formatLine(n, evidence, decision) {
  const { verdict, killAdvised } = decision
  const { commitCount, dirtyCount, ageSeconds } = evidence
  const parts = [
    verdict,
    `#${n}`,
    `age=${formatAge(ageSeconds)}`,
    `commits=${commitCount}`,
    `dirty=${dirtyCount}`,
  ]
  if (killAdvised) parts.push('advice=kill+re-dispatch')
  return parts.join(' ')
}

// ── impure CLI (skipped on import) ───────────────────────────────────────────

/**
 * Default runner — real `git`, ALWAYS with an explicit `-C <tree>` rather than
 * a cwd option (`.claude/rules/dev-env.md`): the tree a probe reads is named,
 * never inherited.
 */
export function defaultRunner() {
  return {
    git: (tree, args) => {
      const res = spawnSync('git', ['-C', tree, ...args], {
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
      })
      if (res.error) throw new Error(`could not run git: ${res.error.message}`)
      return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
    },
  }
}

/** Default mtime seam: mtime in ms, or null when the path does not exist. */
function defaultStatMtime(p) {
  try {
    return statSync(p).mtimeMs
  } catch {
    return null
  }
}

/** The PRIMARY working tree's root, even when invoked from a linked worktree. */
function mainRepoRoot() {
  const res = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' })
  if (res.status !== 0 || !res.stdout) return null
  // --git-common-dir → "<root>/.git" (absolute inside a worktree, ".git" in the
  // primary tree). Resolve against cwd; the repo root is its parent.
  return dirname(resolve(res.stdout.trim()))
}

function die(msg) {
  process.stderr.write(`${TAG} ${msg}\n`)
  process.exit(2)
}

function main() {
  const n = process.argv[2]
  if (!n || !/^\d+$/.test(n)) die('usage: pnpm dispatch:probe <issue-number>')

  const root = mainRepoRoot()
  if (!root) die('not a git repository (git rev-parse --git-common-dir failed).')

  const worktreePath = join(root, '.claude', 'worktrees', String(n))
  if (defaultStatMtime(worktreePath) == null) {
    die(
      `no worktree at .claude/worktrees/${n} — create it (pnpm task:worktree ${n}) or check the number.`,
    )
  }

  const evidence = gatherEvidence({
    worktreePath,
    runner: defaultRunner(),
    statMtime: defaultStatMtime,
    nowMs: Date.now(),
  })
  process.stdout.write(`${formatLine(n, evidence, classifyVerdict(evidence))}\n`)
  process.exit(0)
}

// Run only as the entry point — the guard keeps the pure seams importable from
// the unit tests without firing main()'s git subprocesses.
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : ''
const SELF = resolve(fileURLToPath(import.meta.url))
if (INVOKED === SELF) {
  main()
}
