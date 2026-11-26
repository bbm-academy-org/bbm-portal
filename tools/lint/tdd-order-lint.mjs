#!/usr/bin/env node
// tdd-order — a pre-commit NOTE on how a new platform module and its test were
// staged. It judges nothing and always exits 0.
//
// Canon: docs/ci-guardrails.md §5, which carries the severity of record.
//
// ── What it is now (#621) ────────────────────────────────────────────────────
// Commit order is not the evidence of TDD: tests that cover the change, green,
// and confirmed by the stage-4 review are (owner decision, 2026-11-25). So this
// guard has no CI plane and no refusal. It reads the local index through git
// plumbing (no network) and prints, on stdout:
//
//   mixed commit  a NEW module staged together with a staged test citing it —
//                 fine; a separate RED commit is welcome, not required
//   advisory      a NEW module that no test in HEAD or the index names — if it
//                 holds behaviour, it wants a test; a barrel, a route layout or
//                 a schema table legitimately has none
//
// "Write the failing test first" stays the working practice (task-cycle stage
// 3); this is the nudge toward it at the moment it is cheapest to act on.
// Whether a test exists for changed code at all is `test-presence`'s question,
// and that guard does block.
//
// Scope: NEW files under `src/lib/**` and `src/app/(platform)/p/**`, real
// sources only (`isPlatformModule`). Modified and renamed files carry no note.
//
// Merges (#565) and squash merges (#569) are read against EVERY parent, so the
// modules and tests a merge of `origin/main` brings in are not reported as this
// commit's own — see `stagedAdditions` and `squashHeads`.
//
// History: until #621 the MIXED case refused the commit, and a CI plane read the
// PR's commit graph and told authors to rebase test commits in front of their
// implementation. Both are gone; `git log` holds them.
//
// Wired on the existing `simple-git-hooks` pre-commit line after lint-staged.
// Run: `node tools/lint/tdd-order-lint.mjs --staged` (the hook) or
// `pnpm lint:tdd-order`; `--staged` is accepted and is the only mode.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isEntryPoint, isFixturePath, reporter, repoRoot, runMain, toPosix } from './lib/guard.mjs'
import { isTestSource, needlesFor, PROD_EXEMPT_RE } from './test-presence-lint.mjs'

const TAG = 'tdd-order'

/**
 * The platform-module paths task-cycle stage 3 makes TDD a hard rule for. Not
 * every production path: `src/collections/**` is Payload's CMS contract and
 * `tools/**` is tooling, both out of scope by the header's scope decision.
 */
const PLATFORM_MODULE_RE = /^(?:src\/lib\/|src\/app\/\(platform\)\/p\/)/
/** Only real sources carry a TDD obligation. */
const SOURCE_EXT_RE = /\.(?:ts|tsx|mjs)$/

/**
 * True for a path this guard's NEW-file rule applies to: inside the platform
 * modules, a real source, and neither a test nor a fixture nor an exempt file
 * (generated types, migrations, declarations, configs — `PROD_EXEMPT_RE`, owned
 * by `test-presence-lint.mjs` so the two guards cannot drift apart on what
 * counts as code).
 *
 * @param {string} rel
 * @returns {boolean}
 */
export function isPlatformModule(rel) {
  const p = toPosix(rel)
  return (
    PLATFORM_MODULE_RE.test(p) &&
    SOURCE_EXT_RE.test(p) &&
    !isFixturePath(p) &&
    !isTestSource(p) &&
    !PROD_EXEMPT_RE.test(p)
  )
}

// ── The pre-commit plane (`--staged`) ────────────────────────────────────────

/**
 * The staged notes, in two buckets. Pure seam: no git, no IO. Neither bucket
 * blocks (#621): `mixed` is a module staged with its own test, `advisory` a
 * module no test cites. The second can never be a verdict anyway — the
 * `needlesFor` substring matcher run in the rejecting direction false-BLOCKed
 * 41 of 78 platform files on `main` (round-2 review of PR #394).
 *
 * A test already in HEAD discharges the obligation even if one is also staged:
 * the test came first, and what is staged now is the implementation plus
 * whatever that test grew into.
 *
 * @param {{path: string, headTests: string[], indexTests: string[]}[]} modules
 * @returns {{mixed: {path: string, tests: string[]}[], advisory: {path: string}[]}}
 */
