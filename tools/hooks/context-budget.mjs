#!/usr/bin/env node
// UserPromptSubmit hook: context-budget OPERATOR ADVISORY (issue #134; ported
// from ds-platform tools/hooks/context-budget.mjs).
//
// Symptom → root cause: a session that runs past the cache-read cliff gets
// slower and more expensive every turn, and nobody notices — the number is
// invisible while the work feels fine. `/wrap` then happens too late, after the
// retro material has already been squeezed out of the window.
//
// This hook NEVER talks to the model. The ds-platform predecessor originally
// injected `additionalContext` ordering the agent to stop taking new work; the
// owner's verdict there was that it makes the agent abandon in-flight slices
// mid-task. So the design is a VISIBLE OPERATOR ADVISORY: `systemMessage` only,
// for the human to read. It MUST NEVER emit `hookSpecificOutput` /
// `additionalContext` — the decision to /wrap belongs to the owner, not to the
// agent that would be wrapping itself.
//
// It reads the CURRENT session transcript (path arrives on stdin), takes the
// last assistant message's usage block, and computes the live context size as
// input_tokens + cache_read_input_tokens + cache_creation_input_tokens.
// Thresholds are calibrated to the ~150K cache-read cost cliff of the session
// model, with headroom for the wrap itself — below the first tier the hook is
// silent.
//
// Contract: stdin — JSON UserPromptSubmit ({session_id, transcript_path, …}).
// exit 0 always, with an optional `systemMessage` on stdout. FAIL-OPEN: any
// parse/IO error exits 0 with no output — a broken budget probe must never
// break prompting.

import { readFileSync } from 'node:fs'

import { emitWarn, hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** Approaching the cliff: advisory only, the session can keep going. */
export const WARN_THRESHOLD = 110_000

/** The /wrap threshold: every further turn pays full cache-read price. */
export const WRAP_THRESHOLD = 120_000

/**
 * Live context size of the session: the usage block of the LAST assistant
 * message in the transcript. Cache reads and cache creation count — they are
 * context that is being re-sent, not free history. Unparseable lines are
 * skipped; a transcript with no assistant usage yields 0 (silent).
 */
export function lastAssistantContextTokens(transcript) {
  const lines = String(transcript || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const usage = entry && entry.message && entry.message.usage
    if (entry && entry.type === 'assistant' && usage) {
      return (
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      )
    }
  }
  return 0
}

/**
 * Pure decision seam: token count → advisory tier. `none` means no output at
 * all. The message names the number, because the point of the advisory is to
 * make an invisible quantity visible to the operator.
 */
export function decideContextBudget(contextTokens) {
  const context = Number(contextTokens) || 0
  const k = Math.round(context / 1000)
  if (context >= WRAP_THRESHOLD) {
    return {
      tier: 'wrap',
      message:
        `⚠ context budget (#134): the session is at ≈${k}K tokens (threshold ` +
        `${WRAP_THRESHOLD / 1000}K) — every further turn pays full cache-read price and the ` +
        `retro material is being squeezed out. Time to /wrap. Advisory only: the call is yours.`,
    }
  }
  if (context >= WARN_THRESHOLD) {
    return {
      tier: 'warn',
      message:
        `⚠ context budget (#134): the session is at ≈${k}K tokens — approaching the /wrap ` +
        `threshold (${WRAP_THRESHOLD / 1000}K). Advisory only: the call is yours.`,
    }
  }
  return { tier: 'none' }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    if (!payload.transcript_path) process.exit(0)
    const transcript = readFileSync(payload.transcript_path, 'utf8')
    const decision = decideContextBudget(lastAssistantContextTokens(transcript))
    if (decision.tier !== 'none') emitWarn(decision.message)
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: a broken probe must never break prompting
  }
}

if (isDirectRun(import.meta.url)) main()
