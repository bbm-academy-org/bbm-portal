#!/usr/bin/env node
// bbm-portal — per-session task worktree (parallel-session safe). Issue #90.
//
// Why: parallel Claude sessions share ONE checkout, which has ONE HEAD and one
// uncommitted-change set. Four incidents in a week came out of that: a
// force-push onto another session's branch (resurrecting a deleted one), a
// subagent switching the branch under a live acceptance stand, and the checkout
// walking off to `feat/81` in the middle of the owner's acceptance ("the link
// doesn't work"). The fix is structural — the session's branch lives in its OWN
// worktree, the shared checkout stays on `main` — and this makes that one
// deterministic command instead of a remembered four-step incantation.
//
// Canon: `.claude/rules/parallel-sessions.md`.
// Pairs with `pnpm worktree:teardown <N>`.
//
// Usage:
//   pnpm task:worktree <N>                  # derive slug + type from `gh issue view <N>`
//   pnpm task:worktree <N> <slug>           # explicit slug, type from the issue title
//   pnpm task:worktree <N> <slug> <type>    # explicit both (feat|fix|chore|docs)
//
// What it does, in order:
//   1. resolve the PRIMARY tree's root from `git rev-parse --git-common-dir`, so
//      the worktree always lands under the primary `.claude/worktrees/` even when
//      this runs from inside another worktree,
//   2. `gh issue view <N>` → title → branch type (Conventional-Commit prefix of
//      the title) + slug (transliterated, the titles here are Russian),
//   3. refuse early if the worktree path or the branch already exists,
//   4. `git fetch origin main` → `git worktree add .claude/worktrees/<N> -b <branch> origin/main`
//      (the path is the bare issue number: a short path dodges the Windows
//      MAX_PATH limit that deep `node_modules` trees blow through),
//   5. print the next steps with a LOUD `pnpm install` warning.
//
// Exit codes: 0 = worktree ready; 1 = pre-flight refusal (exists / gh / git
// error); 2 = usage error.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── pure seams (unit-tested in tests/unit/dev-worktree.spec.ts) ──────────────

/** The branch types this repo uses (AGENTS.md → Code style, Conventional Commits). */
export const BRANCH_TYPES = ['feat', 'fix', 'chore', 'docs']

/**
 * Conventional-Commit types that may appear in an issue title, mapped to the
 * four branch prefixes above. Anything unrecognized (`refactor`, `ci`, `test`,
 * a title with no prefix at all) falls to `chore`: a mislabelled maintenance
 * branch is cheaper to rename than a stray `feat/` that misreads the changelog.
 */
const TITLE_TYPE_MAP = {
  feat: 'feat',
  feature: 'feat',
  fix: 'fix',
  bug: 'fix',
  bugfix: 'fix',
  docs: 'docs',
}

/** Cyrillic → latin, so a fully Russian issue title still yields a real slug. */
const TRANSLIT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

/** Strip a leading Conventional-Commit prefix (`feat(dev): `, `chore: `). */
function stripConventionalPrefix(title) {
  return (title ?? '').replace(/^\s*[a-zA-Z]+(\([^)]*\))?!?:\s*/, '')
}

/**
 * Issue title → branch type. The signal is the title's Conventional-Commit
 * prefix (`feat(dev): …` → `feat`) because this repo's issues carry no kind
 * labels — the type lives in the title by convention. Unknown → `chore`.
 */
export function branchTypeFromTitle(title) {
  const m = (title ?? '').match(/^\s*([a-zA-Z]+)(\([^)]*\))?!?:/)
  if (!m) return 'chore'
  return TITLE_TYPE_MAP[m[1].toLowerCase()] ?? 'chore'
}

/** True for a type this repo actually uses as a branch prefix. */
export function isValidBranchType(type) {
  return BRANCH_TYPES.includes(type)
}

/**
 * Issue title → branch slug: drop the Conventional-Commit prefix, transliterate
 * Cyrillic, lowercase, dash every run of non-alphanumerics, and cap at six words
 * so the branch stays readable (the worktree PATH is the bare number; the BRANCH
 * is what humans read in `gh pr list`).
 */
export function slugifyTitle(title) {
  return stripConventionalPrefix(title)
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (ch) => TRANSLIT[ch] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
}

/** `<type>/<N>-<slug>`. */
export function branchName(type, n, slug) {
  return `${type}/${n}-${slug}`
}

/** The short, numeric worktree path (repo-relative, forward slashes). */
export function worktreeRelPath(n) {
  return `.claude/worktrees/${n}`
}

/**
 * The post-create "next steps" block, as a line array so the CLI can tag each
 * line and the unit tests can assert on the copy without firing git/gh.
 *
 * A fresh worktree has NO `node_modules`, so nothing that lives there exists
 * yet — including the pre-commit hook. That is a predictable failed-commit
 * round-trip, so the install requirement is an UNCONDITIONAL, visually loud
 * warning rather than a skimmable hint.
 */
