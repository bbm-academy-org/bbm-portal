import { describe, expect, it } from 'vitest'

import {
  classify,
  detectClaimState,
  evaluateRationale,
  findMegaBlockers,
  findMirrorDrift,
  formatAge,
  formatReport,
  isPlaceholder,
  mentionsIssue,
  missingFields,
  sourceLineText,
  parseDependenciesSection,
  parseProseBlockers,
  parseRefsWithRationale,
} from '../../tools/gh/backlog-triage.mjs'

/**
 * `pnpm backlog:triage` считает готовность из НАТИВНОГО графа, а не из лейбла.
 * Разбор и классификация вынесены в чистые функции — тесты гоняют их без сети.
 * Канон: `.claude/rules/task-canon.md` §2, §3, §4.
 */

describe('missingFields', () => {
  const clean = {
    issueType: { name: 'Task' },
    labels: [{ name: 'channel:owner' }],
    body: '**Source:** баг-репорт в Mattermost 2026-08-04',
    milestone: { title: 'Консолидация платформы' },
    assignees: [{ login: 'sidorovanthon' }],
  }

  it('на полностью заполненной задаче молчит', () => {
    expect(missingFields(clean)).toEqual([])
  })

  it('требует штатный Type, а не kind-лейбл', () => {
    expect(missingFields({ ...clean, issueType: null })).toContain('нет Type')
    expect(missingFields({ ...clean, issueType: { name: 'Epic' } })).toContainEqual(
      expect.stringMatching(/неизвестный Type/),
    )
  })

  it('ловит упразднённые kind:*-лейблы', () => {
    const res = missingFields({
      ...clean,
      labels: [{ name: 'channel:owner' }, { name: 'kind:feat' }],
    })
    expect(res).toContainEqual(expect.stringMatching(/упразднённые kind/))
  })

  it('ловит дефолтные лейблы GitHub и адресует их миграции 7.2', () => {
    const res = missingFields({
      ...clean,
      labels: [{ name: 'channel:owner' }, { name: 'enhancement' }],
    })
    expect(res).toContainEqual(expect.stringMatching(/дефолтные лейблы GitHub.*7\.2/))
  })

  it('требует ровно один channel:* из таксономии', () => {
    expect(missingFields({ ...clean, labels: [] })).toContain('нет channel:*')
    expect(
      missingFields({ ...clean, labels: [{ name: 'channel:owner' }, { name: 'channel:agent' }] }),
    ).toContainEqual(expect.stringMatching(/несколько channel/))
    expect(missingFields({ ...clean, labels: [{ name: 'channel:луна' }] })).toContainEqual(
      expect.stringMatching(/неизвестный channel/),
    )
  })

  it('требует непустую строку **Source:** в теле — это отдельное измерение', () => {
    expect(missingFields({ ...clean, body: '## Context' })).toContain(
      'нет непустой строки **Source:**',
    )
    expect(missingFields({ ...clean, body: '**Source:**' })).toContain(
      'нет непустой строки **Source:**',
    )
  })

  it('ловит упразднённые source:*-лейблы', () => {
    expect(
      missingFields({ ...clean, labels: [{ name: 'channel:owner' }, { name: 'source:owner' }] }),
    ).toContainEqual(expect.stringMatching(/упразднённые source/))
  })

  it('требует milestone и assignee', () => {
    expect(missingFields({ ...clean, milestone: null })).toContain('нет milestone')
    expect(missingFields({ ...clean, assignees: [] })).toContain('нет assignee')
  })

  it('принимает лейблы как строки — форма ответа gh не единственная', () => {
    expect(missingFields({ ...clean, labels: ['channel:owner'] })).toEqual([])
  })
})

describe('sourceLineText', () => {
  /**
   * Происхождение — свободный текст, поэтому проверяется только наличие и
   * непустота. Тело приезжает в двух формах: `pnpm issue:create` пишет
   * `**Source:** …`, issue-формы GitHub рендерят секцию `### Source`.
   */
  it('читает строку, которую пишет обёртка', () => {
    expect(sourceLineText('**Source:** баг-репорт в Mattermost\n\n## Context')).toBe(
      'баг-репорт в Mattermost',
    )
  })

  it('читает секцию, которую рендерит issue-форма', () => {
    expect(sourceLineText('### Source\n\nexecutive-решение партнёров\n\n### Context\n\nx')).toBe(
      'executive-решение партнёров',
    )
  })

  it('читает секцию Source, даже если она последняя в теле', () => {
    expect(sourceLineText('### Context\n\nx\n\n### Source\n\nсам поймал при работе над #124')).toBe(
      'сам поймал при работе над #124',
    )
  })

  it('незаполненное поле формы происхождением не считает', () => {
    expect(sourceLineText('### Source\n\n_No response_\n\n### Context')).toBeNull()
    expect(sourceLineText('**Source:**')).toBeNull()
    expect(sourceLineText('## Context')).toBeNull()
  })

  /**
   * Регрессия: в отступах стоял `\s`, который включает `\n`, — пустая строка
   * `**Source:**` захватывала следующий абзац, и НЕзаполненное поле читалось
   * как заполненное.
   */
  it('пустая строка Source не захватывает следующий абзац', () => {
    expect(sourceLineText('**Source:**\n\nобычный текст')).toBeNull()
    expect(sourceLineText('**Source:**   \n\n## Context')).toBeNull()
  })

  it('невынутая угловая заглушка скелета §1 источником не считается', () => {
    expect(sourceLineText('**Source:** <на основании чего задача существует>')).toBeNull()
  })
})

