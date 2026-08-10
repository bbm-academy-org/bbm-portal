#!/usr/bin/env node
// bbm-portal — `pnpm issue:create`: единственный путь заведения задачи (#130).
//
// Почему обёртка, а не `gh issue create`:
//   • сырой `gh issue create` создаёт issue с любым набором полей — и мусор
//     попадает в бэклог раньше, чем кто-нибудь это заметит. Здесь валидация
//     fail-closed ДО первого gh-вызова: нарушение таксономии = issue НЕ создана
//     вообще, а не создана-и-потом-чинится;
//   • «Item added → Todo» на борде срабатывает с задержкой, поэтому строка
//     ставится на борд явно, статус Todo выставляется явно, и наличие строки
//     подтверждается прямым GraphQL-чтением по node id (у `item-list` read-lag
//     на только что добавленной строке).
//
// Канон: `.claude/skills/task-canon/SKILL.md` §2 + §7.
//
// Классификатор задачи — ШТАТНОЕ поле GitHub **Type** (Bug/Feature/Task),
// решение владельца 2026-08-04 («не надо выдумывать новые поля взамен
// существующих»).
//
// Происхождение задачи — ДВА измерения, и их легко перепутать (решение
// владельца 2026-08-04, там же):
//   • `--channel` — КАК задача попала в бэклог, кто завёл её в трекер. Закрытый
//     список из четырёх, становится лейблом `channel:*`. Служит порядку;
//   • `--source`  — НА ОСНОВАНИИ ЧЕГО она существует. СВОБОДНЫЙ текст, первой
//     строкой тела. Enum'а тут быть не может: «баг-репорт в Mattermost»,
//     «executive-решение партнёров», «сам поймал при работе над #124»,
//     «обновилось приложение», «изменилась миссия» — пространство открытое, а
//     закрытый список выродился бы в «99% owner», то есть в ноль информации.
//
// Использование (тонкий passthrough — всё после управляющих флагов уходит в
// `gh issue create` дословно, его флаги здесь не переизобретаются):
//   pnpm issue:create --title "<t>" --body-file <f> --type Task \
//     --channel agent --source "сам поймал при работе над #130" \
//     --milestone "Platform: operations and hardening"
//   pnpm issue:create --no-todo --title …    # добавить на борд, Status не трогать
//
// Управляющие флаги (потребляются здесь, в gh НЕ уходят): `--no-todo`,
// `--channel`, `--source`, `--body`/`--body-file` (тело пересобирается).
//
// Exit codes: 0 = issue создана, добавлена на борд и подтверждена;
// 1 = ошибка валидации / gh / подтверждения.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CHANNEL_LABELS,
  FALLBACK_MILESTONE,
  ISSUE_TYPES,
  OWNER,
  PROJECT_NUMBER,
  PROJECT_TITLE,
  REPO,
  buildNodeQuery,
  buildStatusMutation,
  ghGraphqlResult,
  ghJson,
  ghResult,
  parseNodeReadback,
  resolveBoardStatusTarget,
} from './lib/gh.mjs'

const TAG = '[issue:create]'

// ── чистые сеймы (юнит-тестируются в tests/unit/gh-create-issue.spec.ts) ─────

/**
 * Разделить argv на свои управляющие флаги и passthrough в gh.
 * @returns {{ setTodo: boolean, passthrough: string[] }}
 */
export function partitionArgs(argv) {
  const passthrough = []
  let setTodo = true
  for (const a of argv ?? []) {
    if (a === '--no-todo') {
      setTodo = false
      continue
    }
    passthrough.push(a)
  }
  return { setTodo, passthrough }
}

/**
 * Достать значение флага во всех формах, которые принимает gh: `--flag V`,
 * `--flag=V`, `-f V`, `-fV`. Возвращает ВСЕ найденные значения по порядку —
 * повтор флага тоже сигнал (gh уважает последний, а нам важно заметить).
 * @param {string[]|null|undefined} args
 * @param {string} longName
 * @param {string|null} [shortName]
 * @returns {string[]}
 */
