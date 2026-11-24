import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  HARD_THRESHOLD,
  SOFT_REPEAT_STEP,
  SOFT_THRESHOLD,
  STATE_DIR_REL,
  checkpointPath,
  decide,
  hardMessage,
  isAllowedUnderHardCap,
  readCadence,
  resolveSubagentTranscript,
  softMessage,
  statePath,
} from '../../tools/hooks/subagent-context-budget.mjs'

/**
 * SUBAGENT context budget (#588, ported from ds-platform
 * `tools/hooks/subagent-context-budget.mjs`, their `#1374` / `#2373`). A
 * PreToolUse guard on `.*` that acts ONLY inside a subagent (stdin carries
 * `agent_id`), measures the SUBAGENT's own transcript — never the lead's, which
 * is what `transcript_path` carries — injects a ROTATE directive at
 * SOFT_THRESHOLD (then every +SOFT_REPEAT_STEP) and DENIES every tool except the
 * checkpoint/hand-back allow-list at HARD_THRESHOLD. Fail-open (silent) on
 * anything malformed, like every hook of this stack.
 */

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../tools/hooks/subagent-context-budget.mjs',
)

const tempDirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

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

/**
 * The on-disk layout the harness produces: the lead transcript
 * `<projects>/<slug>/<session>.jsonl` and, beside it, the subagent transcript
 * `<projects>/<slug>/<session>/subagents/agent-<agent_id>.jsonl`. Omitting
 * `subagent` builds the lead-only variant (no `subagents/` dir).
 */
function fixture(opts: { lead: number; subagent?: number; agentId?: string }) {
  const dir = tempDir('subagent-ctx-')
  const session = 'sess-1'
  const leadPath = join(dir, `${session}.jsonl`)
  writeFileSync(leadPath, usageLine(opts.lead))
  if (typeof opts.subagent === 'number') {
    const subDir = join(dir, session, 'subagents')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(subDir, `agent-${opts.agentId ?? 'a1'}.jsonl`), usageLine(opts.subagent))
  }
  return { session, leadPath }
}

/** Run the real hook; cadence state lands in a throwaway project dir. */
function runHook(payload: Record<string, unknown> | string, extraEnv: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    cwd: tmpdir(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tempDir('subagent-ctx-root-'), ...extraEnv },
  })
  return { status: res.status, stdout: (res.stdout ?? '').trim() }
}

describe('subagent-context-budget thresholds', () => {
  it('owner-decided constants (Anton, 2026-11-24, #588): 250K soft / 350K hard / +25K repeat', () => {
    expect(SOFT_THRESHOLD).toBe(250_000)
    expect(HARD_THRESHOLD).toBe(350_000)
    expect(SOFT_REPEAT_STEP).toBe(25_000)
  })

  it('cadence state lives in a gitignored *-guard-state dir, per session + agent', () => {
    expect(STATE_DIR_REL).toMatch(/^\.claude\/[a-z-]+-guard-state$/)
    const p = statePath('/repo', 'sess/1', 'a1').replace(/\\/g, '/')
    expect(p).toContain(`${STATE_DIR_REL}/sess_1-a1.json`)
  })

  it('missing / corrupt cadence state reads as 0 (fail-open)', () => {
    expect(readCadence('/nope/none.json')).toEqual({ lastNotifiedAt: 0 })
    expect(readCadence('x', () => '{not json')).toEqual({ lastNotifiedAt: 0 })
    expect(readCadence('x', () => '{"lastNotifiedAt": -5}')).toEqual({ lastNotifiedAt: 0 })
    expect(readCadence('x', () => '{"lastNotifiedAt": 260000}')).toEqual({
      lastNotifiedAt: 260_000,
    })
  })
})

