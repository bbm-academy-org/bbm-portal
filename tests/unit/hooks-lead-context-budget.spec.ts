import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  HARD_THRESHOLD,
  OVERRIDE_REL,
  SOFT_THRESHOLD,
  TAIL_BYTES,
  decide,
  hardMessage,
  overrideActive,
  overrideMessage,
  overridePath,
  readTail,
  softMessage,
} from '../../tools/hooks/lead-context-budget.mjs'

/**
 * LEAD context budget (#457, ported from ds-platform `lead-context-budget.mjs`).
 * A PreToolUse guard on `Agent|Task` that acts ONLY for the lead (stdin carries
 * NO `agent_id`), measures the lead's own `transcript_path`, warns at
 * SOFT_THRESHOLD, DENIES a NEW dispatch at HARD_THRESHOLD, and is lifted —
 * loudly — by the `.claude/lead-budget-override` marker. Fail-open throughout.
 *
 * Unlike `context-budget.mjs` (operator advisory, `systemMessage` only), this
 * hook DOES address the model: it fires at the moment a new dispatch is asked
 * for, so nothing in flight is ever interrupted.
 */

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../tools/hooks/lead-context-budget.mjs',
)

const tempDirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** One transcript line whose assistant usage block sums to `contextTokens`. */
function usageLine(contextTokens: number): string {
  return `${JSON.stringify({
    type: 'assistant',
    message: {
      usage: {
        input_tokens: 0,
        cache_read_input_tokens: contextTokens,
        cache_creation_input_tokens: 0,
      },
    },
  })}\n`
}

/** A lead transcript reporting `contextTokens`. */
function leadTranscript(contextTokens: number): string {
  const path = join(tempDir('lead-ctx-'), 'sess-1.jsonl')
  writeFileSync(path, usageLine(contextTokens))
  return path
}

/** A throwaway project root, optionally carrying the override marker. */
function projectDir(withOverride: boolean): string {
  const dir = tempDir('lead-ctx-root-')
  if (withOverride) {
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(overridePath(dir), 'owner override\n')
  }
  return dir
}

function runRaw(input: string, extraEnv: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input,
    encoding: 'utf8',
    cwd: tmpdir(),
    env: { ...process.env, ...extraEnv },
  })
  return { status: res.status, stdout: (res.stdout ?? '').trim() }
}

