#!/usr/bin/env node
// bbm-portal — `pnpm dispatch:brief <N>`: generate a dispatch brief for a
// subagent (task 7.3, #134; port of ds-platform `tools/gh/dispatch-brief.mjs`).
//
// Why: the lead types the implementation inline exactly when authoring a
// CORRECT brief costs more than doing the work — that cost asymmetry is what
// `tools/hooks/dispatch-guard.mjs` catches after the fact, by counting the
// lead's consecutive writes in the shared checkout. This script attacks the
// cause: it emits a ready-to-edit brief pre-stamped with everything this repo's
// canon requires (worktree isolation, the port rule, the gates, the PR block,
// the ≤30-line return contract, the deviations line), seeded from the issue and
// the worktree, so writing a correct brief is cheaper than inlining the work.
//
// Adaptations to this repo (the ds original assumed ds conventions):
//   • branch/slug are NOT re-derived here — they come from the same seams
//     `pnpm task:worktree` uses (`tools/dev/task-worktree.mjs`), so a brief can
//     never name a branch the worktree tool would not create;
//   • the branch type is the issue's native GitHub **Type** (canon §2), not a
//     Conventional-Commit prefix in the title — our titles carry no prefix;
//   • the governing skill is a `.claude/skills/<name>/SKILL.md` path, and
//     `task-cycle` is pre-filled because every tracked task follows it;
//   • the brief is DIRECT-APPLY by default and names the
//     `STAGED: <irreversible|conflicting|owner-preapproval>` token as an
//     UNFILLED placeholder — the very token `dispatch-guard.mjs` demands when a
//     brief stages its output instead of applying it. Unfilled, the placeholder
//     satisfies neither the guard nor `pnpm dispatch:brief-check`, which is the
//     point: staging has to be declared deliberately.
//
// Usage:
//   pnpm dispatch:brief <issue-N>            # markdown to stdout
//   pnpm dispatch:brief <issue-N> > brief.md
//
// Seeding is best-effort: with no `gh`, no network or no worktree the affected
// section carries a `<fill …>` placeholder instead of failing.
//
// Exit codes: 0 = brief emitted (even degraded); 2 = usage error (missing or
// non-numeric <N>). Pure node, no bash-isms — the pure seams are exported for
// tests/unit/dispatch-scripts.spec.ts and every `gh`/`git` call goes through an
// injectable runner, so the tests never shell out.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  branchName,
  branchTypeFromTitle,
  slugifyTitle,
  worktreeRelPath,
} from '../dev/task-worktree.mjs'
import { extractPathTokens } from './dispatch-brief-check.mjs'
import { REPO, branchTypeFromIssueType } from './lib/gh.mjs'

const TAG = '[dispatch:brief]'
const MAX_BUFFER = 16 * 1024 * 1024
// The user-facing session report stays Russian by contract even though project
// artifacts and agent-facing instructions are English.
const DEVIATIONS_MARKER =
  '\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0438\u044f \u043e\u0442 \u043a\u043e\u043d\u0432\u0435\u043d\u0446\u0438\u0439: \u043d\u0435\u0442 / <\u0441\u043f\u0438\u0441\u043e\u043a>'

// ── pure seams (unit-tested in tests/unit/dispatch-scripts.spec.ts) ──────────

// The path-token heuristic is the CHECKER's definition, imported rather than
// copied: a seeder that disagreed with `dispatch:brief-check` about what counts
// as a named surface would emit briefs its own gate rejects. Re-exported so the
// scaffold's callers (and its tests) do not need to know where it lives.
export { extractPathTokens }

/**
 * `<type>/<N>-<slug>` for the issue — derived through the SAME seams
 * `pnpm task:worktree` uses, so the brief cannot name a branch that tool would
 * not create. The native Type is the primary signal (canon §2); the title's
 * Conventional-Commit prefix is the fallback for pre-canon issues; an empty
 * slug degrades to a visible placeholder rather than a bare `feat/134-`.
 * @param {{issueNumber: string|number, title?: string|null, issueType?: string|null}} args
 * @returns {string}
 */