describe('subagent-context-budget resolveSubagentTranscript()', () => {
  const payload = { session_id: 'sess-1', agent_id: 'a1', transcript_path: '/p/slug/sess-1.jsonl' }

  it('derives <dirname>/<session>/subagents/agent-<id>.jsonl from the LEAD path', () => {
    const p = resolveSubagentTranscript(payload, () => true)
    expect(String(p).replace(/\\/g, '/')).toBe('/p/slug/sess-1/subagents/agent-a1.jsonl')
  })

  it('an explicit agent_transcript_path wins (forward-compat)', () => {
    const p = resolveSubagentTranscript(
      { ...payload, agent_transcript_path: '/x/sess/subagents/agent-z.jsonl' },
      () => true,
    )
    expect(String(p).replace(/\\/g, '/')).toBe('/x/sess/subagents/agent-z.jsonl')
  })

  it('null when the resolved file does not exist (never the lead transcript)', () => {
    expect(resolveSubagentTranscript(payload, () => false)).toBeNull()
  })

  it('null when the path is not under a subagents/ segment', () => {
    expect(
      resolveSubagentTranscript(
        { ...payload, agent_transcript_path: '/p/slug/sess-1.jsonl' },
        () => true,
      ),
    ).toBeNull()
  })

  it('null when the payload lacks session_id / agent_id / transcript_path', () => {
    expect(resolveSubagentTranscript({ agent_id: 'a1' }, () => true)).toBeNull()
    expect(
      resolveSubagentTranscript({ transcript_path: '/p/s.jsonl', agent_id: 'a1' }, () => true),
    ).toBeNull()
    expect(
      resolveSubagentTranscript({ transcript_path: '/p/s.jsonl', session_id: 's' }, () => true),
    ).toBeNull()
  })
})

describe('subagent-context-budget decide() — soft cadence', () => {
  const base = { toolName: 'Read', toolInput: {}, state: { lastNotifiedAt: 0 } }

  it('below the soft cap → silent', () => {
    expect(decide({ ...base, contextTokens: 249_999 }).action).toBe('silent')
  })

  it('first crossing of the soft cap → soft directive + state', () => {
    const d = decide({ ...base, contextTokens: 250_000 })
    expect(d.action).toBe('soft')
    expect(d.state).toEqual({ lastNotifiedAt: 250_000 })
  })

  it('already notified, still inside the same +25K step → silent', () => {
    expect(
      decide({ ...base, contextTokens: 270_000, state: { lastNotifiedAt: 250_000 } }).action,
    ).toBe('silent')
  })

  it('+25K past the last notification → soft directive again', () => {
    const d = decide({ ...base, contextTokens: 275_000, state: { lastNotifiedAt: 250_000 } })
    expect(d.action).toBe('soft')
    expect(d.state).toEqual({ lastNotifiedAt: 275_000 })
  })

  it('a non-numeric context reads as 0 (fail-open)', () => {
    expect(decide({ ...base, contextTokens: Number.NaN }).action).toBe('silent')
    expect(decide({}).action).toBe('silent')
  })
})

