#!/usr/bin/env node
// bbm-portal — `pnpm pr:land <pr>`: the PR closing tail in one command (#130).
//
// Why: after the merge a multi-step tail remains (drop your own PR row from the
// board, set Done on every `Closes #N`, tear the worktree down, re-sweep the
// leftovers) — and it is exactly the part that gets forgotten most often,
// because the task is "already done". Here the tail is one deterministic call,
// with no weakening of the gate:
//
//   1. gate        — the PR is open and not a draft, no conflict, a `Closes #N`
//                    is present, review is confirmed, every check-run on the
//                    CURRENT head SHA is green (bounded polling), head has not
//                    moved;
//   2. merge       — `gh pr merge <N> --squash --delete-branch
//                    --match-head-commit <the same SHA>`;
//   3. board-clear — drop YOUR OWN PR row from the board. NOT fatal: the merge
//                    has already landed, a failure here is a report line, not a
//                    rollback;
//   4. board-done  — `Status=Done` on every linked `Closes #N`;
//   5. teardown    — `pnpm worktree:teardown <N>`, if the worktree is on disk;
//   6. re-sweep    — open PRs + head branches on origin, in one line.
//
// The first failing stage stops the tail, prints the stage name and one line of
// "what to finish by hand" (canon §7).
//
// Two properties keep a landed merge from reading as a failure (#142):
//   — the merge stage is judged by the PR's state read back, not by the exit
//     code alone. `--delete-branch` also deletes the LOCAL branch, which always
//     fails while a worktree holds it (the norm here), so a non-zero exit on a
//     PR that IS merged becomes a warning. No stage of this tail deletes that
//     branch either — teardown keeps a squash-merged one on purpose — so the
//     warning sends the operator to `git branch -D` and says so plainly;
//   — the tail is re-runnable. On a PR that is already MERGED stages 1–2 are
//     skipped and the run resumes at the first unfinished stage; stages 3–6 are
//     idempotent by construction.
//
// The review gate is BLOCKING and on by default, but it accepts the form of
// review that actually exists in this repo: the only human with the rights IS
// the PR author (they cannot APPROVE their own PR), and the reviewer is a
// subagent leaving a comment. So either a human APPROVE counts, or a comment
// carrying a `VERDICT: APPROVE` line created AFTER the PR's last commit (an
// approval older than the code is about different code — the same logic as head
// pinning). `--require-review` narrows this to a human APPROVE;
// `--no-review-gate "<reason>"` lifts the gate with a mandatory recorded reason.
// Owner acceptance (stage 5) is a separate requirement, and the reminder about
// it is printed always: the gate cannot check it.
//
// Exit codes: 0 = the tail passed; 1 = a stage failed (RED); 2 = gate timeout;
// 3 = usage/resolution error; 4 = launched from a worktree.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildDeleteItemMutation,
  buildPrProjectItemsQuery,
  ghGraphqlResult,
  ghJson,
  pickProjectItem,
} from './lib/gh.mjs'

const TAG = '[pr:land]'

// ── pure seams (unit-tested in tests/unit/gh-pr-land.spec.ts) ────────────────

/** The canonical stage order — a contract the test verifies. */
export const STAGES = ['gate', 'merge', 'board-clear', 'board-done', 'teardown', 're-sweep']

/**
 * Worktree-number candidates: the linked `Closes #N` plus the number in the
 * branch name `<type>/<N>-<slug>` (worktrees are named by the task number, not
 * by the PR number).
 */
