import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  BYPASS_ENV,
  ZERO_DISPATCH_BLOCK_THRESHOLD,
  blockMessage,
  bypassReason,
  decideZeroDispatch,
  isMutatingCall,
  isSubagentSession,
  readCounterState,
} from '../../tools/hooks/zero-dispatch-guard.mjs'

/**
 * zero-dispatch guard (#322): блокирует лида, который набирает мутацию за
 * мутацией, ни разу не диспетчеризовав Agent. Проверяется ЧИСТЫЙ seam решения
 * плюс контракт процесса (exit 2 = BLOCK, fail-open на мусоре).
 */

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/hooks')

function runHook(hook: string, stdin: string, env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [resolve(HOOKS_DIR, hook)], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: res.status, stderr: res.stderr ?? '', stdout: res.stdout ?? '' }
}

const LEAD = { subagent: false, worktree: false }

/** Голое env-окружение для чистых seam'ов: `NODE_ENV` в них не участвует. */
function env(vars: Record<string, string>) {
  return vars as unknown as NodeJS.ProcessEnv
}

describe('zero-dispatch-guard: что считается мутацией лида', () => {
  it.each(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])('%s — мутация', (tool) => {
    expect(isMutatingCall(tool, {})).toBe(true)
  })

  it.each([
    'git commit -m "x"',
    'git -C C:/repo push origin main',
    'gh issue create --title x',
    'gh issue comment 322 --body x',
    'gh pr create --fill',
    'gh pr edit 12 --add-label x',
    'pnpm issue:create --title x',
  ])('Bash `%s` — мутация', (command) => {
    expect(isMutatingCall('Bash', { command })).toBe(true)
  })

  it.each([
    'gh issue view 322',
    'gh pr diff 12',
    'git status',
    'pnpm test:unit',
    'rg "commit" tools/',
  ])('Bash `%s` — чтение, не считается', (command) => {
    expect(isMutatingCall('Bash', { command })).toBe(false)
  })

  it('упоминание команды в теле heredoc командой не является', () => {
    const command = 'gh pr comment 1 --body "$(cat <<\'EOF\'\ngit commit -m x\nEOF\n)"'
    // Мутация тут настоящая (`gh pr comment`), но по СВОЕМУ глаголу.
    expect(isMutatingCall('Bash', { command })).toBe(true)
    expect(
      isMutatingCall('Bash', { command: 'echo "$(cat <<\'EOF\'\ngit commit -m x\nEOF\n)"' }),
    ).toBe(false)
  })

  it.each(['Read', 'Grep', 'Glob', 'Agent', 'Task'])('%s мутацией не считается', (tool) => {
    expect(isMutatingCall(tool, {})).toBe(false)
  })
})

describe('zero-dispatch-guard: счётчик и порог', () => {
  it('ниже порога — считает молча', () => {
    const d = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: { mutations: ZERO_DISPATCH_BLOCK_THRESHOLD - 2 },
      ...LEAD,
    })
    expect(d.action).toBe('count')
    expect(d.state?.mutations).toBe(ZERO_DISPATCH_BLOCK_THRESHOLD - 1)
  })

  it('на пороге — блокирует', () => {
    const d = decideZeroDispatch({
      toolName: 'Write',
      toolInput: {},
      state: { mutations: ZERO_DISPATCH_BLOCK_THRESHOLD - 1 },
      ...LEAD,
    })
    expect(d.action).toBe('block')
    expect(d.state?.mutations).toBe(ZERO_DISPATCH_BLOCK_THRESHOLD)
  })

  it('заблокированный вызов не исполнился — счётчик не растёт на повторе', () => {
    const first = decideZeroDispatch({
      toolName: 'Write',
      toolInput: {},
      state: { mutations: ZERO_DISPATCH_BLOCK_THRESHOLD - 1 },
      ...LEAD,
    })
    const second = decideZeroDispatch({
      toolName: 'Write',
      toolInput: {},
      state: first.state,
      ...LEAD,
    })
    expect(second.action).toBe('block')
    expect(second.state?.mutations).toBe(ZERO_DISPATCH_BLOCK_THRESHOLD)
  })

  it('нечитаемое состояние трактуется как ноль (fail-open)', () => {
    expect(readCounterState(null)).toEqual({ mutations: 0, dispatched: false, bypassUsed: '' })
    expect(readCounterState({ mutations: -7, dispatched: 'да' })).toEqual({
      mutations: 0,
      dispatched: false,
      bypassUsed: '',
    })
  })

  it('не-мутирующий вызов состояние не трогает', () => {
    const d = decideZeroDispatch({
      toolName: 'Read',
      toolInput: {},
      state: { mutations: 4 },
      ...LEAD,
    })
    expect(d.action).toBe('silent')
    expect(d.state).toBeUndefined()
  })
})

