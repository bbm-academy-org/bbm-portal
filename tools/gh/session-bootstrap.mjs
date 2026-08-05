#!/usr/bin/env node
// bbm-portal — SessionStart bootstrap snapshot (task 7.3, issue #134).
//
// Port of ds-platform `tools/agent-bootstrap.ts`, trimmed to what this repo
// actually has and rewritten as plain Node ESM (no tsx: the tsx loader is
// fragile on this Windows box, and a SessionStart hook that fails to load is a
// hook that silently never runs).
//
// What it answers, in one screen, before the session forms its first opinion:
//   * which tree am I in (shared main checkout vs `.claude/worktrees/<N>`),
//     which branch, is it dirty, how far from `origin/main`;
//   * which task number this tree belongs to and what the board says about it
//     (the two claim signals of task-canon §4: worktree/branch AND board status);
//   * my open PRs with their review decision and CI rollup;
//   * one recommendation line — what to do first.
//
// Engineering contract (issue #134 acceptance):
//   * NEVER throws and always exits 0. Every external call (git, gh) is a seam
//     that degrades to a `!` diagnostic line; a missing `gh`, a dead network or
//     "not a git repo" all produce a printable snapshot, never a crash. A
//     SessionStart hook that dies takes the session's context with it.
//   * Output is ALWAYS ≤ 2 KB (`OUTPUT_LIMIT_BYTES`), enforced by `fitToBytes`
//     on the fully rendered text — no section can bloat the context window.
//   * Reads nothing from stdin. SessionStart does deliver a JSON payload, but a
//     blocking `readFileSync(0)` would hang a manual `node tools/gh/session-
//     bootstrap.mjs` run; cwd + env carry everything this script needs.
//   * Fast: 4 local git calls + at most 3 `gh` calls, each with its own timeout,
//     under a total wall-clock budget (`TOTAL_BUDGET_MS`). Once the budget is
//     spent the remaining probes are skipped with a diagnostic instead of
//     stalling the session start.
//
// Pure seams (parsers, recommendation, renderer, byte cap) are exported apart
// from `main()` and unit-tested in `tests/unit/session-bootstrap.spec.ts`; the
// entry-point guard keeps importing this file side-effect free.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { PROJECT_NUMBER, REPO, buildBoardItemsPageQuery } from './lib/gh.mjs'
import {
  hooksDisabled,
  liveSessionsFromFlag,
  norm,
  readFlag,
  statMtimeMs,
} from '../hooks/shared.mjs'

/** Hard output ceiling, bytes (issue #134). The trailing newline counts. */
export const OUTPUT_LIMIT_BYTES = 2048

/** Per-call timeouts: git is local and cheap, `gh` crosses the network. */
export const GIT_TIMEOUT_MS = 4000
export const GH_TIMEOUT_MS = 6000

/** Total wall-clock budget for the network probes; past it they are skipped. */
export const TOTAL_BUDGET_MS = 15000

/** How many of your PRs get their own line before the byte cap has to care. */
const MAX_PR_LINES = 4

/** Board column that means "claimed" in this repo (task-canon §4). */
const IN_PROGRESS = 'In Progress'

// ── runners ─────────────────────────────────────────────────────────────────
// Structured result, never a throw: `{ok, status, stdout, stderr, error}` —
// the same shape as `lib/gh.mjs#ghResult`, so callers read one contract. Both
// are injectable (`deps.runGit` / `deps.runGh`) which is how the never-throw
// and cap tests drive this file without touching the network.

function runProcess(cmd, args, timeout) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  if (res.error) {
    return {
      ok: false,
      status: -1,
      stdout: '',
      stderr: '',
      error: `${cmd} failed to start: ${res.error.message}`,
    }
  }
  const stdout = res.stdout ?? ''
  const stderr = res.stderr ?? ''
  if (res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? -1,
      stdout,
      stderr,
      error: `${cmd} ${args[0] ?? ''} exited ${res.status}: ${stderr.trim() || '(no stderr)'}`,
    }
  }
  return { ok: true, status: 0, stdout, stderr }
}

export function defaultRunGit(args, cwd) {
  return runProcess('git', ['-C', cwd || process.cwd(), ...args], GIT_TIMEOUT_MS)
}

export function defaultRunGh(args) {
  return runProcess('gh', args, GH_TIMEOUT_MS)
}

// ── pure seams ──────────────────────────────────────────────────────────────

