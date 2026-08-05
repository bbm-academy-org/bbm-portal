import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  WARN_THRESHOLD,
  WRAP_THRESHOLD,
  decideContextBudget,
  lastAssistantContextTokens,
} from '../../tools/hooks/context-budget.mjs'

/**
 * Context-budget advisory (#134). The hook only ever speaks to the OPERATOR:
 * `systemMessage`, never `additionalContext`. That boundary is the whole point —
 * an instruction aimed at the model makes it abandon in-flight work mid-task,
 * so the decision to /wrap has to stay with the human reading the line.
 */

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/hooks')

function assistantLine(usage: Record<string, number>) {
  return JSON.stringify({ type: 'assistant', message: { usage } })
}

const USER_LINE = JSON.stringify({ type: 'user', message: { content: 'дальше' } })

describe('lastAssistantContextTokens', () => {
  it('sums input + cache-read + cache-creation of the LAST assistant message', () => {
    const transcript = [
      assistantLine({ input_tokens: 10, cache_read_input_tokens: 20 }),
      assistantLine({
        input_tokens: 1_000,
        cache_read_input_tokens: 100_000,
        cache_creation_input_tokens: 500,
      }),
      USER_LINE,
    ].join('\n')
    expect(lastAssistantContextTokens(transcript)).toBe(101_500)
  })

  it('missing usage fields count as zero', () => {
    expect(lastAssistantContextTokens(assistantLine({ input_tokens: 42 }))).toBe(42)
  })

  it('skips blank and unparseable lines instead of failing', () => {
    const transcript = ['', 'не JSON', assistantLine({ input_tokens: 7 }), '   '].join('\n')
    expect(lastAssistantContextTokens(transcript)).toBe(7)
  })

  it('a transcript without assistant usage yields 0 — the hook stays silent', () => {
    expect(lastAssistantContextTokens(`${USER_LINE}\n${USER_LINE}`)).toBe(0)
    expect(lastAssistantContextTokens('')).toBe(0)
    expect(lastAssistantContextTokens(undefined as unknown as string)).toBe(0)
  })
})

describe('decideContextBudget', () => {
  it('is silent below the first tier', () => {
    expect(decideContextBudget(0).tier).toBe('none')
    expect(decideContextBudget(WARN_THRESHOLD - 1).tier).toBe('none')
  })

  it('warns from the approach threshold and names the number', () => {
    const d = decideContextBudget(WARN_THRESHOLD)
    expect(d.tier).toBe('warn')
    expect(d.message).toContain('≈110K')
    expect(d.message).toContain('120K')
  })

  it('calls for /wrap from the wrap threshold', () => {
    const d = decideContextBudget(WRAP_THRESHOLD + 5_400)
    expect(d.tier).toBe('wrap')
    expect(d.message).toContain('≈125K')
    expect(d.message).toContain('/wrap')
  })

  it('advisory wording only — the call stays with the operator', () => {
    expect(decideContextBudget(WRAP_THRESHOLD).message).toMatch(/advisory only/i)
  })

  it('garbage input degrades to silence, not to a throw', () => {
    expect(decideContextBudget(NaN).tier).toBe('none')
    expect(decideContextBudget(undefined as unknown as number).tier).toBe('none')
  })
})

function runHook(input: string, extraEnv: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [resolve(HOOKS_DIR, 'context-budget.mjs')], {
    input,
    encoding: 'utf8',
    cwd: tmpdir(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...extraEnv },
  })
  return { status: res.status, stdout: res.stdout ?? '' }
}

describe('context-budget as a process', () => {
  const transcriptPath = resolve(mkdtempSync(resolve(tmpdir(), 'ctx-budget-')), 'transcript.jsonl')
  writeFileSync(
    transcriptPath,
    `${USER_LINE}\n${assistantLine({ input_tokens: 5_000, cache_read_input_tokens: 125_000 })}\n`,
  )

  it('emits a systemMessage advisory and NEVER additionalContext', () => {
    const res = runHook(JSON.stringify({ transcript_path: transcriptPath }))
    expect(res.status).toBe(0)
    const out = JSON.parse(res.stdout)
    expect(out.systemMessage).toContain('context budget')
    expect(out.hookSpecificOutput).toBeUndefined()
    expect(res.stdout).not.toContain('additionalContext')
  })

  it('the BBM_HOOKS_DISABLE kill switch silences it', () => {
    const res = runHook(JSON.stringify({ transcript_path: transcriptPath }), {
      BBM_HOOKS_DISABLE: '1',
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
  })

  it('fail-open: garbage stdin and a missing transcript exit 0 without output', () => {
    expect(runHook('{ это не JSON')).toEqual({ status: 0, stdout: '' })
    expect(runHook(JSON.stringify({ transcript_path: '/no/such/file.jsonl' }))).toEqual({
      status: 0,
      stdout: '',
    })
    expect(runHook(JSON.stringify({}))).toEqual({ status: 0, stdout: '' })
  })
})
