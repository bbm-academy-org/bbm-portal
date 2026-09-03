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
  overrideMessage,
  overridePath,
  projectRoot,
  readOverride,
  readTail,
  softMessage,
} from '../../tools/hooks/lead-context-budget.mjs'

/**
 * LEAD context budget (#457, ported from ds-platform `lead-context-budget.mjs`).
 * A PreToolUse guard on `Agent|Task` that acts ONLY for the lead (stdin carries
 * NO `agent_id`), measures the lead's own `transcript_path`, warns at
 * SOFT_THRESHOLD, DENIES a NEW dispatch at HARD_THRESHOLD, and is lifted —
 * loudly, and only with a written reason — by the `.claude/lead-budget-override`
 * marker. Fail-open throughout.
 *
 * Unlike `context-budget.mjs` (operator advisory, `systemMessage` only), this
 * hook DOES address the model: it fires at the moment a new dispatch is asked
 * for, so nothing in flight is ever interrupted.
 */

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../tools/hooks/lead-context-budget.mjs',
)

/** This spec file lives in `<repo>/tests/unit`, so the repo (or worktree) root. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

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

/**
 * A throwaway project root. `overrideReason` writes the marker with that text;
 * `''` writes a REASONLESS marker (whitespace only), `null` writes none.
 */
function projectDir(overrideReason: string | null = null): string {
  const dir = tempDir('lead-ctx-root-')
  if (overrideReason !== null) {
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(overridePath(dir), overrideReason === '' ? '  \n' : `${overrideReason}\n`)
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
  return {
    status: res.status,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  }
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

  it('an override WITH a reason lifts both tiers, loudly', () => {
    expect(decide({ contextTokens: 155_000, override: true }).action).toBe('override')
    expect(decide({ contextTokens: 325_000, override: true }).action).toBe('override')
  })

  it('a REASONLESS marker is not an override — the tiers still apply', () => {
    expect(
      decide({ contextTokens: 325_000, override: false, overrideReasonless: true }).action,
    ).toBe('deny')
    expect(
      decide({ contextTokens: 155_000, override: false, overrideReasonless: true }).action,
    ).toBe('soft')
    expect(
      decide({ contextTokens: 325_000, override: false, overrideReasonless: true }).reasonless,
    ).toBe(true)
  })

  it('a non-numeric context reads as 0 (fail-open)', () => {
    expect(decide({ contextTokens: Number.NaN, override: false }).action).toBe('silent')
    expect(decide({}).action).toBe('silent')
  })
})

describe('lead-context-budget readOverride()', () => {
  it('a marker carrying a reason is an active override, reason trimmed', () => {
    const o = readOverride(projectDir('релиз доводим сегодня, владелец'))
    expect(o.active).toBe(true)
    expect(o.reasonless).toBe(false)
    expect(o.reason).toBe('релиз доводим сегодня, владелец')
  })

  it('a REASONLESS marker is present but inactive — clause (d) demands a reason', () => {
    const o = readOverride(projectDir(''))
    expect(o.active).toBe(false)
    expect(o.reasonless).toBe(true)
  })

  it('no marker at all — neither active nor reasonless', () => {
    const o = readOverride(projectDir(null))
    expect(o.active).toBe(false)
    expect(o.reasonless).toBe(false)
  })

  it('a reader that throws reads as inactive (the hatch fails closed)', () => {
    const o = readOverride('/repo', () => {
      throw new Error('io')
    })
    expect(o.active).toBe(false)
    expect(o.reasonless).toBe(false)
  })

  it('only the first line of the marker is taken as the reason', () => {
    const o = readOverride(projectDir('одна причина\nвторая строка'))
    expect(o.reason).toBe('одна причина')
  })
})