/** First line of an error/message, clipped — diagnostics must not eat the cap. */
export function clip(text, max = 90) {
  const one = String(text ?? '')
    .split(/\r?\n/)[0]
    .trim()
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`
}

/**
 * `git rev-list --left-right --count origin/main...HEAD` → `{behind, ahead}`.
 * Left side is `origin/main` (commits we do NOT have = behind), right side is
 * HEAD (commits origin/main does not have = ahead). Unparseable output — most
 * often "no origin/main yet" — returns null so the renderer prints `?` rather
 * than a confident zero.
 */
export function parseAheadBehind(stdout) {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(String(stdout ?? ''))
  if (!m) return null
  return { behind: Number(m[1]), ahead: Number(m[2]) }
}

/**
 * The task number this tree belongs to. Both claim-carrying names are accepted
 * (`.claude/rules/parallel-sessions.md`): the worktree directory
 * `.claude/worktrees/<N>` and the branch `<type>/<N>-<slug>`. The directory
 * wins — it is a filesystem fact, while a branch can be renamed under you.
 */
export function issueNumberFrom(branch, cwd) {
  const dir = /\/\.claude\/worktrees\/(\d+)(?:\/|$)/.exec(norm(cwd ?? ''))
  if (dir) return Number(dir[1])
  const br = /^[a-z]+\/(\d+)-/.exec(String(branch ?? '').trim())
  return br ? Number(br[1]) : null
}

/**
 * A linked worktree has its own git-dir inside the main tree's
 * `.git/worktrees/<name>`; in the primary checkout `--git-dir` and
 * `--git-common-dir` resolve to the same `.git`. Both are resolved against cwd
 * so a relative `.git` compares equal.
 */
export function isSharedMainTree(gitDir, gitCommonDir, cwd) {
  const at = (p) => norm(resolve(cwd || '.', String(p ?? '')))
  return at(gitDir) === at(gitCommonDir)
}

/** CI rollup of one PR, collapsed to a word. */
export function ciState(pr) {
  const rollup = Array.isArray(pr?.statusCheckRollup) ? pr.statusCheckRollup : []
  if (rollup.length === 0) return 'none'
  const bad = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']
  if (rollup.some((c) => bad.includes(String(c?.conclusion ?? '')))) return 'fail'
  if (rollup.some((c) => c?.status && String(c.status) !== 'COMPLETED')) return 'run'
  return 'ok'
}

/**
 * Task PR or dependency-bot PR. In this repo Renovate opens its PRs under the
 * owner's own token, so `gh pr list --author @me` returns them mixed in with
 * real work — and a red Renovate CI would otherwise outrank the session's task
 * in `recommend`. The branch name is the reliable discriminator: task branches
 * are `<type>/<issue>-<slug>` (task-canon §2), bot branches are not.
 */
export function prKind(pr) {
  const head = String(pr?.headRefName ?? '')
  if (/^(?:renovate|dependabot)\//i.test(head)) return 'deps'
  return /^[a-z]+\/\d+-/.test(head) ? 'task' : 'other'
}

/**
 * One page of board items → `{statusOf, inProgress}`. Only OPEN content counts:
 * a closed issue parked in the In Progress column is board debt, not a claim.
 *
 * The accumulators carry explicit types: inferred from `{}` / `[]` they would
 * reach consumers (and `tsc --noEmit` over the specs) as un-indexable `{}`.
 * @returns {{statusOf: Record<number, string|null>, inProgress: number[]}}
 */
export function parseBoardPage(data) {
  const nodes = data?.organization?.projectV2?.items?.nodes
  /** @type {Record<number, string|null>} */
  const statusOf = {}
  /** @type {number[]} */
  const inProgress = []
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const number = node?.content?.number
    if (number == null) continue
    const status = node?.fieldValueByName?.name ?? null
    statusOf[number] = status
    const open = String(node?.content?.state ?? 'OPEN').toUpperCase() === 'OPEN'
    if (open && status === IN_PROGRESS) inProgress.push(number)
  }
  inProgress.sort((a, b) => a - b)
  return { statusOf, inProgress }
}

/**
 * The single "do this first" line. Ordering is deliberate: an unanswered review
 * and a red CI outrank new work; isolation outranks everything in the shared
 * checkout (four incidents in one week came from editing it — see
 * `.claude/rules/parallel-sessions.md`); a claim whose board half is missing is
 * named before the work resumes, because triage in another session reads the
 * board, not your worktree.
 */
export function recommend(model) {
  const git = model?.git ?? {}
  const all = Array.isArray(model?.prs) ? model.prs : []
  const prs = all.filter((p) => prKind(p) !== 'deps')
  const deps = all.filter((p) => prKind(p) === 'deps')
  if (!git.ok) {
    return 'git state unreadable — see the diagnostics below before touching branches or worktrees.'
  }
  const changes = prs.find((p) => p.reviewDecision === 'CHANGES_REQUESTED')
  if (changes) return `Answer review on PR #${changes.number} (CHANGES_REQUESTED) before new work.`
  const red = prs.find((p) => ciState(p) === 'fail')
  if (red) return `CI is red on your PR #${red.number} — fix it before new work.`
  if (git.inMainTree && model.parallel > 0) {
    return `SHARED main checkout with ${model.parallel} live session(s) — \`pnpm task:worktree <N>\` and work there.`
  }
  if (git.inMainTree && git.dirty) {
    return 'The shared main checkout is DIRTY — deal with it there; never carry it into a worktree.'
  }
  const n = model.issueNumber
  if (n != null) {
    const pr = prs.find((p) => String(p.headRefName ?? '').includes(`/${n}-`))
    if (pr) {
      return `#${n}: PR #${pr.number} open (${pr.reviewDecision || 'review pending'}) — review → owner acceptance → \`pnpm pr:land ${pr.number}\`.`
    }
    const status = model.board?.ok ? (model.board.statusOf?.[n] ?? '(not on board)') : null
    if (status !== null && status !== IN_PROGRESS) {
      return `#${n} claimed by this tree but the board says «${status}» — \`pnpm board:status ${n} "${IN_PROGRESS}"\`.`
    }
    return `Resume #${n} — task-cycle: plan → design gate → owner "go" → TDD → review → acceptance.`
  }
  if (prs.length > 0)
    return `No task branch here; ${prs.length} PR(s) of yours are open — land them first.`
  if (deps.length > 0) {
    return `No task claimed here — \`pnpm backlog:triage\`, then \`pnpm task:worktree <N>\`; ${deps.length} dependency PR(s) also await triage.`
  }
  return 'No task claimed here — pick one with `pnpm backlog:triage`, then `pnpm task:worktree <N>`.'
}