describe('subagent-context-budget decide() — hard cap + allow-list', () => {
  it('349_999 allows a plain Read; 350_000 denies it', () => {
    const state = { lastNotifiedAt: 349_000 }
    expect(decide({ contextTokens: 349_999, toolName: 'Read', toolInput: {}, state }).action).toBe(
      'silent',
    )
    expect(decide({ contextTokens: 350_000, toolName: 'Read', toolInput: {}, state }).action).toBe(
      'deny',
    )
  })

  it('denies above the hard cap on EVERY call (no cadence gap)', () => {
    for (const ctx of [350_000, 350_001, 360_000, 600_000]) {
      expect(
        decide({
          contextTokens: ctx,
          toolName: 'Edit',
          toolInput: { file_path: '/repo/src/a.ts' },
          state: { lastNotifiedAt: ctx },
        }).action,
      ).toBe('deny')
    }
  })

  it('allow-list: plain and `git -C <path>` git commands, via Bash or PowerShell', () => {
    for (const command of [
      'git commit -m wip',
      '  git push  ',
      'git status',
      'git -C C:/Users/x/repo/.claude/worktrees/588 add -- tools/x.mjs',
      'git -C "C:\\Users\\x\\repo" diff --stat',
      'git rev-parse HEAD',
    ]) {
      expect(isAllowedUnderHardCap('Bash', { command })).toBe(true)
      expect(isAllowedUnderHardCap('PowerShell', { command })).toBe(true)
    }
  })

  it('allow-list: writing the agent’s OWN checkpoint file', () => {
    expect(isAllowedUnderHardCap('Write', { file_path: checkpointPath('a1') }, 'a1')).toBe(true)
    // Another agent's checkpoint is not this agent's hand-back path.
    expect(isAllowedUnderHardCap('Write', { file_path: checkpointPath('a2') }, 'a1')).toBe(false)
    // Without an agent id the basename shape is the only thing to check.
    expect(isAllowedUnderHardCap('Write', { file_path: '/tmp/s/checkpoint-a1.md' })).toBe(true)
  })

  it('allow-list rejects a chained / piped / substituted command', () => {
    for (const command of [
      'git status && pnpm build',
      'git log; rm -rf x',
      'git diff | tee /tmp/out',
      'git add $(ls src)',
      'git status\npnpm test',
      'git log `whoami`',
      'git diff > out.txt',
    ]) {
      expect(isAllowedUnderHardCap('Bash', { command })).toBe(false)
    }
  })

  it('allow-list rejects near-misses (git-ish names, other git verbs, other writes, other tools)', () => {
    expect(isAllowedUnderHardCap('Bash', { command: 'github-cli sync' })).toBe(false)
    expect(isAllowedUnderHardCap('Bash', { command: 'git checkout main' })).toBe(false)
    expect(isAllowedUnderHardCap('Bash', { command: 'git reset --hard' })).toBe(false)
    expect(isAllowedUnderHardCap('Bash', { command: 'pnpm test:unit' })).toBe(false)
    expect(isAllowedUnderHardCap('Bash', {})).toBe(false)
    expect(isAllowedUnderHardCap('Write', { file_path: '/repo/notes/report.md' })).toBe(false)
    expect(isAllowedUnderHardCap('Write', { file_path: '/repo/checkpoint.md' })).toBe(false)
    expect(isAllowedUnderHardCap('Edit', { file_path: checkpointPath('a1') }, 'a1')).toBe(false)
    expect(isAllowedUnderHardCap('Read', { file_path: '/x/checkpoint-a.md' })).toBe(false)
  })

  it('an allow-listed tool above the hard cap stays silent (hand-back path)', () => {
    expect(
      decide({
        contextTokens: 500_000,
        toolName: 'Bash',
        toolInput: { command: 'git add -- tools/x.mjs' },
        state: { lastNotifiedAt: 500_000 },
      }).action,
    ).toBe('silent')
  })
})

describe('subagent-context-budget messages + paths', () => {
  it('the ROTATE contract and the resolved checkpoint path are in both messages', () => {
    const path = checkpointPath('a1')
    expect(path.replace(/\\/g, '/')).toContain('claude-checkpoints/checkpoint-a1.md')
    expect(softMessage(260_000, path)).toContain(`ROTATE: ${path}`)
    expect(softMessage(260_000, path)).toContain('260K')
    expect(softMessage(260_000, path)).toContain('250K')
    expect(hardMessage(360_000, path)).toContain(`ROTATE: ${path}`)
    expect(hardMessage(360_000, path)).toContain('360K')
    expect(hardMessage(360_000, path)).toContain('350K')
  })

  it('checkpoint file names are filename-safe', () => {
    expect(checkpointPath('a/1').replace(/\\/g, '/')).toContain(
      'claude-checkpoints/checkpoint-a_1.md',
    )
  })
})