export function flagValues(args, longName, shortName = null) {
  const values = []
  const list = args ?? []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (a === `--${longName}`) {
      values.push(list[i + 1] ?? '')
    } else if (a.startsWith(`--${longName}=`)) {
      values.push(a.slice(longName.length + 3))
    } else if (shortName && a === `-${shortName}`) {
      values.push(list[i + 1] ?? '')
    } else if (shortName && a.length > 2 && a.startsWith(`-${shortName}`) && !a.startsWith('--')) {
      values.push(a.slice(2))
    }
  }
  return values
}

/** Все значения `--label` / `-l`, включая списки через запятую. */
export function collectLabels(args) {
  const out = []
  for (const raw of flagValues(args, 'label', 'l')) {
    for (const part of String(raw).split(',')) {
      const label = part.trim()
      if (label) out.push(label)
    }
  }
  return out
}

/** Есть ли `--repo`/`-R` в passthrough — борд привязан к репо, оверрайд запрещён. */
export function hasRepoOverride(args) {
  return (args ?? []).some(
    (a) => a === '--repo' || a.startsWith('--repo=') || a === '-R' || a.startsWith('-R'),
  )
}

/** Короткие значения канала: `--channel owner` == `--channel channel:owner`. */
export function normalizeChannel(value) {
  const v = String(value ?? '').trim()
  if (v === '') return ''
  return v.startsWith('channel:') ? v : `channel:${v}`
}

/**
 * Ровно один `channel:*` — канал попадания задачи в бэклог. Принимается и
 * флагом `--channel owner`, и лейблом `--label channel:owner`: обёртку зовут и
 * руками, и из скилла, а расходиться в двух формах записи ей незачем.
 */
export function channelError(args) {
  const taxonomy = CHANNEL_LABELS.join(' | ')
  const short = CHANNEL_LABELS.map((l) => l.slice('channel:'.length)).join('|')
  const found = [
    ...flagValues(args, 'channel').map(normalizeChannel),
    ...collectLabels(args).filter((l) => l.startsWith('channel:')),
  ].filter((v) => v !== '')
  const unique = [...new Set(found)]
  if (unique.length === 0) {
    return (
      `у каждой задачи ровно один канал попадания в бэклог — передай --channel <${short}>. ` +
      `Это НЕ происхождение (оно свободным текстом в --source), а «кто завёл задачу в трекер».`
    )
  }
  if (unique.length > 1) {
    return `допустим ровно ОДИН канал, получено: ${unique.join(', ')} (таксономия: ${taxonomy}).`
  }
  if (!CHANNEL_LABELS.includes(unique[0])) {
    return `неизвестный канал «${unique[0]}» — должен быть одним из: ${taxonomy}.`
  }
  return null
}

/** Единственный канал из argv (после валидации). */
export function resolveChannel(args) {
  const found = [
    ...flagValues(args, 'channel').map(normalizeChannel),
    ...collectLabels(args).filter((l) => l.startsWith('channel:')),
  ].filter((v) => v !== '')
  return found[0] ?? null
}

/**
 * Обязательное происхождение — СВОБОДНЫЙ текст (решение владельца 2026-08-04).
 * Enum'а тут быть не может: «баг-репорт Х в Mattermost», «executive-решение
 * партнёров от 2026-07-30», «сам поймал при работе над #124», «обновление
 * зависимости payload 3.86» — пространство источников открытое, и именно этот
 * контекст теряется первым.
 */
export function sourceTextError(args) {
  const found = flagValues(args, 'source').map((v) => String(v).trim())
  if (found.length === 0 || found.every((v) => v === '')) {
    return (
      `у каждой задачи есть происхождение — передай --source "<на основании чего>". ` +
      `Свободный текст, например: «баг-репорт Антона в Mattermost 2026-08-04», ` +
      `«executive-решение партнёров», «сам поймал при работе над #124», «ретро сессии 2026-08-01».`
    )
  }
  if (found.length > 1) return `допустим ровно ОДИН --source, получено ${found.length}.`
  return null
}

/**
 * Строка `**Source:**` собирается тулингом, а не пишется в тело руками — иначе
 * их стало бы два и они бы разошлись.
 */
export function sourceLineError(bodyText) {
  if (!/^\s*\*\*Source:\*\*/im.test(String(bodyText ?? ''))) return null
  return (
    'в теле уже есть строка **Source:** — не пиши её руками, происхождение задаётся ' +
    'флагом --source, обёртка сама поставит строку первой.'
  )
}

