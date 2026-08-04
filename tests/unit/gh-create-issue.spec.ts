import { describe, expect, it } from 'vitest'

import {
  collectLabels,
  enrichCreateError,
  ensureAssigneeFlag,
  extractIssueUrl,
  flagValues,
  hasAssignee,
  hasRepoOverride,
  issueNumberFromUrl,
  kindLabelError,
  milestoneError,
  bodyError,
  partitionArgs,
  readBodyText,
  skeletonWarnings,
  sourceLabelError,
  typeError,
  validationError,
} from '../../tools/gh/create-issue.mjs'
import { branchTypeFromIssueType, parseNodeReadback } from '../../tools/gh/lib/gh.mjs'

/**
 * `pnpm issue:create` — единственный путь заведения задачи, и его валидация
 * fail-closed: нарушение таксономии обязано отменить создание ДО первого
 * gh-вызова. Все гейты — чистые функции, поэтому тестируются без сети.
 * Канон: `.claude/rules/task-canon.md` §2 + §7.
 */

const OK_ARGS = [
  '--title',
  'что-то',
  '--body',
  'тело',
  '--type',
  'Task',
  '--label',
  'source:agent',
  '--milestone',
  'Консолидация платформы',
]

describe('partitionArgs', () => {
  it('снимает свои управляющие флаги, остальное отдаёт gh дословно', () => {
    const { setTodo, passthrough } = partitionArgs(['--no-todo', '--title', 'x'])
    expect(setTodo).toBe(false)
    expect(passthrough).toEqual(['--title', 'x'])
  })

  it('по умолчанию ставит Status=Todo', () => {
    expect(partitionArgs(['--title', 'x']).setTodo).toBe(true)
  })
})

describe('flagValues', () => {
  it('читает все формы записи флага, которые принимает gh', () => {
    expect(flagValues(['--milestone', 'A'], 'milestone', 'm')).toEqual(['A'])
    expect(flagValues(['--milestone=A'], 'milestone', 'm')).toEqual(['A'])
    expect(flagValues(['-m', 'A'], 'milestone', 'm')).toEqual(['A'])
    expect(flagValues(['-mA'], 'milestone', 'm')).toEqual(['A'])
  })

  it('не путает короткий флаг с длинным и не глотает чужие', () => {
    expect(flagValues(['--milestone-ish', 'A'], 'milestone', 'm')).toEqual([])
    expect(flagValues(['--type', 'Task'], 'milestone', 'm')).toEqual([])
  })
})