describe('zero-dispatch-guard: диспетчеризующая сессия не прерывается', () => {
  it('Agent сбрасывает счётчик и поднимает флаг dispatched', () => {
    const d = decideZeroDispatch({
      toolName: 'Agent',
      toolInput: { model: 'opus' },
      state: { mutations: ZERO_DISPATCH_BLOCK_THRESHOLD - 1 },
      ...LEAD,
    })
    expect(d.action).toBe('dispatched')
    expect(d.state).toEqual({ mutations: 0, dispatched: true, bypassUsed: '' })
  })

  it('после диспатча порог не блокирует НИКОГДА — сессия оркеструет', () => {
    const dispatched = { mutations: 0, dispatched: true, bypassUsed: '' }
    let state = dispatched
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD * 3; i += 1) {
      const d = decideZeroDispatch({ toolName: 'Edit', toolInput: {}, state, ...LEAD })
      expect(d.action).toBe('silent')
      state = d.state ?? state
    }
  })

  it('`Task` — кросс-харнесный алиас Agent — сбрасывает так же', () => {
    expect(
      decideZeroDispatch({ toolName: 'Task', toolInput: {}, state: { mutations: 5 }, ...LEAD })
        .action,
    ).toBe('dispatched')
  })
})

describe('zero-dispatch-guard: одноразовый записанный побег', () => {
  const atThreshold = {
    mutations: ZERO_DISPATCH_BLOCK_THRESHOLD - 1,
    dispatched: false,
    bypassUsed: '',
  }

  it('побег пропускает ровно следующую мутацию и называет причину', () => {
    const d = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: atThreshold,
      bypass: 'фикс прода, диспатч дороже правки',
      ...LEAD,
    })
    expect(d.action).toBe('bypass')
    expect(d.reason).toBe('фикс прода, диспатч дороже правки')
    expect(d.state?.bypassUsed).toBe('фикс прода, диспатч дороже правки')
  })

  it('израсходованный побег ту же причину второй раз не пропускает', () => {
    const used = {
      ...atThreshold,
      mutations: ZERO_DISPATCH_BLOCK_THRESHOLD,
      bypassUsed: 'та же причина',
    }
    const d = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: used,
      bypass: 'та же причина',
      ...LEAD,
    })
    expect(d.action).toBe('block')
    expect(d.exhausted).toBe(true)
  })

  it('новая причина — новый побег', () => {
    const used = { ...atThreshold, mutations: ZERO_DISPATCH_BLOCK_THRESHOLD, bypassUsed: 'старая' }
    expect(
      decideZeroDispatch({ toolName: 'Edit', toolInput: {}, state: used, bypass: 'новая', ...LEAD })
        .action,
    ).toBe('bypass')
  })

  it('пустой побег побегом не является — значение это ПРИЧИНА, а не рубильник', () => {
    expect(bypassReason(env({ [BYPASS_ENV]: '1' }))).toBe('1')
    expect(bypassReason(env({ [BYPASS_ENV]: '   ' }))).toBe('')
    expect(bypassReason(env({}))).toBe('')
    const d = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: atThreshold,
      bypass: '',
      ...LEAD,
    })
    expect(d.action).toBe('block')
  })

  it('ниже порога побег не расходуется', () => {
    const d = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: { mutations: 0, dispatched: false, bypassUsed: '' },
      bypass: 'причина',
      ...LEAD,
    })
    expect(d.action).toBe('count')
    expect(d.state?.bypassUsed).toBe('')
  })
})

describe('zero-dispatch-guard: субагент под гардом не ходит', () => {
  it('сессия-субагент освобождена — она и есть цель диспатча', () => {
    const d = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: { mutations: ZERO_DISPATCH_BLOCK_THRESHOLD },
      subagent: true,
      worktree: false,
    })
    expect(d.action).toBe('silent')
  })

  it('сессия в worktree освобождена — там сидит исполнитель', () => {
    const d = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: { mutations: ZERO_DISPATCH_BLOCK_THRESHOLD },
      subagent: false,
      worktree: true,
    })
    expect(d.action).toBe('silent')
  })

  it('дискриминатор №1 — AI_AGENT, харнес ставит его ТОЛЬКО в сессии-агенте', () => {
    expect(isSubagentSession({ env: env({ AI_AGENT: 'claude-code_2-1-245_agent' }) })).toBe(true)
    expect(isSubagentSession({ env: env({}) })).toBe(false)
    expect(isSubagentSession({ env: env({ CLAUDE_CODE_CHILD_SESSION: '1' }) })).toBe(false)
  })

  it('дискриминатор №2 — маркер диспатча в транскрипте (канон wrap/SKILL.md)', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'zdg-'))
    const sdk = resolve(dir, 'sdk.jsonl')
    const typed = resolve(dir, 'typed.jsonl')
    writeFileSync(sdk, '{"type":"user","promptSource":"sdk"}\n')
    writeFileSync(typed, '{"type":"user","promptSource":"typed"}\n')
    expect(isSubagentSession({ env: env({}), transcriptPath: sdk })).toBe(true)
    expect(isSubagentSession({ env: env({}), transcriptPath: typed })).toBe(false)
    writeFileSync(sdk, '{"isSidechain":true}\n')
    expect(isSubagentSession({ env: env({}), transcriptPath: sdk })).toBe(true)
    // Нечитаемый транскрипт — не улика ни за, ни против.
    expect(isSubagentSession({ env: env({}), transcriptPath: resolve(dir, 'нет.jsonl') })).toBe(
      false,
    )
  })
})

