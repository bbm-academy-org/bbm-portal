import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isCodexExecutorTurn } from '../../tools/hooks/codex-subagent-turn-recorder.mjs'
import {
  ARM_BYPASS_FLAG,
  BYPASS_ENV,
  ZERO_DISPATCH_BLOCK_THRESHOLD,
  armBypass,
  blockMessage,
  bypassFilePath,
  bypassReason,
  decideZeroDispatch,
  isMutatingCall,
  isSubagentSession,
  readCounterState,
  resolveBypassReason,
  splitInlineBypass,
  wrongShellForm,
} from '../../tools/hooks/zero-dispatch-guard.mjs'

/**
 * zero-dispatch guard (#322): блокирует лида, который набирает мутацию за
 * мутацией, ни разу не диспетчеризовав Agent. Проверяется ЧИСТЫЙ seam решения
 * плюс контракт процесса (exit 2 = BLOCK, fail-open на мусоре).
 */

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/hooks')
const GUARD = resolve(HOOKS_DIR, 'zero-dispatch-guard.mjs')

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
    expect(readCounterState(null)).toEqual({
      mutations: 0,
      dispatched: false,
      bypassUsed: [],
      subagent: false,
    })
    expect(readCounterState({ mutations: -7, dispatched: 'да' })).toEqual({
      mutations: 0,
      dispatched: false,
      bypassUsed: [],
      subagent: false,
    })
  })

  it('старая строковая форма bypassUsed читается как список из одного элемента', () => {
    // Сессия, начатая до правки MAJOR 1, не теряет запись и не получает лишний
    // побег: строка — это одна израсходованная причина, а не «ничего».
    expect(readCounterState({ bypassUsed: 'старая причина' }).bypassUsed).toEqual([
      'старая причина',
    ])
    expect(readCounterState({ bypassUsed: ['a', '', 7, 'b'] }).bypassUsed).toEqual(['a', 'b'])
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
    expect(d.state).toEqual({ mutations: 0, dispatched: true, bypassUsed: [], subagent: false })
  })

  it('после диспатча порог не блокирует НИКОГДА — сессия оркеструет', () => {
    const dispatched = { mutations: 0, dispatched: true, bypassUsed: [] as string[] }
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
    bypassUsed: [] as string[],
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
    expect(d.state?.bypassUsed).toEqual(['фикс прода, диспатч дороже правки'])
  })

  it('израсходованный побег ту же причину второй раз не пропускает', () => {
    const used = {
      ...atThreshold,
      mutations: ZERO_DISPATCH_BLOCK_THRESHOLD,
      bypassUsed: ['та же причина'],
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
    const used = {
      ...atThreshold,
      mutations: ZERO_DISPATCH_BLOCK_THRESHOLD,
      bypassUsed: ['старая'],
    }
    expect(
      decideZeroDispatch({ toolName: 'Edit', toolInput: {}, state: used, bypass: 'новая', ...LEAD })
        .action,
    ).toBe('bypass')
  })

  it('ЧЕРЕДОВАНИЕ двух причин побег не размножает (ревью PR #346, MAJOR 1)', () => {
    // r1 → r2 → r1: с одной строкой `bypassUsed` третий вызов снова проходил бы,
    // и две причины давали бы неограниченное число побегов.
    const step = (state: unknown, bypass: string) =>
      decideZeroDispatch({ toolName: 'Edit', toolInput: {}, state, bypass, ...LEAD })
    const first = step({ ...atThreshold, mutations: ZERO_DISPATCH_BLOCK_THRESHOLD }, 'причина r1')
    expect(first.action).toBe('bypass')
    const second = step(first.state, 'причина r2')
    expect(second.action).toBe('bypass')
    expect(second.state?.bypassUsed).toEqual(['причина r1', 'причина r2'])
    const third = step(second.state, 'причина r1')
    expect(third.action).toBe('block')
    expect(third.exhausted).toBe(true)
    // Свежая причина по-прежнему работает — гард не превратился в рубильник.
    expect(step(second.state, 'причина r3').action).toBe('bypass')
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
      state: { mutations: 0, dispatched: false, bypassUsed: [] },
      bypass: 'причина',
      ...LEAD,
    })
    expect(d.action).toBe('count')
    expect(d.state?.bypassUsed).toEqual([])
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

  it('транскрипт читается ЛЕНИВО — только когда от него зависит решение (MAJOR 3)', () => {
    let calls = 0
    const probe = () => {
      calls += 1
      return false
    }
    // Не мутация — предикат не зовут вовсе.
    decideZeroDispatch({
      toolName: 'Read',
      toolInput: {},
      state: {},
      subagent: probe,
      worktree: false,
    })
    expect(calls).toBe(0)
    // Не мутирующая Bash-команда — тоже.
    decideZeroDispatch({
      toolName: 'Bash',
      toolInput: { command: 'gh issue view 1' },
      state: {},
      subagent: probe,
      worktree: false,
    })
    expect(calls).toBe(0)
    // Сессия уже диспетчеризовала — тоже.
    decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: { dispatched: true },
      subagent: probe,
      worktree: false,
    })
    expect(calls).toBe(0)
    // И только настоящая мутация лида без диспатча платит за чтение.
    decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: {},
      subagent: probe,
      worktree: false,
    })
    expect(calls).toBe(1)
  })

  it('положительный вердикт кэшируется в состоянии — второго чтения нет', () => {
    let calls = 0
    const probe = () => {
      calls += 1
      return true
    }
    const first = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: {},
      subagent: probe,
      worktree: false,
    })
    expect(first.action).toBe('silent')
    expect(first.state?.subagent).toBe(true)
    const second = decideZeroDispatch({
      toolName: 'Edit',
      toolInput: {},
      state: first.state,
      subagent: probe,
      worktree: false,
    })
    expect(second.action).toBe('silent')
    expect(calls).toBe(1)
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