export function evaluateStaged(modules) {
  const pending = modules.filter((m) => m.headTests.length === 0)
  return {
    mixed: pending
      .filter((m) => m.indexTests.length > 0)
      .map((m) => ({ path: m.path, tests: m.indexTests })),
    advisory: pending.filter((m) => m.indexTests.length === 0).map((m) => ({ path: m.path })),
  }
}

/**
 * `git` in `root`, stdout or null. Never throws: a git that cannot answer is a skip.
 * No shell on any platform: git is a real `.exe` on Windows, and cmd.exe would
 * split an argument with a space — a module path in a `git grep -e` needle (#570).
 * `core.quotepath=false`: git's default octal-escapes a non-ASCII path
 * (`"src/lib/\320\273..."`), which never matches a module path (#573). The
 * path-list calls also read `-z` output, verbatim under any config. Paths are
 * UTF-8 bytes on every platform, Windows included, hence `utf8`.
 */
function git(root, args) {
  const res = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
  })
  return res.status === 0 ? res.stdout : null
}

/**
 * The other parents of a merge in progress — the shas in `MERGE_HEAD` (several
 * for an octopus), or `[]` when no merge is being concluded. `--git-path` is what
 * finds the file from a linked worktree, whose `.git` is a file, not a directory.
 */
function mergeHeads(root) {
  const rel = git(root, ['rev-parse', '--git-path', 'MERGE_HEAD'])
  if (rel === null) return []
  const file = resolve(root, rel.trim())
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * The squashed side of a `git merge --squash` in progress (#569), or `[]`.
 * A squash writes no MERGE_HEAD; its only trace is SQUASH_MSG, which opens with
 * the header `Squashed commit of the following:` and lists every squashed commit
 * as a column-0 `commit <sha>` line, message bodies indented beneath it. The
 * header is REQUIRED: `git rebase -i` writes SQUASH_MSG too, on a squash-step
 * conflict, with the messages UNINDENTED (`# This is a combination of …`), so a
 * message line `commit <sha>` there would otherwise forge a squashed side. Git
 * deletes the file on commit and on reset, so a present file normally belongs to
 * the squash being concluded (an abandoned squash cleared by `restore`/`clean`
 * instead leaves it for the next commit, which then gets the wrong note). Shas that do not resolve
 * to a commit are dropped — an unreadable file leaves the plain-commit reading —
 * and `merge-base --independent` reduces the list to the branch TIP(s), which
 * stand in for the parents a real merge would have recorded.
 */
function squashHeads(root) {
  const rel = git(root, ['rev-parse', '--git-path', 'SQUASH_MSG'])
  if (rel === null) return []
  const file = resolve(root, rel.trim())
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  if (!/^Squashed commit of the following:\r?\n/.test(text)) return []
  const listed = [...text.matchAll(/^commit ([0-9a-f]{40}|[0-9a-f]{64})\s*$/gm)].map((m) => m[1])
  const commits = [...new Set(listed)].filter(
    (sha) => git(root, ['rev-parse', '--verify', '-q', `${sha}^{commit}`]) !== null,
  )
  if (commits.length === 0) return []
  const tips = git(root, ['merge-base', '--independent', ...commits])
  if (tips === null) return []
  return tips
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Files the INDEX adds outright against `rev` (HEAD when absent), as
 * repo-relative paths. `-M` keeps rename detection on, so a moved module
 * reports `R` and never reaches this list: relocating tracked code re-opens no
 * TDD obligation.
 */
function additionsAgainst(root, rev) {
  const args = ['diff', '--cached', '--name-only', '-z', '--diff-filter=A', '-M']
  if (rev) args.push(rev)
  const out = git(root, args)
  if (out === null) return null
  return out.split('\0').filter(Boolean).map(toPosix)
}

/**
 * What THIS commit adds. For a plain commit: the index against HEAD. For a
 * merge being concluded (#565): the paths new against EVERY parent. Read
 * against HEAD alone, the index of `git merge origin/main` holds each module
 * main landed — with its test — as a staged addition, and the MIXED rule then
 * blocked the merge over code the branch never wrote. A path present on any
 * parent arrived from that parent (as is, or edited by the resolution — a
 * modification, out of scope in v1 like any other), so only a path new against
 * all of them is the resolution's own authorship.
 *
 * Rebase and cherry-pick continuations need no such case (probed on git 2.55):
 * `git rebase --continue` runs no pre-commit hook, and a manual commit
 * mid-sequence stages only the picked commit's own delta against HEAD — the
 * plain-commit reading, unchanged.
 *
 * @param {string} root
 * @param {string[]} parents the merge's other parents (`[]` for a plain commit)
 * @returns {string[]|null} null when git cannot answer
 */
function stagedAdditions(root, parents) {
  let kept = additionsAgainst(root)
  for (const sha of parents) {
    if (kept === null) return null
    const vsParent = additionsAgainst(root, sha)
    if (vsParent === null) return null
    const set = new Set(vsParent)
    kept = kept.filter((p) => set.has(p))
  }
  return kept
}

/**
 * Test sources containing any of `needles`, in one tree. `rev` is a revision for
 * HEAD or `--cached` for the index. `git grep -l -F` does the scanning, so no
 * blob is read into node and an empty tree is simply no matches.
 */
function testsMatching(root, rev, needles) {
  const args = ['grep', '-l', '-z', '-F', '-I']
  for (const n of needles) args.push('-e', n)
  args.push(rev, '--')
  const out = git(root, args)
  if (out === null) return [] // exit 1 = no match; an unreadable rev is also "nothing cites it"
  // `git grep <rev>` prefixes each hit with `<rev>:`; `--cached` prints bare paths.
  const prefix = rev === '--cached' ? '' : `${rev}:`
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => toPosix(prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line))
    .filter((p) => isTestSource(p))
}

/** The pre-commit plane: read the index, never the network. */
function runStaged(out, root) {
  // A real merge wins; only without MERGE_HEAD can a squash be in progress
  // (`git merge --squash` refuses to start while a merge is unconcluded).
  const merged = mergeHeads(root)
  const squashed = merged.length > 0 ? [] : squashHeads(root)
  const squashing = squashed.length > 0
  const parents = squashing ? squashed : merged
  const merging = parents.length > 0
  const kind = squashing ? 'squash merge' : 'merge'
  const side = squashing ? 'the squashed branch' : 'a merged parent'
  const additions = stagedAdditions(root, parents)
  if (additions === null) {
    out.ok('not a git working tree (or git is unavailable), nothing to check')
  }
  if (merging) {
    out.info(
      `${kind} in progress: judging only what the resolution adds against HEAD and ` +
        `${parents.length} merged ${squashing ? 'tip' : 'parent'}(s); files arriving from ` +
        `${squashing ? 'the squashed branch' : 'a parent'} are not this commit's authorship`,
    )
  }

  const newModules = additions.filter((p) => isPlatformModule(p))
  if (newModules.length === 0) {
    out.ok(
      `${additions.length} staged addition(s), none a new platform module under src/lib/** or src/app/(platform)/p/**`,
    )
  }

  const hasHead = git(root, ['rev-parse', '--verify', '-q', 'HEAD']) !== null
  // A test committed on ANY parent of the commit being made is a RED commit that
  // already happened — for a merge, that includes the merged branch's tests.
  const committedRevs = [...(hasHead ? ['HEAD'] : []), ...parents]
  const modules = newModules.map((path) => {
    const needles = needlesFor(path)
    return {
      path,
      headTests: committedRevs.flatMap((rev) => testsMatching(root, rev, needles)),
      indexTests: testsMatching(root, '--cached', needles),
    }
  })

  const { mixed, advisory } = evaluateStaged(modules)

  // ADVISORY, never a verdict: printed on stdout and does not affect the exit
  // code. The substring matcher is not entitled to reject in this direction —
  // see `evaluateStaged` — but the developer is still better off knowing.
  for (const a of advisory) {
    out.info(
      `advisory  ${a.path}  is new and no test in HEAD or the index names it. If it holds ` +
        'behaviour, write a failing test for it; a barrel, a ' +
        'route layout or a schema table legitimately has no name-citing test and needs nothing.',
    )
  }

  // MIXED is a note too, never a refusal (#621). Proof of red-first by commit
  // order is not required: tests that cover the change, green, and confirmed by
  // review are the evidence. Kept as a nudge toward the practice, not a gate.
  for (const m of mixed) {
    out.info(
      `mixed commit  ${m.path}  is staged together with its test (${m.tests.join(', ')}). ` +
        `Fine — a separate RED commit is welcome, not required.` +
        (merging ? ` Introduced by this ${kind} resolution itself, not by ${side}.` : ''),
    )
  }

  const notes = advisory.length + mixed.length
  out.ok(
    `PASS — ${newModules.length} new platform module(s) staged` +
      (notes ? ` (${notes} advisory note(s) above).` : '.'),
  )
}

async function main() {
  runStaged(reporter(TAG), repoRoot())
}

if (isEntryPoint(import.meta.url)) runMain(TAG, main)