describe('zero-dispatch-guard: сообщение блока', () => {
  const text = blockMessage({ mutations: ZERO_DISPATCH_BLOCK_THRESHOLD, exhausted: false })

  it('называет правило, счёт и лестницу делегирования', () => {
    expect(text).toContain('lead-delegates-even-small-prep')
    expect(text).toContain(String(ZERO_DISPATCH_BLOCK_THRESHOLD))
    expect(text).toContain('bbm-explorer')
    expect(text).toContain('opus')
  })

  it('называет побег и то, что он попадёт в строку stage 7', () => {
    expect(text).toContain(BYPASS_ENV)
    expect(text).toContain('Отклонения от конвенций')
  })

  it('на израсходованном побеге говорит именно это', () => {
    expect(blockMessage({ mutations: 9, exhausted: true })).toMatch(/израсходован/i)
  })
})

describe('zero-dispatch-guard как процесс', () => {
  const LEAD_ENV = { AI_AGENT: '', BBM_HOOKS_DISABLE: '', [BYPASS_ENV]: '' }

  function leadPayload(session: string, tool = 'Edit') {
    return JSON.stringify({
      tool_name: tool,
      tool_input: { file_path: 'C:/Users/sidor/repos/bbm-portal/src/x.ts' },
      cwd: 'C:/Users/sidor/repos/bbm-portal',
      session_id: session,
    })
  }

  it('мусор во входе даёт exit 0 (fail-open)', () => {
    expect(runHook('zero-dispatch-guard.mjs', '{ это не JSON').status).toBe(0)
  })

  it('N-я мутация подряд без диспатча возвращает 2 и называет правило', () => {
    const session = `zdg-block-${Date.now()}`
    let last: ReturnType<typeof runHook> = { status: 0, stderr: '', stdout: '' }
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      last = runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV)
    }
    expect(last.status).toBe(2)
    expect(last.stderr).toContain('zero-dispatch guard')
    expect(last.stderr).toContain('lead-delegates-even-small-prep')
  })

  it('рубильник BBM_HOOKS_DISABLE=1 снимает блок', () => {
    const session = `zdg-kill-${Date.now()}`
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV)
    }
    expect(
      runHook('zero-dispatch-guard.mjs', leadPayload(session), {
        ...LEAD_ENV,
        BBM_HOOKS_DISABLE: '1',
      }).status,
    ).toBe(0)
  })

  it('побег пропускает вызов и печатает причину в stderr — она попадает в лог сессии', () => {
    const session = `zdg-bypass-${Date.now()}`
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD - 1; i += 1) {
      runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV)
    }
    const escaped = runHook('zero-dispatch-guard.mjs', leadPayload(session), {
      ...LEAD_ENV,
      [BYPASS_ENV]: 'правка одной строки в доке',
    })
    expect(escaped.status).toBe(0)
    expect(escaped.stderr).toContain('правка одной строки в доке')
  })

  it('Agent снимает блок на всю оставшуюся сессию', () => {
    const session = `zdg-reset-${Date.now()}`
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD - 1; i += 1) {
      runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV)
    }
    expect(runHook('zero-dispatch-guard.mjs', leadPayload(session, 'Agent'), LEAD_ENV).status).toBe(
      0,
    )
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD * 2; i += 1) {
      expect(runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV).status).toBe(0)
    }
  })
})

describe('zero-dispatch-guard: регистрация', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

  it('привязан в .claude/settings.json на PreToolUse', () => {
    const settings = readFileSync(resolve(root, '.claude/settings.json'), 'utf8')
    expect(settings).toContain('zero-dispatch-guard.mjs')
  })

  it('назван в реестре хуков и в реестре гардов', () => {
    expect(readFileSync(resolve(root, 'tools/hooks/README.md'), 'utf8')).toContain(
      'zero-dispatch-guard.mjs',
    )
    expect(readFileSync(resolve(root, 'docs/ci-guardrails.md'), 'utf8')).toContain(
      'zero-dispatch-guard.mjs',
    )
  })
})
