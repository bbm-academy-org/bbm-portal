#!/usr/bin/env node
// Stop hook (issue #134, task 7.3; port of ds-platform tools/hooks/
// surface-decision-debt-gate.mjs onto our task-cycle markers).
//
// Root symptom: a deviation can be NAMED in the stage-7 line «Отклонения от
// конвенций: …» and still evaporate — nobody says where it went. A deviation
// that is not routed (its own issue / a `DEBT.md` line / explicitly written off
// in the report) is indistinguishable from one that was never surfaced: the
// next session meets it as a surprise. The `surface-decision-debt:` line is the
// ROUTING half of the stage-7 line — for each deviation, WHERE it landed.
//
// SEVERITY — WARN, deliberately (task 7.3 rule). This gate does not block the
// stop: it prints a `systemMessage` and exits 0. Two blocking Stop gates
// already stand on the same terminal report (completion-report + deviations);
// a third blocker on a discipline the repo has not yet practised would turn
// every honest report into a loop. Promotion to BLOCK is a canon decision, not
// a code tweak.
// SEVERITY (docs/ci-guardrails.md §6, decided 2026-08-05): WARN. Promotion means
// an agent cannot end its turn, and a wrong verdict then strands the session with
// no way out — so this one needs the canon §4 clean window AND a documented
// escape hatch before it can block, not just the clock.
//
// COMPOSITION: this gate REUSES the terminal-report recognizer of
// `completion-report-gate.mjs` — the same seam `deviations-gate.mjs` imports.
// Chosen over mirroring the regexes: our completion-report gate is already the
// single source of truth for "what counts as a completion report", so all three
// Stop gates fire on exactly the same set of turns and cannot drift apart.
//
// Stop-hook contract: stdin — {session_id, transcript_path, stop_hook_active}.
// exit 0 = the stop is allowed (this gate ALWAYS exits 0). Loop guard on
// `stop_hook_active`: a session already continued after another gate's block is
// not warned again. FAIL-OPEN: no transcript, malformed JSON, no assistant
// message → exit 0 silently.

import { readFileSync } from 'node:fs'

import {
  extractLastAssistantText,
  hasWriteAction,
  isEnforceableTerminalReport,
} from './completion-report-gate.mjs'
import { emitWarn, hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** The marker whose absence trips the gate — the `surface-decision-debt:` line
 * of the final report. Case-insensitive, tolerant of whitespace before the
 * colon; markdown emphasis (`**surface-decision-debt:**`) still contains the
 * literal token, so the plain regex matches it inherently. */
export const DEBT_MARKER_RE = /surface-decision-debt\s*:/i

/** The line is present. PRESENCE is sufficient: `[]` and a routed list are
 * equally valid — whether every real deviation was surfaced is the author's
 * responsibility, not something a regex can adjudicate. */
export function hasDecisionDebtLine(text) {
  return DEBT_MARKER_RE.test(String(text || ''))
}

export function warnMessage() {
  return (
    '⚠ surface-decision-debt gate (#134, WARN): the final message reads as a task-completion ' +
    'report but carries no `surface-decision-debt:` line. The stage-7 line «Отклонения от ' +
    'конвенций: …» NAMES the deviations; this line says where each one was ROUTED — its own ' +
    'issue, a `DEBT.md` line, or written off in the report itself. Add either ' +
    '`surface-decision-debt: []` (nothing deviated) or one item per deviation with its routing ' +
    '(.claude/skills/surface-decision-debt/SKILL.md). Not blocking — the stop proceeds.'
  )
}

/**
 * Pure decision seam: warn only when this is not a post-block continuation, the
 * final message is a terminal report (the SAME recognizer both blocking Stop
 * gates use), and the `surface-decision-debt:` line is absent from it.
 *
 * Returns `{warn}` rather than `{block}` on purpose — the shape names the
 * severity, so a promotion to blocking (#136) is a visible change of contract
 * and not a silent flip of a boolean's meaning.
 */
export function decideWarn({ stopHookActive, lastAssistantText, writeActionSeen = false }) {
  if (stopHookActive) return { warn: false }
  if (!isEnforceableTerminalReport({ lastAssistantText, writeActionSeen })) return { warn: false }
  if (hasDecisionDebtLine(lastAssistantText)) return { warn: false }
  return { warn: true }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    if (payload.stop_hook_active) process.exit(0)
    if (!payload.transcript_path) process.exit(0)
    const transcript = readFileSync(payload.transcript_path, 'utf8')
    const decision = decideWarn({
      stopHookActive: Boolean(payload.stop_hook_active),
      lastAssistantText: extractLastAssistantText(transcript),
      writeActionSeen: hasWriteAction(transcript),
    })
    if (decision.warn) emitWarn(warnMessage())
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: a gate bug must never break a normal stop
  }
}

if (isDirectRun(import.meta.url)) main()