/** Итоговое тело: строка Source первой, затем то, что написал вызывающий. */
export function composeBody(sourceText, bodyText) {
  return `**Source:** ${String(sourceText).trim()}\n\n${String(bodyText ?? '').trim()}\n`
}

/**
 * Убрать из passthrough флаги тела и наши собственные — тело уезжает в gh
 * переписанным (через временный файл, чтобы не упереться в лимит длины
 * командной строки Windows), а `--channel`/`--source` gh не знает.
 */
export function stripConsumedFlags(args) {
  const out = []
  const list = args ?? []
  const withValue = new Set(['--body', '-b', '--body-file', '-F', '--channel', '--source'])
  const prefixes = ['--body=', '--body-file=', '--channel=', '--source=']
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (withValue.has(a)) {
      i++ // проглотить значение
      continue
    }
    if (prefixes.some((p) => a.startsWith(p))) continue
    if (a.length > 2 && !a.startsWith('--') && (a.startsWith('-b') || a.startsWith('-F'))) continue
    out.push(a)
  }
  return out
}

/**
 * `kind:*`-лейблов в этом репо нет: класс задачи живёт в штатном поле Type
 * (решение владельца 2026-08-04). Отдельная ошибка вместо молчаливого
 * пропуска — иначе привычка из ds-platform завела бы вторую классификацию.
 */
export function kindLabelError(args) {
  const kinds = collectLabels(args).filter((l) => l.startsWith('kind:'))
  if (kinds.length > 0) {
    return (
      `kind:*-лейблы в этом репо упразднены (${kinds.join(', ')}) — класс задачи задаётся ` +
      `штатным полем Type: --type ${ISSUE_TYPES.join('|')}.`
    )
  }
  const sources = collectLabels(args).filter((l) => l.startsWith('source:'))
  if (sources.length > 0) {
    return (
      `source:*-лейблы упразднены (${sources.join(', ')}): происхождение — свободный текст ` +
      `в --source, канал попадания в бэклог — --channel <owner|spec|retro|agent>.`
    )
  }
  return null
}

/** Ровно один валидный `--type`. */
export function typeError(args) {
  const taxonomy = ISSUE_TYPES.join(' | ')
  const found = flagValues(args, 'type').map((v) => String(v).trim())
  if (found.length === 0) {
    return `у каждой задачи ровно один штатный тип — передай --type <тип>, один из: ${taxonomy}.`
  }
  if (found.length > 1) {
    return `допустим ровно ОДИН --type, получено: ${found.join(', ')}.`
  }
  if (!ISSUE_TYPES.includes(found[0])) {
    return `неизвестный тип «${found[0]}» — должен быть одним из: ${taxonomy} (org Issue Types).`
  }
  return null
}

/** Непустой `--milestone`. */
export function milestoneError(args) {
  const found = flagValues(args, 'milestone', 'm')
    .map((v) => String(v).trim())
    .filter((v) => v !== '')
  if (found.length === 0) {
    return (
      `у каждой задачи есть milestone — передай --milestone <тема>; постоянный fallback для ` +
      `процессных/эксплуатационных задач: «${FALLBACK_MILESTONE}».`
    )
  }
  return null
}

/**
 * Непустое тело. `--body-file` требует чтения файла, поэтому читатель
 * инжектируется — тест гоняет гейт без файловой системы.
 */
export function bodyError(args, readFile = (p) => readFileSync(p, 'utf8')) {
  const inline = flagValues(args, 'body', 'b')
  const files = flagValues(args, 'body-file', 'F')
  if (inline.length === 0 && files.length === 0) {
    return 'у задачи должно быть тело — передай --body "<текст>" или --body-file <файл> (скелет: .claude/skills/task-canon/SKILL.md §1).'
  }
  for (const value of inline) {
    if (String(value).trim() === '') return 'тело задачи пустое (--body) — постановка не бывает пустой.'
  }
  for (const file of files) {
    let content
    try {
      content = readFile(String(file))
    } catch (e) {
      return `не удалось прочитать файл тела «${file}»: ${e?.message ?? e}`
    }
    if (String(content).trim() === '') {
      return `файл тела «${file}» пуст — постановка не бывает пустой.`
    }
  }
  return null
}

