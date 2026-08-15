#!/usr/bin/env node

import { recordWriteEvidence } from './codex-compat.mjs'
import { hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    recordWriteEvidence(readHookPayload())
  } catch {
    // Fail-open: missing state must not break a session or a tool call.
  }
  process.exit(0)
}

if (isDirectRun(import.meta.url)) main()
