import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import { decideAgentModel } from '../../tools/hooks/agent-model-guard.mjs'
import {
  applyPatchPaths,
  normalizeHookPayload,
  recordWriteEvidence,
  readStopContext,
  writeEvidenceForPayload,
} from '../../tools/hooks/codex-compat.mjs'
import { decideCodexStop } from '../../tools/hooks/codex-stop-adapter.mjs'
import { decideReminder } from '../../tools/hooks/handoff-verify-reminder.mjs'
import {
  collectRegisteredSessionLogs,
  registerSessionLog,
} from '../../tools/hooks/session-flag-writer.mjs'
import { decideEscapeBlock } from '../../tools/hooks/worktree-path-guard.mjs'

const repoRoot = resolve(import.meta.dirname, '..', '..')

describe('Codex hook payload compatibility', () => {
  it('normalizes apply_patch and guards every path in a multi-file patch', () => {
    const command = [
      '*** Begin Patch',
      '*** Update File: src/safe.ts',
      '@@',
      '-old',
      '+new',
      '*** Update File: C:\\repo\\src\\escaped.ts',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n')

    expect(applyPatchPaths(command)).toEqual(['src/safe.ts', 'C:\\repo\\src\\escaped.ts'])

    const payload = normalizeHookPayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { command },
    })
    expect(payload.tool_name).toBe('MultiEdit')
    expect(payload.tool_input.file_paths).toEqual(['src/safe.ts', 'C:\\repo\\src\\escaped.ts'])
    expect(
      decideEscapeBlock({
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        cwd: 'C:\\repo\\.claude\\worktrees\\209',
      }).block,
    ).toBe(true)
  })

  it('blocks an apply_patch relative traversal into the shared checkout', () => {
    const cwd = resolve(tmpdir(), 'bbm-main', '.claude', 'worktrees', '209')
    const escaped = normalizeHookPayload({
      tool_name: 'apply_patch',
      tool_input: {
        command: [
          '*** Begin Patch',
          '*** Update File: ../../../src/escaped.ts',
          '*** End Patch',
        ].join('\n'),
      },
    })
    const safe = normalizeHookPayload({
      tool_name: 'apply_patch',
      tool_input: {
        command: ['*** Begin Patch', '*** Update File: src/safe.ts', '*** End Patch'].join('\n'),
      },
    })

    expect(
      decideEscapeBlock({ toolName: escaped.tool_name, toolInput: escaped.tool_input, cwd }).block,
    ).toBe(true)
    expect(
      decideEscapeBlock({ toolName: safe.tool_name, toolInput: safe.tool_input, cwd }),
    ).toEqual({ block: false, inWorktreeSession: true })
  })

  it('normalizes spawn_agent into the existing Agent model contract', () => {
    const missing = normalizeHookPayload({
      tool_name: 'spawn_agent',
      tool_input: { task_name: 'review', message: 'Review the change.' },
    })
    expect(missing.tool_name).toBe('Agent')
    expect(missing.tool_input).toMatchObject({
      subagent_type: 'review',
      prompt: 'Review the change.',
    })
    expect(
      decideAgentModel({ toolName: missing.tool_name, toolInput: missing.tool_input }).block,
    ).toBe(true)

    const explicit = normalizeHookPayload({
      tool_name: 'spawn_agent',
      tool_input: { task_name: 'review', message: 'Review the change.', model: 'gpt-5.6-sol' },
    })
    expect(
      decideAgentModel({ toolName: explicit.tool_name, toolInput: explicit.tool_input }).block,
    ).toBe(false)
  })

  it('normalizes Codex shell calls while keeping read-only classification fail-open', () => {
    expect(
      normalizeHookPayload({ tool_name: 'shell_command', tool_input: { command: 'git status' } }),
    ).toMatchObject({ tool_name: 'Bash', tool_input: { command: 'git status' } })

    expect(
      writeEvidenceForPayload({
        tool_name: 'shell_command',
        tool_input: { command: 'git status' },
      }),
    ).toBe(false)
    expect(
      writeEvidenceForPayload({
        tool_name: 'shell_command',
        tool_input: { command: 'git commit -m "test: evidence"' },
      }),
    ).toBe(true)
    expect(writeEvidenceForPayload({ tool_name: 'unknown', tool_input: null })).toBe(false)
    expect(writeEvidenceForPayload(null)).toBe(false)
  })

  it('classifies apply_patch and spawn_agent as writes', () => {
    expect(
      writeEvidenceForPayload({
        tool_name: 'apply_patch',
        tool_input: { command: '*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch' },
      }),
    ).toBe(true)
    expect(
      writeEvidenceForPayload({
        tool_name: 'spawn_agent',
        tool_input: { task_name: 'review', message: 'Review this.' },
      }),
    ).toBe(true)
  })

  it('preserves write evidence across compact, resume, and source-less SessionStart events', () => {
    const writes: Array<{ writeActionSeen: boolean }> = []
    const deps = {
      mainRepoRoot: () => 'C:\\repo',
      writeState: (_path: string, state: { writeActionSeen: boolean }) => writes.push(state),
    }

    for (const source of ['compact', 'resume', undefined]) {
      recordWriteEvidence(
        {
          session_id: 'codex-209',
          hook_event_name: 'SessionStart',
          ...(source ? { source } : {}),
        },
        deps,
      )
    }
    expect(writes).toEqual([])
  })

  it('resets write evidence only for explicit startup and clear SessionStart events', () => {
    const writes: Array<{ writeActionSeen: boolean; haltSignal: boolean }> = []
    const deps = {
      mainRepoRoot: () => 'C:\\repo',
      writeState: (_path: string, state: { writeActionSeen: boolean; haltSignal: boolean }) =>
        writes.push(state),
    }

    for (const source of ['startup', 'clear']) {
      recordWriteEvidence(
        { session_id: `codex-${source}`, hook_event_name: 'SessionStart', source },
        deps,
      )
    }
    expect(writes).toEqual([
      { writeActionSeen: false, haltSignal: false },
      { writeActionSeen: false, haltSignal: false },
    ])
  })

  it('persists a halt prompt monotonically and blocks deviations self-certification at Stop', () => {
    let state = { writeActionSeen: true, haltSignal: false }
    const deps = {
      mainRepoRoot: () => 'C:\\repo',
      readState: () => state,
      writeState: (_path: string, next: typeof state) => {
        state = next
      },
    }
    const stop = {
      session_id: 'codex-209',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: [
        'Done: PR #209 merged.',
        'Проверить глазами: tests.',
        'Отклонения от конвенций: нет.',
      ].join('\n'),
    }

    recordWriteEvidence(
      {
        session_id: 'codex-209',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Стоп, что ты делаешь?',
      },
      deps,
    )
    recordWriteEvidence(
      {
        session_id: 'codex-209',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Continue with the fix.',
      },
      deps,
    )

    expect(state).toEqual({ writeActionSeen: true, haltSignal: true })
    expect(decideCodexStop('deviations', stop, deps)).toEqual({
      block: true,
      reason: 'self-cert',
    })
  })

  it('does not arm halt evidence for a normal prompt', () => {
    const state = { writeActionSeen: true, haltSignal: false }
    const writeState = vi.fn()
    const deps = {
      mainRepoRoot: () => 'C:\\repo',
      readState: () => state,
      writeState,
    }
    const stop = {
      session_id: 'codex-209',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: [
        'Done: PR #209 merged.',
        'Проверить глазами: tests.',
        'Отклонения от конвенций: нет.',
      ].join('\n'),
    }

    recordWriteEvidence(
      {
        session_id: 'codex-209',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Continue with the fix.',
      },
      deps,
    )

    expect(writeState).not.toHaveBeenCalled()
    expect(decideCodexStop('deviations', stop, deps)).toEqual({ block: false })
  })

  it('uses stable PostToolUse evidence and Stop last_assistant_message without parsing Codex JSONL', () => {
    const readTranscript = vi.fn(() => {
      throw new Error('Codex transcript format is intentionally not parsed')
    })
    expect(
      readStopContext(
        {
          session_id: 'codex-209',
          hook_event_name: 'Stop',
          stop_hook_active: false,
          last_assistant_message: 'PR #209 merged. Проверить глазами: tests.',
          transcript_path: 'unstable-codex-format.jsonl',
        },
        {
          readTranscript,
          readWriteEvidence: () => true,
        },
      ),
    ).toEqual({
      haltSignal: false,
      lastAssistantText: 'PR #209 merged. Проверить глазами: tests.',
      writeActionSeen: true,
    })
    expect(readTranscript).not.toHaveBeenCalled()
  })

  it('feeds Codex Stop payloads through the existing completion, deviations, and debt seams', () => {
    const payload = {
      session_id: 'codex-209',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done: PR #209 merged.',
    }
    const wrote = { readWriteEvidence: () => true }
    expect(decideCodexStop('completion', payload, wrote)).toEqual({ block: true })
    expect(decideCodexStop('deviations', payload, wrote)).toEqual({ block: true })
    expect(decideCodexStop('debt', payload, wrote)).toEqual({ warn: true })

    const readOnly = { readWriteEvidence: () => false }
    expect(decideCodexStop('completion', payload, readOnly)).toEqual({ block: false })
    expect(decideCodexStop('deviations', payload, readOnly)).toEqual({ block: false })
    expect(decideCodexStop('debt', payload, readOnly)).toEqual({ warn: false })
  })

  it('keeps UserPromptSubmit prompt semantics unchanged', () => {
    const output = decideReminder({
      hook_event_name: 'UserPromptSubmit',
      prompt: '## Current task\nContinue #209\n\n## Where we stopped\nTests are red.',
    })
    expect(output).toContain('handoff-verify')
  })

  it('registers Codex transcript paths for cross-harness parallel-session detection', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bbm-codex-session-'))
    const transcript = resolve(root, 'rollout.jsonl')
    mkdirSync(resolve(root, '.claude'), { recursive: true })
    writeFileSync(transcript, '{}\n')

    try {
      registerSessionLog(root, { session_id: 'codex-209', transcript_path: transcript })
      expect(collectRegisteredSessionLogs(root)).toEqual([
        expect.objectContaining({ id: 'codex-209', logPath: transcript }),
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('repository-local Codex hooks', () => {
  it('configures all five event families and resolves commands from git root', () => {
    const hooks = JSON.parse(readFileSync(resolve(repoRoot, '.codex', 'hooks.json'), 'utf8'))
    expect(Object.keys(hooks.hooks)).toEqual(
      expect.arrayContaining([
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'Stop',
      ]),
    )

    const commands = Object.values(hooks.hooks)
      .flatMap((groups: unknown) => groups as Array<{ hooks: Array<Record<string, string>> }>)
      .flatMap((group) => group.hooks)
    expect(commands.length).toBeGreaterThan(0)
    for (const hook of commands) {
      expect(hook.command).toContain('git rev-parse --show-toplevel')
      expect(hook.commandWindows).toContain('git rev-parse --show-toplevel')
    }

    expect(hooks.hooks.SessionStart[0]).not.toHaveProperty('matcher')
    expect(hooks.hooks.UserPromptSubmit[0]).not.toHaveProperty('matcher')
    expect(hooks.hooks.Stop[0]).not.toHaveProperty('matcher')
    expect(hooks.hooks.PostToolUse[0].matcher).toBe('.*')
    expect(JSON.stringify(hooks)).not.toContain('"matcher":"*"')
    expect(
      hooks.hooks.UserPromptSubmit[0].hooks.some((hook: { command: string }) =>
        hook.command.includes('write-evidence-recorder.mjs'),
      ),
    ).toBe(true)
  })

  it('the Codex PostToolUse recorder is fail-open on malformed payloads', () => {
    const result = spawnSync(process.execPath, ['tools/hooks/write-evidence-recorder.mjs'], {
      cwd: repoRoot,
      input: '{ malformed json',
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})