/** Render the model as compact markdown. Pure; the byte cap is applied after. */
export function renderSnapshot(model) {
  const lines = []
  const stamp = new Date(model.generatedAt ?? Date.now())
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
  lines.push(`# session bootstrap — ${REPO} — ${stamp} UTC`)

  const git = model.git ?? {}
  if (git.ok) {
    const where = git.inMainTree
      ? 'SHARED main checkout'
      : `worktree ${git.worktreeName ?? '(linked)'}`
    const drift =
      git.aheadBehind == null
        ? 'origin/main unknown'
        : `${git.aheadBehind.ahead} ahead / ${git.aheadBehind.behind} behind origin/main`
    lines.push(
      `- tree: ${where} · branch \`${git.branch}\` ${git.dirty ? 'DIRTY' : 'clean'} · ${drift}`,
    )
  } else {
    lines.push('- tree: git state unreadable (see diagnostics)')
  }

  if (model.parallel > 0) {
    lines.push(
      `- parallel: ${model.parallel} live session(s) flagged — branches and ports are shared`,
    )
  }

  const board = model.board ?? {}
  const bits = []
  if (model.issueNumber != null) {
    const st = board.ok
      ? (board.statusOf?.[model.issueNumber] ?? '(not on board)')
      : '(board unread)'
    bits.push(`this tree = #${model.issueNumber} [${st}]`)
  }
  if (board.ok && board.inProgress?.length) {
    bits.push(`in progress: #${board.inProgress.slice(0, 8).join(', #')}`)
  }
  if (model.openIssues != null) bits.push(`open issues: ${model.openIssues}`)
  if (bits.length > 0) lines.push(`- board (Project ${PROJECT_NUMBER}): ${bits.join(' · ')}`)

  const all = Array.isArray(model.prs) ? model.prs : []
  // Dependency-bot PRs are backlog hygiene, not session work — they get a
  // one-line count instead of eating the PR section (see `prKind`).
  const prs = all.filter((p) => prKind(p) !== 'deps')
  const deps = all.filter((p) => prKind(p) === 'deps')
  if (model.prsOk === false) {
    lines.push('- your PRs: unread (see diagnostics)')
  } else if (prs.length === 0) {
    lines.push('- your PRs: none open')
  } else {
    lines.push(`- your PRs (${prs.length}):`)
    for (const p of prs.slice(0, MAX_PR_LINES)) {
      const draft = p.isDraft ? ' draft' : ''
      lines.push(
        `  - #${p.number} ${clip(p.title, 58)} — ${p.reviewDecision || 'pending'} · CI ${ciState(p)}${draft}`,
      )
    }
    if (prs.length > MAX_PR_LINES) lines.push(`  - … ${prs.length - MAX_PR_LINES} more`)
  }
  if (deps.length > 0) {
    const red = deps.filter((p) => ciState(p) === 'fail').length
    lines.push(
      `- dependency PRs: ${deps.length} open${red > 0 ? ` (${red} with red CI)` : ''} — triage, not session work`,
    )
  }

  for (const w of model.warnings ?? []) lines.push(`! ${w}`)

  // Always the last line: `fitToBytes` preserves the first and last line, so
  // the recommendation survives any truncation.
  lines.push(`→ next: ${recommend(model)}`)
  return lines.join('\n')
}