export function issueCandidates(closingIssueNumbers, branch) {
  const out = []
  const push = (n) => {
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  for (const n of Array.isArray(closingIssueNumbers) ? closingIssueNumbers : []) push(n)
  const m = /^[a-z]+\/(\d+)-/.exec(branch ?? '')
  if (m) push(Number(m[1]))
  return out
}

/** One line of "what to finish by hand" per failed stage. */
export function stageRemedy(stage, pr) {
  switch (stage) {
    case 'gate':
      return `sort out the cause of the RED above; do NOT merge by hand — fix it and re-run \`pnpm pr:land ${pr}\`.`
    case 'merge':
      return `read the gh output above and re-run \`pnpm pr:land ${pr}\` (the gate re-confirms first; if the merge did land, the re-run resumes the tail instead of merging again).`
    case 'board-clear':
      return `the merge landed — the PR row could not be dropped from the board (not fatal); delete it by hand if it hangs there dead.`
    case 'board-done':
      return `the merge landed — finish by hand: \`pnpm board:status <issue> Done\`, then \`pnpm worktree:teardown <N>\`.`
    case 'teardown':
      return `the merge landed — finish by hand: \`pnpm worktree:teardown <N>\` (its output above names the holder).`
    case 're-sweep':
      return `the merge landed — re-sweep by hand: \`gh pr list\` + \`git ls-remote --heads origin\`.`
    default:
      return `re-run \`pnpm pr:land ${pr}\`.`
  }
}

/**
 * What `gh pr merge`'s exit code actually means, cross-checked against the PR's
 * state read back afterwards (#142).
 *
 * One exit code covers three operations: the remote merge, the deletion of the
 * remote branch, and the deletion of the LOCAL branch. The last one fails
 * whenever a worktree holds that branch — which in this repo is the norm, not
 * an edge case (`.claude/rules/parallel-sessions.md`). Reading a non-zero exit
 * as "the merge failed" therefore reports a landed merge as a failure, aborts
 * the tail before the board is updated, and sends the caller back to re-merge a
 * PR that is already merged.
 *
 * The state read back is the arbiter, and only in the permissive direction: a
 * state we could not read leaves the failure a failure, because an unverifiable
 * merge is not a merge.
 * @param {number|null|undefined} status  the child's exit code
 * @param {string|null} stateAfter        the PR's state after the call, uppercase
 * @returns {'merged'|'merged-dirty'|'failed'}
 */
export function classifyMergeResult(status, stateAfter) {
  if (status === 0) return 'merged'
  return String(stateAfter ?? '').toUpperCase() === 'MERGED' ? 'merged-dirty' : 'failed'
}

/**
 * Normalise a child's exit code: a non-zero number passes through as is,
 * 0/null/undefined collapse to 1 — a child killed by a signal must NEVER read
 * as success.
 */
export function failCode(status) {
  return typeof status === 'number' && status !== 0 ? status : 1
}

/** Running from a worktree — this is a lead-side command of the main checkout. */
export function isWorktreeCwd(cwd) {
  return /[\\/]\.claude[\\/]worktrees[\\/]/.test(String(cwd ?? '') + '/')
}

export function cwdGuardMessage(cwd) {
  return (
    `refused: the command was launched from a worktree (${cwd}). \`pr:land\` merges and tears ` +
    `worktrees down — running it from inside one means sawing off the branch you sit on. ` +
    `Switch to the main checkout.`
  )
}

/**
 * Structural classification of check-runs. Parsed ONLY by the status /
 * conclusion / state fields — matching on a job's name yields a false green at
 * the first rename.
 * @returns {{verdict:'green'|'pending'|'red', pending:string[], failed:string[]}}
 */
export function classifyChecks(rollup) {
  const list = Array.isArray(rollup) ? rollup : []
  const pending = []
  const failed = []
  for (const entry of list) {
    const name = entry?.name ?? entry?.context ?? '(unnamed)'
    if (entry?.__typename === 'StatusContext' || entry?.state !== undefined) {
      const state = String(entry.state ?? '').toUpperCase()
      if (state === 'PENDING' || state === 'EXPECTED' || state === '') pending.push(name)
      else if (state !== 'SUCCESS') failed.push(`${name} (${state})`)
      continue
    }
    const status = String(entry?.status ?? '').toUpperCase()
    if (status !== 'COMPLETED') {
      pending.push(name)
      continue
    }
    const conclusion = String(entry?.conclusion ?? '').toUpperCase()
    // SKIPPED/NEUTRAL — a legitimate "nothing to do" (path filters); CANCELLED
    // and everything else is red: a cancelled run proved nothing.
    if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion)) {
      failed.push(`${name} (${conclusion || 'no conclusion'})`)
    }
  }
  if (failed.length > 0) return { verdict: 'red', pending, failed }
  // Zero registered runs is not "green" but "they have not arrived yet": we
  // wait within the timeout, after which the stage turns RED.
  if (pending.length > 0 || list.length === 0) return { verdict: 'pending', pending, failed }
  return { verdict: 'green', pending, failed }
}

