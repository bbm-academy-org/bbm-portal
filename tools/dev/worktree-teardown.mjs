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
// The FIRST thing that runs is the scope gate: the canonicalized target must lie
// strictly inside `<primary>/.claude/worktrees/`. `.`, the container itself, the
// primary checkout, and anything outside are refused before a single destructive
// call — this command deletes task worktrees and nothing else.
//
// Exit codes: 0 = torn down; 1 = refused (outside the allowed scope, dirty
// worktree without --force, unreadable working-tree state, or an orphan
// directory that could not be purged); 2 = usage error; 3 = the argument names
// neither a registered worktree nor a directory under `.claude/worktrees/`
// (fail loud — a typo must never masquerade as a clean teardown).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, win32 } from 'node:path'
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
 * Is the target a path this tool is allowed to destroy at all? THE safety gate —
 * it runs before every `git worktree remove` and every purge, for registered and
 * orphan targets alike.
 *
 * Without it the tool deletes things it must never touch (review of PR #97):
 *   - `pnpm worktree:teardown .` resolves to the `.claude/worktrees` CONTAINER,
 *     whose purge takes out every session's tree at once;
 *   - the primary checkout's own path makes `git worktree remove` fail with
 *     "is a main working tree" — a message the error parser does not recognize,
 *     so control fell through to the purge and the MAIN CHECKOUT was erased.
 *
 * Legal targets are therefore STRICTLY INSIDE `<primary>/.claude/worktrees/` and
 * deeper than the container itself. Both sides are canonicalized through `real`
 * (realpath) first, so a symlink, a junction, or a Windows 8.3 short name cannot
 * smuggle a path past the prefix test.
 *
 * Returns: "inside" | "primary-tree" | "worktrees-root" | "outside" | "no-root".
 * Pure + injectable (`real`) so the unit tests drive every branch without a
 * filesystem.
 */
export function classifyTeardownScope(absPath, root, real = (p) => p) {
  if (!root) return 'no-root'
  const primary = normPath(real(root))
  const container = normPath(real(join(root, '.claude', 'worktrees')))
  const target = normPath(real(absPath))
  if (target === primary) return 'primary-tree'
  if (target === container) return 'worktrees-root'
  if (target.startsWith(`${container}/`)) return 'inside'
  return 'outside'
}

/**
 * Classify the target so an unresolvable one fails loud instead of exiting 0:
 *   - "registered"   — a live registered worktree → normal teardown,
 *   - "orphan"       — not registered but still on disk → purge only,
 *   - "unresolvable" — neither → typo / shell-mangled path.
 *
 * This says WHAT the target is, never whether touching it is allowed — that is
 * `classifyTeardownScope`, and an "orphan" passes exactly the same gate.
 */
export function classifyTeardownTarget(absPath, registeredPaths, exists = existsSync) {
  const want = normPath(absPath)
  if (registeredPaths.some((p) => normPath(p) === want)) return 'registered'
  if (exists(absPath)) return 'orphan'
  return 'unresolvable'
}

/**
 * Decide what happens to the worktree's branch. Split out as a seam so the
 * "only a branch main already contains may be deleted" promise is proven by a
 * test rather than by reading the call site.
 */
export function branchDeletionDecision(branch, isMergedIntoMain) {
  if (!branch) return 'detached'
  return isMergedIntoMain ? 'delete' : 'keep'
}

function envNamesBranchDatabase(envContents, taskId) {
  const expected = `platform_${taskId}`
  for (const line of String(envContents ?? '').split(/\r?\n/)) {
    const match = /^PLATFORM_DATABASE_URL=(.*)$/.exec(line.trim())
    if (!match) continue
    const value = match[1].trim().replace(/^['"]|['"]$/g, '')
    try {
      return new URL(value).pathname.replace(/^\//, '').toLowerCase() === expected
    } catch {
      return false
    }
  }
  return false
}

export function branchDatabaseTeardownPlan(rawArg, absPath, root, localEnvContents = '') {
  const numericArg = /^[1-9][0-9]*$/.test(String(rawArg ?? '')) ? String(rawArg) : null
  const container = normPath(join(root ?? '', '.claude', 'worktrees'))
  const target = normPath(absPath)
  const rel = target.startsWith(`${container}/`) ? target.slice(container.length + 1) : ''
  const firstSegment = rel.split('/')[0] ?? ''
  const pathId = /^[1-9][0-9]*$/.test(firstSegment)
    ? firstSegment
    : /^[1-9][0-9]*$/.test(basename(absPath))
      ? basename(absPath)
      : null

  if (numericArg && pathId && numericArg !== pathId) {
    throw new Error(`numeric task id mismatch: argument ${numericArg}, worktree path ${pathId}`)
  }
  const taskId = numericArg ?? pathId
  if (!taskId) return { action: 'skip', reason: 'not a numeric task worktree' }
  if (!envNamesBranchDatabase(localEnvContents, taskId)) {
    return {
      action: 'skip',
      reason: `no local PLATFORM_DATABASE_URL marker for platform_${taskId}`,
    }
  }
  return { action: 'drop', taskId }
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

/**
 * Canonicalize a path, falling back to the input when it does not exist yet.
 * Feeding this to the scope gate is what makes a symlink / junction / 8.3 short
 * name unable to point outside the worktrees container while looking inside it.
 */
function safeRealpath(p) {
  try {
    return realpathSync.native(p)
  } catch {
    return p
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
  // Both refs: the primary checkout's local `main` is often behind (it only
  // moves when someone pulls), so testing it alone keeps every branch forever.
  // Containment in EITHER `main` or `origin/main` means the commits are safe.
  const merged = ['main', 'origin/main'].some(
    (ref) =>
      run('git', ['merge-base', '--is-ancestor', branch ?? '', ref], { cwd: root }).status === 0,
  )
  switch (branchDeletionDecision(branch, merged)) {
    case 'detached':
      out('worktree was detached (no branch) — nothing to delete.')
      return
    case 'keep':
      warn(
        `branch '${branch}' is NOT merged into main — kept. Its commits still exist; ` +
          `delete it yourself (git branch -D ${branch}) once the PR is merged or the work is dropped.`,
      )
      return
    default: {
      const res = run('git', ['branch', '-d', branch], { cwd: root })
      if (res.status === 0) out(`deleted merged branch '${branch}'.`)
      else warn(`could not delete merged branch '${branch}': ${res.stderr.trim()}`)
    }
  }
}

/**
 * Probe the target's working-tree state, FAIL-CLOSED. Returns:
 *   - "clean"          — git says there is nothing uncommitted,
 *   - "dirty"          — uncommitted changes (overridable with --force),
 *   - "unavailable"    — the target IS a git tree but `git status` failed; we
 *                        know nothing, so we must not assume "clean". NOT
 *                        overridable by --force: a broken query is not consent,
 *   - "not-a-worktree" — no `.git` entry at all, so there is no git state to
 *                        lose. This is the long-path orphan left behind after
 *                        git already deregistered the tree; the scope gate has
 *                        already proven it sits inside `.claude/worktrees/`.
 */
function probeWorkingTree(absPath) {
  if (!existsSync(join(absPath, '.git'))) return { state: 'not-a-worktree', detail: '' }
  const res = run('git', ['status', '--porcelain'], { cwd: absPath })
  if (res.status !== 0) {
    return { state: 'unavailable', detail: (res.stderr || res.stdout).trim() }
  }
  return res.stdout.trim() === ''
    ? { state: 'clean', detail: '' }
    : { state: 'dirty', detail: res.stdout.trimEnd() }
}

function scriptRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function dropBranchDatabaseBeforeWorktreeRemoval(taskId, absPath) {
  const script = join(scriptRepoRoot(), 'tools', 'platform', 'branch-database.mjs')
  const envWithoutPlatformUrl = { ...process.env }
  delete envWithoutPlatformUrl.PLATFORM_DATABASE_URL
  // Same reason as the line above, for the migrating echelon (#278): an exported
  // variable wins over the worktree `.env`, and dropping must resolve the branch
  // database from THAT worktree's file or it aims at someone else's.
  delete envWithoutPlatformUrl.PLATFORM_MIGRATE_DATABASE_URL
  return run(process.execPath, [script, 'drop', taskId, '--env-root', absPath], {
    cwd: existsSync(absPath) ? absPath : scriptRepoRoot(),
    env: envWithoutPlatformUrl,
  })
}

function readLocalEnv(absPath) {
  const path = join(absPath, '.env')
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
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

  // 0. THE safety gate, before any git-remove or filesystem delete: the target
  //    must sit strictly inside <primary>/.claude/worktrees/. `.`, the container
  //    itself, the primary checkout and anything outside are refused here, so no
  //    later branch can reach them (PR #97 review).
  switch (classifyTeardownScope(absPath, root, safeRealpath)) {
    case 'inside':
      break
    case 'primary-tree':
      die(
        `'${positional[0]}' resolves to the PRIMARY checkout '${absPath}' — refusing.\n` +
          `That is the shared tree every session and live stand depends on; it is not a ` +
          `task worktree and this command will never delete it.`,
        1,
      )
      break
    case 'worktrees-root':
      die(
        `'${positional[0]}' resolves to the worktrees CONTAINER '${absPath}' — refusing.\n` +
          `Removing it would take out EVERY session's worktree at once. Name one worktree ` +
          `(e.g. pnpm worktree:teardown 93).`,
        1,
      )
      break
    case 'no-root':
      die('not a git repository — cannot locate the primary tree; refusing to delete anything.', 1)
      break
    default:
      die(
        `'${positional[0]}' resolves to '${absPath}', which is OUTSIDE ` +
          `'${join(root ?? '', '.claude', 'worktrees')}' — refusing.\n` +
          `This command only ever removes task worktrees created by pnpm task:worktree.`,
        1,
      )
  }

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

  // Refuse on uncommitted work — for orphans as much as for registered trees,
  // and FAIL-CLOSED: a `git status` that errors tells us nothing, so it can
  // never be read as "clean" (PR #97 review).
  const tree = probeWorkingTree(absPath)
  if (tree.state === 'unavailable') {
    die(
      `cannot read the working-tree state of '${absPath}' — refusing to remove it.\n` +
        `git status failed there, so uncommitted work cannot be ruled out; --force does NOT ` +
        `override this (a failed check is not a clean check). Fix the tree, then re-run:\n` +
        `    ${tree.detail || '(git produced no message)'}`,
      1,
    )
  }
  if (tree.state === 'dirty' && !force) {
    die(
      `worktree '${absPath}' has uncommitted changes — refusing to remove it.\n` +
        `Commit or stash them there first, or re-run with --force to discard them:\n` +
        tree.detail
          .split(/\r?\n/)
          .slice(0, 10)
          .map((l) => `    ${l}`)
          .join('\n'),
      1,
    )
  }
  if (tree.state === 'not-a-worktree') {
    out(`'${absPath}' is no longer a git worktree (deregistered leftover) — purging the directory.`)
  }

  let dbPlan
  try {
    dbPlan = branchDatabaseTeardownPlan(positional[0], absPath, root, readLocalEnv(absPath))
  } catch (err) {
    die(`cannot decide branch database teardown safely: ${err?.message ?? String(err)}`, 1)
  }
  if (dbPlan.action === 'drop') {
    const db = dropBranchDatabaseBeforeWorktreeRemoval(dbPlan.taskId, absPath)
    if (db.status !== 0) {
      die(
        `branch database teardown for platform_${dbPlan.taskId} failed; refusing to remove the worktree ` +
          `and claim cleanup succeeded.\n${(db.stdout + db.stderr).trim()}`,
        1,
      )
    }
    out(`branch database platform_${dbPlan.taskId} removed (or already absent).`)
    if (db.stdout.trim()) out(db.stdout.trim())
  } else {
    out(`branch database teardown skipped: ${dbPlan.reason}.`)
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
