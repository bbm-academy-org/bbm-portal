import { describe, expect, it, vi } from 'vitest'

import {
  formatPlan,
  missingIssueTypes,
  planLabels,
  planMilestone,
  CHANNEL_LABEL_SPECS,
} from '../../tools/gh/bootstrap-taxonomy.mjs'
import {
  FALLBACK_MILESTONE,
  KNOWN,
  buildBoardItemsPageQuery,
  buildDeleteItemMutation,
  buildIssueProjectItemsQuery,
  buildStatusMutation,
  knownIdWarnings,
  pickProjectItem,
  resolveStatusOption,
} from '../../tools/gh/lib/gh.mjs'
import { parseArgs, runBoardStatus } from '../../tools/gh/set-board-status.mjs'

/**
 * Плюмбинг борда: построители запросов не должны склеиваться из непроверенных
 * строк, а `board:status` обязан переживать «In Progress» без кавычек — иначе
 * половина claim'ов просто не проставится (канон §4).
 */

describe('parseArgs (board:status)', () => {
  it('разбирает номер и статус', () => {
    expect(parseArgs(['130', 'Done'])).toMatchObject({ ok: true, issueNumber: 130, status: 'Done' })
  })

  it('склеивает «In Progress», потерявший кавычки в shell', () => {
    expect(parseArgs(['130', 'In', 'Progress'])).toMatchObject({ ok: true, status: 'In Progress' })
  })

  it('поддерживает режим только-чтения', () => {
    expect(parseArgs(['130', '--resolve'])).toMatchObject({ ok: true, resolveOnly: true })
  })

  it('падает на неверном номере, отсутствующем и неизвестном статусе', () => {
    expect(parseArgs(['abc', 'Done']).ok).toBe(false)
    expect(parseArgs(['130']).ok).toBe(false)
    expect(parseArgs(['130', 'Review']).ok).toBe(false)
  })
})

/**
 * Регрессия #132. Мутация проходила, а команда падала `ReferenceError: item is
 * not defined` на строке успешного лога → exit 1 при СДЕЛАННОЙ работе, и
 * `pr:land` читал стадию board-done как провал. Класс ошибки живёт ровно там,
 * куда тест не заходил, поэтому здесь успешная ветка исполняется ЦЕЛИКОМ —
 * вместе с формированием итоговой строки, а не до неё.
 */