/**
 * The subagent reviewer's verdict, read from the PR comments. Here review
 * arrives as a comment rather than as a GitHub review (the only human with the
 * rights is the PR author, who cannot APPROVE their own PR), so the checkable
 * artifact is a `VERDICT: APPROVE` line in a comment body.
 *
 * Freshness is mandatory: an approval issued before the last commit is about
 * different code — exactly the same logic as head pinning for the checks.
 * @param {{body?:string, createdAt?:string}[]} comments
 * @param {string|null} headCommittedDate  the date of the PR's last commit
 * @returns {{ok:true, at:string}|{ok:false, reason:'none'|'stale'|'changes', at?:string}}
 */
export function findAgentApproval(comments, headCommittedDate) {
  const verdicts = []
  for (const c of Array.isArray(comments) ? comments : []) {
    const m = /^VERDICT:\s*(APPROVE|REQUEST_CHANGES)\b/m.exec(String(c?.body ?? ''))
    if (!m) continue
    const at = Date.parse(c?.createdAt ?? '')
    if (!Number.isFinite(at)) continue
    verdicts.push({ verdict: m[1], at, iso: c.createdAt })
  }
  if (verdicts.length === 0) return { ok: false, reason: 'none' }
  verdicts.sort((a, b) => a.at - b.at)
  const latest = verdicts[verdicts.length - 1]
  if (latest.verdict !== 'APPROVE') return { ok: false, reason: 'changes', at: latest.iso }
  const head = Date.parse(headCommittedDate ?? '')
  if (Number.isFinite(head) && latest.at < head)
    return { ok: false, reason: 'stale', at: latest.iso }
  return { ok: true, at: latest.iso }
}

/** The PR's last commit date — the baseline for the review freshness check. */
export function headCommittedDate(pr) {
  const commits = pr?.commits
  if (!Array.isArray(commits) || commits.length === 0) return null
  return commits[commits.length - 1]?.committedDate ?? null
}

/**
 * The non-CI gate conditions. Returns the list of RED reasons (empty = ok) and,
 * separately, the non-fatal remarks.
 * @param {object} pr
 * @param {{requireReview?:boolean, reviewGate?:boolean}} [opts]
 *   requireReview — count ONLY a human APPROVE;
 *   reviewGate    — true by default: a human APPROVE OR a fresh
 *                   `VERDICT: APPROVE` from the subagent reviewer counts.
 *                   false — WARN only.
 */
