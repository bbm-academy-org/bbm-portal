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
//   1. REPEAT — a header already asked in this session and STILL UNANSWERED,
//      re-sent without being substantially expanded (< 2× the FIRST-ask length).
//      Repeating an unanswered question unchanged yields the same non-answer.
//   2. SELF-CONTAINMENT — a short question (< 120 chars) that leans on a bare
//      `#N` issue reference. The number is context the agent has and the owner
//      does not.
//
// Two corrections from review PR #148 (refs #149), both about check 1:
//   * The baseline is the length of the FIRST ask under that header and is
//     NEVER moved by an allowed repeat. Storing "the previous length" ratcheted
//     the bar 150 → 300 → 600 and made a third, perfectly good rewrite illegal.
//   * "The owner did not answer" is now VERIFIED, not asserted: the PreToolUse
//     payload carries `transcript_path`, and an answered question leaves a
//     `The user answered:` tool_result line after the ask was recorded. An
//     answered header is cleared, so a genuinely new question that reuses the
//     header passes.
//
// Contract: stdin — JSON PreToolUse ({session_id, cwd, tool_name, tool_input,
// transcript_path}). exit 2 + stderr = BLOCK (same mechanics as
// agent-model-guard). exit 0 = allowed. FAIL-OPEN: broken stdin / unreadable
// payload / unreadable transcript → exit 0. State is updated ONLY on an allowed
// call, so a blocked question does not poison the baseline it is compared
// against.

import { readFileSync } from 'node:fs'

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

/** A rewrite counts as a real rewrite only from this factor of the BASELINE. */
export const REPEAT_EXPANSION_FACTOR = 2

/** Below this length a question cannot carry its own context. */
export const SELF_CONTAINED_MIN_LEN = 120

/**
 * A bare issue/PR reference — meaningful to the agent, opaque to the owner. The
 * trailing lookahead keeps hex colours out (review PR #148): `#4a90e2` used to
 * match as `#4`.
 */
export const BARE_REF_RE = /#\d+(?![0-9A-Za-z])/

/** The harness wording that records an answer coming back from the owner. */
export const OWNER_ANSWER_RE = /The user answered:/

/** How much of the stored question must reappear in the answer line to link it. */
export const ANSWER_PREFIX_LEN = 20

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

/**
 * The per-header record map (`{baseline, question, line}`); anything unreadable
 * degrades to empty. A pre-#149 numeric entry is read as a bare baseline.
 */
export function readHeaderRecords(state) {
  const raw = state && state.headers
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [header, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[header] = { baseline: value, question: '', line: 0 }
    } else if (value && typeof value === 'object' && Number.isFinite(Number(value.baseline))) {
      out[header] = {
        baseline: Number(value.baseline),
        question: typeof value.question === 'string' ? value.question : '',
        line: Number.isFinite(Number(value.line)) ? Number(value.line) : 0,
      }
    }
  }
  return out
}

/**
 * Did the owner answer THIS recorded ask? Only lines after the ask position
 * count, and the answer must name the header or carry a long enough prefix of
 * the stored question — otherwise an answer to a different dialog would clear
 * this one. Errs toward "answered", i.e. toward allowing the call.
 */
export function hasOwnerAnswer(lines, record) {
  const from = Math.max(0, Number(record.line) || 0)
  const prefix = String(record.question || '').slice(0, ANSWER_PREFIX_LEN)
  const header = String(record.header || '').trim()
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i]
    if (!OWNER_ANSWER_RE.test(line)) continue
    if (header && line.includes(header)) return true
    if (prefix.length >= ANSWER_PREFIX_LEN && line.includes(prefix)) return true
  }
  return false
}

/**
 * Pure decision seam.
 *
 * Returns `{ block: false, state }` — where `state` is the next state to persist
 * — or `{ block: true, reason: 'repeat' | 'bare-ref', message }`. A payload that
 * cannot be read as a question list is allowed through untouched (fail-open).
 *
 * `transcript` is the raw JSONL of this session; its line count doubles as the
 * position stamp of the ask being recorded, so "the answer came after the ask"
 * needs no clock.
 */
export function decideAskUserQuestion({ toolName, toolInput, state, transcript }) {
  if (!/^AskUserQuestion$/.test(toolName || '')) return { block: false, state: state || {} }
  const questions = toolInput && typeof toolInput === 'object' ? toolInput.questions : null
  if (!Array.isArray(questions)) return { block: false, state: state || {} }

  const lines = String(transcript || '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  const seen = readHeaderRecords(state)
  const next = { ...seen }

  for (const item of questions) {
    if (!item || typeof item !== 'object') continue
    const question = typeof item.question === 'string' ? item.question : ''
    if (!question) continue
    const header = typeof item.header === 'string' ? item.header.trim() : ''

    // Разрешённый повтор оставляет baseline НЕТРОНУТЫМ — иначе следующая
    // переписка потребует 4×, потом 8× (храповик, ревью PR #148).
    let keepBaseline = false
    const previous = header ? seen[header] : null
    if (previous && previous.baseline > 0) {
      if (hasOwnerAnswer(lines, { ...previous, header })) {
        // Отвеченный вопрос закрыт: header освобождается, текущий становится
        // первым под ним — иначе новый вопрос платил бы за старый диалог.
        delete next[header]
      } else if (question.length < previous.baseline * REPEAT_EXPANSION_FACTOR) {
        return { block: true, reason: 'repeat', message: repeatBlockMessage() }
      } else {
        keepBaseline = true
      }
    }

    if (question.length < SELF_CONTAINED_MIN_LEN && BARE_REF_RE.test(question)) {
      return { block: true, reason: 'bare-ref', message: bareRefBlockMessage() }
    }

    if (header && !keepBaseline) {
      next[header] = { baseline: question.length, question, line: lines.length }
    }
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
    let transcript = ''
    try {
      if (payload.transcript_path) transcript = readFileSync(payload.transcript_path, 'utf8')
    } catch {
      // fail-open: нечитаемый транскрипт значит «ответа не видно» — а без него
      // повтор просто сравнивается по длине, как раньше.
    }
    const decision = decideAskUserQuestion({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      state: readState(statePath),
      transcript,
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
