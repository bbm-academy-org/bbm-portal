#!/usr/bin/env node
// PreToolUse hook (`Agent|Task`): LEAD context budget — WARN at the soft tier,
// DENY a NEW dispatch at the hard tier (issue #457; ported from ds-platform
// `tools/hooks/lead-context-budget.mjs`, their #1693).
//
// Symptom → root cause: an orchestration lead keeps dispatching fresh waves at
// 200K+ with no in-band signal at all, and the session ends in a rushed handoff
// (or none). The budget probe this repo already has cannot catch that:
//   1. `context-budget.mjs` is an OPERATOR advisory — `systemMessage` only, it
//      never talks to the model (owner decision, ported with it), and
//   2. it fires on UserPromptSubmit, while an orchestration session runs mostly
//      on `<task-notification>` turns that never submit a prompt at all.
// So the lead's own context size is invisible to the lead exactly in the
// sessions where it matters.
//
// This hook DOES address the model — deliberately, and unlike its sibling. That
// is safe here because of the matcher: `Agent|Task` fires at the moment a NEW
// dispatch is being requested, never mid-work. Nothing in flight is interrupted;
// the only thing that can be denied is STARTING another agent. The failure mode
// that made the advisory hook operator-only (an instruction that makes the agent
// abandon an in-flight slice) has no way to occur on this event.
//
// Contract:
//   - Acts ONLY for the LEAD. A PreToolUse payload from inside a SUBAGENT
//     carries `agent_id`; a lead call has none, and its `transcript_path` IS the
//     lead's own transcript. `agent_id` present ⇒ exit 0 silent (a subagent-side
//     budget is out of scope, see #457).
//   - Context size = the last assistant usage block, computed by
//     `lastAssistantContextTokens` imported from `context-budget.mjs` — ONE
//     definition of that parse, never a copy — over the file TAIL (`readTail`).
//   - ≥ SOFT_THRESHOLD → allow, plus an `additionalContext` warning. No
//     `permissionDecision: "allow"`: that would pre-approve the dispatch and
//     bypass the operator's own permission view.
//   - ≥ HARD_THRESHOLD → `permissionDecision: "deny"`.
//   - The marker file `.claude/lead-budget-override` in the MAIN checkout lifts
//     both tiers — but only when it CARRIES A REASON (its first line). An empty
//     marker is not an override: the tiers still apply and the message says the
//     marker is reasonless. The reason is quoted into `additionalContext` and
//     written to stderr, so it lands in the session log and can be named in the
//     stage-7 «Отклонения от конвенций» line. That is §3 class-3 clause (d) of
//     `docs/ci-guardrails.md`, read for a budget fence: persistent rather than
//     consumed-once (a one-shot hatch would be re-armed at every dispatch for
//     the rest of the session, which is worse), but reasoned and loud. The
//     register row in `docs/ci-guardrails.md` §6 owns that reading; this is the
//     pointer, and it owns the tier numbers below.
//   - `BBM_HOOKS_DISABLE=1` silences it like every other hook of the stack.
//   FAIL-OPEN: any parse / IO / logic error exits 0 with no output — a budget
//   probe must never wedge a legitimate dispatch.
//
// `readTail` lives HERE rather than in `shared.mjs` on purpose: it has exactly
// one consumer today (ds-platform shares it with a subagent-side budget hook
// this repo deliberately did not port). It is exported, so the day that sibling
// lands the move to `shared.mjs` is a rename, not a rewrite.

import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import { resolve } from 'node:path'

import { lastAssistantContextTokens } from './context-budget.mjs'
import { hooksDisabled, isDirectRun, mainRepoRoot, readHookPayload } from './shared.mjs'

/** Soft cap: the wave in flight may finish; no NEW wave may start.
 * Owner-tunable (owner decision, 2026-09-03, #457: 150K). */
export const SOFT_THRESHOLD = 150_000

/** Hard cap: a new dispatch is DENIED — bring the task to a stop and hand off.
 * Owner-tunable (owner decision, 2026-09-03, #457: 160K). */