function runHook(payload: Record<string, unknown>, extraEnv: Record<string, string> = {}) {
  return runRaw(JSON.stringify(payload), extraEnv)
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('lead-context-budget thresholds', () => {
  it('owner-decided constants (2026-09-03, #457): 150K soft / 160K hard', () => {
    expect(SOFT_THRESHOLD).toBe(150_000)
    expect(HARD_THRESHOLD).toBe(160_000)
  })

  it('the override marker is the documented repo-relative path', () => {
    expect(OVERRIDE_REL).toBe('.claude/lead-budget-override')
    // `resolve()` prefixes a drive letter on Windows — assert the suffix, so the
    // expectation holds on the Linux CI runner and locally alike.
    expect(overridePath('/repo').replace(/\\/g, '/')).toMatch(
      /\/repo\/\.claude\/lead-budget-override$/,
    )
  })
})

describe('lead-context-budget decide()', () => {
  it('below the soft cap → silent (override or not)', () => {
    expect(decide({ contextTokens: SOFT_THRESHOLD - 1, override: false }).action).toBe('silent')
    expect(decide({ contextTokens: 0, override: true }).action).toBe('silent')
  })

  it('soft band 150K–159K → soft warning', () => {
    for (const ctx of [150_000, 155_000, 159_999]) {
      expect(decide({ contextTokens: ctx, override: false }).action).toBe('soft')
    }
  })

  it('≥160K → deny', () => {
    for (const ctx of [160_000, 208_000, 325_000]) {
      expect(decide({ contextTokens: ctx, override: false }).action).toBe('deny')
    }
  })

  it('the override marker lifts BOTH tiers, loudly', () => {
    expect(decide({ contextTokens: 155_000, override: true }).action).toBe('override')
    expect(decide({ contextTokens: 325_000, override: true }).action).toBe('override')
  })

  it('a non-numeric context reads as 0 (fail-open)', () => {
    expect(decide({ contextTokens: Number.NaN, override: false }).action).toBe('silent')
    expect(decide({}).action).toBe('silent')
  })
})

describe('lead-context-budget overrideActive()', () => {
  it('true only when the marker file exists', () => {
    expect(overrideActive(projectDir(true))).toBe(true)
    expect(overrideActive(projectDir(false))).toBe(false)
  })

  it('an existsSync that throws reads as inactive (the hatch fails closed)', () => {
    expect(
      overrideActive('/repo', () => {
        throw new Error('io')
      }),
    ).toBe(false)
  })
})

describe('lead-context-budget readTail()', () => {
  it('returns only the tail of the file, not the whole of it', () => {
    const path = join(tempDir('lead-ctx-tail-'), 'big.jsonl')
    writeFileSync(path, `${'x'.repeat(5_000)}\nTAIL-MARKER\n`)
    const tail = readTail(path, 32)
    expect(tail.length).toBe(32)
    expect(tail).toContain('TAIL-MARKER')
    expect(tail).not.toContain('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  })

  it('a file shorter than the window comes back whole', () => {
    const path = join(tempDir('lead-ctx-tail-'), 'small.jsonl')
    writeFileSync(path, 'short\n')
    expect(readTail(path, TAIL_BYTES)).toBe('short\n')
  })
})

describe('lead-context-budget messages', () => {
  it('the soft warning names the measured size, the cap and the handoff', () => {
    const msg = softMessage(155_000)
    expect(msg).toContain('155K')
    expect(msg).toContain('150K')
    expect(msg).toContain('handoff-prompt')
    expect(msg).toContain('report-task-outcome')
  })

  it('the deny message names the size, the cap and the override hatch', () => {
    const msg = hardMessage(208_000)
    expect(msg).toContain('208K')
    expect(msg).toContain('160K')
    expect(msg).toContain(OVERRIDE_REL)
    expect(msg).toContain('handoff-prompt')
  })

  it('the override message announces the override rather than hiding it', () => {
    const msg = overrideMessage(325_000)
    expect(msg).toContain('325K')
    expect(msg).toContain('OVERRIDE')
    expect(msg).toContain(OVERRIDE_REL)
  })
})

describe('lead-context-budget end-to-end (real hook process)', () => {
  it('silent below the soft cap', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(90_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir(false) },
    )
    expect(res).toEqual({ status: 0, stdout: '' })
  })

  it('soft band → additionalContext warning WITHOUT a permissionDecision', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(155_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir(false) },
    )
    expect(res.status).toBe(0)
    const json = JSON.parse(res.stdout)
    expect(json.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(json.hookSpecificOutput.additionalContext).toContain('155K')
    expect(json.hookSpecificOutput.permissionDecision).toBeUndefined()
    expect(json.systemMessage).toContain('155K')
  })

  it('≥160K → deny with the handoff reason', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Task',
        tool_input: {},
        transcript_path: leadTranscript(208_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir(false) },
    )
    expect(res.status).toBe(0)
    const json = JSON.parse(res.stdout)
    expect(json.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(json.hookSpecificOutput.permissionDecisionReason).toContain('handoff-prompt')
    expect(json.systemMessage).toContain('208K')
  })

  it('the override marker turns the deny into a loud allow', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(208_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir(true) },
    )
    expect(res.status).toBe(0)
    const json = JSON.parse(res.stdout)
    expect(json.hookSpecificOutput.permissionDecision).toBeUndefined()
    expect(json.hookSpecificOutput.additionalContext).toContain('OVERRIDE')
  })

  it('a SUBAGENT dispatch (agent_id present) is silent even at 325K', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        agent_id: 'a1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(325_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir(false) },
    )
    expect(res).toEqual({ status: 0, stdout: '' })
  })

  it('the BBM_HOOKS_DISABLE kill switch silences it', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(325_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir(false), BBM_HOOKS_DISABLE: '1' },
    )
    expect(res).toEqual({ status: 0, stdout: '' })
  })

  it('fail-open: malformed stdin, no transcript path, missing transcript', () => {
    expect(runRaw('{not json')).toEqual({ status: 0, stdout: '' })
    expect(
      runHook(
        { session_id: 'sess-1', tool_name: 'Agent', tool_input: {} },
        { CLAUDE_PROJECT_DIR: projectDir(false) },
      ),
    ).toEqual({ status: 0, stdout: '' })
    expect(
      runHook(
        {
          session_id: 'sess-1',
          tool_name: 'Agent',
          tool_input: {},
          transcript_path: '/definitely/not/here.jsonl',
        },
        { CLAUDE_PROJECT_DIR: projectDir(false) },
      ),
    ).toEqual({ status: 0, stdout: '' })
  })
})
