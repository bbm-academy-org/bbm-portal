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
// Канон: `.claude/rules/task-canon.md` §2 + §7.
//
// Классификатор задачи — ШТАТНОЕ поле GitHub **Type** (Bug/Feature/Task),
// решение владельца 2026-08-04 («не надо выдумывать новые поля взамен
// существующих»). Кастомная таксономия ровно одна — `source:*`: штатного поля
// «кто это просил» у GitHub нет.
//
// Использование (тонкий passthrough — всё после управляющих флагов уходит в
// `gh issue create` дословно, его флаги здесь не переизобретаются):
//   pnpm issue:create --title "<t>" --body-file <f> --type Task \
//     --label source:agent --milestone "Платформа: эксплуатация и упрочнение"
//   pnpm issue:create --no-todo --title …    # добавить на борд, Status не трогать
//
// Управляющие флаги (потребляются здесь, в gh НЕ уходят): `--no-todo`.
//
// Exit codes: 0 = issue создана, добавлена на борд и подтверждена;
// 1 = ошибка валидации / gh / подтверждения.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import {
  FALLBACK_MILESTONE,
  ISSUE_TYPES,
  OWNER,
  PROJECT_NUMBER,
  REPO,
  SOURCE_LABELS,
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

/** Ровно один `source:*` из таксономии. Возвращает null либо текст ошибки. */
export function sourceLabelError(args) {
  const taxonomy = SOURCE_LABELS.join(' | ')
  const found = collectLabels(args).filter((l) => l.startsWith('source:'))
  if (found.length === 0) {
    return `у каждой задачи ровно один лейбл происхождения — передай --label <source>, один из: ${taxonomy}.`
  }
  if (found.length > 1) {
    return `допустим ровно ОДИН source:*-лейбл, получено: ${found.join(', ')} (таксономия: ${taxonomy}).`
  }
  if (!SOURCE_LABELS.includes(found[0])) {
    return `неизвестный source-лейбл «${found[0]}» — должен быть одним из: ${taxonomy}.`
  }
  return null
}

/**
 * `kind:*`-лейблов в этом репо нет: класс задачи живёт в штатном поле Type
 * (решение владельца 2026-08-04). Отдельная ошибка вместо молчаливого
 * пропуска — иначе привычка из ds-platform завела бы вторую классификацию.
 */
export function kindLabelError(args) {
  const found = collectLabels(args).filter((l) => l.startsWith('kind:'))
  if (found.length === 0) return null
  return (
    `kind:*-лейблы в этом репо упразднены (${found.join(', ')}) — класс задачи задаётся ` +
    `штатным полем Type: --type ${ISSUE_TYPES.join('|')}.`
  )
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
    return 'у задачи должно быть тело — передай --body "<текст>" или --body-file <файл> (скелет: .claude/rules/task-canon.md §1).'
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
    sourceLabelError(args) ??
    kindLabelError(args) ??
    typeError(args) ??
    milestoneError(args) ??
    bodyError(args, readFile) ??
    null
  )
}

/**
 * Дополнить ошибку `gh issue create` подсказкой, когда причина — отсутствующий
 * лейбл таксономии. Обёртка объявлена единственным путём заведения задач, а до
 * `taxonomy:bootstrap --apply` лейблов `source:*` в репо нет — без подсказки
 * первая же попытка упирается в невнятное «could not add label».
 * @param {string} stderr
 * @param {string[]} labels  лейблы, которые передал вызывающий
 * @returns {string}
 */
export function enrichCreateError(stderr, labels) {
  const text = String(stderr ?? '')
  if (!/label/i.test(text)) return text
  const source = (labels ?? []).filter((l) => l.startsWith('source:'))
  if (source.length === 0) return text
  return (
    `${text}\n  Похоже, лейбла ${source.join(', ')} в репо ещё нет. Таксономия заводится ` +
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
      `    --type ${ISSUE_TYPES.join('|')} --label <source:*> --milestone "<тема>"\n\n` +
      `  Тонкая обёртка над \`gh issue create\` (его флаги идут дословно), которая ещё и\n` +
      `  ставит задачу на борд «${'BBM Platform'}» (Project ${PROJECT_NUMBER}), выставляет Status=Todo\n` +
      `  и подтверждает строку прямым GraphQL-чтением. --no-todo: добавить без Status.\n\n` +
      `  Обязательно (fail-closed, ДО любого gh-вызова):\n` +
      `    • ровно один --type: ${ISSUE_TYPES.join(' | ')} (штатное поле GitHub);\n` +
      `    • ровно один source-лейбл: ${SOURCE_LABELS.join(' | ')};\n` +
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

  for (const w of skeletonWarnings(readBodyText(passthrough), collectLabels(passthrough))) {
    process.stderr.write(`${TAG} замечание (не блокирует): ${w}\n`)
  }

  const augmented = ensureAssigneeFlag(passthrough)

  // 1. Создание. `--repo` пинится ПОСЛЕ passthrough: gh уважает последний, так
  //    что даже если оверрайд просочится, issue приземлится в нашем репо.
  out('создаю задачу…')
  const created = ghResult(['issue', 'create', ...augmented, '--repo', REPO])
  if (!created.ok) die(enrichCreateError(created.error, collectLabels(passthrough)))
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