export function gateConditions(pr, { requireReview = false, reviewGate = true } = {}) {
  const red = []
  const warn = []
  const state = String(pr?.state ?? '').toUpperCase()
  if (state !== 'OPEN') red.push(`the PR is not open (state=${state || 'unknown'})`)
  if (pr?.isDraft) red.push('the PR is a draft')
  if (String(pr?.mergeable ?? '').toUpperCase() === 'CONFLICTING') {
    red.push('the PR conflicts with its base — update the branch')
  }
  const closes = (pr?.closingIssuesReferences ?? []).map((r) => r?.number).filter(Boolean)
  if (closes.length === 0) {
    red.push('the PR body carries no `Closes #N` — without it board-done has nowhere to set Done')
  }

  const humanApproved = String(pr?.reviewDecision ?? '').toUpperCase() === 'APPROVED'
  const agent = findAgentApproval(pr?.comments, headCommittedDate(pr))
  const AGENT_REASON = {
    none: 'not a single comment carries a `VERDICT: APPROVE` line',
    stale: 'the last `VERDICT: APPROVE` is older than the last commit — it is about different code',
    changes: "the reviewer's latest verdict is `REQUEST_CHANGES`",
  }
  if (requireReview) {
    if (!humanApproved) red.push('no human APPROVE review (--require-review)')
  } else if (reviewGate) {
    if (!humanApproved && !agent.ok) {
      red.push(
        `review is not confirmed: ${AGENT_REASON[agent.reason]}. ` +
          `Run the review (the bbm-reviewer subagent, task-cycle stage 4) or, if this class of ` +
          `work needs no review, state the reason: --no-review-gate "<reason>"`,
      )
    }
  } else if (!humanApproved && !agent.ok) {
    warn.push(
      `the review gate was lifted by hand and there is no confirmation: ${AGENT_REASON[agent.reason]}`,
    )
  }

  // Owner acceptance (stage 5) is a requirement separate from review, so the
  // reminder is printed ALWAYS: on an APPROVE nothing else would recall it.
  warn.push(
    'task-cycle stage 5: for owner-visible changes the merge happens only after a recorded ' +
      'acceptance on a live stand — the gate does not check this',
  )
  // RED since #216, a remark before it. `main` now carries
  // `required_status_checks.strict: true` (docs/ci-guardrails.md §2.1), so BEHIND
  // is not a warning that the merge might refuse — the server WILL refuse it with
  // GH006. A remark would let this gate report green and then fail at the merge
  // call, which is the single outcome the gate exists to prevent.
  if (String(pr?.mergeStateStatus ?? '').toUpperCase() === 'BEHIND') {
    red.push(
      'the branch is behind its base (mergeStateStatus=BEHIND) and `main` requires strict ' +
        'status checks — the server will refuse this merge. Update the branch ' +
        '(`gh pr update-branch <pr#>`) and let CI re-run on the new head',
    )
  }
  return { red, warn, closes }
}

export const USAGE = `Usage: pnpm pr:land <pr#> [flags]

  The PR closing tail in one command: gate → merge → drop the PR row from the
  board → Status=Done on every \`Closes #N\` → worktree teardown → re-sweep. The
  first failing stage stops the tail and prints what to finish by hand.

  Gate: the PR is open and not a draft, no conflict, not behind its base
  (\`main\` requires strict status checks since #216, so BEHIND is a refusal at
  the server), a \`Closes #N\` is present,
  review is confirmed, every check on the CURRENT head SHA is green. That same
  SHA goes into \`gh pr merge --match-head-commit\`, so a commit that lands while
  we wait makes the merge refuse rather than ride in unchecked.

  Review counts in two ways by default: a human APPROVE OR a reviewer comment
  carrying a \`VERDICT: APPROVE\` line created AFTER the PR's last commit.

  Re-runnable: on a PR that is already MERGED the gate and the merge are skipped
  and the tail resumes at the first unfinished stage. A \`gh pr merge\` that exits
  non-zero only because the LOCAL branch could not be deleted (a worktree holds
  it — the norm here) is a warning, not a failed merge.

  That local branch is then yours to delete: \`worktree:teardown\` removes the
  worktree but KEEPS the branch, because it only deletes one that main already
  contains and a squash merge never produces such a branch. Once the merge is
  confirmed — \`git branch -D <branch>\`.

  Flags:
    --timeout <sec>            wait for the checks, 900 by default
    --interval <sec>           poll period, 20 by default
    --require-review           count only a human APPROVE
    --no-review-gate "<reason>"  lift the review gate; the reason is mandatory and printed

  Exit codes: 0 — the tail passed; 1 — a stage failed; 2 — gate timeout;
  3 — usage error; 4 — launched from a worktree.
`