export function deriveBranch({ issueNumber, title = null, issueType = null }) {
  const type = issueType ? branchTypeFromIssueType(issueType) : branchTypeFromTitle(title ?? '')
  const slug = title ? slugifyTitle(title) : ''
  return branchName(type, String(issueNumber), slug || '<fill-slug>')
}

/** Default runner — real `gh`/`git`. `shell` on win32: `gh` is a `.cmd` shim there. */
export function defaultRunner() {
  const run = (cmd, args, opts = {}) => {
    const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...opts })
    if (res.error) return { status: -1, stdout: '', stderr: res.error.message }
    return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
  }
  return {
    gh: (args) => run('gh', args, { shell: process.platform === 'win32' }),
    git: (args) => run('git', args),
  }
}

/**
 * `git rev-parse --git-common-dir` output → the PRIMARY working tree's root, in
 * forward slashes. Pure string work on purpose: `--show-toplevel` would answer
 * with the LINKED worktree when the script runs from inside one, and the brief
 * would then point at `.../worktrees/134/.claude/worktrees/134`. The common dir
 * always belongs to the primary tree, which is where `.claude/worktrees/` lives.
 * Git may answer relatively (`.git`), hence the `cwd` argument.
 * @param {string} out    raw stdout of `git rev-parse --git-common-dir`
 * @param {string} [cwd]  directory the command ran in
 * @returns {string|null}
 */
