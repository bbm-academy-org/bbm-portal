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

function die(msg) {
  process.stderr.write(`${TAG} ${msg}\n`)
  process.exit(1)
}

function warn(msg) {
  process.stderr.write(`${TAG} замечание: ${msg}\n`)
}

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
  const { issueNumber, resolveOnly, status } = parsed

  // 1. Targeted-резолвинг — один дешёвый запрос, без скана борда. В режиме
  //    --resolve опция не запрашивается: смысл режима — посмотреть, что есть.
  const target = resolveBoardStatusTarget(issueNumber, resolveOnly ? VALID_STATUS[0] : status)
  if (!target.ok) die(target.error)

  // 2. Кросс-чек с задокументированными id — только WARN, побеждает резолвнутое.
  for (const w of target.warnings) warn(w)

  if (resolveOnly) {
    const { project, statusField } = target
    process.stdout.write(
      `${TAG} отрезолвлено (только чтение):\n` +
        `  проект  = ${project.title} (#${project.number}) ${project.id}\n` +
        `  поле    = Status ${statusField.id}\n` +
        `  строка  = #${issueNumber} -> ${target.itemId}\n` +
        `  опции   = ${(statusField.options ?? []).map((o) => `${o.name}:${o.id}`).join(', ')}\n` +
        `  Мутации не было (--resolve).\n`,
    )
    process.exit(0)
  }

  // 3. Мутация — резолвнутыми живьём id.
  const mutated = ghGraphqlResult(
    buildStatusMutation(target.projectId, target.itemId, target.fieldId, target.optionId),
  )
  if (!mutated.ok) die(mutated.error)

  process.stdout.write(
    `${TAG} ГОТОВО — задача #${issueNumber}: Status = «${status}» (строка ${item.id}).\n`,
  )
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