describe('zero-dispatch-guard: побег достижим ИЗ сессии (ревью PR #346, BLOCKER 1)', () => {
  it('канал A — инлайн-префикс в строке команды, а не env под-оболочки', () => {
    expect(splitInlineBypass('DISPATCH_BYPASS="фикс прода" gh issue edit 1 --body x')).toEqual({
      reason: 'фикс прода',
      command: 'gh issue edit 1 --body x',
      wrongForm: '',
    })
    expect(splitInlineBypass("DISPATCH_BYPASS='одна строка' git commit -m x").reason).toBe(
      'одна строка',
    )
    expect(splitInlineBypass('gh issue edit 1')).toEqual({
      reason: '',
      command: 'gh issue edit 1',
      wrongForm: '',
    })
  })

  it('PowerShell имеет СВОЮ форму префикса (ревью PR #346, MAJOR 2)', () => {
    expect(
      splitInlineBypass(`$env:DISPATCH_BYPASS='триаж бэклога'; gh issue edit 1`, 'PowerShell'),
    ).toEqual({
      reason: 'триаж бэклога',
      command: 'gh issue edit 1',
      wrongForm: '',
    })
    expect(
      splitInlineBypass('$env:DISPATCH_BYPASS = "фикс прода" ; git commit -m x', 'PowerShell')
        .reason,
    ).toBe('фикс прода')
  })

  it('форма чужой оболочки причину НЕ расходует — команда бы не исполнилась', () => {
    // В PowerShell `DISPATCH_BYPASS="x" gh …` не присваивание, а команда с таким
    // именем: она падает. Засчитать по ней побег значило бы съесть причину при
    // неисполнившейся мутации.
    const ps = splitInlineBypass('DISPATCH_BYPASS="фикс" gh issue edit 1', 'PowerShell')
    expect(ps.reason).toBe('')
    expect(ps.wrongForm).toBe('bash')
    // Вызов при этом обязан остаться СЧИТАННЫМ как мутация.
    expect(
      isMutatingCall('PowerShell', { command: 'DISPATCH_BYPASS="фикс" gh issue edit 1' }),
    ).toBe(true)
    expect(
      wrongShellForm({
        toolName: 'PowerShell',
        toolInput: { command: 'DISPATCH_BYPASS="фикс" gh issue edit 1' },
      }),
    ).toBe('bash')
    // Симметрично: powershell-форма в Bash-вызове тоже не побег.
    const bash = splitInlineBypass(`$env:DISPATCH_BYPASS='фикс'; git commit -m x`, 'Bash')
    expect(bash.reason).toBe('')
    expect(bash.wrongForm).toBe('powershell')
    expect(
      resolveBypassReason({
        toolName: 'Bash',
        toolInput: { command: `$env:DISPATCH_BYPASS='фикс'; git commit -m x` },
        env: env({}),
      }),
    ).toBe('')
  })

  it('префикс срезается ПЕРЕД предикатом мутации — иначе побег стал бы рубильником', () => {
    // С оставленным префиксом `gh issue edit` не стоял бы в начале сегмента и
    // MUTATING_COMMAND_RE промахнулся бы: вызов прошёл бы молча и БЕЗ записи.
    expect(isMutatingCall('Bash', { command: 'DISPATCH_BYPASS="x" gh issue edit 1' })).toBe(true)
  })

  it('резолв причины: команда → файл → env старта', () => {
    const shell = {
      toolName: 'Bash',
      toolInput: { command: 'DISPATCH_BYPASS="из команды" git push' },
    }
    expect(resolveBypassReason({ ...shell, bypassFile: 'из файла', env: env({}) })).toBe(
      'из команды',
    )
    expect(
      resolveBypassReason({
        toolName: 'Edit',
        toolInput: {},
        bypassFile: 'из файла',
        env: env({ [BYPASS_ENV]: 'из env' }),
      }),
    ).toBe('из файла')
    expect(
      resolveBypassReason({
        toolName: 'Edit',
        toolInput: {},
        env: env({ [BYPASS_ENV]: 'из env' }),
      }),
    ).toBe('из env')
    expect(resolveBypassReason({ toolName: 'Edit', toolInput: {}, env: env({}) })).toBe('')
  })

  it('файл-побег лежит рядом с файлом состояния сессии', () => {
    expect(bypassFilePath('/x/zero-dispatch-guard-state/abc.json')).toBe(
      '/x/zero-dispatch-guard-state/abc.bypass',
    )
  })

  it('взвод файла требует причину и каталог состояния гарда', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'zdg-arm-'))
    const good = resolve(dir, 'zero-dispatch-guard-state', 's1.bypass')
    expect(armBypass([good, ''], { log: () => {} })).toBe(2)
    expect(armBypass([resolve(dir, 'что-угодно.txt'), 'причина'], { log: () => {} })).toBe(2)
    expect(armBypass([good, 'правка', 'одной', 'строки'], { log: () => {} })).toBe(0)
    expect(readFileSync(good, 'utf8')).toBe('правка одной строки')
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

  it('называет форму префикса ОТДЕЛЬНО для каждой оболочки (MAJOR 2)', () => {
    expect(text).toContain(`${BYPASS_ENV}="<причина>" <твоя команда>`)
    expect(text).toContain(`$env:${BYPASS_ENV}='<причина>'; <твоя команда>`)
  })

  it('обещает отказ по ЛЮБОЙ уже названной причине, а не только по последней', () => {
    expect(text).toMatch(/ЛЮБУЮ уже названную/)
  })

  it('на форме чужой оболочки объясняет, что причина НЕ израсходована', () => {
    const hinted = blockMessage({ mutations: 6, exhausted: false, wrongForm: 'bash' })
    expect(hinted).toMatch(/НЕ засчитана и НЕ израсходована/)
    expect(hinted).toContain(`$env:${BYPASS_ENV}=`)
  })
})