describe('parseRefsWithRationale', () => {
  it('разбирает ссылку с rationale через тире', () => {
    expect(parseRefsWithRationale('#131 — схема задаётся там')).toEqual([
      { number: 131, rationale: 'схема задаётся там' },
    ])
  })

  it('разбирает несколько ссылок, часть без rationale', () => {
    expect(parseRefsWithRationale('#1 — почему, #2')).toEqual([
      { number: 1, rationale: 'почему' },
      { number: 2, rationale: null },
    ])
  })

  it('на плейсхолдерах не выдумывает рёбер', () => {
    for (const p of ['', 'нет', '—', 'none', '_No response_']) {
      expect(parseRefsWithRationale(p)).toEqual([])
    }
  })
})

describe('isPlaceholder', () => {
  it('считает пустышкой незаполненный HTML-комментарий шаблона', () => {
    expect(isPlaceholder('<!-- сюда ссылки -->')).toBe(true)
  })

  it('считает пустышкой невынутую угловую заглушку скелета канона §1', () => {
    expect(isPlaceholder('<на основании чего задача существует — свободный текст>')).toBe(true)
    expect(isPlaceholder('<конкретный deliverable>')).toBe(true)
  })

  it('осмысленный текст пустышкой не считает', () => {
    expect(isPlaceholder('#12 — причина')).toBe(false)
    expect(isPlaceholder('баг-репорт <Антона> в Mattermost')).toBe(false)
  })
})

describe('parseDependenciesSection', () => {
  const body = [
    '## Dependencies',
    '',
    '**Blocked by:** #131 — контракт БД задаётся там',
    '**Blocks:** #140, #141',
  ].join('\n')

  it('читает рёбра и rationale из секции Dependencies', () => {
    const deps = parseDependenciesSection(body)
    expect(deps.blockedBy).toEqual([{ number: 131, rationale: 'контракт БД задаётся там' }])
    expect(deps.blocks).toEqual([140, 141])
  })

  it('читает и списочную форму строки (issue-формы рендерят по-своему)', () => {
    expect(parseDependenciesSection('- **Blocked by:** #7').blockedBy).toEqual([
      { number: 7, rationale: null },
    ])
  })

  it('на пустой секции рёбер не выдумывает', () => {
    expect(parseDependenciesSection('**Blocked by:** нет\n**Blocks:**')).toEqual({
      blockedBy: [],
      blocks: [],
    })
  })
})

describe('parseProseBlockers', () => {
  it('видит прозовую зависимость вне секции Dependencies', () => {
    expect(parseProseBlockers('Эта задача зависит от #99, пока он не сделан.')).toEqual([99])
  })

  it('иерархия блокером НЕ считается — родитель, эпик, «связано», «преемник»', () => {
    expect(parseProseBlockers('Часть эпика #117, зависит от него организационно')).toEqual([])
    expect(parseProseBlockers('Связано с #12, зависит от общего контекста')).toEqual([])
    expect(parseProseBlockers('Преемник #40 — зависит от его выводов')).toEqual([])
  })

  it('не дублирует то, что уже стоит строкой Blocked by', () => {
    expect(parseProseBlockers('**Blocked by:** #131 — причина')).toEqual([])
  })
})

describe('mentionsIssue', () => {
  it('ловит и `#N`, и ссылку', () => {
    expect(mentionsIssue('см. #131', 131)).toBe(true)
    expect(mentionsIssue('https://github.com/o/r/issues/131', 131)).toBe(true)
  })

  it('не считает #1310 упоминанием #131', () => {
    expect(mentionsIssue('#1310', 131)).toBe(false)
  })
})

