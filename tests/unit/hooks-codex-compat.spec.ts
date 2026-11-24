import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { decideAgentModel } from '../../tools/hooks/agent-model-guard.mjs'
import {
  applyPatchPaths,
  normalizeHookPayload,
  powershellFileWritePaths,
} from '../../tools/hooks/shared.mjs'
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

  it('normalizes full-history spawn_agent calls to the inherited-model fork exemption', () => {
    for (const forkTurns of [undefined, 'all']) {
      const inherited = normalizeHookPayload({
        tool_name: 'spawn_agent',
        tool_input: {
          task_name: 'review',
          message: 'Review the change.',
          ...(forkTurns ? { fork_turns: forkTurns } : {}),
        },
      })
      expect(inherited.tool_name).toBe('Agent')
      expect(inherited.tool_input).toMatchObject({
        subagent_type: 'fork',
        prompt: 'Review the change.',
      })
      expect(
        decideAgentModel({ toolName: inherited.tool_name, toolInput: inherited.tool_input }).block,
      ).toBe(false)
    }
  })

  it('requires an explicit model only for non-full-history spawn_agent calls', () => {
    const explicit = normalizeHookPayload({
      tool_name: 'spawn_agent',
      tool_input: {
        task_name: 'review',
        message: 'Review the change.',
        fork_turns: 'none',
        model: 'gpt-5.6-sol',
      },
    })
    expect(explicit.tool_input.subagent_type).toBe('review')
    expect(
      decideAgentModel({ toolName: explicit.tool_name, toolInput: explicit.tool_input }).block,
    ).toBe(false)

    const missing = normalizeHookPayload({
      tool_name: 'spawn_agent',
      tool_input: { task_name: 'review', message: 'Review the change.', fork_turns: '3' },
    })
    expect(
      decideAgentModel({ toolName: missing.tool_name, toolInput: missing.tool_input }).block,
    ).toBe(true)
  })

  it('normalizes Codex shell calls and passes unknown payloads through unchanged', () => {
    expect(
      normalizeHookPayload({ tool_name: 'shell_command', tool_input: { command: 'git status' } }),
    ).toMatchObject({ tool_name: 'Bash', tool_input: { command: 'git status' } })

    const unknown = { tool_name: 'unknown', tool_input: null }
    expect(normalizeHookPayload(unknown)).toBe(unknown)
    expect(normalizeHookPayload(null)).toBe(null)
  })

  it('normalizes async user-input titles and string options without transcript repeat inference', () => {
    expect(
      normalizeHookPayload({
        tool_name: 'request_user_input_async',
        tool_input: {
          questions: [
            {
              id: 'scope',
              title: 'Which scope should be used?',
              options: ['Focused', 'Complete'],
            },
          ],
        },
      }),
    ).toMatchObject({
      harness_tool_name: 'request_user_input_async',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          {
            id: 'scope',
            header: 'scope',
            question: 'Which scope should be used?',
            options: [
              { label: 'Focused', description: '' },
              { label: 'Complete', description: '' },
            ],
          },
        ],
      },
    })
  })

  it('extracts safely parseable literal PowerShell file-write targets', () => {
    expect(
      powershellFileWritePaths("Set-Content -LiteralPath '..\\shared\\one.txt' -Value x"),
    ).toEqual(['..\\shared\\one.txt'])
    expect(powershellFileWritePaths('"x" | Add-Content -Path "folder two\\two.txt"')).toEqual([
      'folder two\\two.txt',
    ])
    expect(powershellFileWritePaths("'x' | Out-File -FilePath 'three.txt'")).toEqual(['three.txt'])
    expect(powershellFileWritePaths("Get-Content -LiteralPath '..\\shared\\one.txt'")).toEqual([])
    expect(powershellFileWritePaths("Write-Output 'Set-Content -Path escaped.txt'")).toEqual([])
    expect(
      powershellFileWritePaths('Write-Output "quoted line\nSet-Content -Path escaped.txt"'),
    ).toEqual([])
    expect(
      powershellFileWritePaths(
        "Set-Content -Value 'text -Path C:\\repo\\src\\wrong.txt' -LiteralPath 'C:\\repo\\.claude\\worktrees\\475\\right.txt'",
      ),
    ).toEqual(['C:\\repo\\.claude\\worktrees\\475\\right.txt'])
    expect(powershellFileWritePaths('# audit only; Set-Content -Path escaped.txt')).toEqual([])
    expect(powershellFileWritePaths('Set-Content -Path $target -Value x')).toEqual([])
    expect(powershellFileWritePaths('Set-Content -Path "$(Join-Path $root x)" -Value x')).toEqual(
      [],
    )
    expect(powershellFileWritePaths('Set-Content -Path "src\\*.txt" -Value x')).toEqual([])
  })

  it('does not treat quoted PowerShell values as path switches', () => {
    expect(
      powershellFileWritePaths("Set-Content -Value '-Path' -LiteralPath 'C:\\repo\\src\\file.ts'"),
    ).toEqual(['C:\\repo\\src\\file.ts'])
  })

  it('ignores PowerShell block comments', () => {
    expect(
      powershellFileWritePaths(
        "<#\nSet-Content -LiteralPath 'C:\\repo\\src\\file.ts' -Value x\n#>",
      ),
    ).toEqual([])
  })

  it('normalizes canonical Codex shell aliases with literal write targets', () => {
    for (const tool_name of ['Bash', 'PowerShell']) {
      expect(
        normalizeHookPayload({
          tool_name,
          tool_input: { command: "Set-Content -LiteralPath 'src\\result.txt' -Value x" },
        }),
      ).toMatchObject({ tool_input: { file_paths: ['src\\result.txt'] } })
    }
  })

  it('path-checks literal PowerShell file writes from nested cwd', () => {
    const cwd = resolve(tmpdir(), 'bbm-main', '.claude', 'worktrees', '475', 'nested')
    const escaped = normalizeHookPayload({
      tool_name: 'exec_command',
      tool_input: { command: "Set-Content -LiteralPath '../../../../escaped.txt' -Value x" },
    })
    const safe = normalizeHookPayload({
      tool_name: 'exec_command',
      tool_input: { command: "Set-Content -LiteralPath './safe file.txt' -Value x" },
    })
    const read = normalizeHookPayload({
      tool_name: 'exec_command',
      tool_input: { command: "Get-Content -LiteralPath '../../../../escaped.txt'" },
    })

    expect(escaped.tool_input.file_paths).toEqual(['../../../../escaped.txt'])
    expect(
      decideEscapeBlock({ toolName: escaped.tool_name, toolInput: escaped.tool_input, cwd }).block,
    ).toBe(true)
    expect(
      decideEscapeBlock({ toolName: safe.tool_name, toolInput: safe.tool_input, cwd }),
    ).toEqual({
      block: false,
      inWorktreeSession: true,
    })
    expect(read.tool_input).not.toHaveProperty('file_paths')
    expect(
      decideEscapeBlock({ toolName: read.tool_name, toolInput: read.tool_input, cwd }),
    ).toEqual({
      block: false,
    })
  })

  it('blocks literal shell writes through the real worktree guard CLI', () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'bbm-worktree-guard-'))
    const cwd = resolve(tempRoot, '.claude', 'worktrees', '475', 'nested')
    const run = (tool_name: string, command: string) =>
      spawnSync(process.execPath, [resolve(repoRoot, 'tools/hooks/worktree-path-guard.mjs')], {
        cwd,
        input: JSON.stringify({ cwd, tool_name, tool_input: { command } }),
        encoding: 'utf8',
      })

    mkdirSync(cwd, { recursive: true })
    try {
      for (const toolName of ['Bash', 'PowerShell', 'exec_command']) {
        expect(
          run(toolName, "Set-Content -LiteralPath '../../../../escaped.txt' -Value x").status,
          toolName,
        ).toBe(2)
        expect(run(toolName, 'git status').status, `${toolName} read`).toBe(0)
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
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
  it('keeps every Windows hook override as a native PowerShell snippet', () => {
    const hooks = JSON.parse(readFileSync(resolve(repoRoot, '.codex', 'hooks.json'), 'utf8'))
    const commands = Object.values(hooks.hooks)
      .flatMap((groups: unknown) => groups as Array<{ hooks: Array<Record<string, string>> }>)
      .flatMap((group) => group.hooks)

    expect(commands).toHaveLength(15)
    for (const hook of commands) {
      expect(hook.commandWindows).not.toMatch(/^powershell(?:\.exe)?\s/i)
      expect(hook.commandWindows).toMatch(/;\s*exit \$LASTEXITCODE$/)
    }
  })

  it.runIf(process.platform === 'win32')(
    'executes every Windows hook override and preserves exit codes through active PowerShell',
    () => {
      const hooks = JSON.parse(readFileSync(resolve(repoRoot, '.codex', 'hooks.json'), 'utf8'))
      const commands = Object.values(hooks.hooks)
        .flatMap((groups: unknown) => groups as Array<{ hooks: Array<Record<string, string>> }>)
        .flatMap((group) => group.hooks)
      const shimRoot = mkdtempSync(resolve(tmpdir(), 'bbm-codex-node-shim-'))
      const shimCalls = resolve(shimRoot, 'calls.log')
      const nodeShim = resolve(shimRoot, 'node.cmd')
      const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
      const runHook = (command: string) =>
        spawnSync(command, {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            [pathKey]: `${shimRoot};${process.env[pathKey] ?? ''}`,
          },
          input: '{}\n',
          shell: 'powershell.exe',
        })

      writeFileSync(nodeShim, '@echo call>>"%~dp0calls.log"\r\n@exit /b 0\r\n')

      try {
        for (const hook of commands) {
          const result = runHook(hook.commandWindows)

          expect(
            result.status,
            `${hook.commandWindows}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
          ).toBe(0)
        }
        expect(readFileSync(shimCalls, 'utf8').trim().split(/\r?\n/)).toHaveLength(commands.length)

        writeFileSync(nodeShim, '@exit /b 2\r\n')
        const blocked = runHook(commands[0].commandWindows)
        expect(
          blocked.status,
          `${commands[0].commandWindows}\nstdout: ${blocked.stdout}\nstderr: ${blocked.stderr}`,
        ).toBe(2)
      } finally {
        rmSync(shimRoot, { recursive: true, force: true })
      }
    },
    30_000,
  )

  // PostToolUse and Stop are gone since #589: their only consumers were the
  // retired Stop gates (write evidence + the Codex Stop adapter).
  it('configures the live event families and resolves commands from git root', () => {
    const hooks = JSON.parse(readFileSync(resolve(repoRoot, '.codex', 'hooks.json'), 'utf8'))
    expect(Object.keys(hooks.hooks)).toEqual(
      expect.arrayContaining([
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'SessionEnd',
        'SubagentStart',
        'SubagentStop',
      ]),
    )
    expect(Object.keys(hooks.hooks)).not.toContain('Stop')
    expect(Object.keys(hooks.hooks)).not.toContain('PostToolUse')

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
    expect(hooks.hooks.SessionEnd[0]).not.toHaveProperty('matcher')
    expect(hooks.hooks.SessionEnd[0].hooks[0].timeout).toBeLessThanOrEqual(3)
    expect(hooks.hooks.SubagentStart[0]).not.toHaveProperty('matcher')
    expect(hooks.hooks.SubagentStop[0]).not.toHaveProperty('matcher')
    expect(JSON.stringify(hooks)).not.toContain('"matcher":"*"')
  })

  it('wires the Codex executor lifecycle and zero-dispatch guard through real config', () => {
    const hooks = JSON.parse(readFileSync(resolve(repoRoot, '.codex', 'hooks.json'), 'utf8'))

    for (const event of ['SessionEnd', 'SubagentStart', 'SubagentStop']) {
      expect(hooks.hooks[event][0].hooks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: expect.stringContaining('codex-subagent-turn-recorder.mjs'),
            commandWindows: expect.stringContaining('codex-subagent-turn-recorder.mjs'),
          }),
        ]),
      )
    }

    const guardGroup = hooks.hooks.PreToolUse.find(
      (candidate: { matcher?: string }) =>
        candidate.matcher === 'Agent|Task|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell',
    )
    expect(guardGroup.hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.stringContaining('zero-dispatch-guard.mjs'),
          commandWindows: expect.stringContaining('zero-dispatch-guard.mjs'),
        }),
      ]),
    )
  })

  it('routes spawn_agent through the configured model guard with valid Codex semantics', () => {
    const hooks = JSON.parse(readFileSync(resolve(repoRoot, '.codex', 'hooks.json'), 'utf8'))
    const group = hooks.hooks.PreToolUse.find(
      (candidate: { matcher?: string }) => candidate.matcher === 'Agent|Task',
    )
    expect(group.hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.stringContaining('agent-model-guard.mjs') }),
      ]),
    )

    const run = (tool_input: Record<string, unknown>) =>
      spawnSync(process.execPath, ['tools/hooks/agent-model-guard.mjs'], {
        cwd: repoRoot,
        input: JSON.stringify({
          hook_event_name: 'PreToolUse',
          tool_name: 'spawn_agent',
          tool_input,
        }),
        encoding: 'utf8',
      })

    expect(run({ task_name: 'review', message: 'Review.' }).status).toBe(0)
    expect(
      run({
        task_name: 'review',
        message: 'Review.',
        fork_turns: 'none',
        model: 'gpt-5.6-sol',
      }).status,
    ).toBe(0)
  })
})
