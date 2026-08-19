import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { decideAgentModel } from '../../tools/hooks/agent-model-guard.mjs'
import { decideStaging } from '../../tools/hooks/dispatch-guard.mjs'
import {
  decideSecretEcho,
  hasSensitiveVarRef,
  isSensitivePath,
} from '../../tools/hooks/secret-echo-guard.mjs'
import { decideMergeWarn } from '../../tools/hooks/merge-gate.mjs'

/**
 * Гарды, блокирующие по содержимому вызова (#91): субагент без явной модели и
 * команда, печатающая секрет в вывод сессии. Плюс общий для всего стека
 * контракт fail-open — битый stdin никогда не даёт ненулевой код.
 */

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/hooks')

describe('agent-model-guard', () => {
  it('блокирует Agent-вызов без model — иначе субагент наследует модель лида', () => {
    const d = decideAgentModel({
      toolName: 'Agent',
      toolInput: { subagent_type: 'general-purpose', prompt: 'сделай' },
    })
    expect(d.block).toBe(true)
    expect(d.reason).toBe('missing')
  })

  it('блокирует явный Fable — Fable оркеструет, но субагентом не бывает', () => {
    expect(
      decideAgentModel({ toolName: 'Agent', toolInput: { model: 'fable', prompt: 'x' } }),
    ).toMatchObject({ block: true, reason: 'fable' })
  })

  it('пропускает вызов с явной моделью', () => {
    expect(
      decideAgentModel({
        toolName: 'Agent',
        toolInput: { subagent_type: 'bbm-explorer', model: 'sonnet' },
      }).block,
    ).toBe(false)
    expect(decideAgentModel({ toolName: 'Task', toolInput: { model: 'opus' } }).block).toBe(false)
  })

  it('пропускает fork (модель там наследуется по устройству инструмента) и чужие инструменты', () => {
    expect(
      decideAgentModel({ toolName: 'Agent', toolInput: { subagent_type: 'fork' } }).block,
    ).toBe(false)
    expect(decideAgentModel({ toolName: 'Bash', toolInput: {} }).block).toBe(false)
  })

  it('пустой model считается отсутствующим', () => {
    expect(decideAgentModel({ toolName: 'Agent', toolInput: { model: '   ' } }).block).toBe(true)
  })
})

describe('dispatch-guard: staging gate', () => {
  const staged =
    'Read the issue bodies and write the rewritten text as drafts on disk — do not mutate ' +
    'anything on GitHub; the lead applies them afterwards.'

  it('предупреждает на брифе, который складывает результат в черновики вместо применения', () => {
    const d = decideStaging({ toolName: 'Agent', prompt: staged })
    expect(d.warn).toBe(true)
  })

  it('молчит, когда staging объявлен явным токеном STAGED:', () => {
    expect(
      decideStaging({
        toolName: 'Agent',
        prompt: `${staged}\nSTAGED: irreversible — the edit deletes owner-authored history.`,
      }).warn,
    ).toBe(false)
    expect(
      decideStaging({ toolName: 'Task', prompt: `${staged}\nSTAGED: owner-preapproval` }).warn,
    ).toBe(false)
  })

  it('молчит на брифе прямого применения и на не-диспетчеризующем инструменте', () => {
    expect(
      decideStaging({
        toolName: 'Agent',
        prompt: 'Read each issue body, rewrite it and apply the edit with `gh issue edit`.',
      }).warn,
    ).toBe(false)
    expect(decideStaging({ toolName: 'Edit', prompt: staged }).warn).toBe(false)
    expect(decideStaging({ toolName: 'Agent', prompt: undefined }).warn).toBe(false)
  })

  // Ревью PR #148 (refs #149): «do not mutate» это ЛЮБОЙ read-only бриф, а не
  // признак staging. Признаком остаётся только сам черновик на диске.
  it('ловит фразу остановленного пайплайна и не ловит read-only бриф разведчика', () => {
    expect(
      decideStaging({ toolName: 'Agent', prompt: 'drafts on disk only; the lead applies them' })
        .warn,
    ).toBe(true)
    expect(
      decideStaging({ toolName: 'Agent', prompt: 'Do NOT mutate anything on GitHub' }).warn,
    ).toBe(false)
  })

  // Те же carve-out'ы, что у streak-половины: изолированная сессия и рубильник.
  it('молчит в worktree-сессии и при явном opt-out', () => {
    expect(
      decideStaging({
        toolName: 'Agent',
        prompt: staged,
        cwd: 'C:/Users/sidor/repos/bbm-portal/.claude/worktrees/133',
      }).warn,
    ).toBe(false)
    expect(
      decideStaging({
        toolName: 'Agent',
        prompt: staged,
        projectDir: 'C:/Users/sidor/repos/bbm-portal/.claude/worktrees/133',
      }).warn,
    ).toBe(false)
    expect(decideStaging({ toolName: 'Agent', prompt: staged, carveOut: true }).warn).toBe(false)
  })
})