/** Flag parsing for `pr:land`. */
export function parseFlags(argv) {
  const list = argv ?? []
  if (list.includes('--help') || list.includes('-h')) return { ok: true, help: true }
  const rawPr = list[0]
  const pr = Number(rawPr)
  if (!rawPr || !Number.isInteger(pr) || pr <= 0) {
    return { ok: false, error: `invalid PR number: «${rawPr ?? ''}»` }
  }
  const opts = {
    pr,
    timeout: 900,
    interval: 20,
    requireReview: false,
    reviewGate: true,
    reviewGateWaiver: null,
  }
  for (let i = 1; i < list.length; i++) {
    const a = list[i]
    if (a === '--require-review') opts.requireReview = true
    else if (a === '--no-review-gate') {
      // The reason is mandatory: lifting the gate with no recorded grounds IS
      // the silent bypass for whose sake gates are later called useless.
      const reason = list[++i]
      if (!reason || reason.startsWith('--')) {
        return {
          ok: false,
          error: '--no-review-gate requires a reason: --no-review-gate "<reason>"',
        }
      }
      opts.reviewGate = false
      opts.reviewGateWaiver = reason
    } else if (a === '--timeout') opts.timeout = Number(list[++i])
    else if (a === '--interval') opts.interval = Number(list[++i])
    else return { ok: false, error: `unknown flag «${a}»` }
  }
  for (const key of ['timeout', 'interval']) {
    if (!Number.isFinite(opts[key]) || opts[key] <= 0) {
      return { ok: false, error: `--${key} must be a positive number of seconds` }
    }
  }
  return { ok: true, ...opts }
}

// ── imperative runners (injected in tests) ───────────────────────────────────

const PR_FIELDS =
  'state,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,' +
  'headRefName,headRefOid,statusCheckRollup,comments,commits'

function runViewPr(pr) {
  return ghJson(['pr', 'view', String(pr), '--json', PR_FIELDS])
}

/**
 * The merge, pinned to the same SHA that passed the gate. Without
 * `--match-head-commit` the pinning would only exist on the read side: between
 * a green gate (which may wait up to 900 s) and `gh pr merge` a commit has time
 * to land on the branch — and it would land unchecked by anything. In a repo
 * with parallel sessions this is not a hypothetical; GitHub itself refuses the
 * merge if head has moved.
 */
function runMerge(pr, sha) {
  const args = ['pr', 'merge', String(pr), '--squash', '--delete-branch']
  if (sha) args.push('--match-head-commit', String(sha))
  return spawnSync('gh', args, { stdio: 'inherit' })
}

/**
 * A cheap read of everything the tail needs to know about a PR independently of
 * the gate: is it merged, what does it close, which branch is it on. Serves two
 * callers — the pre-flight probe (is there anything left to gate and merge?) and
 * the post-merge verification (did the merge land despite a non-zero exit?).
 * @returns {{ok:true, state:string, closes:number[], branch:string|null, mergeCommit:string|null}|{ok:false, error:string}}
 */
function runPrState(pr) {
  const res = ghJson([
    'pr',
    'view',
    String(pr),
    '--json',
    'state,closingIssuesReferences,headRefName,mergeCommit',
  ])
  if (!res.ok) return { ok: false, error: res.error }
  const data = res.data ?? {}
  return {
    ok: true,
    state: String(data.state ?? '').toUpperCase(),
    closes: (data.closingIssuesReferences ?? []).map((r) => r?.number).filter(Boolean),
    branch: data.headRefName ?? null,
    mergeCommit: data.mergeCommit?.oid ?? null,
  }
}

function runClearPrBoardItem(pr) {
  const resolved = ghGraphqlResult(buildPrProjectItemsQuery(pr))
  if (!resolved.ok) return { status: 'error', detail: resolved.error }
  const item = pickProjectItem(resolved.data?.repository?.pullRequest?.projectItems?.nodes)
  if (!item?.id || !item.project?.id) return { status: 'absent' }
  const deleted = ghGraphqlResult(buildDeleteItemMutation(item.project.id, item.id))
  if (!deleted.ok) return { status: 'error', detail: deleted.error }
  return { status: 'deleted', detail: item.id }
}

function runBoardDone(issue) {
  return spawnSync('node', ['tools/gh/set-board-status.mjs', String(issue), 'Done'], {
    stdio: 'inherit',
  })
}

function defaultWorktreeExists(n) {
  return existsSync(join(process.cwd(), '.claude', 'worktrees', String(n)))
}

function runTeardown(n) {
  return spawnSync('node', ['tools/dev/worktree-teardown.mjs', String(n)], { stdio: 'inherit' })
}

function runListOpenPrs() {
  const res = ghJson(['pr', 'list', '--json', 'number'])
  if (!res.ok) return { status: 1, count: null }
  return { status: 0, count: Array.isArray(res.data) ? res.data.length : null }
}

