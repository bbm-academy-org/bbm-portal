#!/usr/bin/env node
// bbm-portal — `pnpm board:status <issue> <Todo|In Progress|Done>` (#130).
//
// Why this is a separate command: `Closes #N` closes an issue but does NOT move
// its Projects v2 column; this board has no «closed → Done» automation. Status
// must therefore be set explicitly, and manual board movement is the cycle's
// most frequently forgotten step (canon §7). A claim also means worktree AND
// `In Progress` (§4), and this command sets the claim's second half.
//
// Resolution uses ONE targeted GraphQL request for the specific issue: its
// projectItems carry the item id, project id and Status field with options.
// There is deliberately no full-board scan because the 5000/hour quota is
// shared by every parallel session.
//
// Usage:
//   pnpm board:status <issue#> <Todo|In Progress|Done>
//   pnpm board:status <issue#> --resolve        # read-only, no mutation
//
// Exit codes: 0 = status set (or resolved); 1 = error.

import { pathToFileURL } from 'node:url'

import {
  PROJECT_NUMBER,
  PROJECT_TITLE,
  VALID_STATUS,
  buildStatusMutation,
  ghGraphqlResult,
  resolveBoardStatusTarget,
} from './lib/gh.mjs'

const TAG = '[board:status]'

// ── pure seams (unit-tested in tests/unit/gh-board-tools.spec.ts) ────────────

/**
 * Parse command argv. The shell normally passes status as ONE argument, but
 * quotes around «In Progress» are easy to lose, so join the tail back together:
 * `board:status 42 In Progress` must behave like
 * `board:status 42 "In Progress"`, or half the claims will not be set.
 */
export function parseArgs(argv) {
  const list = argv ?? []
  const rawIssue = list[0]
  const rest = list.slice(1)
  const issueNumber = Number(rawIssue)
  if (!rawIssue || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    return { ok: false, error: `invalid issue number: «${rawIssue ?? ''}»` }
  }
  if (rest.length === 0) return { ok: false, error: 'status is required' }
  if (rest.length === 1 && rest[0] === '--resolve') {
    return { ok: true, issueNumber, resolveOnly: true, status: null }
  }
  const status = rest.join(' ').trim()
  if (!VALID_STATUS.includes(status)) {
    return {
      ok: false,
      error: `invalid status «${status}». Allowed values: ${VALID_STATUS.join(', ')}`,
    }
  }
  return { ok: true, issueNumber, resolveOnly: false, status }
}

// ── imperative part ─────────────────────────────────────────────────────────

export const USAGE = `Usage: pnpm board:status <issue#> <${VALID_STATUS.join('|')}>
               pnpm board:status <issue#> --resolve   (read-only, no mutation)

  Sets an issue's Status on the «${PROJECT_TITLE}» board (Project ${PROJECT_NUMBER})
  with one targeted GraphQL request. There is no full-board scan because the
  5000/hour quota is shared by every parallel session.

  Why it is needed: \`Closes #N\` closes an issue but does NOT move its board
  column; «In Progress» is also the second half of canon §4's claim (the first
  half is a worktree).

  The two-word status may be passed without quotes: \`board:status 42 In Progress\`.

  Exit codes: 0 — status set (or resolved); 1 — error.
`

/**
 * Full command path after argv parsing: resolution → (cross-check) → mutation →
 * final line. Runners are injected so tests drive the successful path IN FULL,
 * including final-message construction, without network or live-board mutation.
 *
 * Regression #132: this path used to live directly in `main()` and was not run
 * by unit tests. The final line referenced a nonexistent `item` variable (the
 * resolver result is named `target`): mutation succeeded, logging threw a
 * `ReferenceError`, and completed work exited 1, so `pr:land` read board-done as
 * a failure.
 */
export function runBoardStatus(parsed, io = {}) {
  const resolve = io.resolve ?? resolveBoardStatusTarget
  const mutate = io.mutate ?? ghGraphqlResult
  const out = io.out ?? ((msg) => process.stdout.write(msg))
  const err = io.err ?? ((msg) => process.stderr.write(msg))
  const exit = io.exit ?? ((code) => process.exit(code))

  const { issueNumber, resolveOnly, status } = parsed
  const die = (msg) => {
    err(`${TAG} ${msg}\n`)
    return exit(1)
  }
  const warn = (msg) => err(`${TAG} remark: ${msg}\n`)

  // 1. Targeted resolution — one cheap request, no board scan. In --resolve
  //    mode the option is not requested because the point is to inspect state.
  const target = resolve(issueNumber, resolveOnly ? VALID_STATUS[0] : status)
  if (!target.ok) return die(target.error)

  // 2. Cross-check documented ids — WARN only; live resolution wins.
  for (const w of target.warnings ?? []) warn(w)

  if (resolveOnly) {
    const { project, statusField } = target
    out(
      `${TAG} resolved (read-only):\n` +
        `  project = ${project.title} (#${project.number}) ${project.id}\n` +
        `  field   = Status ${statusField.id}\n` +
        `  item    = #${issueNumber} -> ${target.itemId}\n` +
        `  options = ${(statusField.options ?? []).map((o) => `${o.name}:${o.id}`).join(', ')}\n` +
        `  No mutation was made (--resolve).\n`,
    )
    return exit(0)
  }

  // 3. Mutation — with live-resolved ids.
  const mutated = mutate(
    buildStatusMutation(target.projectId, target.itemId, target.fieldId, target.optionId),
  )
  if (!mutated.ok) return die(mutated.error)

  out(`${TAG} DONE — issue #${issueNumber}: Status = «${status}» (item ${target.itemId}).\n`)
  return exit(0)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    process.stderr.write(`${TAG} ${parsed.error}\n${USAGE}`)
    process.exit(1)
  }
  runBoardStatus(parsed)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
