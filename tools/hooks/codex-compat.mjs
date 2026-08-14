#!/usr/bin/env node

import { readFileSync } from 'node:fs'

import {
  extractLastAssistantText,
  hasWriteAction,
  isWriteToolUse,
} from './completion-report-gate.mjs'
import { HALT_RE, detectHaltSignal } from './deviations-gate.mjs'
import {
  CODEX_WRITE_STATE_DIR_REL,
  applyPatchPaths,
  mainRepoRoot,
  normalizeHookPayload,
  readState,
  stateFilePath,
  writeState,
} from './shared.mjs'

export { applyPatchPaths, normalizeHookPayload }

/** One stable PostToolUse payload is enough evidence that this session wrote. */
export function writeEvidenceForPayload(payload) {
  try {
    const normalized = normalizeHookPayload(payload)
    return Boolean(normalized && isWriteToolUse(normalized.tool_name, normalized.tool_input || {}))
  } catch {
    return false
  }
}

export function writeEvidencePath(payload, deps = {}) {
  const sessionId = payload && payload.session_id
  const cwd = (payload && payload.cwd) || process.cwd()
  if (!sessionId || !cwd) return null
  const root = (deps.mainRepoRoot || mainRepoRoot)(cwd)
  if (!root) return null
  return stateFilePath(root, CODEX_WRITE_STATE_DIR_REL, sessionId)
}

/**
 * SessionStart resets evidence; PostToolUse only ever promotes it to true.
 * Best-effort state follows the hook stack's fail-open contract.
 */
export function recordWriteEvidence(payload, deps = {}) {
  try {
    const path = writeEvidencePath(payload, deps)
    if (!path) return false
    if (payload.hook_event_name === 'SessionStart') {
      // Codex emits SessionStart again for resume/compaction. Resetting there
      // would erase an earlier write and let the final Stop look read-only.
      // Missing source is preserved too: session ids are unique, while a false
      // reset would disable critical completion enforcement.
      if (!['startup', 'clear'].includes(String(payload.source || ''))) return false
      const reset = deps.writeState || writeState
      reset(path, { writeActionSeen: false, haltSignal: false })
      return false
    }
    if (payload.hook_event_name === 'UserPromptSubmit') {
      if (!HALT_RE.test(String(payload.prompt || ''))) return false
      const read = deps.readState || readState
      const state = read(path)
      if (state.haltSignal) return true
      const write = deps.writeState || writeState
      write(path, { ...state, haltSignal: true })
      return true
    }
    if (payload.hook_event_name !== 'PostToolUse' || !writeEvidenceForPayload(payload)) return false
    const read = deps.readState || readState
    const write = deps.writeState || writeState
    write(path, { ...read(path), writeActionSeen: true })
    return true
  } catch {
    return false
  }
}

export function readSessionEvidence(payload, deps = {}) {
  try {
    const path = writeEvidencePath(payload, deps)
    const state = path ? (deps.readState || readState)(path) : {}
    return {
      haltSignal: Boolean(state.haltSignal),
      writeActionSeen: Boolean(state.writeActionSeen),
    }
  } catch {
    return { haltSignal: false, writeActionSeen: false }
  }
}

export function readWriteEvidence(payload, deps = {}) {
  return readSessionEvidence(payload, deps).writeActionSeen
}

/**
 * Codex exposes the final message directly. Its transcript format is explicitly
 * unstable, so transcript parsing remains only a Claude fallback and halt hint;
 * write enforcement uses the stable PostToolUse state above.
 */
export function readStopContext(payload, deps = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const directAssistantText =
    typeof source.last_assistant_message === 'string' ? source.last_assistant_message : null
  let transcript = ''
  if (directAssistantText == null && source.transcript_path) {
    try {
      transcript = (deps.readTranscript || ((path) => readFileSync(path, 'utf8')))(
        source.transcript_path,
      )
    } catch {
      transcript = ''
    }
  }

  let evidence = { haltSignal: false, writeActionSeen: false }
  try {
    if (deps.readSessionEvidence) {
      const state = deps.readSessionEvidence(source) || {}
      evidence = {
        haltSignal: Boolean(state.haltSignal),
        writeActionSeen: Boolean(state.writeActionSeen),
      }
    } else if (deps.readWriteEvidence || deps.readHaltEvidence) {
      evidence = {
        haltSignal: Boolean(deps.readHaltEvidence && deps.readHaltEvidence(source)),
        writeActionSeen: Boolean(deps.readWriteEvidence && deps.readWriteEvidence(source)),
      }
    } else {
      evidence = readSessionEvidence(source, deps)
    }
  } catch {
    evidence = { haltSignal: false, writeActionSeen: false }
  }

  return {
    haltSignal: evidence.haltSignal || (transcript ? detectHaltSignal(transcript) : false),
    lastAssistantText: directAssistantText ?? extractLastAssistantText(transcript),
    writeActionSeen: evidence.writeActionSeen || hasWriteAction(transcript),
  }
}