function runListRemoteBranches() {
  const res = spawnSync('git', ['ls-remote', '--heads', 'origin'], { encoding: 'utf8' })
  if (res.error || res.status !== 0) return { status: failCode(res.status), count: null }
  return {
    status: 0,
    count: (res.stdout ?? '').split(/\r?\n/).filter((l) => l.trim() !== '').length,
  }
}

function sleepSync(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000)
}

// ── the gate ─────────────────────────────────────────────────────────────────

/**
 * The gate's bounded polling. Head is pinned: if a new commit arrived while we
 * waited, a green on the old SHA proves nothing — that is RED. The same SHA
 * leaves the function and goes on into `gh pr merge --match-head-commit`,
 * otherwise the pinning would remain a promise made on the read side only.
 * @returns {{verdict:'green'|'red'|'timeout', reasons:string[], warn:string[], closes:number[], branch:string|null, sha:string|null}}
 */
export function runGate(
  pr,
  { timeout, interval, requireReview = false, reviewGate = true },
  io = {},
) {
  const viewPr = io.viewPr ?? runViewPr
  const sleep = io.sleep ?? sleepSync
  const now = io.now ?? (() => Date.now())

  const deadline = now() + timeout * 1000
  let pinnedSha = null
  let lastPending = []

  for (;;) {
    const res = viewPr(pr)
    if (!res.ok) {
      return { verdict: 'red', reasons: [res.error], warn: [], closes: [], branch: null, sha: null }
    }
    const data = res.data ?? {}
    const cond = gateConditions(data, { requireReview, reviewGate })
    const sha = data.headRefOid ?? null
    const out = (verdict, reasons) => ({
      verdict,
      reasons,
      warn: cond.warn,
      closes: cond.closes,
      branch: data.headRefName ?? null,
      sha: pinnedSha ?? sha,
    })

    if (cond.red.length > 0) return out('red', cond.red)

    if (pinnedSha === null) pinnedSha = sha
    else if (sha !== pinnedSha) {
      return out('red', [
        `head moved while we waited (${pinnedSha} → ${sha}) — the checks are about different code`,
      ])
    }

    const checks = classifyChecks(data.statusCheckRollup)
    if (checks.verdict === 'red') return out('red', [`red checks: ${checks.failed.join(', ')}`])
    if (checks.verdict === 'green') return out('green', [])

    lastPending = checks.pending
    if (now() >= deadline) {
      return out('timeout', [
        `the checks did not finish within ${timeout} s (waiting on: ${lastPending.join(', ') || 'not a single check registered'})`,
      ])
    }
    process.stdout.write(
      `${TAG} gate: waiting on ${lastPending.length || 'registration of the'} check(s)… ` +
        `next probe in ${interval} s\n`,
    )
    sleep(interval)
  }
}

// ── orchestration ────────────────────────────────────────────────────────────

/**
 * The six stages of the tail. Every stage is its own separate call (no pipes:
 * in a pipe the shell sees the exit code of the last command, not the gate's).
 * The runners are injected so the test can drive every branch without
 * subprocesses.
 *
 * The tail is re-runnable (#142). Stages 1–2 are the only ones that are not
 * repeatable by nature, so they are skipped outright on a PR that is already
 * MERGED; stages 3–6 are idempotent on their own (an absent board row, a Done
 * that is already Done, a worktree that is no longer on disk, a read-only
 * sweep). That is what makes a second `pr:land` finish the tail instead of
 * demanding a merge that already happened.
 *
 * The trade that buys it, named rather than hidden: the resume path services ANY
 * merged PR with no gate in front of it, so a mistyped number moves the board of
 * whatever that PR closes. The gate never protected a merged PR in the first
 * place — it refused it outright — and the damage is bounded (a Done set on a
 * Done, a teardown behind an existence check, a read-only sweep). Tracked in
 * DEBT.md with a return condition (review of PR #161).
 */
