import { describe, expect, it } from 'vitest'

import {
  decideReminder,
  isHandoffPrompt,
  reminderOutput,
} from '../../tools/hooks/handoff-verify-reminder.mjs'

/**
 * The UserPromptSubmit reminder (#134) is WARN-only: its whole job is to fire on
 * a handoff-shaped prompt and stay silent on everything else. A false positive
 * costs a noisy banner on every ordinary prompt, so the shape recogniser is the
 * part worth pinning.
 */

const SENTINEL = 'You are continuing a previous Claude Code session that ran out of context.'

describe('handoff shape recogniser', () => {
  it('fires on the continuation sentinel sentence', () => {
    expect(isHandoffPrompt(`${SENTINEL}\nДальше по задаче #134.`)).toBe(true)
  })

  it('fires on the header PAIR of a /handoff-prompt block (EN and RU)', () => {
    expect(isHandoffPrompt('## Current task\nбла\n## Where we stopped\nбла')).toBe(true)
    expect(isHandoffPrompt('## Текущая задача\nбла\n## Где остановились\nбла')).toBe(true)
  })

  it('stays silent on a single header — quoting one README section is not a handoff', () => {
    expect(isHandoffPrompt('## Current task\nописание задачи')).toBe(false)
    expect(isHandoffPrompt('## Where we stopped')).toBe(false)
  })

  it('stays silent on an ordinary prompt and on an empty one', () => {
    expect(isHandoffPrompt('посмотри бэклог и предложи следующую задачу')).toBe(false)
    expect(isHandoffPrompt('')).toBe(false)
    expect(isHandoffPrompt(undefined)).toBe(false)
  })
})

describe('reminder payload', () => {
  it('names the command and insists on the VERBATIM text', () => {
    const out = reminderOutput()
    expect(out.systemMessage).toContain('pnpm handoff:verify')
    expect(out.hookSpecificOutput.additionalContext).toContain('VERBATIM')
    expect(out.hookSpecificOutput.additionalContext).toContain('pnpm handoff:verify')
  })

  it('declares the event it answers, so the harness attaches the context', () => {
    expect(reminderOutput().hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
  })

  it('is WARN-only — no permission decision, nothing that could block a prompt', () => {
    const out = JSON.parse(JSON.stringify(reminderOutput()))
    expect(Object.keys(out).sort()).toEqual(['hookSpecificOutput', 'systemMessage'])
    expect(JSON.stringify(out)).not.toContain('permissionDecision')
  })
})

describe('decision seam', () => {
  it('returns the serialized payload for a handoff-shaped prompt', () => {
    const out = decideReminder({ prompt: SENTINEL })
    expect(out).not.toBeNull()
    expect(JSON.parse(out as string).hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
  })

  it('returns null (silence) for an ordinary prompt and for a broken payload', () => {
    expect(decideReminder({ prompt: 'сделай ревью PR #148' })).toBeNull()
    expect(decideReminder({} as { prompt?: string })).toBeNull()
    expect(decideReminder(null)).toBeNull()
  })
})
