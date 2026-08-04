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
  channelError,
  composeBody,
  normalizeChannel,
  resolveChannel,
  sourceLineError,
  sourceTextError,
  stripConsumedFlags,
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
  '--channel',
  'agent',
  '--source',
  'сам поймал при работе над #130',
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

describe('normalizeChannel', () => {
  it('принимает и короткую форму, и полную', () => {
    expect(normalizeChannel('owner')).toBe('channel:owner')
    expect(normalizeChannel('channel:owner')).toBe('channel:owner')
    expect(normalizeChannel('  spec ')).toBe('channel:spec')
  })

  it('пустое значение каналом не притворяется', () => {
    expect(normalizeChannel('')).toBe('')
    expect(normalizeChannel(null)).toBe('')
  })
})

describe('channelError', () => {
  it('пропускает ровно один канал во флаговой и лейбловой форме', () => {
    expect(channelError(['--channel', 'owner'])).toBeNull()
    expect(channelError(['--label', 'channel:spec'])).toBeNull()
  })

  it('падает без канала и объясняет, что это НЕ происхождение', () => {
    const err = channelError(['--label', 'epic'])
    expect(err).toMatch(/ровно один канал/)
    expect(err).toMatch(/НЕ происхождение/)
  })

  it('падает на двух разных каналах', () => {
    expect(channelError(['--channel', 'owner', '--label', 'channel:agent'])).toMatch(
      /ровно ОДИН канал/,
    )
  })

  it('одно и то же значение в двух формах записи конфликтом не считает', () => {
    expect(channelError(['--channel', 'owner', '--label', 'channel:owner'])).toBeNull()
  })

  it('падает на канале вне таксономии', () => {
    expect(channelError(['--channel', 'тётя'])).toMatch(/неизвестный канал/)
  })
})

describe('resolveChannel', () => {
  it('возвращает канонический лейбл канала', () => {
    expect(resolveChannel(['--channel', 'retro'])).toBe('channel:retro')
    expect(resolveChannel(['--label', 'channel:spec'])).toBe('channel:spec')
    expect(resolveChannel([])).toBeNull()
  })
})

describe('sourceTextError', () => {
  /**
   * Происхождение — обязательный СВОБОДНЫЙ текст (решение владельца
   * 2026-08-04): «99% задач будут запрошены оунером, пользы никакой» — enum
   * вырождался, а контекст «на основании чего» теряется первым.
   */
  it('пропускает непустой свободный текст', () => {
    expect(sourceTextError(['--source', 'баг-репорт Антона в Mattermost 2026-08-04'])).toBeNull()
  })

  it('падает без --source и приводит примеры формулировок', () => {
    const err = sourceTextError([])
    expect(err).toMatch(/есть происхождение/)
    expect(err).toMatch(/executive-решение/)
  })

  it('пробельный --source пустым и остаётся', () => {
    expect(sourceTextError(['--source', '   '])).toMatch(/есть происхождение/)
  })

  it('два --source — конфликт, а не склейка', () => {
    expect(sourceTextError(['--source', 'A', '--source', 'B'])).toMatch(/ровно ОДИН --source/)
  })
})

describe('sourceLineError', () => {
  it('строку **Source:** руками в тело писать нельзя — её ставит обёртка', () => {
    expect(sourceLineError('**Source:** что-то\n\n## Context')).toMatch(/не пиши её руками/)
  })

  it('тело без такой строки проходит', () => {
    expect(sourceLineError('## Context\n\nтекст')).toBeNull()
  })
})

describe('composeBody', () => {
  it('ставит строку Source первой, тело — следом', () => {
    expect(composeBody('баг-репорт в MM', '## Context\n\nтекст')).toBe(
      '**Source:** баг-репорт в MM\n\n## Context\n\nтекст\n',
    )
  })
})

describe('stripConsumedFlags', () => {
  it('снимает флаги тела и свои собственные, чужие оставляет', () => {
    expect(
      stripConsumedFlags([
        '--title',
        'x',
        '--body-file',
        'f.md',
        '--channel',
        'agent',
        '--source',
        'текст',
        '--label',
        'epic',
      ]),
    ).toEqual(['--title', 'x', '--label', 'epic'])
  })

  it('снимает и `=`-форму, и короткую', () => {
    expect(
      stripConsumedFlags(['--body=текст', '-b', 'x', '--source=y', '--milestone', 'M']),
    ).toEqual(['--milestone', 'M'])
  })
})

describe('kindLabelError', () => {
  /**
   * kind:*-лейблов у нас нет: класс задачи — штатное поле Type (решение
   * владельца 2026-08-04). Привычка из ds-platform должна падать громко, иначе
   * заведётся вторая, расходящаяся классификация.
   */
  it('молчит, когда упразднённых лейблов нет', () => {
    expect(kindLabelError(['--label', 'channel:agent'])).toBeNull()
  })

  it('падает на любом kind:*-лейбле и указывает на --type', () => {
    expect(kindLabelError(['--label', 'kind:feat'])).toMatch(/упразднены.*--type/s)
  })

  it('падает на старом source:*-лейбле и разводит два измерения', () => {
    const err = kindLabelError(['--label', 'source:owner'])
    expect(err).toMatch(/source:\*-лейблы упразднены/)
    expect(err).toMatch(/--source/)
    expect(err).toMatch(/--channel/)
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

  it('сообщает ровно одну ошибку за раз, начиная с канала', () => {
    const err = validationError(['--title', 'x'])
    expect(err).toMatch(/ровно один канал/)
    expect(err).not.toMatch(/milestone/)
  })

  it('канал есть, происхождения нет — вторая по очереди ошибка', () => {
    expect(validationError(['--channel', 'owner'])).toMatch(/есть происхождение/)
  })

  it('на каждом отдельном нарушении возвращает непустую ошибку', () => {
    const drop = (flag: string) => {
      const i = OK_ARGS.indexOf(flag)
      return [...OK_ARGS.slice(0, i), ...OK_ARGS.slice(i + 2)]
    }
    expect(validationError(drop('--channel'))).toBeTruthy()
    expect(validationError(drop('--source'))).toBeTruthy()
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
    '**Source:** сам поймал при работе над #130',
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
    const msg = enrichCreateError("could not add label: 'channel:agent' not found", [
      'channel:agent',
    ])
    expect(msg).toMatch(/taxonomy:bootstrap --apply/)
  })

  it('чужие ошибки не обрастают посторонним советом', () => {
    expect(enrichCreateError('HTTP 502', ['channel:agent'])).toBe('HTTP 502')
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