export function landPr(opts, io = {}) {
  const { pr } = opts
  const gate = io.gate ?? ((o) => runGate(pr, o))
  const merge = io.merge ?? runMerge
  const prState = io.prState ?? runPrState
  const clearBoardItem = io.clearBoardItem ?? runClearPrBoardItem
  const boardDone = io.boardDone ?? runBoardDone
  const worktreeExists = io.worktreeExists ?? defaultWorktreeExists
  const teardown = io.teardown ?? runTeardown
  const listOpenPrs = io.listOpenPrs ?? runListOpenPrs
  const listRemoteBranches = io.listRemoteBranches ?? runListRemoteBranches
  const exit = io.exit ?? ((code) => process.exit(code))
  const log = io.log ?? ((msg) => process.stdout.write(msg))
  const err = io.err ?? ((msg) => process.stderr.write(`${TAG} ${msg}\n`))

  const report = []
  const printReport = () => {
    log(`${TAG} ── closing tail of PR #${pr} ──\n`)
    for (const line of report) log(`${TAG}   ${line}\n`)
  }
  const fail = (stage, code, detail) => {
    report.push(`${stage}: FAILED${detail ? ` (${detail})` : ''}`)
    printReport()
    err(
      `stage «${stage}» failed on PR #${pr}${detail ? ` — ${detail}` : ''}. What to do: ${stageRemedy(stage, pr)}`,
    )
    return exit(code)
  }

  const onlyIssues = (list) => (list ?? []).filter((n) => Number.isInteger(n) && n > 0)
  const short = (s) => (s ? String(s).slice(0, 12) : null)

  // 0. Pre-flight: is there anything left to gate and merge at all? A PR whose
  //    merge landed but whose tail aborted must be resumable — the gate would
  //    otherwise read it as «not open» and send the caller back to a merge that
  //    already happened. A probe that cannot be read is NOT treated as "already
  //    merged": we fall through to the gate, which reports the failure properly.
  const before = prState(pr)
  const alreadyMerged = before.ok && before.state === 'MERGED'

  let issues
  let branch

  if (alreadyMerged) {
    report.push(`gate: skip (PR #${pr} is already MERGED — there is nothing left to gate)`)
    report.push(
      `merge: skip (already merged${before.mergeCommit ? `, ${short(before.mergeCommit)}` : ''}) — ` +
        `resuming the tail from the first unfinished stage`,
    )
    issues = onlyIssues(before.closes)
    branch = before.branch
  } else {
    // 1. The gate.
    const g = gate(opts)
    for (const w of g.warn ?? []) err(`gate, remark: ${w}`)
    if (g.verdict === 'timeout') return fail('gate', 2, g.reasons.join('; '))
    if (g.verdict !== 'green') return fail('gate', 1, g.reasons.join('; '))
    report.push('gate: OK (checks green, head pinned)')

    issues = onlyIssues(g.closes)
    branch = g.branch

    // 2. The merge — pinned to the same SHA that passed the gate.
    const mergeRes = merge(pr, g.sha)
    if (mergeRes.error) {
      return fail('merge', 3, `could not launch gh pr merge: ${mergeRes.error.message}`)
    }
    // The remote merge and the local cleanup share one exit code — read the PR
    // back to tell them apart instead of trusting the code alone (#142).
    const after = prState(pr)
    const outcome = classifyMergeResult(mergeRes.status, after.ok ? after.state : null)
    if (outcome === 'failed') return fail('merge', failCode(mergeRes.status))
    const sha = after.ok ? after.mergeCommit : null
    if (outcome === 'merged') {
      report.push(
        `merge: OK (squash${g.sha ? `, head pinned at ${short(g.sha)}` : ''}` +
          `${sha ? `, ${short(sha)}` : ''})`,
      )
    } else {
      // merged-dirty: this run's `gh pr merge` did NOT report success, so it is
      // not ours to claim that it merged the SHA we pinned. The same outcome
      // covers a parallel session merging a NEWER head — which is precisely what
      // `--match-head-commit` refuses. All that is established here is that the
      // PR is merged now (review of PR #161).
      report.push(
        `merge: OK (the PR is MERGED${sha ? ` as ${short(sha)}` : ''}; this run's ` +
          `\`gh pr merge\` exited non-zero — see merge-cleanup)`,
      )
    }
    if (outcome === 'merged-dirty') {
      // NOT a stage failure: what is left undone is LOCAL, and no stage of this tail deletes it:
      // `worktree:teardown` removes the worktree but deliberately keeps the
      // branch, because it only deletes one that main already contains and a
      // squash merge never produces such a branch
      // (`tools/dev/worktree-teardown.mjs`, `cleanupBranch`). Saying otherwise
      // would print a remedy that does not work (review of PR #161).
      const detail =
        '`gh pr merge --delete-branch` exited non-zero AFTER the remote merge landed — ' +
        'the LOCAL branch was not deleted. A local branch held by a worktree is the norm ' +
        'here (`.claude/rules/parallel-sessions.md`). Mind what does NOT finish the job: ' +
        '`pnpm worktree:teardown <N>` removes the worktree but KEEPS this branch (it only ' +
        'deletes a branch main already contains, and a squash merge never makes one). ' +
        `Once the merge is confirmed, delete it yourself: \`git branch -D ${branch ?? '<branch>'}\`.`
      report.push(`merge-cleanup: WARNING (not fatal — ${detail})`)
      err(`merge cleanup, remark: ${detail}`)
    }
  }

  // 3. board-clear — NOT fatal: the merge has already landed.
  const clear = clearBoardItem(pr)
  if (clear.status === 'deleted') report.push('board-clear: OK (PR row dropped from the board)')
  else if (clear.status === 'absent') report.push('board-clear: skip (the PR was not on the board)')
  else report.push(`board-clear: WARNING (not fatal — ${clear.detail ?? 'unknown error'})`)

  // 4. board-done.
  if (issues.length === 0) {
    report.push('board-done: skip (the PR has no linked `Closes #N`)')
  } else {
    for (const issue of issues) {
      const res = boardDone(issue)
      if (res.error)
        return fail('board-done', 3, `could not launch board:status: ${res.error.message}`)
      if (res.status !== 0) return fail('board-done', failCode(res.status), `issue #${issue}`)
    }
    report.push(`board-done: OK (#${issues.join(', #')} → Done)`)
  }

  // 5. worktree teardown.
  const candidates = issueCandidates(issues, branch)
  const present = candidates.filter((n) => worktreeExists(n))
  if (present.length === 0) {
    report.push(
      `teardown: skip (nothing on disk at .claude/worktrees/{${candidates.join(',') || '-'}})`,
    )
  } else {
    for (const n of present) {
      const res = teardown(n)
      if (res.error)
        return fail('teardown', 3, `could not launch worktree:teardown: ${res.error.message}`)
      if (res.status !== 0) return fail('teardown', failCode(res.status), `.claude/worktrees/${n}`)
    }
    report.push(`teardown: OK (.claude/worktrees/{${present.join(',')}})`)
  }

  // 6. The re-sweep.
  const prs = listOpenPrs()
  if (prs.status !== 0) return fail('re-sweep', 1, '`gh pr list` did not work')
  const branches = listRemoteBranches()
  if (branches.status !== 0)
    return fail('re-sweep', 1, '`git ls-remote --heads origin` did not work')
  report.push(`re-sweep: OK (open PRs: ${prs.count}; head branches on origin: ${branches.count})`)

  printReport()
  log(`${TAG} the closing tail of PR #${pr} PASSED.\n`)
  return exit(0)
}

function main() {
  const parsed = parseFlags(process.argv.slice(2))
  if (parsed.ok && parsed.help) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (!parsed.ok) {
    process.stderr.write(`${TAG} ${parsed.error}\n${USAGE}`)
    process.exit(3)
  }
  const cwd = process.cwd()
  if (isWorktreeCwd(cwd)) {
    process.stderr.write(`${TAG} ${cwdGuardMessage(cwd)}\n`)
    process.exit(4)
  }
  if (parsed.reviewGateWaiver) {
    process.stdout.write(
      `${TAG} the review gate was LIFTED by hand. Reason: ${parsed.reviewGateWaiver}\n` +
        `${TAG} this is recorded into the session output deliberately — lifting a gate must be visible.\n`,
    )
  }
  landPr(parsed)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