describe('secret-echo-guard', () => {
  it('блокирует чтение .env-подобных файлов в вывод сессии', () => {
    expect(decideSecretEcho('cat deploy/.env.prod')).toMatchObject({ block: true, rule: 'reader' })
    expect(decideSecretEcho('Get-Content .env')).toMatchObject({ block: true })
    expect(decideSecretEcho('head -n 5 ~/.aws/credentials')).toMatchObject({ block: true })
    expect(decideSecretEcho('grep -n TOKEN deploy/.env.preview')).toMatchObject({ block: true })
  })

  it('блокирует эхо переменной с секретным именем', () => {
    expect(decideSecretEcho('echo $PLANE_API_TOKEN')).toMatchObject({ block: true, rule: 'echo' })
    expect(decideSecretEcho('echo "%GITHUB_SECRET%"')).toMatchObject({ block: true })
  })

  it('не трогает шаблоны, каталоги и не-читающие команды', () => {
    expect(decideSecretEcho('cat .env.example').block).toBe(false)
    expect(decideSecretEcho('git add .env.example').block).toBe(false)
    expect(decideSecretEcho('ls -la deploy/').block).toBe(false)
    expect(decideSecretEcho('cp .env.example .env').block).toBe(false)
  })

  it('не срабатывает на паттерн-аргументах и исходниках с «token» в имени', () => {
    expect(decideSecretEcho('grep -rn "token" src/').block).toBe(false)
    expect(decideSecretEcho('cat src/theme/tokens.css').block).toBe(false)
    expect(decideSecretEcho("sed -n 's/secret=.*/x/p' app.log").block).toBe(false)
  })

  it('пропускает санкционированные способы: в файл и в переменную', () => {
    expect(decideSecretEcho('cat deploy/.env.prod > /tmp/x').block).toBe(false)
    expect(decideSecretEcho('TOKEN=$(cat deploy/.env.prod)').block).toBe(false)
  })

  it('видит нарушение в любом сегменте составной команды', () => {
    expect(decideSecretEcho('cd deploy && cat .env.prod | head -3').block).toBe(true)
  })

  it('распознаватели путей и переменных', () => {
    expect(isSensitivePath('deploy/.env.prod')).toBe(true)
    expect(isSensitivePath('.env.example')).toBe(false)
    expect(isSensitivePath('src/config.environment.ts')).toBe(false)
    expect(isSensitivePath('-n')).toBe(false)
    expect(hasSensitiveVarRef('$env:PLANE_API_TOKEN')).toBe(true)
    expect(hasSensitiveVarRef('$PORT')).toBe(false)
  })
})

/**
 * Дампы РАЗРЕШЁННОГО окружения (#262). Симптом: 2026-08-18 субагент на проде
 * выполнил `ssh portal-prod-tw docker compose --profile tools config` — вывод
 * содержал каждое значение из host-only `.env.prod` и уехал в транскрипт.
 */
