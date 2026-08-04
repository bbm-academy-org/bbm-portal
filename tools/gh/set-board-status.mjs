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
  OWNER,
  PROJECT_NUMBER,
  PROJECT_TITLE,
  REPO,
  VALID_STATUS,
  buildIssueProjectItemsQuery,
  buildStatusMutation,
  ghGraphqlResult,
  knownIdWarnings,
  pickProjectItem,
  resolveStatusOption,
} from './lib/gh.mjs'

const TAG = '[board:status]'

// ── чистые сеймы (юнит-тестируются в tests/unit/gh-board-status.spec.ts) ─────

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

function usage() {
  process.stderr.write(
    `Использование: pnpm board:status <issue#> <${VALID_STATUS.join('|')}>\n` +
      `               pnpm board:status <issue#> --resolve   (только чтение)\n`,
  )
  process.exit(1)
}

function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    process.stderr.write(`${TAG} ${parsed.error}\n`)
    usage()
  }
  const { issueNumber, resolveOnly, status } = parsed

  // 1. Targeted-резолвинг — один дешёвый запрос, без скана борда.
  const res = ghGraphqlResult(buildIssueProjectItemsQuery(issueNumber))
  if (!res.ok) die(res.error)
  const issue = res.data?.repository?.issue
  if (!issue) die(`задача #${issueNumber} не найдена в ${REPO}`)

  const item = pickProjectItem(issue.projectItems?.nodes, PROJECT_NUMBER)
  if (!item) {
    die(
      `задача #${issueNumber} не стоит на борде «${PROJECT_TITLE}» (Project ${PROJECT_NUMBER}). ` +
        `Поставь: gh project item-add ${PROJECT_NUMBER} --owner ${OWNER} --url <url задачи>`,
    )
  }

  const project = item.project
  const statusField = project?.field
  if (!statusField?.id) {
    die(`поле Status (single-select) не найдено на Project ${PROJECT_NUMBER}`)
  }

  // 2. Кросс-чек с задокументированными id — только WARN, побеждает резолвнутое.
  for (const w of knownIdWarnings({
    projectId: project.id,
    statusFieldId: statusField.id,
    options: statusField.options,
  })) {
    warn(w)
  }

  if (resolveOnly) {
    process.stdout.write(
      `${TAG} отрезолвлено (только чтение):\n` +
        `  проект  = ${project.title} (#${project.number}) ${project.id}\n` +
        `  поле    = Status ${statusField.id}\n` +
        `  строка  = #${issueNumber} -> ${item.id}\n` +
        `  опции   = ${(statusField.options ?? []).map((o) => `${o.name}:${o.id}`).join(', ')}\n` +
        `  Мутации не было (--resolve).\n`,
    )
    process.exit(0)
  }

  const option = resolveStatusOption(statusField.options, status)
  if (!option) die(`у поля Status нет опции «${status}»`)

  // 3. Мутация — резолвнутыми живьём id.
  const mutated = ghGraphqlResult(
    buildStatusMutation(project.id, item.id, statusField.id, option.id),
  )
  if (!mutated.ok) die(mutated.error)

  process.stdout.write(
    `${TAG} ГОТОВО — задача #${issueNumber}: Status = «${status}» (строка ${item.id}).\n`,
  )
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
