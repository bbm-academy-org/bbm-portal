#!/usr/bin/env node
// bbm-portal — task worktree teardown (long-path safe). Issue #90.
//
// The pair of `pnpm task:worktree <N>`. Two things make a hand-rolled teardown
// unreliable on this box:
//
//   1. Windows MAX_PATH — a worktree that ran `pnpm install` has `node_modules`
//      paths past the limit, so `git worktree remove` DEREGISTERS the worktree
//      but FAILS the filesystem delete ("Filename too long"), leaving an orphan
//      directory that blocks the next `task:worktree` for the same issue.
//   2. Unmerged work — a plain `git branch -D` after the remove throws away
//      commits that were never pushed. Here the branch is deleted ONLY when it
//      is already an ancestor of `main`; anything else is kept and reported.
//
// Canon: `.claude/rules/parallel-sessions.md`.
//
// Usage:
//   pnpm worktree:teardown <N>                    # → .claude/worktrees/<N>
//   pnpm worktree:teardown <N> --force            # discard uncommitted changes in it
//   pnpm worktree:teardown <N> --keep-branch      # leave the branch alone
//   pnpm worktree:teardown <path>                 # explicit path also works
//
// A BARE name resolves against the PRIMARY tree's `.claude/worktrees/<name>`, so
// a teardown fired from inside another worktree targets the right tree.
//
// Exit codes: 0 = torn down; 1 = refused (dirty worktree without --force) or the
// orphan directory could not be purged; 2 = usage error; 3 = the argument names
// neither a registered worktree nor a directory under `.claude/worktrees/`
// (fail loud — a typo must never masquerade as a clean teardown).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const IS_WIN = process.platform === 'win32'

// ── pure seams (unit-tested in tests/unit/dev-worktree.spec.ts) ──────────────

/** Normalize a path for cross-tool comparison (lowercase, forward slashes). */
export const normPath = (p) =>
  String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()

/**
 * Resolve the teardown argument to an absolute path. A BARE name (no separator,
 * not absolute) resolves against the PRIMARY tree's `.claude/worktrees/<name>`;
 * an explicit path is honored as given. Injectable (`root`, `exists`) so the
 * unit tests can drive it without git or a real filesystem.
 */
export function resolveWorktreePath(rawArg, root, exists = existsSync) {
  if (isAbsolute(rawArg) || /[\\/]/.test(rawArg)) return resolve(rawArg)
  if (root) {
    const candidate = join(root, '.claude', 'worktrees', rawArg)
    if (exists(candidate)) return candidate
  }
  return resolve(rawArg)
}

/**
 * Classify the target so an unresolvable one fails loud instead of exiting 0:
 *   - "registered"   — a live registered worktree → normal teardown,
 *   - "orphan"       — not registered but still on disk → purge only,
 *   - "unresolvable" — neither → typo / shell-mangled path.
 */
export function classifyTeardownTarget(absPath, registeredPaths, exists = existsSync) {
  const want = normPath(absPath)
  if (registeredPaths.some((p) => normPath(p) === want)) return 'registered'
  if (exists(absPath)) return 'orphan'
  return 'unresolvable'
}

// ── impure CLI ───────────────────────────────────────────────────────────────

function out(msg) {
  process.stdout.write(`[worktree:teardown] ${msg}\n`)
}
function warn(msg) {
  process.stderr.write(`[worktree:teardown] WARN: ${msg}\n`)
}
function die(msg, code = 2) {
  process.stderr.write(`[worktree:teardown] ${msg}\n`)
  process.exit(code)
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts })
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    error: res.error,
  }
}

/** The primary working tree's root, or null when this is not a git repo. */
function mainRepoRoot() {
  const res = run('git', ['rev-parse', '--git-common-dir'])
  if (res.status !== 0) return null
  return dirname(resolve(res.stdout.trim()))
}

/** All registered worktree absolute paths. */
function listWorktreePaths(root) {
  const res = run('git', ['worktree', 'list', '--porcelain'], { cwd: root ?? undefined })
  if (res.status !== 0) return []
  return res.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
}

/** The branch checked out in the worktree at `absPath`, or null (detached). */
function resolveWorktreeBranch(root, absPath) {
  const res = run('git', ['worktree', 'list', '--porcelain'], { cwd: root ?? undefined })
  if (res.status !== 0) return null
  const want = normPath(absPath)
  let current = null
  for (const line of res.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) current = normPath(line.slice('worktree '.length))
    else if (line.startsWith('branch ') && current === want) {
      return line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
  }
  return null
}

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded])
}