describe('secret-echo-guard: дампы разрешённого окружения (#262)', () => {
  it('блокирует `docker compose config` в любом написании, включая инцидентную ssh-форму', () => {
    expect(decideSecretEcho('docker compose config')).toMatchObject({
      block: true,
      rule: 'compose-config',
    })
    expect(decideSecretEcho('docker compose --profile tools config').block).toBe(true)
    expect(decideSecretEcho('docker-compose -f deploy/docker-compose.prod.yml config').block).toBe(
      true,
    )
    expect(
      decideSecretEcho('docker compose --env-file deploy/.env.prod -f a.yml config').block,
    ).toBe(true)
    expect(decideSecretEcho('ssh portal-prod-tw docker compose --profile tools config').block).toBe(
      true,
    )
    expect(decideSecretEcho('ssh portal-prod-tw "docker compose config"').block).toBe(true)
  })

  it('пропускает инвентарные флаги compose — они печатают имена, а не значения', () => {
    expect(decideSecretEcho('docker compose config --services').block).toBe(false)
    expect(decideSecretEcho('docker compose --profile tools config --profiles').block).toBe(false)
    expect(decideSecretEcho('docker compose config --volumes').block).toBe(false)
    expect(decideSecretEcho('ssh portal-prod-tw docker compose config --services').block).toBe(
      false,
    )
  })

  it('пропускает прочие подкоманды compose и редирект модели в файл', () => {
    expect(decideSecretEcho('docker compose ps').block).toBe(false)
    expect(decideSecretEcho('docker compose -f deploy/docker-compose.prod.yml up -d').block).toBe(
      false,
    )
    expect(decideSecretEcho('docker compose config > /tmp/model.yml').block).toBe(false)
  })

  it('блокирует `docker inspect` без сужающего --format — он печатает секцию Env', () => {
    expect(decideSecretEcho('docker inspect bbm-portal-app-1')).toMatchObject({
      block: true,
      rule: 'docker-inspect',
    })
    expect(decideSecretEcho('docker container inspect bbm-portal-app-1').block).toBe(true)
    expect(decideSecretEcho('ssh portal-prod-tw docker inspect bbm-portal-app-1').block).toBe(true)
    expect(decideSecretEcho("docker inspect -f '{{json .Config}}' app").block).toBe(true)
    expect(decideSecretEcho("docker inspect --format '{{.Config.Env}}' app").block).toBe(true)
    expect(decideSecretEcho("docker inspect -f '{{json .}}' app").block).toBe(true)
  })

  it('пропускает docker inspect с шаблоном, не тянущим Env', () => {
    expect(decideSecretEcho("docker inspect -f '{{.State.Status}}' app").block).toBe(false)
    expect(decideSecretEcho("docker inspect --format '{{.Config.Image}}' app").block).toBe(false)
    expect(
      decideSecretEcho(
        "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' app",
      ).block,
    ).toBe(false)
    expect(
      decideSecretEcho("ssh portal-prod-tw docker inspect -f '{{.State.Running}}' app").block,
    ).toBe(false)
  })

  it('блокирует голые env / printenv, в том числе через ssh и в конвейере', () => {
    expect(decideSecretEcho('env')).toMatchObject({ block: true, rule: 'env-dump' })
    expect(decideSecretEcho('env | grep -i plane').block).toBe(true)
    expect(decideSecretEcho('printenv').block).toBe(true)
    expect(decideSecretEcho('printenv PLANE_API_TOKEN').block).toBe(true)
    expect(decideSecretEcho('ssh portal-prod-tw printenv').block).toBe(true)
    expect(decideSecretEcho("ssh portal-prod-tw 'env'").block).toBe(true)
  })

  it('не трогает env-префикс перед командой и посторонние «env» в имени', () => {
    expect(decideSecretEcho('env NODE_ENV=test pnpm test:unit').block).toBe(false)
    expect(decideSecretEcho('env -u NODE_OPTIONS node script.mjs').block).toBe(false)
    expect(decideSecretEcho('pnpm env use --global 22').block).toBe(false)
    expect(decideSecretEcho('node --env-file=.env.local script.mjs').block).toBe(false)
    expect(decideSecretEcho('env > /tmp/env.txt').block).toBe(false)
  })

  it('разворачивает ssh-обёртку и ловит чтение .env на удалённом боксе', () => {
    expect(decideSecretEcho("ssh portal-prod-tw 'cat .env.prod'")).toMatchObject({
      block: true,
      rule: 'reader',
    })
    expect(decideSecretEcho('ssh portal-prod-tw cat bbm-portal/deploy/.env.prod').block).toBe(true)
    expect(
      decideSecretEcho('ssh -i ~/.ssh/id_ed25519 portal-prod-tw "cat deploy/.env.postgres"').block,
    ).toBe(true)
    expect(decideSecretEcho('ssh portal-prod-tw "tail -5 deploy/.env.prod"').block).toBe(true)
    expect(decideSecretEcho("ssh portal-prod-tw 'cat deploy/.env.prod > /tmp/x'").block).toBe(false)
    expect(decideSecretEcho('ssh portal-prod-tw docker compose ps').block).toBe(false)
  })
})