export const HARD_THRESHOLD = 160_000

/** Owner-only escape hatch, repo-relative. Gitignored: it is a live-session
 * marker, never a committed setting. */
export const OVERRIDE_REL = '.claude/lead-budget-override'

/** Bytes of the transcript tail that are parsed. `lastAssistantContextTokens`
 * scans from the END and stops at the first assistant usage block it meets, so
 * the tail yields the same number as the whole file — while a lead transcript of
 * the very runs this hook exists to catch is tens of MB. */
export const TAIL_BYTES = 4 * 1024 * 1024

/** Last `maxBytes` of a file as UTF-8. A truncated first line is fine — the
 * parser skips unparseable lines. IO errors propagate to the fail-open catch. */
export function readTail(path, maxBytes = TAIL_BYTES) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, maxBytes)
    const buf = Buffer.allocUnsafe(length)
    readSync(fd, buf, 0, length, size - length)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** Absolute path of the override marker for a given repo root. */
export function overridePath(projectDir) {
  return resolve(projectDir, OVERRIDE_REL)
}

/**
 * Repo root the marker is looked up in: the MAIN checkout, resolved by
 * `mainRepoRoot` (`git rev-parse --git-common-dir`) from the payload's cwd.
 *
 * `CLAUDE_PROJECT_DIR` is deliberately NOT preferred, and the distinction is
 * real: it names the SESSION's project directory, which for a session started
 * inside `.claude/worktrees/<N>` is the WORKTREE, not the main tree. An owner
 * override is a statement about this box's work rather than about one worktree,
 * so it lives in exactly one place. `mainRepoRoot` falls back to
 * `CLAUDE_PROJECT_DIR` by itself when git cannot answer at all (see
 * `shared.mjs`), which is the only case where the session dir is used.
 */
export function projectRoot(payload = {}) {
  return mainRepoRoot((payload && payload.cwd) || process.cwd())
}

/**
 * The override hatch as read from disk.
 *
 * @returns `{active, reasonless, reason}` — `active` only when the marker exists
 *   AND its first line is non-empty. A marker without a reason is `reasonless`:
 *   NOT an override, but the tier message names it, so a session that created
 *   the file is told why nothing changed. Any read error reads as no marker at
 *   all — the hatch fails closed.
 */
export function readOverride(projectDir, readFile = (path) => readFileSync(path, 'utf8')) {
  let raw
  try {
    raw = readFile(overridePath(projectDir))
  } catch {
    return { active: false, reasonless: false, reason: '' }
  }
  const reason = String(raw || '')
    .split(/\r?\n/)[0]
    .trim()
  if (!reason) return { active: false, reasonless: true, reason: '' }
  return { active: true, reasonless: false, reason }
}

/** Appended to a tier message when a marker exists but carries no reason. */
function reasonlessNote() {
  return (
    ` Маркер ${OVERRIDE_REL} на месте, но БЕЗ причины — это НЕ override: впиши первой ` +
    `строкой файла причину владельца, иначе пороги действуют как обычно.`
  )
}

export function softMessage(contextTokens, { reasonless = false } = {}) {
  const k = Math.round(contextTokens / 1000)
  const soft = Math.round(SOFT_THRESHOLD / 1000)
  return (
    `⚠ Контекст лида ≈${k}K ≥ ${soft}K — волну в полёте довести, новую НЕ начинать. ` +
    `Доведи задачу до логической точки остановки, напиши финальный отчёт ` +
    `(skill report-task-outcome) и handoff (skill handoff-prompt); /wrap — только по ` +
    `команде владельца.` +
    (reasonless ? reasonlessNote() : '')
  )
}

export function hardMessage(contextTokens, { reasonless = false } = {}) {
  const k = Math.round(contextTokens / 1000)
  const hard = Math.round(HARD_THRESHOLD / 1000)
  return (
    `⛔ Контекст лида ≈${k}K ≥ ${hard}K — новый диспатч заблокирован. Прими результаты уже ` +
    `запущенных агентов, доведи хвосты PR руками, напиши финальный отчёт ` +
    `(skill report-task-outcome) и handoff (skill handoff-prompt); /wrap — только по команде ` +
    `владельца; продолжение — в новой сессии. Override — только по явному указанию ` +
    `владельца: файл ${OVERRIDE_REL}, первой строкой — причина.` +
    (reasonless ? reasonlessNote() : '')
  )
}

