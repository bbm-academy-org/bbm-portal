import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DISPATCH_WARN_THRESHOLD,
  decideDispatch,
  dispatchStateKey,
  readWarned,
} from '../../tools/hooks/dispatch-guard.mjs'

/**
 * dispatch-guard one-WARN-per-session latch (#594; ported from ds-platform
 * `#1700`): the drift signal is said once, then the streak keeps counting
 * silently. Before the latch it fired on EVERY mutation past the threshold.
 */

const MAIN = 'C:/Users/sidor/repos/bbm-portal'
const main = { cwd: MAIN, projectDir: MAIN }

describe('decideDispatch — the latch', () => {
  it('warns at the threshold when not yet warned this session', () => {
    expect(
      decideDispatch({ ...main, toolName: 'Edit', streak: DISPATCH_WARN_THRESHOLD - 1 }),
    ).toEqual({ action: 'warn', streak: DISPATCH_WARN_THRESHOLD })
  })

  it('only counts past the threshold once the session was warned', () => {
    expect(decideDispatch({ ...main, toolName: 'Edit', streak: 7, warned: true })).toEqual({
      action: 'count',
      streak: 8,
    })
  })

  it('an Agent dispatch still resets the streak', () => {
    expect(decideDispatch({ ...main, toolName: 'Agent', streak: 9, warned: true })).toEqual({
      action: 'reset',
      streak: 0,
    })
  })

  it('a missing or corrupt latch reads as not warned (fail-open)', () => {
    expect(readWarned({})).toBe(false)
    expect(readWarned({ warned: 'yes' })).toBe(false)
    expect(readWarned({ warned: true })).toBe(true)
  })
})

describe('dispatchStateKey — per actor', () => {
  it('the lead keys by session; a subagent sharing the session gets its own key', () => {
    expect(dispatchStateKey({ session_id: 's1' })).toBe('s1')
    expect(dispatchStateKey({ session_id: 's1', agent_id: 'a9' })).toBe('s1--agent-a9')
    expect(dispatchStateKey({})).toBe('')
  })

  // ds `actorIdentity`: a Codex subagent shares the lead's `session_id` and
  // carries no `agent_id`; only its `transcript_path` tells it apart.
  it('a different transcript under the same session is a different actor', () => {
    const lead = dispatchStateKey({ session_id: 's1', transcript_path: 'C:/t/lead.jsonl' })
    const sub = dispatchStateKey({ session_id: 's1', transcript_path: 'C:/t/sub.jsonl' })
    expect(lead).not.toBe(sub)
    expect(lead.startsWith('s1')).toBe(true)
    expect(dispatchStateKey({ session_id: 's1', transcript_path: 'C:/t/lead.jsonl' })).toBe(lead)
    expect(lead).toMatch(/^[A-Za-z0-9._-]+$/)
  })
})

describe('dispatch-guard as a process', { timeout: 60_000 }, () => {
  const HOOK = resolve(import.meta.dirname, '..', '..', 'tools', 'hooks', 'dispatch-guard.mjs')
  let root = ''
  beforeAll(() => {
    // Not a git tree: the guard's state root falls back to CLAUDE_PROJECT_DIR,
    // so nothing lands in the real checkout's `.claude/dispatch-guard-state`.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'bbm-dispatch-latch-')))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const call = (tool_name: string, extra: Record<string, unknown> = {}) => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        session_id: 'latch-spec',
        cwd: root,
        tool_name,
        tool_input: { file_path: join(root, 'a.ts'), prompt: 'x' },
        ...extra,
      }),
      encoding: 'utf8',
      cwd: root,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        BBM_HOOKS_DISABLE: '',
        BBM_DISPATCH_GUARD_DISABLE: '',
      },
    })
    expect(r.status).toBe(0)
    return r.stdout.includes('dispatch guard') ? 1 : 0
  }

  it('a session with 10 edits past the threshold gets exactly one warning', () => {
    let warnings = 0
    for (let i = 0; i < DISPATCH_WARN_THRESHOLD + 10; i += 1) warnings += call('Edit')
    expect(warnings).toBe(1)
    // The latch survives the reset: a dispatch and a new streak say nothing more.
    call('Agent')
    for (let i = 0; i < DISPATCH_WARN_THRESHOLD + 2; i += 1) warnings += call('Write')
    expect(warnings).toBe(1)
  })

  it('a subagent`s edits do not spend the lead`s warning', () => {
    let sub = 0
    for (let i = 0; i < DISPATCH_WARN_THRESHOLD; i += 1) {
      sub += call('Edit', { session_id: 'latch-actor', agent_id: 'ag-1' })
    }
    expect(sub).toBe(1)
    let lead = 0
    for (let i = 0; i < DISPATCH_WARN_THRESHOLD; i += 1) {
      lead += call('Edit', { session_id: 'latch-actor' })
    }
    expect(lead).toBe(1)
  })

  it('a Codex subagent (same session, own transcript, no agent_id) keeps its own latch', () => {
    const as = (transcript_path: string) => ({ session_id: 'latch-codex', transcript_path })
    let sub = 0
    for (let i = 0; i < DISPATCH_WARN_THRESHOLD; i += 1) sub += call('Edit', as('C:/t/sub.jsonl'))
    expect(sub).toBe(1)
    let lead = 0
    for (let i = 0; i < DISPATCH_WARN_THRESHOLD; i += 1) lead += call('Edit', as('C:/t/lead.jsonl'))
    expect(lead).toBe(1)
  })
})
