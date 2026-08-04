import { describe, expect, it, vi } from 'vitest'

import {
  STAGES,
  classifyChecks,
  cwdGuardMessage,
  failCode,
  findAgentApproval,
  gateConditions,
  headCommittedDate,
  isWorktreeCwd,
  issueCandidates,
  landPr,
  parseFlags,
  runGate,
  stageRemedy,
} from '../../tools/gh/pr-land.mjs'

/**
 * `pnpm pr:land` — хвост закрытия PR. Все стадии инжектируются, поэтому тест
 * прогоняет их порядок и обрывы без единого подпроцесса и без сети.
 * Канон: `.claude/rules/task-canon.md` §7.
 */

describe('classifyChecks', () => {
  it('все завершённые успехом — зелено', () => {
    expect(
      classifyChecks([{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }]).verdict,
    ).toBe('green')
  })

  it('незавершённый прогон — ждём, а не «зелено»', () => {
    expect(classifyChecks([{ name: 'ci', status: 'IN_PROGRESS' }]).verdict).toBe('pending')
  })

  it('ноль зарегистрированных прогонов зелёным не считается', () => {
    expect(classifyChecks([]).verdict).toBe('pending')
  })

  it('CANCELLED — красное: отменённый прогон ничего не доказал', () => {
    const res = classifyChecks([{ name: 'ci', status: 'COMPLETED', conclusion: 'CANCELLED' }])
    expect(res.verdict).toBe('red')
    expect(res.failed[0]).toMatch(/CANCELLED/)
  })

  it('SKIPPED и NEUTRAL — законный «нечего делать»', () => {
    expect(
      classifyChecks([
        { name: 'a', status: 'COMPLETED', conclusion: 'SKIPPED' },
        { name: 'b', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      ]).verdict,
    ).toBe('green')
  })

  it('разбирает и StatusContext-строки по полю state', () => {
    expect(classifyChecks([{ context: 'legacy', state: 'FAILURE' }]).verdict).toBe('red')
    expect(classifyChecks([{ context: 'legacy', state: 'PENDING' }]).verdict).toBe('pending')
    expect(classifyChecks([{ context: 'legacy', state: 'SUCCESS' }]).verdict).toBe('green')
  })

  it('красное перебивает ожидание — ждать нечего', () => {
    expect(
      classifyChecks([
        { name: 'a', status: 'IN_PROGRESS' },
        { name: 'b', status: 'COMPLETED', conclusion: 'FAILURE' },
      ]).verdict,
    ).toBe('red')
  })
})

describe('findAgentApproval', () => {
  const HEAD = '2026-08-04T12:00:00Z'

  it('свежий VERDICT: APPROVE засчитывается', () => {
    const res = findAgentApproval(
      [{ body: 'ревью…\n\nVERDICT: APPROVE', createdAt: '2026-08-04T12:30:00Z' }],
      HEAD,
    )
    expect(res.ok).toBe(true)
  })

  it('APPROVE старше последнего коммита — протух: он про другой код', () => {
    const res = findAgentApproval(
      [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-04T11:00:00Z' }],
      HEAD,
    )
    expect(res).toMatchObject({ ok: false, reason: 'stale' })
  })

  it('последний вердикт REQUEST_CHANGES перебивает более ранний APPROVE', () => {
    const res = findAgentApproval(
      [
        { body: 'VERDICT: APPROVE', createdAt: '2026-08-04T12:10:00Z' },
        { body: 'VERDICT: REQUEST_CHANGES', createdAt: '2026-08-04T12:20:00Z' },
      ],
      HEAD,
    )
    expect(res).toMatchObject({ ok: false, reason: 'changes' })
  })

  it('обычные комментарии вердиктом не считаются', () => {
    expect(
      findAgentApproval([{ body: 'выглядит ок, мержим', createdAt: HEAD }], HEAD),
    ).toMatchObject({ ok: false, reason: 'none' })
  })

  it('без даты последнего коммита свежесть не проверяется, но APPROVE нужен', () => {
    expect(
      findAgentApproval([{ body: 'VERDICT: APPROVE', createdAt: '2020-01-01T00:00:00Z' }], null).ok,
    ).toBe(true)
    expect(findAgentApproval([], null).ok).toBe(false)
  })
})

describe('headCommittedDate', () => {
  it('берёт дату ПОСЛЕДНЕГО коммита PR', () => {
    expect(headCommittedDate({ commits: [{ committedDate: 'a' }, { committedDate: 'b' }] })).toBe(
      'b',
    )
  })

  it('на пустом списке коммитов возвращает null, а не падает', () => {
    expect(headCommittedDate({})).toBeNull()
  })
})

describe('gateConditions', () => {
  const ok = {
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    closingIssuesReferences: [{ number: 130 }],
  }

  it('исправный PR причин для RED не даёт', () => {
    expect(gateConditions(ok).red).toEqual([])
  })

  it('закрытый, draft и конфликтующий PR — RED', () => {
    expect(gateConditions({ ...ok, state: 'MERGED' }).red[0]).toMatch(/не открыт/)
    expect(gateConditions({ ...ok, isDraft: true }).red[0]).toMatch(/draft/)
    expect(gateConditions({ ...ok, mergeable: 'CONFLICTING' }).red[0]).toMatch(/конфликтует/)
  })

  it('без `Closes #N` — RED: board-done будет некуда ставить Done', () => {
    expect(gateConditions({ ...ok, closingIssuesReferences: [] }).red[0]).toMatch(/Closes #N/)
  })

  it('без всякого ревью — RED по умолчанию, с указанием, как это закрыть', () => {
    const res = gateConditions({ ...ok, reviewDecision: '' })
    expect(res.red[0]).toMatch(/ревью не подтверждено/)
    expect(res.red[0]).toMatch(/--no-review-gate/)
  })

  it('комментарий ревьюера-субагента засчитывается наравне с человеческим APPROVE', () => {
    const res = gateConditions({
      ...ok,
      reviewDecision: '',
      commits: [{ committedDate: '2026-08-04T12:00:00Z' }],
      comments: [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-04T12:30:00Z' }],
    })
    expect(res.red).toEqual([])
  })

  it('протухший вердикт субагента не спасает — RED', () => {
    const res = gateConditions({
      ...ok,
      reviewDecision: '',
      commits: [{ committedDate: '2026-08-04T12:00:00Z' }],
      comments: [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-04T11:00:00Z' }],
    })
    expect(res.red[0]).toMatch(/старше последнего коммита/)
  })

  it('с --require-review комментарий субагента не засчитывается', () => {
    const res = gateConditions(
      {
        ...ok,
        reviewDecision: '',
        comments: [{ body: 'VERDICT: APPROVE', createdAt: '2026-08-04T12:30:00Z' }],
      },
      { requireReview: true },
    )
    expect(res.red[0]).toMatch(/человеческого APPROVE/)
  })

  it('снятый гейт не краснеет, но расхождение остаётся в замечаниях', () => {
    const res = gateConditions({ ...ok, reviewDecision: '' }, { reviewGate: false })
    expect(res.red).toEqual([])
    expect(res.warn.join('\n')).toMatch(/ревью-гейт отключён вручную/)
  })

  it('про приёмку владельца напоминает ВСЕГДА, даже при APPROVE', () => {
    expect(gateConditions(ok).warn.join('\n')).toMatch(/stage 5/)
  })

  it('отставшая от базы ветка — замечание', () => {
    expect(gateConditions({ ...ok, mergeStateStatus: 'BEHIND' }).warn.join('\n')).toMatch(/BEHIND/)
  })
})

describe('runGate', () => {
  const pr = (over = {}) => ({
    ok: true,
    data: {
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      closingIssuesReferences: [{ number: 130 }],
      headRefName: 'chore/130-x',
      headRefOid: 'aaa',
      statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      ...over,
    },
  })

  it('зелёные проверки — зелёный гейт, номера Closes и SHA прокинуты дальше', () => {
    const res = runGate(
      1,
      { timeout: 10, interval: 1, requireReview: false },
      { viewPr: () => pr() },
    )
    expect(res.verdict).toBe('green')
    expect(res.closes).toEqual([130])
    expect(res.branch).toBe('chore/130-x')
    expect(res.sha).toBe('aaa')
  })

  it('ждёт незавершённые проверки и берёт зелёный со второй пробы', () => {
    const responses = [pr({ statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS' }] }), pr()]
    const sleep = vi.fn()
    const res = runGate(
      1,
      { timeout: 100, interval: 1, requireReview: false },
      { viewPr: () => responses.shift()!, sleep, now: () => 0 },
    )
    expect(res.verdict).toBe('green')
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('сдвиг head во время ожидания — RED: зелёный старого SHA ничего не значит', () => {
    const responses = [
      pr({ statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS' }] }),
      pr({ headRefOid: 'bbb' }),
    ]
    const res = runGate(
      1,
      { timeout: 100, interval: 1, requireReview: false },
      { viewPr: () => responses.shift()!, sleep: () => {}, now: () => 0 },
    )
    expect(res.verdict).toBe('red')
    expect(res.reasons[0]).toMatch(/head сдвинулся/)
    // наружу отдаётся ЗАКРЕПЛЁННЫЙ SHA, а не последний прочитанный
    expect(res.sha).toBe('aaa')
  })

  it('истёкший таймаут — отдельный вердикт, не «зелено» и не «красно»', () => {
    let t = 0
    const res = runGate(
      1,
      { timeout: 1, interval: 1, requireReview: false },
      {
        viewPr: () => pr({ statusCheckRollup: [{ name: 'ci', status: 'QUEUED' }] }),
        sleep: () => {},
        now: () => (t += 100_000),
      },
    )
    expect(res.verdict).toBe('timeout')
  })

  it('недоступный PR — RED с текстом ошибки gh', () => {
    const res = runGate(
      1,
      { timeout: 1, interval: 1, requireReview: false },
      { viewPr: () => ({ ok: false, error: 'gh упал' }) },
    )
    expect(res.verdict).toBe('red')
    expect(res.reasons[0]).toBe('gh упал')
  })
})

describe('issueCandidates', () => {
  it('берёт номера из Closes и из имени ветки, без дублей', () => {
    expect(issueCandidates([130], 'chore/130-kanon')).toEqual([130])
    expect(issueCandidates([130], 'chore/131-other')).toEqual([130, 131])
  })

  it('на ветке без номера не выдумывает кандидатов', () => {
    expect(issueCandidates([], 'main')).toEqual([])
  })
})

describe('failCode', () => {
  it('ненулевой код ребёнка проходит как есть', () => {
    expect(failCode(4)).toBe(4)
  })

  it('убитый сигналом ребёнок (null) никогда не читается как успех', () => {
    expect(failCode(null)).toBe(1)
    expect(failCode(0)).toBe(1)
  })
})

describe('isWorktreeCwd', () => {
  it('узнаёт ворктри в обоих видах разделителя', () => {
    expect(isWorktreeCwd('C:\\repo\\.claude\\worktrees\\130')).toBe(true)
    expect(isWorktreeCwd('/c/repo/.claude/worktrees/130')).toBe(true)
  })

  it('основной чекаут ворктри не считает', () => {
    expect(isWorktreeCwd('C:\\Users\\sidor\\repos\\bbm-portal')).toBe(false)
  })

  it('текст отказа объясняет, почему нельзя', () => {
    expect(cwdGuardMessage('X')).toMatch(/основной чекаут/)
  })
})

describe('parseFlags', () => {
  it('разбирает номер PR и флаги с дефолтами', () => {
    expect(parseFlags(['12'])).toMatchObject({ ok: true, pr: 12, timeout: 900, interval: 20 })
    expect(parseFlags(['12', '--require-review'])).toMatchObject({ requireReview: true })
    expect(parseFlags(['12', '--timeout', '60'])).toMatchObject({ timeout: 60 })
  })

  it('падает на неверном номере, неизвестном флаге и нечисловом таймауте', () => {
    expect(parseFlags(['х'])).toMatchObject({ ok: false })
    expect(parseFlags(['12', '--force'])).toMatchObject({ ok: false })
    expect(parseFlags(['12', '--timeout', 'скоро'])).toMatchObject({ ok: false })
  })
})

describe('landPr — порядок стадий и обрывы', () => {
  const greenGate = () => ({
    verdict: 'green',
    reasons: [],
    warn: [],
    closes: [130],
    branch: 'chore/130-x',
    sha: 'deadbeef',
  })
  const okRunners = (over = {}) => ({
    gate: greenGate,
    merge: () => ({ status: 0 }),
    mergedSha: () => 'abcdef1234567890',
    clearBoardItem: () => ({ status: 'deleted', detail: 'PVTI_x' }),
    boardDone: () => ({ status: 0 }),
    worktreeExists: () => false,
    teardown: () => ({ status: 0 }),
    listOpenPrs: () => ({ status: 0, count: 0 }),
    listRemoteBranches: () => ({ status: 0, count: 1 }),
    ...over,
  })

  // landPr всегда уходит через exit(); в тесте exit бросает, чтобы выполнение
  // остановилось ровно там же, где остановился бы процесс.
  const drive = (over = {}) => {
    const log: string[] = []
    const err: string[] = []
    let code: number | null = null
    try {
      landPr(
        { pr: 7, timeout: 10, interval: 1, requireReview: false },
        {
          ...okRunners(over),
          exit: ((c: number) => {
            code = c
            throw new Error('__exit__')
          }) as never,
          log: (m: string) => log.push(m),
          err: (m: string) => err.push(m),
        },
      )
    } catch (e) {
      if ((e as Error).message !== '__exit__') throw e
    }
    return { log: log.join(''), err: err.join('\n'), code }
  }

  it('канонический порядок стадий зафиксирован', () => {
    expect(STAGES).toEqual(['gate', 'merge', 'board-clear', 'board-done', 'teardown', 're-sweep'])
  })

  it('полный зелёный проход отчитывается по всем стадиям и выходит 0', () => {
    const res = drive()
    expect(res.code).toBe(0)
    for (const stage of [
      'gate:',
      'merge:',
      'board-clear:',
      'board-done:',
      'teardown:',
      're-sweep:',
    ]) {
      expect(res.log).toContain(stage)
    }
  })

  /**
   * Регрессия: гейт пинил head только на чтении, а `gh pr merge` шёл без
   * привязки — коммит, приземлившийся за время ожидания (до 900 с), уезжал в
   * main непроверенным. SHA обязан доехать до команды мержа.
   */
  it('в мерж уходит ровно тот SHA, который прошёл гейт', () => {
    const merge = vi.fn(() => ({ status: 0 }))
    drive({ merge })
    expect(merge).toHaveBeenCalledWith(7, 'deadbeef')
  })

  it('красный гейт останавливает хвост ДО мержа', () => {
    const merge = vi.fn()
    const res = drive({
      gate: () => ({
        verdict: 'red',
        reasons: ['красные проверки'],
        warn: [],
        closes: [],
        branch: null,
      }),
      merge,
    })
    expect(merge).not.toHaveBeenCalled()
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/стадия «gate» упала/)
  })

  it('таймаут гейта отличается от RED кодом выхода', () => {
    expect(
      drive({
        gate: () => ({
          verdict: 'timeout',
          reasons: ['не дождались'],
          warn: [],
          closes: [],
          branch: null,
        }),
      }).code,
    ).toBe(2)
  })

  it('провал мержа не даёт двигать борд', () => {
    const boardDone = vi.fn()
    const res = drive({ merge: () => ({ status: 1 }), boardDone })
    expect(boardDone).not.toHaveBeenCalled()
    expect(res.code).toBe(1)
  })

  it('провал board-clear не фатален — мерж уже приземлился', () => {
    const res = drive({ clearBoardItem: () => ({ status: 'error', detail: 'нет прав' }) })
    expect(res.code).toBe(0)
    expect(res.log).toMatch(/board-clear: ЗАМЕЧАНИЕ/)
  })

  it('провал board-done обрывает хвост и подсказывает ручную команду', () => {
    const res = drive({ boardDone: () => ({ status: 1 }) })
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/pnpm board:status/)
  })

  it('без связанных Closes стадия board-done громко пропускается', () => {
    const res = drive({
      gate: () => ({ verdict: 'green', reasons: [], warn: [], closes: [], branch: 'chore/9-x' }),
    })
    expect(res.log).toMatch(/board-done: пропуск/)
  })

  it('teardown запускается только при существующем ворктри', () => {
    const teardown = vi.fn(() => ({ status: 0 }))
    drive({ worktreeExists: (n: number) => n === 130, teardown })
    expect(teardown).toHaveBeenCalledWith(130)
  })

  it('упавшая пересводка тоже обрывает хвост', () => {
    expect(drive({ listOpenPrs: () => ({ status: 1, count: null }) }).code).toBe(1)
  })
})

describe('stageRemedy', () => {
  it('на каждую стадию даёт непустую подсказку', () => {
    for (const stage of STAGES) expect(stageRemedy(stage, 7).length).toBeGreaterThan(10)
  })

  it('после мержа подсказка не предлагает «просто повторить»', () => {
    expect(stageRemedy('board-done', 7)).toMatch(/мерж прошёл/)
  })
})