/** Собрать текст тела из passthrough (для нефатальных проверок скелета). */
export function readBodyText(args, readFile = (p) => readFileSync(p, 'utf8')) {
  const parts = []
  for (const value of flagValues(args, 'body', 'b')) parts.push(String(value))
  for (const file of flagValues(args, 'body-file', 'F')) {
    try {
      parts.push(String(readFile(String(file))))
    } catch {
      /* bodyError уже отчитается */
    }
  }
  return parts.join('\n')
}

/**
 * Секции канона §1. Разбор терпим к уровню заголовка: `pnpm issue:create`
 * пишет `##`, а issue-формы GitHub рендерят поля как `###` — обе формы
 * канонические, и парсер задачника обязан читать обе.
 */
export const CANON_SECTIONS = [
  'Context',
  'Scope',
  'Spec reference',
  'Acceptance criteria',
  'Notes',
]

export function hasSection(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^#{2,4}\\s*${escaped}\\s*$`, 'im').test(body ?? '')
}

export function hasSourceLine(body) {
  return /^\s*\*\*Source:\*\*/im.test(body ?? '') || hasSection(body, 'Source')
}

/**
 * Нефатальные замечания по скелету тела. НЕ гейт: канон §7 перечисляет ровно
 * четыре fail-closed-условия, и пятое, придуманное тулингом, было бы
 * ужесточением канона мимо владельца. `Acceptance criteria` не требуется у
 * эпика — его критерий это закрытые дети (§1).
 */
export function skeletonWarnings(body, labels = []) {
  const warnings = []
  const isEpic = (labels ?? []).includes('epic')
  if (!hasSourceLine(body)) warnings.push('нет строки **Source:** (канон §1)')
  for (const section of CANON_SECTIONS) {
    if (section === 'Notes') continue
    if (section === 'Acceptance criteria' && isEpic) continue
    if (!hasSection(body, section)) warnings.push(`нет секции «${section}» (канон §1)`)
  }
  return warnings
}

/**
 * Схлопнуть повторяющиеся `--label`: канал приходит и флагом `--channel`, и
 * лейблом, поэтому один и тот же `channel:*` иначе уезжает в gh дважды.
 * Порядок первых вхождений сохраняется; прочие флаги не трогаются.
 */
export function dedupeLabelFlags(args) {
  const out = []
  const seen = new Set()
  const list = args ?? []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    let raw = null
    let skipNext = false
    if (a === '--label' || a === '-l') {
      raw = list[i + 1]
      skipNext = true
    } else if (a.startsWith('--label=')) {
      raw = a.slice('--label='.length)
    } else {
      out.push(a)
      continue
    }
    if (skipNext) i++
    for (const part of String(raw ?? '').split(',')) {
      const label = part.trim()
      if (label === '' || seen.has(label)) continue
      seen.add(label)
      out.push('--label', label)
    }
  }
  return out
}

/** Есть ли уже `--assignee`/`-a`? */
export function hasAssignee(args) {
  return flagValues(args, 'assignee', 'a').length > 0
}

/** Дописать `--assignee @me`, если явного нет. Явный никогда не перетирается. */
export function ensureAssigneeFlag(args) {
  const list = [...(args ?? [])]
  if (hasAssignee(list)) return list
  return [...list, '--assignee', '@me']
}

/**
 * Все гейты по порядку. Первая ошибка — та, что выводится: сообщать пять
 * нарушений разом бесполезно, чинят их всё равно по одному.
 */
export function validationError(args, readFile) {
  if (hasRepoOverride(args)) {
    return (
      `--repo/-R запрещён: обёртка жёстко привязана к ${REPO}, потому что борд Project ` +
      `${PROJECT_NUMBER} привязан к репо. Убери флаг.`
    )
  }
  return (
    channelError(args) ??
    sourceTextError(args) ??
    kindLabelError(args) ??
    typeError(args) ??
    milestoneError(args) ??
    bodyError(args, readFile) ??
    sourceLineError(readBodyText(args, readFile)) ??
    null
  )
}

/**
 * Дополнить ошибку `gh issue create` подсказкой, когда причина — отсутствующий
 * лейбл таксономии. Обёртка объявлена единственным путём заведения задач, а до
 * `taxonomy:bootstrap --apply` лейблов `channel:*` в репо нет — без подсказки
 * первая же попытка упирается в невнятное «could not add label».
 * @param {string} stderr
 * @param {string[]} labels  лейблы, которые уехали в gh
 * @returns {string}
 */