describe('zero-dispatch-guard как процесс', () => {
  // Состояние гарда живёт в дереве, которое он резолвит из cwd вызова. Тест
  // даёт ему СВОЁ дерево во временном каталоге: не-git-каталог отправляет
  // `mainRepoRoot` в откат на `CLAUDE_PROJECT_DIR`, и счётчик кладётся туда,
  // а не в рабочий чекаут. Захардкоженный windows-путь тут не годится — на
  // Linux он не существует, запись состояния молча теряется, и гард никогда
  // не доходит до порога.
  const FAKE_TREE = mkdtempSync(resolve(tmpdir(), 'zdg-tree-'))
  const LEAD_ENV = {
    AI_AGENT: '',
    BBM_HOOKS_DISABLE: '',
    [BYPASS_ENV]: '',
    CLAUDE_PROJECT_DIR: FAKE_TREE,
  }

  function leadPayload(session: string, tool = 'Edit') {
    return JSON.stringify({
      tool_name: tool,
      tool_input: { file_path: resolve(FAKE_TREE, 'src/x.ts') },
      cwd: FAKE_TREE,
      session_id: session,
    })
  }

  function codexPayload(session: string, turn: string, tool = 'apply_patch') {
    return JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      tool_input:
        tool === 'apply_patch'
          ? {
              command: ['*** Begin Patch', '*** Update File: src/x.ts', '*** End Patch'].join('\n'),
            }
          : {
              task_name: 'executor',
              message: 'Implement the scoped change.',
              ...(tool === 'spawn_agent' ? { fork_turns: 'none' } : {}),
            },
      cwd: FAKE_TREE,
      session_id: session,
      turn_id: turn,
    })
  }

  function lifecyclePayload(
    event: 'SessionEnd' | 'SubagentStart' | 'SubagentStop',
    session: string,
    turn: string,
  ) {
    return JSON.stringify({
      hook_event_name: event,
      cwd: FAKE_TREE,
      session_id: session,
      turn_id: turn,
      agent_id: 'agent-405',
      agent_type: 'general-purpose',
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

  it('Codex lead блокируется на шестом apply_patch при zero spawn_agent', () => {
    const session = `zdg-codex-lead-${Date.now()}`
    const turn = `turn-lead-${Date.now()}`
    let last: ReturnType<typeof runHook> = { status: 0, stderr: '', stdout: '' }
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      last = runHook('zero-dispatch-guard.mjs', codexPayload(session, turn), LEAD_ENV)
    }
    expect(last.status).toBe(2)
  })

  it('SubagentStart marks only the executor turn and confirms dispatch for the lead session', () => {
    const session = `zdg-codex-executor-${Date.now()}`
    const turn = `turn-executor-${Date.now()}`
    expect(
      runHook(
        'codex-subagent-turn-recorder.mjs',
        lifecyclePayload('SubagentStart', session, turn),
        LEAD_ENV,
      ).status,
    ).toBe(0)

    const executorPayload = JSON.parse(codexPayload(session, turn))
    expect(isCodexExecutorTurn(executorPayload, { root: FAKE_TREE })).toBe(true)
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD * 2; i += 1) {
      expect(runHook('zero-dispatch-guard.mjs', codexPayload(session, turn), LEAD_ENV).status).toBe(
        0,
      )
    }

    const leadTurn = `turn-parent-${Date.now()}`
    const leadPayload = JSON.parse(codexPayload(session, leadTurn))
    expect(isCodexExecutorTurn(leadPayload, { root: FAKE_TREE })).toBe(false)
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD * 2; i += 1) {
      expect(
        runHook('zero-dispatch-guard.mjs', codexPayload(session, leadTurn), LEAD_ENV).status,
      ).toBe(0)
    }
  })

  it('SubagentStop keeps the executor exempt when another hook continues it', () => {
    const session = `zdg-codex-stop-${Date.now()}`
    const turn = `turn-stop-${Date.now()}`
    expect(
      runHook(
        'codex-subagent-turn-recorder.mjs',
        lifecyclePayload('SubagentStart', session, turn),
        LEAD_ENV,
      ).status,
    ).toBe(0)

    expect(
      runHook(
        'codex-subagent-turn-recorder.mjs',
        lifecyclePayload('SubagentStop', session, turn),
        LEAD_ENV,
      ).status,
    ).toBe(0)
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD * 2; i += 1) {
      expect(runHook('zero-dispatch-guard.mjs', codexPayload(session, turn), LEAD_ENV).status).toBe(
        0,
      )
    }
  })

  it('SessionEnd retires every executor exemption owned by the session', () => {
    const session = `zdg-codex-session-end-${Date.now()}`
    const turn = `turn-session-end-${Date.now()}`
    expect(
      runHook(
        'codex-subagent-turn-recorder.mjs',
        lifecyclePayload('SubagentStart', session, turn),
        LEAD_ENV,
      ).status,
    ).toBe(0)

    expect(
      runHook(
        'codex-subagent-turn-recorder.mjs',
        lifecyclePayload('SessionEnd', session, turn),
        LEAD_ENV,
      ).status,
    ).toBe(0)
    expect(isCodexExecutorTurn(JSON.parse(codexPayload(session, turn)), { root: FAKE_TREE })).toBe(
      false,
    )
  })

  it('a Codex spawn rejected by another PreToolUse hook does not disarm the guard', () => {
    const session = `zdg-codex-dispatch-${Date.now()}`
    const turn = `turn-dispatch-${Date.now()}`
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD - 1; i += 1) {
      runHook('zero-dispatch-guard.mjs', codexPayload(session, turn), LEAD_ENV)
    }
    const attempt = codexPayload(session, turn, 'spawn_agent')
    expect(runHook('zero-dispatch-guard.mjs', attempt, LEAD_ENV).status).toBe(0)
    expect(runHook('agent-model-guard.mjs', attempt, LEAD_ENV).status).toBe(2)
    expect(runHook('zero-dispatch-guard.mjs', codexPayload(session, turn), LEAD_ENV).status).toBe(2)
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

  /**
   * ПРОДАКШЕН-ПУТЬ ПОБЕГА. Env сюда НЕ ВПРЫСКИВАЕТСЯ намеренно: ровно этим
   * первая редакция и обманулась (ревью PR #346, BLOCKER 1) — тест инжектил
   * `DISPATCH_BYPASS` через `spawnSync({ env })`, канала которого у живой
   * сессии нет. Ниже сессия делает то же, что сделала бы настоящая: ставит
   * префикс в команду и взводит файл-побег.
   */
  function bypassPathFor(session: string) {
    return resolve(
      FAKE_TREE,
      '.claude/zero-dispatch-guard-state',
      `${session.replace(/[^A-Za-z0-9._-]/g, '_')}.bypass`,
    )
  }

  function shellPayload(session: string, command: string, tool = 'Bash') {
    return JSON.stringify({
      tool_name: tool,
      tool_input: { command },
      cwd: FAKE_TREE,
      session_id: session,
    })
  }

  it('канал A: инлайн-префикс в команде пропускает ровно следующую мутацию (без env)', () => {
    const session = `zdg-inline-${Date.now()}`
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      runHook(
        'zero-dispatch-guard.mjs',
        shellPayload(session, 'gh issue edit 1 --body x'),
        LEAD_ENV,
      )
    }
    // Блок стоит.
    expect(
      runHook(
        'zero-dispatch-guard.mjs',
        shellPayload(session, 'gh issue edit 1 --body x'),
        LEAD_ENV,
      ).status,
    ).toBe(2)
    const escaped = runHook(
      'zero-dispatch-guard.mjs',
      shellPayload(session, 'DISPATCH_BYPASS="триаж бэклога, правки текста issue" gh issue edit 1'),
      LEAD_ENV,
    )
    expect(escaped.status).toBe(0)
    expect(escaped.stderr).toContain('триаж бэклога, правки текста issue')
    // Израсходован: та же причина второй раз не проходит.
    expect(
      runHook(
        'zero-dispatch-guard.mjs',
        shellPayload(
          session,
          'DISPATCH_BYPASS="триаж бэклога, правки текста issue" gh issue edit 2',
        ),
        LEAD_ENV,
      ).status,
    ).toBe(2)
  })

  it('канал A в PowerShell: своя форма префикса работает через продакшен-путь', () => {
    const session = `zdg-ps-${Date.now()}`
    const cmd = 'gh issue edit 1 --body x'
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      runHook('zero-dispatch-guard.mjs', shellPayload(session, cmd, 'PowerShell'), LEAD_ENV)
    }
    expect(
      runHook('zero-dispatch-guard.mjs', shellPayload(session, cmd, 'PowerShell'), LEAD_ENV).status,
    ).toBe(2)
    const escaped = runHook(
      'zero-dispatch-guard.mjs',
      shellPayload(session, `$env:DISPATCH_BYPASS='правка текста issue'; ${cmd}`, 'PowerShell'),
      LEAD_ENV,
    )
    expect(escaped.status).toBe(0)
    expect(escaped.stderr).toContain('правка текста issue')
  })

  it('bash-форма в вызове PowerShell блокируется и причину НЕ расходует (MAJOR 2)', () => {
    const session = `zdg-ps-wrong-${Date.now()}`
    const cmd = 'gh issue edit 1 --body x'
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      runHook('zero-dispatch-guard.mjs', shellPayload(session, cmd, 'PowerShell'), LEAD_ENV)
    }
    // Bash-префикс в PowerShell: сама команда упала бы, поэтому побегом это не
    // считается — блок стоит, а сообщение называет правильную форму.
    const wrong = runHook(
      'zero-dispatch-guard.mjs',
      shellPayload(session, `DISPATCH_BYPASS="одна причина" ${cmd}`, 'PowerShell'),
      LEAD_ENV,
    )
    expect(wrong.status).toBe(2)
    expect(wrong.stderr).toMatch(/НЕ засчитана и НЕ израсходована/)
    expect(wrong.stderr).toContain(`$env:${BYPASS_ENV}=`)
    // Причина не съедена: та же причина в ПРАВИЛЬНОЙ форме проходит.
    const escaped = runHook(
      'zero-dispatch-guard.mjs',
      shellPayload(session, `$env:DISPATCH_BYPASS='одна причина'; ${cmd}`, 'PowerShell'),
      LEAD_ENV,
    )
    expect(escaped.status).toBe(0)
    expect(escaped.stderr).toContain('одна причина')
  })

  it('чередование двух причин побег не размножает (продакшен-путь, MAJOR 1)', () => {
    const session = `zdg-alt-${Date.now()}`
    const edit = (reason: string) =>
      runHook(
        'zero-dispatch-guard.mjs',
        shellPayload(session, `DISPATCH_BYPASS="${reason}" gh issue edit 1`),
        LEAD_ENV,
      )
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      runHook('zero-dispatch-guard.mjs', shellPayload(session, 'gh issue edit 1'), LEAD_ENV)
    }
    expect(edit('причина r1').status).toBe(0)
    expect(edit('причина r2').status).toBe(0)
    expect(edit('причина r1').status).toBe(2)
    expect(edit('причина r2').status).toBe(2)
    // Свежая причина по-прежнему проходит — это запись, а не рубильник.
    expect(edit('причина r3').status).toBe(0)
  })

  it('канал B: файл-побег, взведённый НЕ мутирующей командой, пропускает Edit (без env)', () => {
    const session = `zdg-file-${Date.now()}`
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV)
    }
    const blocked = runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV)
    expect(blocked.status).toBe(2)
    const bypassPath = bypassPathFor(session)
    // Сообщение блока называет ТОЧНЫЙ путь — сессия свой session_id не знает.
    expect(blocked.stderr).toContain(bypassPath)
    expect(blocked.stderr).toContain(ARM_BYPASS_FLAG)

    // Команда взвода сама сквозь блок проходит: она не мутирующая.
    expect(
      runHook(
        'zero-dispatch-guard.mjs',
        shellPayload(session, `node "${GUARD}" ${ARM_BYPASS_FLAG} "${bypassPath}" "причина"`),
        LEAD_ENV,
      ).status,
    ).toBe(0)
    const armed = spawnSync(
      process.execPath,
      [GUARD, ARM_BYPASS_FLAG, bypassPath, 'правка одной строки в доке'],
      { encoding: 'utf8' },
    )
    expect(armed.status).toBe(0)

    const escaped = runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV)
    expect(escaped.status).toBe(0)
    expect(escaped.stderr).toContain('правка одной строки в доке')
    // Съеден: файла больше нет, следующая мутация снова блокируется.
    expect(existsSync(bypassPath)).toBe(false)
    expect(runHook('zero-dispatch-guard.mjs', leadPayload(session), LEAD_ENV).status).toBe(2)
  })

  it('побег без причины побегом не является (продакшен-путь)', () => {
    const session = `zdg-noreason-${Date.now()}`
    for (let i = 0; i < ZERO_DISPATCH_BLOCK_THRESHOLD; i += 1) {
      runHook('zero-dispatch-guard.mjs', shellPayload(session, 'git commit -m x'), LEAD_ENV)
    }
    expect(
      runHook(
        'zero-dispatch-guard.mjs',
        shellPayload(session, 'DISPATCH_BYPASS="" git commit -m x'),
        LEAD_ENV,
      ).status,
    ).toBe(2)
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
