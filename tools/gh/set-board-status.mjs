#!/usr/bin/env node
// bbm-portal — `pnpm board:status <issue> <Todo|In Progress|Done>` (#130).
//
// Почему отдельная команда: `Closes #N` закрывает задачу, но НЕ двигает колонку
// Projects v2 — автоматизации «closed → Done» на нашем борде не заведено.
// Значит, статус ставится руками, а руками — это самый забываемый шаг цикла
// (канон §7). Плюс claim: «взял задачу» = ворктри И `In Progress` (§4), и
// вторая половина claim'а ставится ровно этой командой.
//
// Резолвинг — ОДИН targeted GraphQL-запрос по конкретной задаче: её
// projectItems несут id строки, id проекта и поле Status с опциями. Скана всего
// борда здесь нет намеренно: квота 5000/ч общая на все параллельные сессии.
//
// Использование:
//   pnpm board:status <issue#> <Todo|In Progress|Done>
//   pnpm board:status <issue#> --resolve        # только чтение, без мутации
//
// Exit codes: 0 = статус установлен (или отрезолвлен); 1 = ошибка.

import { pathToFileURL } from 'node:url'

import {
  PROJECT_NUMBER,
  PROJECT_TITLE,
  VALID_STATUS,
  buildStatusMutation,
  ghGraphqlResult,
  resolveBoardStatusTarget,
} from './lib/gh.mjs'

const TAG = '[board:status]'

// ── чистые сеймы (юнит-тестируются в tests/unit/gh-board-tools.spec.ts) ─────

/**
 * Разобрать argv команды. Статус приходит из shell'а как ОДИН аргумент, но
 * «In Progress» с пробелом легко теряет кавычки, поэтому хвост склеивается
 * обратно: `board:status 42 In Progress` обязан работать так же, как
 * `board:status 42 "In Progress"` — иначе половина claim'ов не проставится.
 */
export function parseArgs(argv) {
  const list = argv ?? []
  const rawIssue = list[0]
  const rest = list.slice(1)
  const issueNumber = Number(rawIssue)
  if (!rawIssue || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    return { ok: false, error: `недопустимый номер задачи: «${rawIssue ?? ''}»` }
  }
  if (rest.length === 0) return { ok: false, error: 'не указан статус' }
  if (rest.length === 1 && rest[0] === '--resolve') {
    return { ok: true, issueNumber, resolveOnly: true, status: null }
  }
  const status = rest.join(' ').trim()
  if (!VALID_STATUS.includes(status)) {
    return {
      ok: false,
      error: `недопустимый статус «${status}». Допустимые: ${VALID_STATUS.join(', ')}`,
    }
  }
  return { ok: true, issueNumber, resolveOnly: false, status }
}

// ── импуративная часть ───────────────────────────────────────────────────────

export const USAGE = `Использование: pnpm board:status <issue#> <${VALID_STATUS.join('|')}>
               pnpm board:status <issue#> --resolve   (только чтение, без мутации)

  Ставит Status задачи на борде «${PROJECT_TITLE}» (Project ${PROJECT_NUMBER}) одним
  targeted GraphQL-запросом — скана всего борда здесь нет: квота 5000/ч общая на
  все параллельные сессии.

  Когда нужна: \`Closes #N\` закрывает задачу, но колонку борда НЕ двигает; и
  «In Progress» — вторая половина claim'а канона §4 (первая — ворктри).

  Статус из двух слов можно передавать без кавычек: \`board:status 42 In Progress\`.

  Exit codes: 0 — статус установлен (или отрезолвлен); 1 — ошибка.
`

/**
 * Весь путь команды после разбора argv: резолвинг → (кросс-чек) → мутация →
 * итоговая строка. Раннеры инжектируются, поэтому тест прогоняет успешную ветку
 * ЦЕЛИКОМ, включая формирование финального сообщения, — без сети и без мутации
 * живого борда.
 *
 * Регрессия #132: раньше эта ветка жила прямо в `main()` и юнит-тестами не
 * исполнялась. В итоговой строке стояла несуществующая переменная `item`
 * (результат резолвера зовётся `target`): мутация проходила, а команда падала
 * `ReferenceError` на логе → exit 1 при СДЕЛАННОЙ работе, и `pr:land` читал
 * стадию board-done как провал.
 */
export function runBoardStatus(parsed, io = {}) {
  const resolve = io.resolve ?? resolveBoardStatusTarget
  const mutate = io.mutate ?? ghGraphqlResult
  const out = io.out ?? ((msg) => process.stdout.write(msg))
  const err = io.err ?? ((msg) => process.stderr.write(msg))
  const exit = io.exit ?? ((code) => process.exit(code))

  const { issueNumber, resolveOnly, status } = parsed
  const die = (msg) => {
    err(`${TAG} ${msg}\n`)
    return exit(1)
  }
  const warn = (msg) => err(`${TAG} замечание: ${msg}\n`)

  // 1. Targeted-резолвинг — один дешёвый запрос, без скана борда. В режиме
  //    --resolve опция не запрашивается: смысл режима — посмотреть, что есть.
  const target = resolve(issueNumber, resolveOnly ? VALID_STATUS[0] : status)
  if (!target.ok) return die(target.error)

  // 2. Кросс-чек с задокументированными id — только WARN, побеждает резолвнутое.
  for (const w of target.warnings ?? []) warn(w)

  if (resolveOnly) {
    const { project, statusField } = target
    out(
      `${TAG} отрезолвлено (только чтение):\n` +
        `  проект  = ${project.title} (#${project.number}) ${project.id}\n` +
        `  поле    = Status ${statusField.id}\n` +
        `  строка  = #${issueNumber} -> ${target.itemId}\n` +
        `  опции   = ${(statusField.options ?? []).map((o) => `${o.name}:${o.id}`).join(', ')}\n` +
        `  Мутации не было (--resolve).\n`,
    )
    return exit(0)
  }

  // 3. Мутация — резолвнутыми живьём id.
  const mutated = mutate(
    buildStatusMutation(target.projectId, target.itemId, target.fieldId, target.optionId),
  )
  if (!mutated.ok) return die(mutated.error)

  out(`${TAG} ГОТОВО — задача #${issueNumber}: Status = «${status}» (строка ${target.itemId}).\n`)
  return exit(0)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    process.stderr.write(`${TAG} ${parsed.error}\n${USAGE}`)
    process.exit(1)
  }
  runBoardStatus(parsed)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