describe('merge-gate', () => {
  it('предупреждает на gh pr merge в любой форме команды', () => {
    expect(
      decideMergeWarn({ toolName: 'Bash', toolInput: { command: 'gh pr merge --squash' } }),
    ).toEqual({
      warn: true,
    })
    expect(
      decideMergeWarn({
        toolName: 'Bash',
        toolInput: { command: 'git fetch origin && gh pr merge 91 --squash --delete-branch' },
      }).warn,
    ).toBe(true)
  })

  it('молчит на прочих командах и инструментах', () => {
    expect(
      decideMergeWarn({ toolName: 'Bash', toolInput: { command: 'gh pr view 91' } }).warn,
    ).toBe(false)
    expect(decideMergeWarn({ toolName: 'Edit', toolInput: {} }).warn).toBe(false)
  })
})

/** Прогон хука как процесса: возвращает код выхода. */
function runHook(hook: string, input: string, extraEnv: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [resolve(HOOKS_DIR, hook)], {
    input,
    encoding: 'utf8',
    // Временный каталог: `session-flag-writer` резолвит корень репо от cwd, и вне
    // git-дерева он не трогает состояние настоящего чекаута.
    cwd: tmpdir(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...extraEnv },
  })
  return { status: res.status, stderr: res.stderr ?? '' }
}

describe('fail-open: битый stdin не даёт ненулевого кода ни одному хуку', () => {
  const hooks = [
    'session-flag-writer.mjs',
    'worktree-path-guard.mjs',
    'main-tree-read-guard.mjs',
    'dispatch-guard.mjs',
    'agent-model-guard.mjs',
    'askuserquestion-context-guard.mjs',
    'secret-echo-guard.mjs',
    'merge-gate.mjs',
    'completion-report-gate.mjs',
    'deviations-gate.mjs',
  ]

  it.each(hooks)('%s выходит с кодом 0 на мусоре во входе', (hook) => {
    expect(runHook(hook, '{ это не JSON').status).toBe(0)
  })
})

describe('блокирующие хуки как процессы', () => {
  it('agent-model-guard возвращает 2 без model и 0 с моделью', () => {
    const blocked = runHook(
      'agent-model-guard.mjs',
      JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose' } }),
    )
    expect(blocked.status).toBe(2)
    expect(blocked.stderr).toContain('agent-model guard')
    expect(
      runHook(
        'agent-model-guard.mjs',
        JSON.stringify({ tool_name: 'Agent', tool_input: { model: 'opus' } }),
      ).status,
    ).toBe(0)
  })

  it('worktree-path-guard возвращает 2 на побеге из worktree', () => {
    const blocked = runHook(
      'worktree-path-guard.mjs',
      JSON.stringify({
        tool_name: 'Write',
        cwd: 'C:/Users/sidor/repos/bbm-portal/.claude/worktrees/91',
        tool_input: { file_path: 'C:/Users/sidor/repos/bbm-portal/src/app/page.tsx' },
      }),
    )
    expect(blocked.status).toBe(2)
    expect(blocked.stderr).toContain('BLOCKED')
  })

  it('рубильник BBM_HOOKS_DISABLE=1 снимает блок', () => {
    const payload = JSON.stringify({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'general-purpose' },
    })
    expect(runHook('agent-model-guard.mjs', payload).status).toBe(2)
    expect(runHook('agent-model-guard.mjs', payload, { BBM_HOOKS_DISABLE: '1' }).status).toBe(0)
  })

  it('askuserquestion-context-guard возвращает 2 на коротком вопросе с голым #N', () => {
    const blocked = runHook(
      'askuserquestion-context-guard.mjs',
      JSON.stringify({
        tool_name: 'AskUserQuestion',
        session_id: 'spec-session',
        tool_input: { questions: [{ header: 'Порядок', question: 'Берём #107?', options: [] }] },
      }),
    )
    expect(blocked.status).toBe(2)
    expect(blocked.stderr).toContain('askuserquestion guard')
  })

  it('secret-echo-guard возвращает 2 на чтении .env в вывод', () => {
    expect(
      runHook(
        'secret-echo-guard.mjs',
        JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cat deploy/.env.prod' } }),
      ).status,
    ).toBe(2)
  })

  it('secret-echo-guard возвращает 2 на инцидентной команде #262 и 0 на инвентарных флагах', () => {
    const incident = runHook(
      'secret-echo-guard.mjs',
      JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'ssh portal-prod-tw docker compose --profile tools config' },
      }),
    )
    expect(incident.status).toBe(2)
    expect(incident.stderr).toContain('no-secret-echo')
    expect(
      runHook(
        'secret-echo-guard.mjs',
        JSON.stringify({
          tool_name: 'Bash',
          tool_input: { command: 'ssh portal-prod-tw docker compose config --services' },
        }),
      ).status,
    ).toBe(0)
  })
})