describe('runBoardStatus — успешная ветка целиком', () => {
  const target = (over: Record<string, unknown> = {}) => ({
    ok: true,
    projectId: 'PVT_kwDOtest',
    itemId: 'PVTI_lADOtest',
    fieldId: 'PVTSSF_lADOtest',
    optionId: '98236657',
    project: { id: 'PVT_kwDOtest', number: 2, title: 'BBM Platform' },
    statusField: { id: 'PVTSSF_lADOtest', options: [{ id: '98236657', name: 'Done' }] },
    warnings: [],
    ...over,
  })

  // Команда всегда уходит через exit(); в тесте exit бросает, чтобы выполнение
  // остановилось ровно там же, где остановился бы процесс.
  const drive = (
    parsed: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ): { out: string; err: string; code: number | null } => {
    const out: string[] = []
    const err: string[] = []
    let code: number | null = null
    try {
      runBoardStatus(parsed, {
        resolve: () => target(),
        mutate: () => ({ ok: true, data: {} }),
        ...over,
        out: (m: string) => out.push(m),
        err: (m: string) => err.push(m),
        exit: (c: number) => {
          code = c
          throw new Error('__exit__')
        },
      })
    } catch (e) {
      if ((e as Error).message !== '__exit__') throw e
    }
    return { out: out.join(''), err: err.join(''), code }
  }

  const done = { ok: true, issueNumber: 130, resolveOnly: false, status: 'Done' }

  it('после успешной мутации печатает ГОТОВО с номером, статусом и строкой борда и выходит 0', () => {
    const res = drive(done)
    expect(res.code).toBe(0)
    expect(res.out).toContain('ГОТОВО')
    expect(res.out).toContain('#130')
    expect(res.out).toContain('Done')
    expect(res.out).toContain('PVTI_lADOtest')
    // Итоговая строка не должна содержать дыр от несуществующих переменных.
    expect(res.out).not.toMatch(/undefined/)
  })

  it('мутация строится РЕЗОЛВНУТЫМИ живьём id', () => {
    const mutate = vi.fn((_query: string) => ({ ok: true, data: {} }))
    drive(done, { mutate })
    const query = String(mutate.mock.calls[0]?.[0] ?? '')
    expect(query).toContain('PVTI_lADOtest')
    expect(query).toContain('98236657')
  })

  it('провал резолвинга — exit 1 и мутации не было', () => {
    const mutate = vi.fn()
    const res = drive(done, {
      resolve: () => ({ ok: false, error: 'задача #130 не стоит на борде' }),
      mutate,
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/не стоит на борде/)
  })

  it('провал мутации — exit 1 и никакого «ГОТОВО»', () => {
    const res = drive(done, { mutate: () => ({ ok: false, error: 'GraphQL вернул ошибки' }) })
    expect(res.code).toBe(1)
    expect(res.out).not.toContain('ГОТОВО')
  })

  it('расхождение id — замечание в stderr, но работа доводится до конца', () => {
    const res = drive(done, { resolve: () => target({ warnings: ['id проекта разошёлся'] }) })
    expect(res.err).toMatch(/замечание: id проекта разошёлся/)
    expect(res.code).toBe(0)
    expect(res.out).toContain('ГОТОВО')
  })

  it('--resolve печатает разбор, выходит 0 и НЕ мутирует', () => {
    const mutate = vi.fn()
    const res = drive({ ok: true, issueNumber: 130, resolveOnly: true, status: null }, { mutate })
    expect(mutate).not.toHaveBeenCalled()
    expect(res.code).toBe(0)
    expect(res.out).toMatch(/Мутации не было/)
    expect(res.out).toContain('PVTI_lADOtest')
    expect(res.out).not.toMatch(/undefined/)
  })
})

describe('построители запросов', () => {
  it('целевой запрос по задаче содержит её номер и поле Status', () => {
    const q = buildIssueProjectItemsQuery(130)
    expect(q).toContain('issue(number:130)')
    expect(q).toContain('field(name:"Status")')
  })

  it('отказывается строить запрос по неположительному номеру', () => {
    expect(() => buildIssueProjectItemsQuery(0)).toThrow()
    expect(() => buildIssueProjectItemsQuery(1.5)).toThrow()
  })

  it('мутации отвергают id с кавычками и скобками — строку запроса не сломать', () => {
    expect(() => buildStatusMutation('a"', 'b', 'c', 'd')).toThrow()
    expect(() => buildDeleteItemMutation('a', '')).toThrow()
  })

  it('пагинация борда добавляет курсор только когда он есть', () => {
    expect(buildBoardItemsPageQuery()).not.toContain('after:')
    expect(buildBoardItemsPageQuery('Y3Vyc29y')).toContain('after:"Y3Vyc29y"')
  })
})

describe('pickProjectItem', () => {
  const nodes = [
    { id: 'i1', project: { number: 9 } },
    { id: 'i2', project: { number: 2 } },
  ]

  it('берёт строку НАШЕГО борда, а не первую попавшуюся', () => {
    expect(pickProjectItem(nodes, '2')?.id).toBe('i2')
  })

  it('без указания номера берёт первую (у PR доска одна)', () => {
    expect(pickProjectItem(nodes)?.id).toBe('i1')
  })

  it('на пустом списке возвращает null, а не падает', () => {
    expect(pickProjectItem(undefined, '2')).toBeNull()
  })
})

describe('resolveStatusOption', () => {
  it('ищет опцию по точному имени', () => {
    const options = [{ id: 'x', name: 'Todo' }]
    expect(resolveStatusOption(options, 'Todo')?.id).toBe('x')
    expect(resolveStatusOption(options, 'Done')).toBeNull()
  })
})

describe('knownIdWarnings', () => {
  it('молчит, когда живые id совпадают с задокументированными', () => {
    expect(
      knownIdWarnings({
        projectId: KNOWN.projectId,
        statusFieldId: KNOWN.statusFieldId,
        options: [{ name: 'Todo', id: KNOWN.options.Todo }],
      }),
    ).toEqual([])
  })

  it('расхождение — предупреждение, а не блок: побеждает резолвнутое значение', () => {
    const warnings = knownIdWarnings({ projectId: 'PVT_другой', statusFieldId: null, options: [] })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/используется резолвнутый/)
  })
})

describe('bootstrap-taxonomy — план', () => {
  it('создаёт недостающие channel-лейблы', () => {
    const plan = planLabels([])
    expect(plan.create).toHaveLength(CHANNEL_LABEL_SPECS.length)
    expect(plan.update).toEqual([])
  })

  it('совпадающие лейблы оставляет как есть', () => {
    expect(planLabels(CHANNEL_LABEL_SPECS).keep).toHaveLength(CHANNEL_LABEL_SPECS.length)
  })

  it('обновляет лейбл с разошедшимся цветом или описанием', () => {
    const drifted = CHANNEL_LABEL_SPECS.map((s, i) => (i === 0 ? { ...s, color: 'ffffff' } : s))
    const plan = planLabels(drifted)
    expect(plan.update).toEqual([CHANNEL_LABEL_SPECS[0]])
  })

  it('план никогда не содержит удалений — судьба старых лейблов за задачей 7.2', () => {
    const labels = planLabels([{ name: 'enhancement', color: 'a2eeef', description: '' }])
    expect(Object.keys(labels)).toEqual(['create', 'update', 'keep'])
    const lines = formatPlan({ labels, milestone: { create: false }, missingTypes: [] })
    expect(lines.join('\n')).not.toMatch(/удалить|delete/i)
  })

  it('milestone заводится только когда его нет ни в одном состоянии', () => {
    expect(planMilestone([]).create).toBe(true)
    expect(planMilestone([{ title: FALLBACK_MILESTONE, state: 'closed' }]).create).toBe(false)
  })

  it('отсутствующий org Issue Type докладывается, а не чинится отсюда', () => {
    expect(missingIssueTypes([{ name: 'Task' }])).toEqual(['Bug', 'Feature'])
    const lines = formatPlan({
      labels: { create: [], update: [], keep: [] },
      milestone: { create: false },
      missingTypes: ['Bug'],
    })
    expect(lines.join('\n')).toMatch(/настройках организации/)
  })
})