describe('evaluateRationale', () => {
  it('находит rationale строкой ребра в заблокированной задаче', () => {
    const body = '**Blocked by:** #131 — контракт БД задаётся там'
    expect(evaluateRationale(140, 131, body, null)).toBe('present')
  })

  it('голая ссылка без объяснения — ребро без rationale (provenance-orphan)', () => {
    expect(evaluateRationale(140, 131, '**Blocked by:** #131', null)).toBe('absent')
  })

  it('засчитывает объяснение на стороне блокера', () => {
    expect(
      evaluateRationale(140, 131, 'нет упоминаний', 'этим блокируется #140, пока нет схемы'),
    ).toBe('present')
  })

  it('без обоих текстов честно говорит «не проверено», а не «нет»', () => {
    expect(evaluateRationale(140, 131, null, null)).toBe('unknown')
  })
})

describe('classify', () => {
  const issue = { number: 140, title: 'задача', labels: [] }

  it('без рёбер задача берётся', () => {
    expect(classify(issue, []).blocked).toBe(false)
  })

  it('открытый блокер блокирует', () => {
    const t = classify(issue, [{ number: 131, source: 'native', open: true, rationale: 'present' }])
    expect(t.blocked).toBe(true)
    expect(t.blockers).toHaveLength(1)
  })

  it('закрытый блокер уже не блокер', () => {
    expect(
      classify(issue, [{ number: 131, source: 'native', open: false, rationale: 'present' }])
        .blocked,
    ).toBe(false)
  })

  it('нативное ребро побеждает прозовое по тому же номеру — граф это граф', () => {
    const t = classify(issue, [
      { number: 131, source: 'prose', open: true, rationale: 'absent' },
      { number: 131, source: 'native', open: true, rationale: 'present' },
    ])
    expect(t.edges).toHaveLength(1)
    expect(t.edges[0].source).toBe('native')
  })

  /**
   * Регрессия: готовность считалась и по прозе, из-за чего задача с правильно
   * заполненным телом и непроведённым ребром выпадала из берущихся, а шаг 6
   * скилла `spec-issue-graph` давал ложный зелёный. Канон §3: проза связью не
   * считается.
   */
  it('прозовое ребро БЕЗ нативного не блокирует — проза связью не считается', () => {
    const t = classify(issue, [{ number: 131, source: 'prose', open: true, rationale: 'present' }])
    expect(t.blocked).toBe(false)
    expect(t.blockers).toEqual([])
    expect(t.edges).toEqual([])
  })
})

describe('findMirrorDrift', () => {
  const body = ['## Dependencies', '', '**Blocked by:** #131 — контракт БД задаётся там'].join('\n')

  it('строка в теле без ребра в графе — расхождение вида mirror', () => {
    expect(findMirrorDrift(body, [])).toEqual([{ number: 131, source: 'mirror' }])
  })

  it('ребро в графе без строки в теле — расхождение вида graph-only', () => {
    expect(findMirrorDrift('пустое тело', [131])).toEqual([{ number: 131, source: 'graph-only' }])
  })

  it('когда тело и граф сходятся, расхождений нет', () => {
    expect(findMirrorDrift(body, [131])).toEqual([])
  })

  it('проза вне секции Dependencies отмечается отдельным видом', () => {
    expect(findMirrorDrift('Эта задача зависит от #99.', [])).toEqual([
      { number: 99, source: 'prose' },
    ])
  })

  it('одно и то же упоминание не считается дважды', () => {
    expect(findMirrorDrift(`${body}\nтакже зависит от #131`, [])).toEqual([
      { number: 131, source: 'mirror' },
    ])
  })
})

describe('findMegaBlockers', () => {
  const blockedBy = (n: number, blocker: number) => ({
    number: n,
    title: `#${n}`,
    blocked: true,
    edges: [],
    blockers: [{ number: blocker, source: 'native', open: true, rationale: 'present' }],
  })

  it('находит узел, блокирующий ≥5 задач', () => {
    const triaged = [1, 2, 3, 4, 5].map((n) => blockedBy(n, 99))
    expect(findMegaBlockers(triaged)).toEqual([{ number: 99, blocked: [1, 2, 3, 4, 5], count: 5 }])
  })

  it('четыре задачи мега-блокером ещё не делают', () => {
    expect(findMegaBlockers([1, 2, 3, 4].map((n) => blockedBy(n, 99)))).toEqual([])
  })

  it('сортирует по убыванию охвата', () => {
    const triaged = [
      ...[1, 2, 3, 4, 5].map((n) => blockedBy(n, 99)),
      ...[6, 7, 8, 9, 10, 11].map((n) => blockedBy(n, 88)),
    ]
    expect(findMegaBlockers(triaged).map((m) => m.number)).toEqual([88, 99])
  })
})