export function enrichCreateError(stderr, labels) {
  const text = String(stderr ?? '')
  if (!/label/i.test(text)) return text
  const channels = (labels ?? []).filter((l) => String(l).startsWith('channel:'))
  if (channels.length === 0) return text
  return (
    `${text}\n  Похоже, лейбла ${channels.join(', ')} в репо ещё нет. Таксономия заводится ` +
    `один раз: pnpm taxonomy:bootstrap (сухой прогон) → pnpm taxonomy:bootstrap --apply`
  )
}

/** URL созданной issue из stdout `gh issue create`. */
export function extractIssueUrl(stdout) {
  const m = (stdout ?? '').match(/https?:\/\/\S*\/issues\/(\d+)\b/)
  return m ? m[0] : null
}

/** Номер issue из её URL. */
export function issueNumberFromUrl(url) {
  const m = (url ?? '').match(/\/issues\/(\d+)\b/)
  return m ? Number(m[1]) : null
}

// ── импуративная часть ───────────────────────────────────────────────────────

function out(msg) {
  process.stdout.write(`${TAG} ${msg}\n`)
}

function die(msg) {
  process.stderr.write(`${TAG} ${msg}\n`)
  process.exit(1)
}

export const USAGE =
  `Использование: pnpm issue:create [--no-todo] --title "<t>" --body-file <f> \\\n` +
  `    --type ${ISSUE_TYPES.join('|')} --channel <owner|spec|retro|agent> \\\n` +
  `    --source "<на основании чего>" --milestone "<тема>"\n\n` +
  `  Тонкая обёртка над \`gh issue create\` (его флаги идут дословно), которая ещё и\n` +
  `  ставит задачу на борд «${PROJECT_TITLE}» (Project ${PROJECT_NUMBER}), выставляет Status=Todo\n` +
  `  и подтверждает строку прямым GraphQL-чтением. --no-todo: добавить без Status.\n\n` +
  `  Два измерения происхождения, не путать:\n` +
  `    --channel  КАК задача попала в бэклог (кто завёл её в трекер) — закрытый список,\n` +
  `               становится лейблом channel:*;\n` +
  `    --source   НА ОСНОВАНИИ ЧЕГО она существует — свободный текст, становится строкой\n` +
  `               «**Source:**» первой строкой тела. Например: «баг-репорт Антона в\n` +
  `               Mattermost 2026-08-04», «executive-решение партнёров», «сам поймал при\n` +
  `               работе над #124», «обновление зависимости payload 3.86».\n\n` +
  `  Обязательно (fail-closed, ДО любого gh-вызова):\n` +
  `    • ровно один --channel: ${CHANNEL_LABELS.join(' | ')};\n` +
  `    • непустой --source (строку **Source:** в теле писать руками нельзя);\n` +
  `    • ровно один --type: ${ISSUE_TYPES.join(' | ')} (штатное поле GitHub);\n` +
  `    • непустой --milestone (fallback «${FALLBACK_MILESTONE}»);\n` +
  `    • непустое тело (--body или --body-file), скелет — канон §1.\n` +
  `  Assignee по умолчанию @me. --repo/-R запрещён.\n\n` +
  `  Таксономия заводится один раз: pnpm taxonomy:bootstrap --apply.\n` +
  `  Exit codes: 0 — задача создана и подтверждена на борде; 1 — ошибка.\n`

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (argv.length === 0) {
    process.stderr.write(USAGE)
    process.exit(1)
  }

  const { setTodo, passthrough } = partitionArgs(argv)

  // 0. Гейты — все до первого gh-вызова. Нарушение = issue не создана вовсе.
  const error = validationError(passthrough)
  if (error) die(error)

  // Тело собирается здесь: строка **Source:** первой, затем текст вызывающего.
  // Уезжает во временный файл, а не в `--body`, чтобы длинное тело не упёрлось
  // в лимит длины командной строки Windows.
  const channel = resolveChannel(passthrough)
  const sourceText = flagValues(passthrough, 'source')[0]
  const body = composeBody(sourceText, readBodyText(passthrough))
  for (const w of skeletonWarnings(body, [channel, ...collectLabels(passthrough)])) {
    process.stderr.write(`${TAG} замечание (не блокирует): ${w}\n`)
  }

  const bodyDir = mkdtempSync(join(tmpdir(), 'bbm-issue-'))
  const bodyFile = join(bodyDir, 'body.md')
  writeFileSync(bodyFile, body, 'utf8')
  // Уборка вешается на 'exit', а не на try/finally: почти все выходы отсюда
  // идут через die() → process.exit, а он finally не исполняет.
  process.on('exit', () => {
    try {
      rmSync(bodyDir, { recursive: true, force: true })
    } catch {
      /* временный каталог — не повод ронять команду */
    }
  })

  const augmented = ensureAssigneeFlag(
    dedupeLabelFlags([
      ...stripConsumedFlags(passthrough),
      '--label',
      channel,
      '--body-file',
      bodyFile,
    ]),
  )

  // 1. Создание. `--repo` пинится ПОСЛЕ passthrough: gh уважает последний, так
  //    что даже если оверрайд просочится, issue приземлится в нашем репо.
  out('создаю задачу…')
  const created = ghResult(['issue', 'create', ...augmented, '--repo', REPO])
  if (!created.ok) die(enrichCreateError(created.error, collectLabels(augmented)))
  const url = extractIssueUrl(created.stdout)
  if (!url) die(`не нашёл URL созданной задачи в выводе gh:\n${created.stdout.trim()}`)
  const issueNumber = issueNumberFromUrl(url)
  if (!issueNumber) die(`не смог разобрать номер задачи из URL: ${url}`)
  out(`создана #${issueNumber} — ${url}`)

  // 2. Постановка на борд — item-add возвращает авторитетный id строки.
  const added = ghJson([
    'project',
    'item-add',
    PROJECT_NUMBER,
    '--owner',
    OWNER,
    '--url',
    url,
    '--format',
    'json',
  ])
  if (!added.ok) {
    die(
      `${added.error}\n  Задача #${issueNumber} СОЗДАНА, но НЕ на борде — доставь вручную: ` +
        `gh project item-add ${PROJECT_NUMBER} --owner ${OWNER} --url ${url}`,
    )
  }
  const itemId = added.data?.id
  if (!itemId) {
    die(
      `gh project item-add не вернул id строки (ответ: ${JSON.stringify(added.data)}); ` +
        `задача #${issueNumber} существует, но НЕ на борде — доставь вручную.`,
    )
  }
  out(`поставлена на борд — строка ${itemId}`)

  // 3. Status=Todo — id резолвятся ЖИВЬЁМ (задокументированные KNOWN остаются
  //    кросс-чеком), той же функцией, что использует `board:status`.
  if (setTodo) {
    const target = resolveBoardStatusTarget(issueNumber, 'Todo')
    if (!target.ok) {
      die(`${target.error}\n  Почини вручную: pnpm board:status ${issueNumber} Todo`)
    }
    for (const w of target.warnings) process.stderr.write(`${TAG} замечание: ${w}\n`)
    const mutated = ghGraphqlResult(
      buildStatusMutation(target.projectId, target.itemId, target.fieldId, target.optionId),
    )
    if (!mutated.ok) {
      die(`${mutated.error}\n  Почини вручную: pnpm board:status ${issueNumber} Todo`)
    }
    out('Status = Todo')
  }

  // 4. Подтверждение прямым node-чтением (обходит read-lag `item-list`).
  const readback = ghGraphqlResult(buildNodeQuery(itemId))
  if (!readback.ok) die(`${readback.error}\n  Сверь вручную: pnpm board:status ${issueNumber} Todo`)
  const check = parseNodeReadback(readback.data, issueNumber, { expectTodo: setTodo })
  if (!check.ok) {
    die(
      `подтверждение борда не прошло: ${check.reason} (строка ${itemId}); ` +
        `почини: pnpm board:status ${issueNumber} Todo`,
    )
  }

  out(
    `ГОТОВО — подтверждено на борде.\n` +
      `  задача = #${issueNumber}\n` +
      `  url    = ${url}\n` +
      `  строка = ${itemId}\n` +
      `  статус = ${check.status ?? '(не задан)'}`,
  )
  process.exit(0)
}

// main запускается только при прямом вызове — чистые сеймы импортируются
// тестом без единого подпроцесса.
const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