export function repoRootFromCommonDir(out, cwd = process.cwd()) {
  const s = String(out ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!s) return null
  const isAbsolute = /^([A-Za-z]:)?\//.test(s)
  const base = String(cwd ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  const abs = isAbsolute ? s : `${base}/${s}`
  const root = abs.replace(/\/+\.git\/?$/, '').replace(/\/+$/, '')
  return root || null
}

/**
 * Best-effort gather of the issue + git state that seeds the brief. Never
 * throws: a failing `gh`/`git` leaves the field null/empty and the renderer
 * degrades to a `<fill …>` placeholder.
 * @param {{issueNumber: string|number, runner: {gh: Function, git: Function},
 *          exists?: (p: string) => boolean, cwd?: string}} args
 * @returns {{title: string|null, body: string, issueType: string|null, milestone: string|null,
 *            seededFiles: string[], worktreeChanged: string[], repoRoot: string|null}}
 */
export function gatherState({ issueNumber, runner, exists = existsSync, cwd = process.cwd() }) {
  let title = null
  let body = ''
  let issueType = null
  let milestone = null

  const res = runner.gh([
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    REPO,
    '--json',
    'title,body,issueType,milestone',
  ])
  if (res.status === 0) {
    try {
      const j = JSON.parse(res.stdout)
      title = j.title ?? null
      body = String(j.body ?? '')
      issueType = j.issueType?.name ?? j.issueType ?? null
      milestone = j.milestone?.title ?? null
    } catch {
      /* degrade to placeholders */
    }
  }

  // The PRIMARY tree's root — resolved live, so no machine-specific path is
  // ever baked into this script, and correct even when invoked from inside a
  // linked worktree.
  const rootRes = runner.git(['rev-parse', '--git-common-dir'])
  const repoRoot = rootRes.status === 0 ? repoRootFromCommonDir(rootRes.stdout, cwd) : null

  // Path tokens the issue body names, kept as a scope seed only when they are
  // real: an existing path, or a not-yet-created FILE (extension). The checker
  // deliberately keeps the looser rule — an AC may demand a directory that does
  // not exist yet — but a seed list padded with prose like `links/statuses/owner`
  // is a list the lead stops reading.
  const seededFiles = extractPathTokens(body).filter(
    (tok) =>
      /\.[A-Za-z][A-Za-z0-9]*$/.test(tok) || (repoRoot ? exists(`${repoRoot}/${tok}`) : false),
  )

  // Changed files, when the task's worktree already exists — the sharpest scope
  // seed there is for a second-wave dispatch onto work already in flight. The
  // tree is named absolutely with `git -C` (`.claude/rules/dev-env.md`): a
  // relative path would read whatever tree the cwd happened to drift into.
  let worktreeChanged = []
  const wtAbs = repoRoot ? `${repoRoot}/${worktreeRelPath(issueNumber)}` : null
  if (wtAbs && exists(wtAbs)) {
    const d = runner.git(['-C', wtAbs, 'diff', '--name-only', 'origin/main...HEAD'])
    if (d.status === 0) {
      worktreeChanged = d.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }

  return { title, body, issueType, milestone, seededFiles, worktreeChanged, repoRoot }
}

/** A markdown bullet list, or one `<fill …>` line when there is nothing to list. */
function bulletsOrPlaceholder(items, placeholder) {
  if (!items || items.length === 0) return `- <fill: ${placeholder}>`
  return items.map((i) => `- \`${i}\``).join('\n')
}

/**
 * Render the ready-to-edit brief. Pure — every input is passed in, so the unit
 * test drives it from fixtures.
 *
 * Wording constraint (load-bearing, asserted by the tests): this text must NOT
 * match `STAGING_RE` in `tools/hooks/dispatch-guard.mjs`. A scaffold that
 * tripped the guard on its own boilerplate would train the lead to ignore the
 * warning, which is the one failure mode the guard cannot survive.
 * @param {{issueNumber: string|number, title?: string|null, issueType?: string|null,
 *          milestone?: string|null, seededFiles?: string[], worktreeChanged?: string[],
 *          repoRoot?: string|null}} args
 * @returns {string}
 */
export function renderBrief({
  issueNumber,
  title = null,
  issueType = null,
  milestone = null,
  seededFiles = [],
  worktreeChanged = [],
  repoRoot = null,
}) {
  const n = String(issueNumber)
  const displayTitle = title || `<fill: issue #${n} title>`
  const branch = deriveBranch({ issueNumber: n, title, issueType })
  const wt = worktreeRelPath(n)
  const root = repoRoot || '<repo-root>'
  const wtAbs = `${root}/${wt}`

  const scopeSource = worktreeChanged.length > 0 ? worktreeChanged : seededFiles
  const scopeLabel =
    worktreeChanged.length > 0
      ? 'seeded from the worktree diff (origin/main...HEAD)'
      : 'seeded from the issue body path-tokens'

  return `# IMPL brief — ${REPO}#${n} (${displayTitle})

Governing skill: \`.claude/skills/task-cycle/SKILL.md\` (stage 3 — implementation)${
    milestone ? `. Milestone: ${milestone}` : ''
  }. <fill: add the second governing skill if this task has one — \`.claude/skills/task-canon/SKILL.md\` for backlog work, \`frontend-design\` for a UI diff — or declare \`kind: engineering-task\` when none governs it.>

## Worktree isolation (MANDATORY — read first)
Work EXCLUSIVELY inside \`${wtAbs}\` (\`.claude/rules/parallel-sessions.md\`). The shared checkout \`${root}\` stays on \`main\` and belongs to the lead and to live acceptance stands.
- Branch: \`${branch}\`. It exists only in this worktree; never create or switch it in the shared checkout.
- FIRST action: \`git -C ${wtAbs} rev-parse --show-toplevel\` and confirm the worktree root before any edit. Every git call names its tree with \`git -C <abs>\` — \`cd\` drifts between calls (\`.claude/rules/dev-env.md\`).
- \`pnpm install\` in the worktree (~42 s) before the first commit or test — a fresh worktree has no \`node_modules\`, so neither the pre-commit hook nor any test exists yet.
- Node 22 first, in every bash session: \`export PATH="$LOCALAPPDATA/node22:$PATH"\`.
- A dev stand, if the task needs one: \`pnpm dev:ports\` → \`PORT=<n> pnpm dev\`. Never bind 3000 blindly, never kill a listener you did not start.

## Application mode
DIRECT-APPLY: edit the files in the worktree yourself and commit them. Handing the edit back for the lead to re-apply is justified ONLY when the change is irreversible, conflicts with another session's work, or the owner asked to pre-approve it — in that case say so explicitly and add the token \`STAGED: <irreversible|conflicting|owner-preapproval>\` (fill the placeholder in; \`tools/hooks/dispatch-guard.mjs\` and \`pnpm dispatch:brief-check\` both read it).

## Research budget
EDIT-FIRST: ≤15 tool calls before your first edit. The recon facts below are DONE — do not re-verify handed facts. Hitting the cap with no edit = STOP and return a partial verdict naming what blocked you.

## Recon facts (authoritative — do not re-verify)
- <fill: the facts the implementer needs as facts — sibling files to mirror, exact wiring points, decisions already taken by the owner. Never "re-read the cited files yourself".>

## Deliverable / scope (${scopeLabel})
${bulletsOrPlaceholder(scopeSource, 'the files this slice touches — each one in-slice, or a named and tracked exclusion')}
- <fill: the concrete deliverable and its acceptance — an observable fact, not "it works".>

## Gates (all GREEN in the worktree before the PR)
- TDD is a hard rule for module code (task-cycle stage 3): a failing test first, derived from the issue's Acceptance criteria.
- \`pnpm test:unit\` · \`pnpm typecheck\` · \`pnpm lint\` · \`pnpm format:check\`.
- <fill: task-specific gates — \`pnpm test:int\`, a Playwright pass for a UI/auth flow, a live-stand check.>

## PR
- Conventional Commits; branch \`${branch}\`.
- ONE \`gh pr create --body-file\` call with the full body: the linkage line, the repo PR template (\`.github/pull_request_template.md\`), a one-line summary.
- The linkage line is ONE of two, and the rule is which one is TRUE: \`Closes #${n}\` when this PR finishes the issue, \`Part of #${n}\` when it is a slice and the issue stays open after the merge. \`pnpm pr:land\` accepts both. If your PR does not fully close #${n}, write \`Part of #${n}\` — do NOT file a synthetic sub-issue just to have something to close (#261 / #270 / #279 were filed exactly that way).
- Do NOT self-review and do NOT merge: the independent review is dispatched by the lead (task-cycle stage 4), and an owner-visible change also needs the owner's recorded live-stand acceptance (stage 5).

## Return contract (≤30 lines)
Line 1: PR # + branch. Then: files changed with line counts, gate verdicts, and the mandatory user-facing line **«${DEVIATIONS_MARKER}»**. Heavy output (full logs, diffs, reports) goes to a scratchpad file or a PR comment — never into the reply.

---
Before dispatch: \`pnpm dispatch:brief-check ${n} <this-file>\` (asserts the brief names every path the issue's Acceptance criteria names, declares a governing skill, and carries a filled \`STAGED:\` token if it stages anything). Every \`Agent\` call names an explicit \`model\` (CLAUDE.md → Subagents and models).
`
}

// ── impure CLI (skipped on import) ───────────────────────────────────────────

function main() {
  const issueArg = process.argv[2]
  if (!issueArg || !/^\d+$/.test(issueArg)) {
    process.stderr.write(`${TAG} usage: pnpm dispatch:brief <issue-N>\n`)
    process.exit(2)
  }

  const state = gatherState({ issueNumber: issueArg, runner: defaultRunner() })

  if (!state.title) {
    process.stderr.write(
      `${TAG} warning: could not read issue #${issueArg} via gh — emitting a skeleton with <fill …> placeholders.\n`,
    )
  }

  process.stdout.write(
    renderBrief({
      issueNumber: issueArg,
      title: state.title,
      issueType: state.issueType,
      milestone: state.milestone,
      seededFiles: state.seededFiles,
      worktreeChanged: state.worktreeChanged,
      repoRoot: state.repoRoot,
    }),
  )
  process.exit(0)
}

// Run only as the entry point — the guard keeps the pure seams importable from
// the unit tests without firing main()'s gh/git subprocesses.
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : ''
const SELF = resolve(fileURLToPath(import.meta.url))
if (INVOKED === SELF) {
  main()
}