describe('detectClaimState — два сигнала клейма (канон §4)', () => {
  const base = { number: 130, hasWorktree: false, hasBranch: false, boardStatus: null, ageMs: 0 }

  it('ворктри + In Progress — claim полон', () => {
    expect(detectClaimState({ ...base, hasWorktree: true, boardStatus: 'In Progress' }).kind).toBe(
      'in-flight',
    )
  })

  it('ворктри есть, статуса нет → правды больше у ворктри, чинится борд', () => {
    const state = detectClaimState({ ...base, hasWorktree: true, boardStatus: 'Todo' })
    expect(state.kind).toBe('board-lags')
    expect(state.message).toMatch(/pnpm board:status 130 "In Progress"/)
  })

  it('статус есть, ворктри и ветки нет → claim протух, но снимает его человек', () => {
    const state = detectClaimState({
      ...base,
      boardStatus: 'In Progress',
      ageMs: 3 * 24 * 3600 * 1000,
    })
    expect(state.kind).toBe('stale-claim')
    expect(state.message).toMatch(/3д/)
    expect(state.message).toMatch(/лид\/владелец, не скрипт/)
  })

  it('статус есть, ворктри нет, но ветка на origin есть — работа вне этой машины', () => {
    expect(detectClaimState({ ...base, boardStatus: 'In Progress', hasBranch: true }).kind).toBe(
      'branch-only',
    )
  })

  it('ни одного сигнала — задача свободна', () => {
    expect(detectClaimState({ ...base, boardStatus: 'Todo' }).kind).toBe('free')
  })
})

describe('formatAge', () => {
  it('масштабирует единицу под величину', () => {
    expect(formatAge(30_000)).toBe('<1м')
    expect(formatAge(34 * 60_000)).toBe('34м')
    expect(formatAge(2 * 3600_000)).toBe('2ч')
    expect(formatAge(3 * 24 * 3600_000)).toBe('3д')
  })

  it('нечисловой возраст не притворяется нулём', () => {
    expect(formatAge(NaN)).toBe('?')
    expect(formatAge(null)).toBe('?')
  })
})

describe('расхождение claim без даты обновления', () => {
  it('протухший claim без даты отчитывается «?», а не «простой <1м»', () => {
    const state = detectClaimState({
      number: 130,
      hasWorktree: false,
      hasBranch: false,
      boardStatus: 'In Progress',
      ageMs: null,
    })
    expect(state.kind).toBe('stale-claim')
    expect(state.message).toMatch(/простой \?/)
  })
})

describe('formatReport', () => {
  const model = {
    generatedAt: '2026-08-04T00:00:00.000Z',
    takeable: [{ number: 1, title: 'берётся' }],
    inFlight: [{ number: 2, title: 'в работе', claim: 'ворктри + In Progress' }],
    blocked: [
      {
        number: 3,
        title: 'ждёт',
        blockers: [{ number: 1, source: 'native', open: true, rationale: 'absent' }],
      },
    ],
    claimIssues: [{ number: 4, message: 'ворктри есть, статуса нет' }],
    epics: [{ number: 5, title: 'зонтик' }],
    hygiene: [{ number: 6, missing: ['нет Type'] }],
    mirrorDrift: [{ number: 3, blocker: 1, source: 'mirror' }],
    orphanEdges: [{ blocked: 3, blocker: 1 }],
    megaBlockers: [{ number: 1, blocked: [3], count: 1 }],
    warnings: ['борд не прочитался'],
  }

  it('печатает все секции контракта с их счётчиками', () => {
    const report = formatReport(model)
    for (const heading of [
      '## Берущиеся (1)',
      '## В работе (1)',
      '## Расхождения claim (1)',
      '## Заблокированные (1)',
      '## Зеркало Dependencies разошлось с графом (1)',
      '## Рёбра без rationale (1)',
      '## Мега-блокеры (1)',
      '## Эпики (1)',
      '## Гигиена полей (1)',
      '## Предупреждения (1)',
    ]) {
      expect(report).toContain(heading)
    }
  })

  it('помечает ребро без rationale как повод оспорить, а не как факт', () => {
    expect(formatReport(model)).toMatch(/⚠ rationale не записан/)
    expect(formatReport(model)).toMatch(/повод оспорить ребро/)
  })

  it('пустой список берущихся не выдаёт за пустой бэклог', () => {
    const report = formatReport({ ...model, takeable: [] })
    expect(report).toMatch(/пустой список берущихся ≠ пустой бэклог/)
  })

  it('без предупреждений секции предупреждений нет', () => {
    expect(formatReport({ ...model, warnings: [] })).not.toContain('## Предупреждения')
  })
})
