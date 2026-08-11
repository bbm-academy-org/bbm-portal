import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FLAG_REL,
  FRESH_WINDOW_MS,
  emitWarn,
  hooksDisabled,
  inWorktree,
  isUnder,
  liveSessionsFromFlag,
  stateFilePath,
  targetPath,
} from '../../tools/hooks/shared.mjs'
import {
  PARALLEL_FLAG_REL,
  SESSION_WINDOW_MS,
  buildParallelFlag,
  encodeProjectSlug,
  isRepoSessionDir,
  liveSessions,
} from '../../tools/hooks/session-flag-writer.mjs'
import {
  WARN_THROTTLE_MS,
  decideReadAction,
  decideWarn,
} from '../../tools/hooks/main-tree-read-guard.mjs'
import { decideEscapeBlock, decideWriteWarn } from '../../tools/hooks/worktree-path-guard.mjs'
import {
  DISPATCH_WARN_THRESHOLD,
  decideDispatch,
  isCarveOut,
  readStreak,
} from '../../tools/hooks/dispatch-guard.mjs'

/**
 * Хуки параллельных сессий (#91). Флаг живых сессий пишет один хук, читают три —
 * поэтому контракт файла и окно свежести проверяются как общая константа, а не
 * как деталь каждого гарда.
 */

const MAIN = 'C:/Users/sidor/repos/bbm-portal'
const WORKTREE = `${MAIN}/.claude/worktrees/91`
const NOW = 1_700_000_000_000

function flagWith(ids: string[]) {
  return {
    generatedAt: new Date(NOW).toISOString(),
    liveSessions: ids.length,
    sessions: ids.map((id) => ({ id, logPath: `C:/logs/${id}.jsonl` })),
  }
}

describe('контракт флага параллельных сессий', () => {
  it('writer и гарды называют один и тот же файл и одно и то же окно свежести', () => {
    expect(PARALLEL_FLAG_REL).toBe(FLAG_REL)
    expect(SESSION_WINDOW_MS).toBe(FRESH_WINDOW_MS)
    expect(FRESH_WINDOW_MS).toBe(10 * 60 * 1000)
  })

  it('слаг каталога логов кодирует путь по правилам Claude Code', () => {
    expect(encodeProjectSlug('C:\\Users\\sidor\\repos\\bbm-portal')).toBe(
      'C--Users-sidor-repos-bbm-portal',
    )
  })

  it('каталог логов репо — это основное дерево и его worktree, но не соседний репо', () => {
    const slug = 'C--Users-sidor-repos-bbm-portal'
    expect(isRepoSessionDir(slug, slug)).toBe(true)
    expect(isRepoSessionDir(`${slug}--claude-worktrees-91`, slug)).toBe(true)
    expect(isRepoSessionDir(`${slug}-2`, slug)).toBe(false)
  })

  it('живая сессия — та, чей лог трогали внутри окна; своя исключается', () => {
    const logs = [
      { id: 'self', mtimeMs: NOW - 1000, logPath: 'a' },
      { id: 'fresh', mtimeMs: NOW - 60_000, logPath: 'b' },
      { id: 'stale', mtimeMs: NOW - 60 * 60_000, logPath: 'c' },
    ]
    const live = liveSessions(logs, { nowMs: NOW, selfId: 'self' })
    expect(live.map((l: { id: string }) => l.id)).toEqual(['fresh'])
  })

  it('тело флага несёт id и путь лога — гард по ним перепроверяет свежесть', () => {
    const flag = buildParallelFlag([{ id: 'x', mtimeMs: NOW, logPath: 'C:/logs/x.jsonl' }], 'ISO')
    expect(flag).toEqual({
      generatedAt: 'ISO',
      liveSessions: 1,
      sessions: [{ id: 'x', logPath: 'C:/logs/x.jsonl' }],
    })
  })

  it('протухший флаг не даёт живых сессий', () => {
    const live = liveSessionsFromFlag({
      flag: flagWith(['other']),
      sessionId: 'self',
      statMtime: () => NOW - 60 * 60_000,
      nowMs: NOW,
    })
    expect(live).toHaveLength(0)
  })
})