describe('collectLabels', () => {
  it('собирает лейблы из повторов, `=`-формы и списков через запятую', () => {
    expect(collectLabels(['--label', 'a', '-l', 'b,c', '--label=d'])).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('sourceLabelError', () => {
  it('пропускает ровно один source-лейбл из таксономии', () => {
    expect(sourceLabelError(['--label', 'source:owner'])).toBeNull()
  })

  it('падает без source-лейбла', () => {
    expect(sourceLabelError(['--label', 'epic'])).toMatch(/ровно один лейбл происхождения/)
  })

  it('падает на двух source-лейблах', () => {
    expect(sourceLabelError(['--label', 'source:owner,source:agent'])).toMatch(/ровно ОДИН source/)
  })

  it('падает на source-лейбле вне таксономии', () => {
    expect(sourceLabelError(['--label', 'source:тётя'])).toMatch(/неизвестный source-лейбл/)
  })
})

describe('kindLabelError', () => {
  /**
   * kind:*-лейблов у нас нет: класс задачи — штатное поле Type (решение
   * владельца 2026-08-04). Привычка из ds-platform должна падать громко, иначе
   * заведётся вторая, расходящаяся классификация.
   */
  it('молчит, когда kind-лейблов нет', () => {
    expect(kindLabelError(['--label', 'source:agent'])).toBeNull()
  })

  it('падает на любом kind:*-лейбле и указывает на --type', () => {
    expect(kindLabelError(['--label', 'kind:feat'])).toMatch(/упразднены.*--type/s)
  })
})

describe('typeError', () => {
  it('пропускает ровно один штатный тип', () => {
    for (const t of ['Bug', 'Feature', 'Task']) expect(typeError(['--type', t])).toBeNull()
  })

  it('падает без типа', () => {
    expect(typeError([])).toMatch(/ровно один штатный тип/)
  })

  it('падает на неизвестном типе и на двух типах', () => {
    expect(typeError(['--type', 'Chore'])).toMatch(/неизвестный тип/)
    expect(typeError(['--type', 'Bug', '--type', 'Task'])).toMatch(/ровно ОДИН --type/)
  })
})

describe('milestoneError', () => {
  it('требует непустое значение, а не сам факт флага', () => {
    expect(milestoneError(['--milestone', 'Тема'])).toBeNull()
    expect(milestoneError(['--milestone', '   '])).toMatch(/есть milestone/)
    expect(milestoneError([])).toMatch(/есть milestone/)
  })

  it('называет постоянный fallback в тексте ошибки', () => {
    expect(milestoneError([])).toMatch(/Платформа: эксплуатация и упрочнение/)
  })
})

describe('bodyError', () => {
  it('пропускает непустое тело в любой форме', () => {
    expect(bodyError(['--body', 'текст'])).toBeNull()
    expect(bodyError(['--body-file', 'x.md'], () => 'текст')).toBeNull()
  })

  it('падает на отсутствующем, пустом и пробельном теле', () => {
    expect(bodyError([])).toMatch(/должно быть тело/)
    expect(bodyError(['--body', '   '])).toMatch(/пустое/)
    expect(bodyError(['--body-file', 'x.md'], () => '\n\n')).toMatch(/пуст/)
  })

  it('падает, если файл тела не читается — молча создавать задачу нельзя', () => {
    expect(
      bodyError(['--body-file', 'нет.md'], () => {
        throw new Error('ENOENT')
      }),
    ).toMatch(/не удалось прочитать файл тела/)
  })
})

describe('hasRepoOverride', () => {
  it('ловит --repo и -R во всех формах: борд привязан к репо', () => {
    expect(hasRepoOverride(['--repo', 'o/r'])).toBe(true)
    expect(hasRepoOverride(['--repo=o/r'])).toBe(true)
    expect(hasRepoOverride(['-R', 'o/r'])).toBe(true)
    expect(hasRepoOverride(['-Ro/r'])).toBe(true)
    expect(hasRepoOverride(OK_ARGS)).toBe(false)
  })
})

describe('validationError — порядок гейтов', () => {
  it('пропускает полный корректный набор', () => {
    expect(validationError(OK_ARGS)).toBeNull()
  })

  it('оверрайд репо перебивает все прочие проверки', () => {
    expect(validationError(['--repo', 'чужой/репо'])).toMatch(/--repo\/-R запрещён/)
  })

  it('сообщает ровно одну ошибку за раз, начиная с source', () => {
    const err = validationError(['--title', 'x'])
    expect(err).toMatch(/лейбл происхождения/)
    expect(err).not.toMatch(/milestone/)
  })

  it('на каждом отдельном нарушении возвращает непустую ошибку', () => {
    const drop = (flag: string) => {
      const i = OK_ARGS.indexOf(flag)
      return [...OK_ARGS.slice(0, i), ...OK_ARGS.slice(i + 2)]
    }
    expect(validationError(drop('--type'))).toBeTruthy()
    expect(validationError(drop('--milestone'))).toBeTruthy()
    expect(validationError(drop('--body'))).toBeTruthy()
  })
})

describe('assignee', () => {
  it('дописывает @me, когда явного нет', () => {
    expect(ensureAssigneeFlag(['--title', 'x'])).toEqual(['--title', 'x', '--assignee', '@me'])
  })

  it('никогда не перетирает явного assignee', () => {
    const args = ['--assignee', 'sidorovanthon']
    expect(hasAssignee(args)).toBe(true)
    expect(ensureAssigneeFlag(args)).toEqual(args)
  })
})

describe('skeletonWarnings', () => {
  const full = [
    '**Source:** source:agent',
    '## Context',
    'почему',
    '## Scope',
    '## Spec reference',
    '## Acceptance criteria',
  ].join('\n')

  it('молчит на полном скелете канона §1', () => {
    expect(skeletonWarnings(full)).toEqual([])
  })

  it('принимает `###`-заголовки: issue-формы GitHub рендерят поля именно так', () => {
    expect(skeletonWarnings(full.replace(/^## /gm, '### '))).toEqual([])
  })

  it('называет каждую недостающую секцию', () => {
    const warnings = skeletonWarnings('просто текст')
    expect(warnings).toContain('нет строки **Source:** (канон §1)')
    expect(warnings).toContain('нет секции «Acceptance criteria» (канон §1)')
  })

  it('у эпика критерии приёмки не требуются — его критерий это закрытые дети', () => {
    const body = full.replace('## Acceptance criteria', '')
    expect(skeletonWarnings(body, ['epic'])).toEqual([])
    expect(skeletonWarnings(body, [])).toContain('нет секции «Acceptance criteria» (канон §1)')
  })
})

describe('readBodyText', () => {
  it('склеивает inline-тело и содержимое файлов', () => {
    expect(readBodyText(['--body', 'A', '--body-file', 'f.md'], () => 'B')).toBe('A\nB')
  })
})

describe('разбор ответов gh', () => {
  it('достаёт URL и номер созданной задачи', () => {
    const stdout = 'https://github.com/bbm-academy-org/bbm-portal/issues/131\n'
    expect(extractIssueUrl(stdout)).toBe('https://github.com/bbm-academy-org/bbm-portal/issues/131')
    expect(issueNumberFromUrl(extractIssueUrl(stdout)!)).toBe(131)
  })

  it('возвращает null, когда URL в выводе нет', () => {
    expect(extractIssueUrl('creating issue…')).toBeNull()
  })
})

describe('enrichCreateError', () => {
  /**
   * Обёртка объявлена единственным путём заведения задач, а лейблов `source:*`
   * в репо нет до `taxonomy:bootstrap --apply` — без подсказки первая попытка
   * упирается в невнятное «could not add label».
   */
  it('на ошибке про лейбл указывает на taxonomy:bootstrap', () => {
    const msg = enrichCreateError("could not add label: 'source:agent' not found", ['source:agent'])
    expect(msg).toMatch(/taxonomy:bootstrap --apply/)
  })

  it('чужие ошибки не обрастают посторонним советом', () => {
    expect(enrichCreateError('HTTP 502', ['source:agent'])).toBe('HTTP 502')
    expect(enrichCreateError('could not add label: epic', [])).toBe('could not add label: epic')
  })
})

describe('parseNodeReadback', () => {
  const node = (number: number, status: string | null) => ({
    node: {
      content: { number },
      fieldValueByName: status === null ? null : { name: status },
    },
  })

  it('подтверждает строку борда с ожидаемым Todo', () => {
    expect(parseNodeReadback(node(131, 'Todo'), 131, { expectTodo: true })).toEqual({
      ok: true,
      status: 'Todo',
      number: 131,
    })
  })

  it('ловит чужую задачу под тем же item id', () => {
    expect(parseNodeReadback(node(999, 'Todo'), 131).ok).toBe(false)
  })

  it('ловит непроставленный Status, когда его ждали', () => {
    const res = parseNodeReadback(node(131, null), 131, { expectTodo: true })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/не задан/)
  })

  it('пустой node — это не «ок», а «строки нет на борде»', () => {
    expect(parseNodeReadback({}, 131).ok).toBe(false)
  })
})

describe('branchTypeFromIssueType', () => {
  /** Цепочка канона §2: Type → префикс ветки → тип Conventional-коммита. */
  it('переводит штатный Type в префикс ветки', () => {
    expect(branchTypeFromIssueType('Bug')).toBe('fix')
    expect(branchTypeFromIssueType('Feature')).toBe('feat')
    expect(branchTypeFromIssueType('Task')).toBe('chore')
  })

  it('неизвестный или отсутствующий Type падает в безопасный chore', () => {
    expect(branchTypeFromIssueType('Epic')).toBe('chore')
    expect(branchTypeFromIssueType(null)).toBe('chore')
  })
})
