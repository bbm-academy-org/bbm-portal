#!/usr/bin/env node

import {
  blockMessage as completionBlockMessage,
  decideBlock as decideCompletionBlock,
} from './completion-report-gate.mjs'
import { readStopContext } from './codex-compat.mjs'
import {
  blockMessage as deviationsBlockMessage,
  decideBlock as decideDeviationsBlock,
  selfCertBlockMessage,
} from './deviations-gate.mjs'
import { decideWarn, warnMessage as debtWarnMessage } from './surface-decision-debt-gate.mjs'
import { emitWarn, hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

export function decideCodexStop(mode, payload, deps = {}) {
  const context = readStopContext(payload, deps)
  const common = {
    stopHookActive: Boolean(payload && payload.stop_hook_active),
    lastAssistantText: context.lastAssistantText,
    writeActionSeen: context.writeActionSeen,
  }
  if (mode === 'completion') return decideCompletionBlock(common)
  if (mode === 'deviations') {
    return decideDeviationsBlock({ ...common, haltSignal: context.haltSignal })
  }
  if (mode === 'debt') return decideWarn(common)
  return { block: false, warn: false }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const mode = process.argv[2] || ''
    const payload = readHookPayload() || {}
    if (payload.stop_hook_active) process.exit(0)
    const decision = decideCodexStop(mode, payload)
    if (mode === 'completion' && decision.block) {
      process.stderr.write(completionBlockMessage())
      process.exit(2)
    }
    if (mode === 'deviations' && decision.block) {
      process.stderr.write(
        decision.reason === 'self-cert' ? selfCertBlockMessage() : deviationsBlockMessage(),
      )
      process.exit(2)
    }
    if (mode === 'debt' && decision.warn) emitWarn(debtWarnMessage())
  } catch {
    // Fail-open: a compatibility adapter must not make Stop less reliable.
  }
  process.exit(0)
}

if (isDirectRun(import.meta.url)) main()
