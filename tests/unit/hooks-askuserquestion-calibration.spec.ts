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

/**
 * A genuinely clean question: an owner-visible product choice, plain Russian, no
 * jargon token, no restore frame, no asserted claim about a live surface. This
 * is the fixture the guard must stay SILENT on (review PR #150, blocker 2).
 */
const CLEAN = ask('Показываем часы за месяц одной таблицей или разбиваем по неделям?', [
  { label: 'Одной таблицей', description: 'Весь месяц подряд, с итогом внизу.' },
  { label: 'По неделям', description: 'Четыре блока с промежуточными итогами.' },
])

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

  it('clean owner-facing copy gets no jargon line — and no banner at all', () => {
    const { jargonHits, systemMessage } = evaluateAskUserQuestion(CLEAN)
    expect(jargonHits).toEqual([])
    expect(systemMessage).toBeNull()
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

describe('the banner fires only on a finding (review PR #150)', () => {
  it('a clean question — and a malformed input — produce NO message at all', () => {
    for (const input of [
      CLEAN,
      ask('Какой тон у заголовка карточки?'),
      {},
      null,
      { questions: 1 },
    ]) {
      const d = evaluateAskUserQuestion(input)
      expect(d.systemMessage).toBeNull()
      expect(d.findings).toEqual([])
    }
  })

  it('names what was flagged, and only what was flagged', () => {
    const jargonOnly = evaluateAskUserQuestion(ask('Делаем rebase или сохраняем историю?'))
    expect(jargonOnly.findings).toEqual(['jargon'])
    expect(jargonOnly.systemMessage).toContain('Flagged: jargon.')
    expect(jargonOnly.systemMessage).not.toContain('live-surface claim')

    const both = evaluateAskUserQuestion(
      ask('Откатываем только последний коммит или всё, что page.tsx содержит?'),
    )
    expect(both.findings).toEqual(['restore-scope', 'surface-claim'])
    expect(both.systemMessage).toContain('Flagged: restore-scope, surface-claim.')
  })

  it('the classification paragraph is the preamble of a flagged banner', () => {
    const { systemMessage } = evaluateAskUserQuestion(ask('Делаем rebase или merge?'))
    expect(systemMessage).toContain('AskUserQuestion calibration')
    expect(systemMessage).toContain('OWNER-VISIBLE DESIGN')
    expect(systemMessage).toContain('ENGINEERING')
    expect(systemMessage).toContain('never blocks')
  })
})

describe('boundary with askuserquestion-context-guard (no duplicated verdicts)', () => {
  const bareRef = ask('Берём #107 в работу?')

  it('the context guard blocks the bare `#N` question — the calibration guard says nothing', () => {
    expect(
      decideAskUserQuestion({ toolName: 'AskUserQuestion', toolInput: bareRef, state: {} }).block,
    ).toBe(true)
    // Self-containment is the context guard's jurisdiction: no finding here, so
    // no second verdict on the same input.
    expect(evaluateAskUserQuestion(bareRef)).toMatchObject({
      systemMessage: null,
      findings: [],
      jargonHits: [],
      restoreScope: false,
      surfaceClaim: false,
    })
  })

  it('the clean question passes both guards in silence', () => {
    expect(
      decideAskUserQuestion({ toolName: 'AskUserQuestion', toolInput: CLEAN, state: {} }).block,
    ).toBe(false)
    expect(evaluateAskUserQuestion(CLEAN).systemMessage).toBeNull()
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

function payload(toolInput: unknown) {
  return JSON.stringify({
    tool_name: 'AskUserQuestion',
    session_id: 'spec-session',
    tool_input: toolInput,
  })
}

const PAYLOAD = payload(ask('Делаем rebase или merge?'))

describe('askuserquestion-calibration-guard as a process', () => {
  it('WARNs on a flagged question, on exit 0, never pre-authorising the call', () => {
    const res = runHook(PAYLOAD)
    expect(res.status).toBe(0)
    expect(res.stderr).toBe('')
    const out = JSON.parse(res.stdout)
    expect(out.systemMessage).toContain('AskUserQuestion calibration')
    expect(out.systemMessage).toContain('Flagged: jargon.')
    // Stack convention (shared.mjs emitWarn, review PR #99): no permissionDecision.
    expect(out.hookSpecificOutput).toBeUndefined()
    expect(res.stdout).not.toContain('permissionDecision')
  })

  it('writes NOTHING on a clean question — the owner sees no banner', () => {
    const res = runHook(payload(CLEAN))
    expect(res.status).toBe(0)
    expect(res.stdout).toBe('')
    expect(res.stderr).toBe('')
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