export function overrideMessage(contextTokens, reason = '') {
  const k = Math.round(contextTokens / 1000)
  const soft = Math.round(SOFT_THRESHOLD / 1000)
  return (
    `⚠ Контекст лида ≈${k}K ≥ ${soft}K, но действует OVERRIDE (${OVERRIDE_REL}) — бюджет ` +
    `диспатчей снят по указанию владельца, причина: «${reason}». Маркер ставит ТОЛЬКО ` +
    `владелец, снимается он на /wrap. Держи волну минимальной и назови этот override в ` +
    `строке «Отклонения от конвенций» финального отчёта.`
  )
}

/**
 * Pure decision seam (unit-tested without FS or stdin). `override` is true only
 * for a marker that CARRIES A REASON; `overrideReasonless` is true for a marker
 * that exists without one and rides along on the decision, so the tier message
 * can say so.
 * - below SOFT                       → `{ action: 'silent' }`
 * - ≥ SOFT, reasoned override marker → `{ action: 'override' }` (loud allow)
 * - ≥ HARD                           → `{ action: 'deny' }`
 * - ≥ SOFT                           → `{ action: 'soft' }`
 *
 * The JSDoc `@param` is load-bearing, not decoration: without it TS infers the
 * parameter shape from the destructuring defaults alone, so only
 * `overrideReasonless` survives and every caller passing `contextTokens` is a
 * TS2353. Same trap, same fix as `applyBlockBudget` in `shared.mjs`.
 *
 * @param {{contextTokens?: number, override?: boolean, overrideReasonless?: boolean}} [args]
 * @returns {{action: 'silent'|'soft'|'deny'|'override', reasonless: boolean}}
 */
export function decide({ contextTokens, override, overrideReasonless = false } = {}) {
  const ctx = Number.isFinite(contextTokens) ? contextTokens : 0
  const reasonless = Boolean(overrideReasonless)
  if (ctx < SOFT_THRESHOLD) return { action: 'silent', reasonless }
  if (override) return { action: 'override', reasonless: false }
  if (ctx >= HARD_THRESHOLD) return { action: 'deny', reasonless }
  return { action: 'soft', reasonless }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    // A subagent's own dispatch is not this hook's addressee.
    if (!payload || typeof payload !== 'object' || payload.agent_id) process.exit(0)
    const transcriptPath = payload.transcript_path
    if (typeof transcriptPath !== 'string' || !transcriptPath) process.exit(0)
    const contextTokens = lastAssistantContextTokens(readTail(transcriptPath))
    const hatch = readOverride(projectRoot(payload))
    const decision = decide({
      contextTokens,
      override: hatch.active,
      overrideReasonless: hatch.reasonless,
    })
    if (decision.action === 'silent') process.exit(0)
    if (decision.action === 'deny') {
      const msg = hardMessage(contextTokens, { reasonless: decision.reasonless })
      process.stdout.write(
        JSON.stringify({
          systemMessage: msg,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: msg,
          },
        }),
      )
      process.exit(0)
    }
    const msg =
      decision.action === 'override'
        ? overrideMessage(contextTokens, hatch.reason)
        : softMessage(contextTokens, { reasonless: decision.reasonless })
    // The reason has to land in the SESSION LOG, not only in the model's
    // context: stderr is what the operator and the transcript actually keep.
    if (decision.action === 'override') {
      process.stderr.write(`[lead-context-budget] OVERRIDE активен, причина: ${hatch.reason}\n`)
    }
    process.stdout.write(
      JSON.stringify({
        systemMessage: msg,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: msg,
        },
      }),
    )
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: never wedge a legitimate dispatch on a bug
  }
}

if (isDirectRun(import.meta.url)) main()