/** Windows long-path-aware directory purge. Returns true when the dir is gone. */
function purgeDirWindows(absPath) {
  const winPath = win32.normalize(absPath)
  const longPath = `\\\\?\\${winPath}`
  runPowerShell(
    `Remove-Item -LiteralPath '${longPath.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue`,
  )
  if (!existsSync(absPath)) return true
  run('cmd', ['/c', 'rmdir', '/s', '/q', longPath])
  if (!existsSync(absPath)) return true
  // Last resort: mirror an empty directory over it (robocopy ignores MAX_PATH),
  // then remove the now-empty tree.
  const empty = mkdtempSync(join(tmpdir(), 'wt-empty-'))
  try {
    run('robocopy', [empty, winPath, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS'])
    run('cmd', ['/c', 'rmdir', '/s', '/q', longPath])
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
  return !existsSync(absPath)
}

function purgeDir(absPath) {
  if (!existsSync(absPath)) return true
  if (IS_WIN) return purgeDirWindows(absPath)
  rmSync(absPath, { recursive: true, force: true })
  return !existsSync(absPath)
}

/**
 * Delete the branch only when `main` already contains it. An unmerged branch is
 * KEPT and reported: teardown is a cleanup step, never a way to lose commits.
 */
function cleanupBranch(root, branch) {
  if (!branch) {
    out('worktree was detached (no branch) — nothing to delete.')
    return
  }
  const merged = run('git', ['merge-base', '--is-ancestor', branch, 'main'], { cwd: root })
  if (merged.status !== 0) {
    warn(
      `branch '${branch}' is NOT merged into main — kept. Its commits still exist; ` +
        `delete it yourself (git branch -D ${branch}) once the PR is merged or the work is dropped.`,
    )
    return
  }
  const res = run('git', ['branch', '-d', branch], { cwd: root })
  if (res.status === 0) out(`deleted merged branch '${branch}'.`)
  else warn(`could not delete merged branch '${branch}': ${res.stderr.trim()}`)
}

function main() {
  const args = process.argv.slice(2)
  let keepBranch = false
  let force = false
  const positional = []
  for (const a of args) {
    if (a === '--keep-branch') keepBranch = true
    else if (a === '--force') force = true
    else if (a.startsWith('--')) die(`unknown flag '${a}'`)
    else positional.push(a)
  }
  if (positional.length !== 1) {
    die('Usage: pnpm worktree:teardown <issue-number|path> [--force] [--keep-branch]')
  }

  const root = mainRepoRoot()
  const absPath = resolveWorktreePath(positional[0], root)

  const registered = listWorktreePaths(root)
  const kind = classifyTeardownTarget(absPath, registered, existsSync)
  if (kind === 'unresolvable') {
    const listing = registered.length
      ? registered.map((p) => `    ${p}`).join('\n')
      : '    (none registered)'
    die(
      `'${positional[0]}' resolved to '${absPath}', which is neither a registered worktree ` +
        `nor a directory under .claude/worktrees/ — nothing was torn down.\n` +
        `Registered worktrees:\n${listing}`,
      3,
    )
  }

  // Refuse on uncommitted work unless --force: `git worktree remove` would too,
  // but the message here names the remedy instead of leaking a git error.
  if (kind === 'registered' && !force) {
    const dirty = run('git', ['status', '--porcelain'], { cwd: absPath })
    if (dirty.status === 0 && dirty.stdout.trim() !== '') {
      die(
        `worktree '${absPath}' has uncommitted changes — refusing to remove it.\n` +
          `Commit or stash them there first, or re-run with --force to discard them:\n` +
          dirty.stdout
            .trimEnd()
            .split(/\r?\n/)
            .slice(0, 10)
            .map((l) => `    ${l}`)
            .join('\n'),
        1,
      )
    }
  }

  const branch = resolveWorktreeBranch(root, absPath)

  const removed = run('git', ['worktree', 'remove', '--force', absPath], { cwd: root })
  if (removed.status === 0) {
    out(`git deregistered + removed worktree '${absPath}'.`)
  } else if (/filename too long|failed to delete/i.test(removed.stderr)) {
    out(`git deregistered '${absPath}' (FS delete hit the long-path limit — purging below).`)
  } else if (/is not a working tree|No such/i.test(removed.stderr)) {
    warn(`'${absPath}' is not a registered worktree — purging any orphan dir anyway.`)
  } else {
    warn(`git worktree remove returned ${removed.status}: ${removed.stderr.trim()}`)
  }

  if (existsSync(absPath)) {
    if (purgeDir(absPath)) out(`purged orphan directory '${absPath}'.`)
    else
      die(
        `could not remove '${absPath}' — something still holds it (a dev server or an editor ` +
          `with its cwd inside). Stop it and re-run; on Windows check ` +
          `Get-NetTCPConnection -State Listen for a stand you started there.`,
        1,
      )
  } else {
    out('no orphan directory left on disk.')
  }

  run('git', ['worktree', 'prune'], { cwd: root })

  if (keepBranch) out(`--keep-branch: leaving branch '${branch ?? '(detached)'}' in place.`)
  else cleanupBranch(root, branch)

  out(`teardown complete for '${absPath}'.`)
  process.exit(0)
}

const INVOKED = process.argv[1] ? resolve(process.argv[1]) : ''
const SELF = resolve(fileURLToPath(import.meta.url))
if (INVOKED === SELF) {
  main()
}