describe('main-tree-read-guard', () => {
  const base = {
    toolName: 'Read',
    toolInput: { file_path: `${MAIN}/src/app/page.tsx` },
    cwd: MAIN,
    sessionId: 'self',
    projectDir: MAIN,
    flag: flagWith(['other']),
    statMtime: () => NOW - 1000,
    nowMs: NOW,
  }

  it('предупреждает о чтении исходников общего чекаута при живой параллели', () => {
    expect(decideWarn(base)).toEqual({ warn: true, liveCount: 1 })
  })

  it('молчит в изолированной сессии', () => {
    expect(decideWarn({ ...base, cwd: WORKTREE }).warn).toBe(false)
  })

  it('молчит без живых параллельных сессий и без флага', () => {
    expect(decideWarn({ ...base, flag: null }).warn).toBe(false)
    expect(decideWarn({ ...base, statMtime: () => null }).warn).toBe(false)
  })

  it('не считает исходниками собственные .claude/ и .git/', () => {
    expect(
      decideWarn({ ...base, toolInput: { file_path: `${MAIN}/.claude/rules/dev-env.md` } }).warn,
    ).toBe(false)
    expect(decideWarn({ ...base, toolInput: { path: `${MAIN}/.git/config` } }).warn).toBe(false)
  })

  it('carve-out read-only лида: одно уведомление, потом тишина, после записи — полное предупреждение', () => {
    const warnDecision = { warn: true, liveCount: 2 }
    expect(decideReadAction({ warnDecision, state: {}, nowMs: NOW })).toEqual({
      action: 'notice',
      liveCount: 2,
      setNoticeShown: true,
    })
    expect(
      decideReadAction({ warnDecision, state: { noticeShown: true }, nowMs: NOW }).action,
    ).toBe('silent')
    expect(
      decideReadAction({
        warnDecision,
        state: { noticeShown: true, mainTreeWriteSeen: true },
        nowMs: NOW,
      }),
    ).toMatchObject({ action: 'warn', setWarnedAt: NOW })
  })

  // Без дросселя гард после первой записи предупреждал бы на КАЖДОЕ чтение —
  // главный источник warn-fatigue во всём стеке (ревью PR #99).
  it('после первой записи предупреждает не чаще раза в окно дросселя', () => {
    const warnDecision = { warn: true, liveCount: 1 }
    const state = { mainTreeWriteSeen: true, warnedAtMs: NOW }
    expect(decideReadAction({ warnDecision, state, nowMs: NOW + 1000 }).action).toBe('silent')
    expect(
      decideReadAction({ warnDecision, state, nowMs: NOW + WARN_THROTTLE_MS + 1 }).action,
    ).toBe('warn')
  })
})

describe('worktree-path-guard', () => {
  it('блокирует абсолютный путь в основное дерево из worktree-сессии', () => {
    const d = decideEscapeBlock({
      toolName: 'Write',
      toolInput: { file_path: `${MAIN}\\src\\app\\page.tsx` },
      cwd: WORKTREE,
    })
    expect(d.block).toBe(true)
    expect(d.worktreeName).toBe('91')
  })

  it('пропускает путь внутри собственного worktree', () => {
    expect(
      decideEscapeBlock({
        toolName: 'Edit',
        toolInput: { file_path: `${WORKTREE}/src/app/page.tsx` },
        cwd: WORKTREE,
      }),
    ).toEqual({ block: false, inWorktreeSession: true })
  })

  // #187: защищаемый класс — ОБЩИЙ чекаут, а не «свой worktree». Сессию
  // опознавать по cwd нельзя: cwd дрейфует (Bash `cd`), а запуск мог случиться
  // в worktree, которого уже нет. Классифицируется ЦЕЛЬ.
  it('пропускает путь в ЧУЖОЙ worktree (инцидент 2: cwd уехал по Bash `cd`)', () => {
    expect(
      decideEscapeBlock({
        toolName: 'Edit',
        toolInput: { file_path: `${MAIN}/.claude/worktrees/169/DEBT.md` },
        cwd: `${MAIN}/.claude/worktrees/79`,
      }),
    ).toEqual({ block: false, inWorktreeSession: true })
  })

  it('пропускает запись в worktree, когда worktree запуска уже удалён (инцидент 1)', () => {
    expect(
      decideEscapeBlock({
        toolName: 'Write',
        toolInput: { file_path: `${WORKTREE}/src/app/page.tsx` },
        cwd: `${MAIN}/.claude/worktrees/172-снесён`,
      }),
    ).toEqual({ block: false, inWorktreeSession: true })
  })

  it('защита сохранена: любой файл общего чекаута вне .claude/worktrees/ блокируется', () => {
    expect(
      decideEscapeBlock({
        toolName: 'Edit',
        toolInput: { file_path: `${MAIN}/DEBT.md` },
        cwd: WORKTREE,
      }).block,
    ).toBe(true)
    expect(
      decideEscapeBlock({
        toolName: 'Edit',
        toolInput: { file_path: `${MAIN}\\.claude\\rules\\dev-env.md` },
        cwd: WORKTREE,
      }).block,
    ).toBe(true)
  })

  it('не блокирует, когда сессия не в worktree', () => {
    expect(
      decideEscapeBlock({
        toolName: 'Write',
        toolInput: { file_path: `${MAIN}/src/app/page.tsx` },
        cwd: MAIN,
      }).block,
    ).toBe(false)
  })

  it('предупреждает о первой записи в общий чекаут при живой параллели', () => {
    expect(
      decideWriteWarn({
        toolName: 'Write',
        toolInput: { file_path: `${MAIN}/src/a.ts` },
        cwd: MAIN,
        sessionId: 'self',
        projectDir: MAIN,
        flag: flagWith(['other', 'third']),
        statMtime: () => NOW - 1000,
        nowMs: NOW,
      }),
    ).toEqual({ warn: true, liveCount: 2 })
  })

  it('не предупреждает изолированную сессию — она и есть правильный случай', () => {
    expect(
      decideWriteWarn({
        toolName: 'Write',
        toolInput: { file_path: `${WORKTREE}/src/a.ts` },
        cwd: WORKTREE,
        sessionId: 'self',
        projectDir: MAIN,
        flag: flagWith(['other']),
        statMtime: () => NOW - 1000,
        nowMs: NOW,
      }).warn,
    ).toBe(false)
  })
})