/**
 * Force `text` under `limit` bytes. Line-structured input keeps its first line
 * (the header) and its last line (the recommendation) and loses middle lines,
 * newest-dropped-last, with an explicit trimmed-count marker — a snapshot that
 * silently loses its verdict is worse than one that says it was cut.
 */
export function fitToBytes(text, limit = OUTPUT_LIMIT_BYTES) {
  const src = String(text ?? '')
  const size = (s) => Buffer.byteLength(s, 'utf8')
  if (size(src) <= limit) return src

  const hardCut = (s) =>
    Buffer.from(s, 'utf8')
      .subarray(0, Math.max(0, limit - 3))
      .toString('utf8')
      .replace(/�+$/, '') + '…'

  const lines = src.split('\n')
  if (lines.length <= 2) return hardCut(src)

  const head = lines[0]
  const tail = lines[lines.length - 1]
  const middle = lines.slice(1, -1)
  const marker = (n) => `… ${n} line(s) trimmed to fit ${limit} B`

  const kept = []
  const total = () => size([head, ...kept, marker(middle.length - kept.length), tail].join('\n'))
  for (const line of middle) {
    kept.push(line)
    if (total() > limit) {
      kept.pop()
      break
    }
  }
  // The marker's own length shrinks as the trimmed count drops digits; re-check
  // and shed lines until the assembled text really fits.
  while (kept.length > 0 && total() > limit) kept.pop()
  const out = [head, ...kept, marker(middle.length - kept.length), tail].join('\n')
  return size(out) <= limit ? out : hardCut(src)
}

// ── collection ──────────────────────────────────────────────────────────────

/**
 * Probe git + GitHub and build the model. Never throws: every call goes through
 * `attempt`, which turns both a thrown exception and a non-zero exit into a
 * diagnostic string. All I/O is injectable so the tests can make every seam
 * fail at once.
 */