describe('subagent-context-budget end-to-end (real hook process)', () => {
  it('measures the SUBAGENT transcript, not the lead’s: lead 300K + subagent 50K → silent', () => {
    const { leadPath } = fixture({ lead: 300_000, subagent: 50_000 })
    const res = runHook({
      session_id: 'sess-1',
      agent_id: 'a1',
      agent_type: 'bbm-explorer',
      tool_name: 'Read',
      tool_input: {},
      transcript_path: leadPath,
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
  })

  it('≥250K: the soft ROTATE checkpoint directive, WITHOUT a permissionDecision', () => {
    const { leadPath } = fixture({ lead: 10_000, subagent: 260_000 })
    const res = runHook({
      session_id: 'sess-1',
      agent_id: 'a1',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test:unit' },
      transcript_path: leadPath,
    })
    expect(res.status).toBe(0)
    const json = JSON.parse(res.stdout)
    expect(json.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(json.hookSpecificOutput.additionalContext).toContain('ROTATE:')
    expect(json.hookSpecificOutput.additionalContext).toContain('checkpoint-a1.md')
    expect(json.hookSpecificOutput.permissionDecision).toBeUndefined()
  })

  it('the soft directive fires once per +25K step (cadence persisted per agent)', () => {
    const { leadPath } = fixture({ lead: 10_000, subagent: 260_000 })
    const root = tempDir('subagent-ctx-root-')
    const payload = {
      session_id: 'sess-1',
      agent_id: 'a1',
      tool_name: 'Read',
      tool_input: {},
      transcript_path: leadPath,
    }
    expect(runHook(payload, { CLAUDE_PROJECT_DIR: root }).stdout).toContain('ROTATE:')
    expect(runHook(payload, { CLAUDE_PROJECT_DIR: root }).stdout).toBe('')
  })

  it('≥350K: a Read is DENIED with the ROTATE reason (lead below cap)', () => {
    const { leadPath } = fixture({ lead: 10_000, subagent: 360_000 })
    const res = runHook({
      session_id: 'sess-1',
      agent_id: 'a1',
      tool_name: 'Read',
      tool_input: {},
      transcript_path: leadPath,
    })
    expect(res.status).toBe(0)
    const json = JSON.parse(res.stdout)
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(json.hookSpecificOutput.permissionDecisionReason).toContain('ROTATE:')
  })

  it('≥350K: a git WIP-commit still passes (hand-back path)', () => {
    const { leadPath } = fixture({ lead: 10_000, subagent: 360_000 })
    const res = runHook({
      session_id: 'sess-1',
      agent_id: 'a1',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m wip' },
      transcript_path: leadPath,
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
  })

  it('lead transcript only (no subagents/ file) → silent even at 400K', () => {
    const { leadPath } = fixture({ lead: 400_000 })
    const res = runHook({
      session_id: 'sess-1',
      agent_id: 'a1',
      tool_name: 'Read',
      tool_input: {},
      transcript_path: leadPath,
    })
    expect(res.stdout).toBe('')
  })

  it('the lead’s own call (no agent_id) is not this hook’s addressee', () => {
    const { leadPath } = fixture({ lead: 10_000, subagent: 360_000 })
    expect(
      runHook({
        session_id: 'sess-1',
        tool_name: 'Read',
        tool_input: {},
        transcript_path: leadPath,
      }).stdout,
    ).toBe('')
  })

  it('the BBM_HOOKS_DISABLE kill switch silences it', () => {
    const { leadPath } = fixture({ lead: 10_000, subagent: 360_000 })
    const res = runHook(
      {
        session_id: 'sess-1',
        agent_id: 'a1',
        tool_name: 'Read',
        tool_input: {},
        transcript_path: leadPath,
      },
      { BBM_HOOKS_DISABLE: '1' },
    )
    expect(res.stdout).toBe('')
  })

  it('fail-open: malformed stdin and a missing transcript exit 0 silently', () => {
    expect(runHook('{not json')).toEqual({ status: 0, stdout: '' })
    expect(
      runHook({
        session_id: 'sess-1',
        agent_id: 'a1',
        tool_name: 'Read',
        tool_input: {},
        transcript_path: '/definitely/not/here.jsonl',
      }),
    ).toEqual({ status: 0, stdout: '' })
  })
})

describe('subagent-context-budget wiring', () => {
  it('is registered in .claude/settings.json on PreToolUse with the catch-all matcher', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const settings = JSON.parse(readFileSync(resolve(root, '.claude/settings.json'), 'utf8'))
    const groups: Array<{ matcher: string; hooks: Array<{ command: string }> }> =
      settings.hooks.PreToolUse
    const group = groups.find((g) =>
      g.hooks.some((h) => h.command.includes('tools/hooks/subagent-context-budget.mjs')),
    )
    expect(group?.matcher).toBe('.*')
  })
})
