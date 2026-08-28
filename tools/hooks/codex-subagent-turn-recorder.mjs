#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  CODEX_EXECUTOR_TURN_DIR_REL,
  ZERO_DISPATCH_STATE_DIR_REL,
  hooksDisabled,
  isDirectRun,
  mainRepoRoot,
  readState,
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

function recordSuccessfulDispatch(payload, root, deps = {}) {
  const sessionId = String((payload && payload.session_id) || '').trim()
  if (!sessionId) return false
  const path = stateFilePath(root, ZERO_DISPATCH_STATE_DIR_REL, sessionId)
  const read = deps.readState || readState
  const current = read(path)
  const persist = deps.writeState || writeState
  persist(path, {
    ...current,
    mutations: 0,
    dispatched: true,
    bypassUsed: [],
    subagent: false,
  })
  return true
}

function clearSessionExecutorTurns(payload, root, deps = {}) {
  const sessionId = String((payload && payload.session_id) || '').trim()
  if (!sessionId) return false
  const directory = resolve(root, CODEX_EXECUTOR_TURN_DIR_REL)
  const list = deps.list || ((target) => readdirSync(target))
  const read = deps.readFile || ((target) => readFileSync(target, 'utf8'))
  const remove = deps.remove || ((target) => rmSync(target, { force: true }))

  let names
  try {
    names = list(directory)
  } catch {
    return true
  }
  for (const name of names) {
    const target = resolve(directory, String(name))
    try {
      const marker = JSON.parse(read(target))
      if (marker && marker.sessionId === sessionId) remove(target)
    } catch {
      // Unreadable exact-turn markers keep their fail-open executor polarity.
    }
  }
  return true
}

export function recordCodexSubagentTurn(payload, deps = {}) {
  try {
    const event = String((payload && payload.hook_event_name) || '')
    if (!['SessionEnd', 'SubagentStart', 'SubagentStop'].includes(event)) return false
    const cwd = String((payload && payload.cwd) || '').trim()
    if (!cwd) return false
    const root = deps.root || (deps.mainRepoRoot || mainRepoRoot)(cwd)
    if (!root) return false

    if (event === 'SessionEnd') return clearSessionExecutorTurns(payload, root, deps)

    const path = executorTurnPath(payload, { ...deps, root })
    if (!path) return false

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
      recordSuccessfulDispatch(payload, root, deps)
      return true
    }

    // Another matching SubagentStop hook can continue this exact child turn.
    // SessionEnd is the first lifecycle event that proves its session is terminal.
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
