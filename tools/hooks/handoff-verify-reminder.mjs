#!/usr/bin/env node
// UserPromptSubmit hook (#134, epic #117; ported from ds-platform
// `tools/hooks/handoff-verify-reminder.mjs`): when the submitted prompt matches
// the handoff shape — the continuation sentinel sentence, or the header pair a
// `/handoff-prompt` block carries — remind that the FIRST action is piping the
// VERBATIM handoff through `pnpm handoff:verify`, never a hand-retyped
// paraphrase (re-typing invents refs and injects false STALE rows).
//
// Symptom → root cause: a handoff is a HYPOTHESIS (task-cycle SKILL.md stage 1,
// memory `orient-before-acting`), but the inheriting session reads it as fact
// and builds on premises that stopped being true hours earlier. The prose rule
// exists; the enforcement seam did not. This hook is only the seam — the canon
// stays in `.claude/skills/task-cycle/SKILL.md` (stage 1 «handoff = hypothesis»,
// stage 2 «handoff ≠ go») and `.claude/skills/wrap/SKILL.md` Phase 5.
//
// Contract (Claude Code UserPromptSubmit hook): stdin JSON carries
// {session_id, hook_event_name:"UserPromptSubmit", prompt, …}. WARN-only: exit 0
// always; on a handoff-shaped prompt it writes stdout JSON with a
// `systemMessage` (visible reminder) + `hookSpecificOutput.additionalContext`
// (model directive). FAIL-OPEN like the rest of the stack (shared.mjs): any
// internal error exits 0 with no output — a guard bug must never break
// prompting. Kill-switch: `BBM_HOOKS_DISABLE=1` (the stack-wide switch).
//
// SEVERITY (docs/ci-guardrails.md §6, decided 2026-08-05): WARN, PERMANENTLY,
// by design — not a promotion candidate. This is a SessionStart reminder: a
// session that cannot start is a broken session, and the whole value of the
// reminder is that a human reads it and decides.

import { hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** The sentence Claude Code puts at the top of a continuation handoff. */
export const HANDOFF_SENTINEL_RE = /You are continuing a previous Claude Code session/i

/**
 * Headers the `/handoff-prompt` shape carries (EN + the RU wording used in this
 * repo). A single header alone is an ordinary prompt — someone quoting a README
 * section; the PAIR is the handoff signature.
 */
// NB: `\b` is ASCII-only in JS, so it never fires after a Cyrillic letter — the
// RU alternatives are deliberately unanchored at the tail.
export const CURRENT_TASK_RE = /^##\s+(?:Current task\b|Текущая задача)/im
export const WHERE_WE_STOPPED_RE =
  /^##\s+(?:Where we stopped\b|Где остановились|На чём остановились)/im

/** Handoff shape: the sentinel sentence, or both signature headers. */
export function isHandoffPrompt(prompt) {
  const p = String(prompt || '')
  if (!p) return false
  if (HANDOFF_SENTINEL_RE.test(p)) return true
  return CURRENT_TASK_RE.test(p) && WHERE_WE_STOPPED_RE.test(p)
}

/** The warn payload — pure, so the spec asserts the exact wording. */
export function reminderOutput() {
  return {
    systemMessage:
      '⚠ handoff-verify (#134): похоже на handoff из прошлой сессии — первый шаг ' +
      'прогнать его ВЕРБАТИМ через `pnpm handoff:verify` (stdin годится), не пересказ.',
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        '<handoff-verify-reminder>This prompt matches the session-handoff shape. ' +
        'Before ANY other action, pipe the VERBATIM handoff text (the exact pasted ' +
        'prompt — never a hand-retyped paraphrase, which injects false STALE rows) ' +
        'into `pnpm handoff:verify` and reconcile every flagged ref before acting on ' +
        "the handoff's premises. Canon: .claude/skills/task-cycle/SKILL.md stage 1 " +
        '(a handoff is a HYPOTHESIS) and stage 2 (handoff ≠ the owner\'s go).</handoff-verify-reminder>',
    },
  }
}

/**
 * Pure decision seam: the stdout text for a payload, or null when the hook says
 * nothing. Keeping it separate from main() is the stack convention (shared.mjs)
 * — the spec imports it without touching stdin or process.exit.
 */
export function decideReminder(payload) {
  if (!payload || !isHandoffPrompt(payload.prompt)) return null
  return JSON.stringify(reminderOutput())
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const out = decideReminder(readHookPayload())
    if (out) process.stdout.write(out)
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: a guard bug must never break prompting
  }
}

if (isDirectRun(import.meta.url)) main()
