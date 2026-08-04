import { describe, expect, it } from 'vitest'

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
import { parseArgs } from '../../tools/gh/set-board-status.mjs'

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
