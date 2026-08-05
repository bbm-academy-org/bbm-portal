import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  collectCopy,
  evaluateAskUserQuestion,
  jargonHitsIn,
  restoreScopeHit,
  surfaceClaimHit,
} from '../../tools/hooks/askuserquestion-calibration-guard.mjs'
import { decideAskUserQuestion } from '../../tools/hooks/askuserquestion-context-guard.mjs'

/**
 * Calibration half of the AskUserQuestion pair (#134). The sibling
 * askuserquestion-context-guard.mjs BLOCKs on whether the question is askable at
 * all (unanswered repeat, bare `#N`); this one only WARNs about whether the
 * question is the OWNER's to answer and whether its copy reads without decoding.
 * The last describe block pins that boundary — a second verdict on
 * self-containment would be noise, so it must not exist here.
 */

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/hooks')

function ask(question: string, options: { label?: string; description?: string }[] = []) {
  return { questions: [{ header: 'Выбор', question, options }] }
}

describe('collectCopy', () => {
  it('collects every owner-facing string and tolerates broken shapes', () => {
    const copies = collectCopy({
      questions: [
        { header: 'Выбор', question: 'Что делаем?', options: [{ label: 'A', description: 'd' }] },
        null,
        { question: 42, options: 'не массив' },
      ],
    })
    expect(copies).toEqual(['Что делаем?', 'Выбор', 'A', 'd'])
    expect(collectCopy(null)).toEqual([])
    expect(collectCopy({ questions: 'нет' })).toEqual([])
  })
})

describe('jargon lint', () => {
  it('matches whole tokens only', () => {
    expect(jargonHitsIn('Сравнить по SHA или по тегу?')).toEqual(['SHA'])
    expect(jargonHitsIn('SHALL we ship it?')).toEqual([])
    expect(jargonHitsIn('Patch the PATCH file')).toEqual([])
    expect(jargonHitsIn('Нужен PAT для приватного репозитория')).toEqual(['PAT'])
  })

  it('reports the hits sorted and de-duplicated across all copy', () => {
    const { jargonHits, systemMessage } = evaluateAskUserQuestion(
      ask('Делаем rebase или squash?', [{ label: 'rebase', description: 'в своём worktree' }]),
    )
    expect(jargonHits).toEqual(['rebase', 'squash', 'worktree'])
    expect(systemMessage).toContain('jargon lint')
  })

  it('clean owner-facing copy gets no jargon line', () => {
    const { jargonHits, systemMessage } = evaluateAskUserQuestion(
      ask('Показываем часы за месяц одной таблицей или разбиваем по неделям?'),
    )
    expect(jargonHits).toEqual([])
    expect(systemMessage).not.toContain('jargon lint')
  })
})

describe('restore/remediation-scope detector', () => {
  it('fires when a restore verb and a scope cue share one string', () => {
    expect(restoreScopeHit(['Восстанавливаем только удалённый файл или весь каталог?'])).toBe(true)
    expect(restoreScopeHit(['Should we restore only the deleted file, or the entire dir?'])).toBe(
      true,
    )
  })

  it('does not fire on the correctness adjective or on split strings', () => {
    expect(restoreScopeHit(['Верный ли это порядок — сначала процессы?'])).toBe(false)
    expect(restoreScopeHit(['Восстановление пароля', 'только для админов'])).toBe(false)
    expect(restoreScopeHit('не массив' as unknown as string[])).toBe(false)
  })

  it('appends its own advisory line', () => {
    const { restoreScope, systemMessage } = evaluateAskUserQuestion(
      ask('Откатываем только последний коммит или всё?'),
    )
    expect(restoreScope).toBe(true)
    expect(systemMessage).toContain('restore/remediation-scope')
  })
})

describe('live-surface claim detector', () => {
  it('fires when a surface reference and an asserted state share one string', () => {
    expect(surfaceClaimHit(['Страница /p/hours is a stub — доделываем или выкатываем?'])).toBe(true)
  })

  it('does not fire on a plain routing choice', () => {
    expect(surfaceClaimHit(['Куда ведём владельца после логина — на дашборд или на список?'])).toBe(
      false,
    )
    expect(surfaceClaimHit([])).toBe(false)
  })

  it('appends its own advisory line', () => {
    const { surfaceClaim, systemMessage } = evaluateAskUserQuestion(
      ask('page.tsx содержит заглушку — правим или переписываем?'),
    )
    expect(surfaceClaim).toBe(true)
    expect(systemMessage).toContain('live-surface claim')
  })
})

describe('the calibration reminder itself', () => {
  it('is emitted for every well-formed call, and for a malformed one too', () => {
    for (const input of [ask('Какой тон у заголовка?'), {}, null, { questions: 'нет' }]) {
      expect(evaluateAskUserQuestion(input).systemMessage).toContain('AskUserQuestion calibration')
    }
  })

  it('names both sides of the classification: owner-visible design vs engineering', () => {
    const { systemMessage } = evaluateAskUserQuestion(ask('Какой тон у заголовка?'))
    expect(systemMessage).toContain('OWNER-VISIBLE DESIGN')
    expect(systemMessage).toContain('ENGINEERING')
    expect(systemMessage).toContain('never blocks')
  })
})

describe('boundary with askuserquestion-context-guard (no duplicated verdicts)', () => {
  const bareRef = ask('Берём #107 в работу?')

  it('the context guard blocks the bare `#N` question — the calibration guard does not repeat it', () => {
    expect(
      decideAskUserQuestion({ toolName: 'AskUserQuestion', toolInput: bareRef, state: {} }).block,
    ).toBe(true)
    const { jargonHits, restoreScope, surfaceClaim, systemMessage } =
      evaluateAskUserQuestion(bareRef)
    expect({ jargonHits, restoreScope, surfaceClaim }).toEqual({
      jargonHits: [],
      restoreScope: false,
      surfaceClaim: false,
    })
    // Only the calibration line: no self-containment verdict of its own.
    expect(systemMessage.split('\n')).toHaveLength(1)
  })
})

function runHook(input: string, extraEnv: Record<string, string> = {}) {
  const res = spawnSync(
    process.execPath,
    [resolve(HOOKS_DIR, 'askuserquestion-calibration-guard.mjs')],
    {
      input,
      encoding: 'utf8',
      cwd: tmpdir(),
      env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...extraEnv },
    },
  )
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

const PAYLOAD = JSON.stringify({
  tool_name: 'AskUserQuestion',
  session_id: 'spec-session',
  tool_input: ask('Делаем rebase или merge?'),
})

describe('askuserquestion-calibration-guard as a process', () => {
  it('WARNs on exit 0 and never pre-authorises the call', () => {
    const res = runHook(PAYLOAD)
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    const out = JSON.parse(res.stdout)
    expect(out.systemMessage).toContain('AskUserQuestion calibration')
    expect(out.systemMessage).toContain('jargon lint')
    // Stack convention (shared.mjs emitWarn, review PR #99): no permissionDecision.
    expect(out.hookSpecificOutput).toBeUndefined()
    expect(res.stdout).not.toContain('permissionDecision')
  })

  it('says nothing on another tool and under the kill switch', () => {
    expect(
      runHook(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.ts' } })).stdout,
    ).toBe('')
    expect(runHook(PAYLOAD, { BBM_HOOKS_DISABLE: '1' }).stdout).toBe('')
  })

  it('fail-open: garbage stdin exits 0 without output', () => {
    const res = runHook('{ это не JSON')
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
  })
})