describe('dispatch-guard', () => {
  const main = { cwd: MAIN, projectDir: MAIN }

  it('считает подряд идущие правки и предупреждает на пороге', () => {
    expect(decideDispatch({ ...main, toolName: 'Edit', streak: 0 })).toEqual({
      action: 'count',
      streak: 1,
    })
    expect(decideDispatch({ ...main, toolName: 'Write', streak: 1 })).toEqual({
      action: 'count',
      streak: 2,
    })
    expect(decideDispatch({ ...main, toolName: 'MultiEdit', streak: 2 })).toEqual({
      action: 'warn',
      streak: DISPATCH_WARN_THRESHOLD,
    })
  })

  it('Agent сбрасывает серию', () => {
    expect(decideDispatch({ ...main, toolName: 'Agent', streak: 5 })).toEqual({
      action: 'reset',
      streak: 0,
    })
  })

  it('не считает и не сбрасывает на прочих инструментах', () => {
    expect(decideDispatch({ ...main, toolName: 'Read', streak: 2 })).toEqual({ action: 'silent' })
  })

  it('carve-out: worktree-сессия и явный env-opt-out', () => {
    expect(
      decideDispatch({ toolName: 'Edit', cwd: WORKTREE, projectDir: MAIN, streak: 9 }).action,
    ).toBe('silent')
    expect(decideDispatch({ ...main, toolName: 'Edit', streak: 9, carveOut: true }).action).toBe(
      'silent',
    )
    expect(isCarveOut({ ...process.env, BBM_DISPATCH_GUARD_DISABLE: '1' })).toBe(true)
    expect(isCarveOut({ ...process.env, BBM_DISPATCH_GUARD_DISABLE: undefined })).toBe(false)
  })

  it('битое состояние читается как нулевая серия (fail-open)', () => {
    expect(readStreak({})).toBe(0)
    expect(readStreak({ streak: -3 })).toBe(0)
    expect(readStreak({ streak: 'ой' })).toBe(0)
    expect(readStreak({ streak: 2 })).toBe(2)
  })
})

describe('форма вывода WARN и общий рубильник', () => {
  // Регресс, найденный ревью PR #99: `permissionDecision: "allow"` — это не
  // «промолчать», а активное разрешение вызова в обход разрешительной системы
  // владельца. Предупреждающий хук не имеет права выдавать разрешения.
  it('emitWarn печатает только systemMessage, без решения о разрешении', () => {
    const chunks: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = (chunk: string) => {
      chunks.push(String(chunk))
      return true
    }
    try {
      emitWarn('внимание')
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(process.stdout as any).write = original
    }
    const payload = JSON.parse(chunks.join(''))
    expect(payload).toEqual({ systemMessage: 'внимание' })
    expect(JSON.stringify(payload)).not.toContain('permissionDecision')
    expect(payload.hookSpecificOutput).toBeUndefined()
  })

  it('рубильник BBM_HOOKS_DISABLE распознаётся по 1/true/yes', () => {
    expect(hooksDisabled({ ...process.env, BBM_HOOKS_DISABLE: '1' })).toBe(true)
    expect(hooksDisabled({ ...process.env, BBM_HOOKS_DISABLE: 'yes' })).toBe(true)
    expect(hooksDisabled({ ...process.env, BBM_HOOKS_DISABLE: undefined })).toBe(false)
  })
})

describe('общие путевые хелперы', () => {
  it('сравнивают пути без учёта регистра и разделителя', () => {
    expect(isUnder('C:\\Repo\\src\\a.ts', 'c:/repo')).toBe(true)
    expect(isUnder('C:/repo-2/src', 'c:/repo')).toBe(false)
    expect(inWorktree(`${WORKTREE}/src`)).toBe(true)
    expect(inWorktree(`${MAIN}/src`)).toBe(false)
  })

  // Ожидания строятся через `resolve`, а не строкой: `C:/…` — абсолютный путь
  // только на Windows, на Linux-CI он резолвится от cwd раннера.
  it('относительный путь инструмента резолвится от cwd, пустой — это сама cwd', () => {
    expect(targetPath({ file_path: 'src/a.ts' }, MAIN)).toBe(resolve(MAIN, 'src/a.ts'))
    expect(targetPath({}, MAIN)).toBe(MAIN)
  })

  it('id сессии санируется в безопасное имя state-файла', () => {
    expect(stateFilePath(MAIN, '.claude/x-state', 'a/b:c')).toBe(
      resolve(MAIN, '.claude/x-state/a_b_c.json'),
    )
  })
})
