#!/usr/bin/env node
// PreToolUse guard on AskUserQuestion (issue #91; retro 2026-08-05, recurrence
// of the "askuserquestion-swallows-proposal" theme).
//
// Symptom → root cause: the owner sees ONLY the question text and the option
// labels. Everything the agent writes between tool calls — the proposal, the
// trade-offs, the reason the question is being asked at all — never reaches
// them. So a question that leans on that prose reads to the owner as a bare
// prompt out of nowhere: the same #107 dialog went out three times, the owner
// answered «про что речь?» twice and finally sent a screenshot of what he was
// actually seeing.
//
// Two deterministic checks, both over `tool_input.questions[]`:
//   1. REPEAT — a header already asked in this session, re-sent without being
//      substantially expanded (< 2× the previous question length). Repeating an
//      unanswered question unchanged yields the same non-answer.
//   2. SELF-CONTAINMENT — a short question (< 120 chars) that leans on a bare
//      `#N` issue reference. The number is context the agent has and the owner
//      does not.
//
// Contract: stdin — JSON PreToolUse ({session_id, cwd, tool_name, tool_input}).
// exit 2 + stderr = BLOCK (same mechanics as agent-model-guard). exit 0 =
// allowed. FAIL-OPEN: broken stdin / unreadable payload → exit 0. State is
// updated ONLY on an allowed call, so a blocked question does not poison the
// baseline it is compared against.

import {
  ASKUSERQUESTION_STATE_DIR_REL,
  hooksDisabled,
  isDirectRun,
  mainRepoRoot,
  readHookPayload,
  readState,
  stateFilePath,
  writeState,
} from './shared.mjs'

/** A rewrite counts as a real rewrite only from this factor of the old length. */
export const REPEAT_EXPANSION_FACTOR = 2

/** Below this length a question cannot carry its own context. */
export const SELF_CONTAINED_MIN_LEN = 120

/** A bare issue/PR reference — meaningful to the agent, opaque to the owner. */
export const BARE_REF_RE = /#\d+/

export function repeatBlockMessage() {
  return (
    '⛔ askuserquestion guard (#91): the owner already received a question with this header and ' +
    'did not answer it. They see only the question+options text — repeating it unchanged yields ' +
    'the same non-answer. Rewrite the question to be self-contained (include the context you ' +
    'wrote between tool calls), or send it as a plain text message and ask on the next turn. ' +
    '(Retro 2026-08-05: the same #107 dialog was sent three times; the owner answered ' +
    '«про что речь?» twice and then sent a screenshot.)'
  )
}

export function bareRefBlockMessage() {
  return (
    '⛔ askuserquestion guard (#91): the question is shorter than ' +
    `${SELF_CONTAINED_MIN_LEN} characters and leans on a bare \`#N\` reference. The owner sees ` +
    'only the question+options text — an issue number is context you have and they do not. ' +
    'Expand the question so the reference is explained inside it: what the issue is about, what ' +
    'the choice actually is, and what each option means.'
  )
}

/** The per-header baseline map; anything unreadable degrades to empty. */
export function readHeaderLengths(state) {
  const h = state && state.headers
  return h && typeof h === 'object' ? h : {}
}

/**
 * Pure decision seam.
 *
 * Returns `{ block: false, state }` — where `state` is the next state to persist
 * — or `{ block: true, reason: 'repeat' | 'bare-ref', message }`. A payload that
 * cannot be read as a question list is allowed through untouched (fail-open).
 */
export function decideAskUserQuestion({ toolName, toolInput, state }) {
  if (!/^AskUserQuestion$/.test(toolName || '')) return { block: false, state: state || {} }
  const questions = toolInput && typeof toolInput === 'object' ? toolInput.questions : null
  if (!Array.isArray(questions)) return { block: false, state: state || {} }

  const seen = readHeaderLengths(state)
  const next = { ...seen }

  for (const item of questions) {
    if (!item || typeof item !== 'object') continue
    const question = typeof item.question === 'string' ? item.question : ''
    if (!question) continue
    const header = typeof item.header === 'string' ? item.header.trim() : ''

    const previous = header ? Number(seen[header]) : NaN
    if (Number.isFinite(previous) && previous > 0) {
      if (question.length < previous * REPEAT_EXPANSION_FACTOR) {
        return { block: true, reason: 'repeat', message: repeatBlockMessage() }
      }
    }

    if (question.length < SELF_CONTAINED_MIN_LEN && BARE_REF_RE.test(question)) {
      return { block: true, reason: 'bare-ref', message: bareRefBlockMessage() }
    }

    if (header) next[header] = question.length
  }

  return { block: false, state: { ...(state || {}), headers: next } }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const cwd = payload.cwd || ''
    const projectDir = mainRepoRoot(cwd)
    const statePath = stateFilePath(
      projectDir,
      ASKUSERQUESTION_STATE_DIR_REL,
      payload.session_id || '',
    )
    const decision = decideAskUserQuestion({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      state: readState(statePath),
    })
    if (decision.block) {
      process.stderr.write(decision.message)
      process.exit(2)
    }
    writeState(statePath, decision.state)
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить вопрос владельцу
  }
}

if (isDirectRun(import.meta.url)) main()