describe('lead-context-budget projectRoot()', () => {
  it('resolves the MAIN checkout, not the session project dir, when git can answer', () => {
    // `CLAUDE_PROJECT_DIR` names the SESSION's project dir — in a worktree
    // session that is the worktree. The marker is owner state for the whole
    // repo, so the main tree wins whenever git can name it.
    const bogus = projectDir(null)
    const previous = process.env.CLAUDE_PROJECT_DIR
    process.env.CLAUDE_PROJECT_DIR = bogus
    try {
      const root = projectRoot({ cwd: REPO_ROOT }).replace(/\\/g, '/')
      expect(root).not.toBe(bogus.replace(/\\/g, '/'))
      // In a worktree the main tree is a prefix of it; in a plain checkout they
      // are the same path. Both satisfy this.
      expect(REPO_ROOT.replace(/\\/g, '/').toLowerCase()).toContain(root.toLowerCase())
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_PROJECT_DIR
      else process.env.CLAUDE_PROJECT_DIR = previous
    }
  })

  it('falls back to CLAUDE_PROJECT_DIR when the cwd is not a git tree at all', () => {
    const fallback = projectDir(null)
    const previous = process.env.CLAUDE_PROJECT_DIR
    process.env.CLAUDE_PROJECT_DIR = fallback
    try {
      expect(projectRoot({ cwd: tempDir('lead-ctx-nogit-') })).toBe(fallback)
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_PROJECT_DIR
      else process.env.CLAUDE_PROJECT_DIR = previous
    }
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

  it('a reasonless marker is called out by name in the tier message', () => {
    expect(hardMessage(208_000, { reasonless: true })).toMatch(/без причины|БЕЗ причины/)
    expect(softMessage(155_000, { reasonless: true })).toMatch(/без причины|БЕЗ причины/)
  })

  it('the override message announces the override, quotes the reason, and names /wrap', () => {
    const msg = overrideMessage(325_000, 'владелец: доводим релиз')
    expect(msg).toContain('325K')
    expect(msg).toContain('OVERRIDE')
    expect(msg).toContain(OVERRIDE_REL)
    expect(msg).toContain('владелец: доводим релиз')
    expect(msg).toContain('/wrap')
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
      { CLAUDE_PROJECT_DIR: projectDir(null) },
    )
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
  })

  it('soft band → additionalContext warning WITHOUT a permissionDecision', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(155_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir(null) },
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
      { CLAUDE_PROJECT_DIR: projectDir(null) },
    )
    expect(res.status).toBe(0)
    const json = JSON.parse(res.stdout)
    expect(json.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(json.hookSpecificOutput.permissionDecisionReason).toContain('handoff-prompt')
    expect(json.systemMessage).toContain('208K')
  })

  it('a truncated first line in the tail is skipped, not fatal', () => {
    const path = join(tempDir('lead-ctx-partial-'), 'sess-1.jsonl')
    writeFileSync(path, `PARTIAL{"type":"assis\n${usageLine(208_000)}`)
    const res = runHook(
      { session_id: 'sess-1', tool_name: 'Agent', tool_input: {}, transcript_path: path },
      { CLAUDE_PROJECT_DIR: projectDir(null) },
    )
    expect(res.status).toBe(0)
    expect(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('a REASONED override marker turns the deny into a loud allow and logs the reason', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(208_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir('владелец: доводим релиз') },
    )
    expect(res.status).toBe(0)
    const json = JSON.parse(res.stdout)
    expect(json.hookSpecificOutput.permissionDecision).toBeUndefined()
    expect(json.hookSpecificOutput.additionalContext).toContain('OVERRIDE')
    expect(json.hookSpecificOutput.additionalContext).toContain('владелец: доводим релиз')
    // The reason has to land in the SESSION LOG, not only in the model's
    // context — §3 class-3 clause (d).
    expect(res.stderr).toContain('владелец: доводим релиз')
  })

  it('a REASONLESS marker does NOT lift the deny, and the message says why', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(208_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir('') },
    )
    expect(res.status).toBe(0)
    const json = JSON.parse(res.stdout)
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/без причины|БЕЗ причины/)
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
      { CLAUDE_PROJECT_DIR: projectDir(null) },
    )
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
  })

  it('the BBM_HOOKS_DISABLE kill switch silences it', () => {
    const res = runHook(
      {
        session_id: 'sess-1',
        tool_name: 'Agent',
        tool_input: {},
        transcript_path: leadTranscript(325_000),
      },
      { CLAUDE_PROJECT_DIR: projectDir(null), BBM_HOOKS_DISABLE: '1' },
    )
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
  })

  it('fail-open: malformed stdin, no transcript path, missing transcript', () => {
    expect(runRaw('{not json').stdout).toBe('')
    expect(
      runHook(
        { session_id: 'sess-1', tool_name: 'Agent', tool_input: {} },
        { CLAUDE_PROJECT_DIR: projectDir(null) },
      ).stdout,
    ).toBe('')
    expect(
      runHook(
        {
          session_id: 'sess-1',
          tool_name: 'Agent',
          tool_input: {},
          transcript_path: '/definitely/not/here.jsonl',
        },
        { CLAUDE_PROJECT_DIR: projectDir(null) },
      ).stdout,
    ).toBe('')
  })
})