export function nextStepsLines(relPath, n) {
  return [
    'next steps:',
    `  1. work inside ${relPath} (EnterWorktree path:${relPath} for a subagent)`,
    '  2. pnpm install              # ~42 s — REQUIRED, see the warning below',
    '  3. pnpm dev:ports            # take a free port; never bind 3000 blindly',
    `  4. … open the PR, then: pnpm worktree:teardown ${n}`,
    '',
    '!!  RUN `pnpm install` IN THE WORKTREE BEFORE YOUR FIRST COMMIT.',
    '!!  A fresh worktree has no node_modules, so the pre-commit hook is NOT',
    '!!  installed and no test/lint command can run — the first commit and any',
    '!!  check WILL FAIL until `pnpm install` (~42 s) has finished.',
  ]
}

// ── impure CLI (skipped on import) ───────────────────────────────────────────

function out(msg) {
  process.stdout.write(`[task:worktree] ${msg}\n`)
}
function die(msg, code = 2) {
  process.stderr.write(`[task:worktree] ${msg}\n`)
  process.exit(code)
}

/** Run a command, never throw; return {status, stdout, stderr}. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    error: res.error,
  }
}

/** The primary working tree's root, even when invoked from a linked worktree. */
function mainRepoRoot() {
  const res = run('git', ['rev-parse', '--git-common-dir'])
  if (res.status !== 0) {
    die(`not a git repository (git rev-parse failed): ${res.stderr.trim()}`, 1)
  }
  // --git-common-dir → "<root>/.git" (absolute inside a worktree, ".git" in the
  // primary tree). Resolve against cwd; the repo root is its parent.
  return dirname(resolve(res.stdout.trim()))
}

/** The default branch behind `origin/HEAD`, falling back to `main`. */
function defaultBranch(root) {
  const res = run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: root })
  if (res.status === 0) {
    const m = res.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/)
    if (m) return m[1]
  }
  return 'main'
}

/** Does a local branch already exist? */
function branchExists(root, branch) {
  return (
    run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root })
      .status === 0
  )
}

/**
 * The issue's title via gh, or null when the issue/gh is unavailable.
 * `shell` on Windows because `gh` is commonly a `.cmd` shim that bare spawn
 * cannot execute (git, by contrast, is always a real `.exe`).
 */
function fetchIssueTitle(n) {
  const res = run('gh', ['issue', 'view', String(n), '--json', 'title'], {
    shell: process.platform === 'win32',
  })
  if (res.status !== 0) return null
  try {
    return JSON.parse(res.stdout).title ?? null
  } catch {
    return null
  }
}

function main() {
  const args = process.argv.slice(2)
  for (const a of args) {
    if (a.startsWith('--')) die(`unknown flag '${a}' — this command takes positionals only.`)
  }
  const [n, slugArg, typeArg] = args

  if (!n || !/^\d+$/.test(n)) {
    die('Usage: pnpm task:worktree <issue-number> [slug] [type]')
  }
  if (typeArg && !isValidBranchType(typeArg)) {
    die(`unknown branch type '${typeArg}' — expected one of: ${BRANCH_TYPES.join(', ')}`)
  }

  let slug = slugArg
  let type = typeArg

  // Args win over gh; gh is only consulted for what is still missing.
  if (!slug || !type) {
    const title = fetchIssueTitle(n)
    if (title === null) {
      die(
        `could not resolve issue #${n} via gh (does it exist? is gh authenticated?) — ` +
          `pass an explicit slug: pnpm task:worktree ${n} <slug> [type]`,
        1,
      )
    }
    slug = slug || slugifyTitle(title)
    type = type || branchTypeFromTitle(title)
  }
  if (!slug) die(`derived an empty slug for #${n} — pass one explicitly.`, 1)

  const root = mainRepoRoot()
  const branch = branchName(type, n, slug)
  const relPath = worktreeRelPath(n)
  const absPath = join(root, '.claude', 'worktrees', String(n))

  // Pre-flight: refuse on collisions with a concrete remedy. A silent reuse is
  // exactly the class of accident this tool exists to prevent.
  if (existsSync(absPath)) {
    die(
      `worktree path '${relPath}' already exists — another session may be live in it. ` +
        `Work there, or tear it down first: pnpm worktree:teardown ${n}`,
      1,
    )
  }
  if (branchExists(root, branch)) {
    die(
      `branch '${branch}' already exists — it may belong to another session. ` +
        `Delete it (git branch -D ${branch}) or pass a different slug.`,
      1,
    )
  }

  const base = defaultBranch(root)
  const fetched = run('git', ['fetch', 'origin', base, '--quiet'], { cwd: root })
  if (fetched.status !== 0) {
    out(`warning: git fetch origin ${base} failed — branching from the local ref.`)
  }

  const added = run('git', ['worktree', 'add', absPath, '-b', branch, `origin/${base}`], {
    cwd: root,
  })
  if (added.status !== 0) {
    die(`git worktree add failed: ${added.stderr.trim() || added.stdout.trim()}`, 1)
  }

  out(`created worktree '${relPath}' on branch '${branch}' (off origin/${base}).`)
  out(`absolute path: ${absPath}`)
  for (const line of nextStepsLines(relPath, n)) out(line)
  process.exit(0)
}

// Run only as the entry point — the guard keeps the pure seams importable from
// the unit tests without firing main()'s git + gh subprocesses.
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : ''
const SELF = resolve(fileURLToPath(import.meta.url))
if (INVOKED === SELF) {
  main()
}
