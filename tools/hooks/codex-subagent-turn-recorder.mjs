#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from 'node:fs'

import {
  CODEX_EXECUTOR_TURN_DIR_REL,
  hooksDisabled,
  isDirectRun,
  mainRepoRoot,
  readHookPayload,
  stateFilePath,
  writeState,
} from './shared.mjs'

function turnKey(payload) {
  const sessionId = String((payload && payload.session_id) || '').trim()
  const turnId = String((payload && payload.turn_id) || '').trim()
  return sessionId && turnId ? `${sessionId}--${turnId}` : ''
}

export function executorTurnPath(payload, deps = {}) {
  try {
    const key = turnKey(payload)
    const cwd = String((payload && payload.cwd) || '').trim()
    if (!key || !cwd) return null
    const root = deps.root || (deps.mainRepoRoot || mainRepoRoot)(cwd)
    return root ? stateFilePath(root, CODEX_EXECUTOR_TURN_DIR_REL, key) : null
  } catch {
    return null
  }
}

export function recordCodexSubagentTurn(payload, deps = {}) {
  try {
    const event = String((payload && payload.hook_event_name) || '')
    const path = executorTurnPath(payload, deps)
    if (!path || !['SubagentStart', 'SubagentStop'].includes(event)) return false

    if (event === 'SubagentStart') {
      const agentId = String(payload.agent_id || '').trim()
      const agentType = String(payload.agent_type || '').trim()
      if (!agentId || !agentType) return false
      const persist = deps.writeState || writeState
      persist(path, {
        active: true,
        agentId,
        agentType,
        sessionId: String(payload.session_id),
        turnId: String(payload.turn_id),
      })
      return true
    }

    const remove = deps.remove || ((target) => rmSync(target, { force: true }))
    remove(path)
    return true
  } catch {
    return false
  }
}

export function isCodexExecutorTurn(payload, deps = {}) {
  const path = executorTurnPath(payload, deps)
  if (!path) return false
  try {
    if (!(deps.exists || existsSync)(path)) return false
  } catch {
    return true
  }

  try {
    const state = JSON.parse((deps.readFile || ((target) => readFileSync(target, 'utf8')))(path))
    return Boolean(
      state &&
      state.active === true &&
      state.sessionId === String(payload.session_id) &&
      state.turnId === String(payload.turn_id),
    )
  } catch {
    // A marker can only be created by SubagentStart. If it becomes unreadable,
    // fail toward exempting that exact turn instead of false-blocking an executor.
    return true
  }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    recordCodexSubagentTurn(payload)
    process.stdout.write('{}')
    process.exit(0)
  } catch {
    process.exit(0)
  }
}

if (isDirectRun(import.meta.url)) main()