export function collect(deps = {}) {
  const cwd = deps.cwd ?? process.cwd()
  const nowMs = deps.nowMs ?? Date.now()
  const runGit = deps.runGit ?? ((args) => defaultRunGit(args, cwd))
  const runGh = deps.runGh ?? defaultRunGh
  const clock = deps.clock ?? (() => Date.now())
  const budgetMs = deps.budgetMs ?? TOTAL_BUDGET_MS
  const warnings = []
  let budgetSpent = false

  const attempt = (source, fn) => {
    try {
      const res = fn()
      if (res && res.ok === false) {
        warnings.push(`${source}: ${clip(res.error ?? res.stderr ?? `exit ${res.status}`)}`)
        return null
      }
      return res
    } catch (e) {
      warnings.push(`${source}: ${clip(e instanceof Error ? e.message : String(e))}`)
      return null
    }
  }

  const startedAt = clock()
  /** Network probes only: past the budget they are skipped, once, loudly. */
  const withinBudget = (source) => {
    if (clock() - startedAt <= budgetMs) return true
    if (!budgetSpent) {
      budgetSpent = true
      warnings.push(`time budget ${budgetMs} ms spent — later probes skipped (${source} onwards)`)
    }
    return false
  }

  // ── git (local, always attempted) ──
  const branchRes = attempt('git branch', () => runGit(['rev-parse', '--abbrev-ref', 'HEAD']))
  const statusRes = attempt('git status', () => runGit(['status', '--porcelain']))
  const dirsRes = attempt('git rev-parse', () =>
    runGit(['rev-parse', '--git-dir', '--git-common-dir']),
  )
  const driftRes = attempt('git rev-list', () =>
    runGit(['rev-list', '--left-right', '--count', 'origin/main...HEAD']),
  )

  const branch = String(branchRes?.stdout ?? '').trim() || '(unknown)'
  const dirLines = String(dirsRes?.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const inMainTree = dirLines.length >= 2 ? isSharedMainTree(dirLines[0], dirLines[1], cwd) : true
  const mainRoot = dirLines.length >= 2 ? dirname(resolve(cwd, dirLines[1])) : cwd
  const worktreeName = /\/\.claude\/worktrees\/([^/]+)/.exec(norm(cwd))?.[1] ?? null

  const git = {
    ok: Boolean(branchRes) || Boolean(statusRes),
    branch,
    dirty: String(statusRes?.stdout ?? '').trim() !== '',
    inMainTree,
    worktreeName: worktreeName ? `.claude/worktrees/${worktreeName}` : null,
    aheadBehind: driftRes ? parseAheadBehind(driftRes.stdout) : null,
  }

  const issueNumber = issueNumberFrom(branch, cwd)

  // ── parallel sessions: local read of the flag `session-flag-writer.mjs`
  // maintains. Freshness is re-checked by mtime, so a stale flag never warns.
  const parallel =
    attempt('parallel flag', () => {
      const flag = (deps.readFlag ?? readFlag)(mainRoot)
      const live = liveSessionsFromFlag({
        flag,
        sessionId: deps.sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? '',
        statMtime: deps.statMtime ?? statMtimeMs,
        nowMs,
      })
      return { ok: true, count: live.length }
    })?.count ?? 0

  // ── gh: three calls, each independently degradable ──
  const ghJson = (source, args) => {
    if (!withinBudget(source)) return null
    const res = attempt(source, () => runGh(args))
    if (!res) return null
    try {
      return JSON.parse(res.stdout)
    } catch {
      warnings.push(`${source}: response is not JSON`)
      return null
    }
  }

  const prData = ghJson('gh pr list', [
    'pr',
    'list',
    '--repo',
    REPO,
    '--state',
    'open',
    '--author',
    '@me',
    '--limit',
    '20',
    '--json',
    'number,title,reviewDecision,headRefName,isDraft,statusCheckRollup',
  ])
  const prs = Array.isArray(prData) ? prData : []

  const boardData = ghJson('gh board', [
    'api',
    'graphql',
    '-f',
    `query=${buildBoardItemsPageQuery(null)}`,
  ])
  let board = { ok: false, statusOf: {}, inProgress: [] }
  if (boardData) {
    if (Array.isArray(boardData.errors) && boardData.errors.length > 0) {
      warnings.push(`gh board: ${clip(boardData.errors.map((e) => e?.message ?? '?').join('; '))}`)
    } else {
      board = { ok: true, ...parseBoardPage(boardData.data) }
    }
  }

  const issueData = ghJson('gh issue list', [
    'issue',
    'list',
    '--repo',
    REPO,
    '--state',
    'open',
    '--limit',
    '200',
    '--json',
    'number',
  ])

  return {
    generatedAt: nowMs,
    git,
    issueNumber,
    parallel,
    prs,
    prsOk: prData !== null,
    board,
    openIssues: Array.isArray(issueData) ? issueData.length : null,
    warnings,
  }
}

/**
 * Full run: collect → render → cap. The outermost guarantee — a fault anywhere,
 * including inside the renderer, still yields a printable line.
 */
export function bootstrap(deps = {}) {
  let text
  try {
    text = renderSnapshot(collect(deps))
  } catch (e) {
    text = `# session bootstrap — unavailable\n! bootstrap failed: ${clip(e instanceof Error ? e.message : String(e))}\n→ next: continue without the snapshot; the session is not blocked by it.`
  }
  return `${fitToBytes(text, OUTPUT_LIMIT_BYTES - 1)}\n`
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    process.stdout.write(bootstrap())
  } catch {
    // Last resort: a SessionStart hook must never crash the session start.
  }
  process.exit(0)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
