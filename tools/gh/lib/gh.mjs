#!/usr/bin/env node
// bbm-portal — общая плюмбинг-библиотека задачника (#130, этап 2).
//
// Здесь живут ТОЛЬКО две вещи:
//   1. константы борда/репо/таксономии — один источник правды, чтобы id борда
//      не расползались копипастой по четырём скриптам;
//   2. тонкие обёртки над `gh` (argv-массив, никогда не shell-строка — нет
//      class'а command injection) + чистые построители GraphQL-запросов.
//
// Канон: `.claude/rules/task-canon.md` §7. Образец: ds-platform
// `tools/gh/lib/projects-v2.mjs` (инвентаризация #127).

import { spawnSync } from 'node:child_process'

// Крупные payload'ы (скан борда, GraphQL) переполняют дефолтный 1 MiB буфер
// spawnSync → ENOBUFS, и это падает молча.
const GH_MAX_BUFFER = 64 * 1024 * 1024

// ── константы репо и борда ───────────────────────────────────────────────────

export const OWNER = 'bbm-academy-org'
export const REPO_NAME = 'bbm-portal'
export const REPO = `${OWNER}/${REPO_NAME}`

/** Org-level Projects v2 «BBM Platform». */
export const PROJECT_NUMBER = '2'
export const PROJECT_TITLE = 'BBM Platform'

/**
 * Задокументированные id борда. Скрипты резолвят их живьём из targeted-запроса
 * и мутируют ИМЕННО резолвнутыми значениями; эти константы — только
 * кросс-чек-предупреждение (борд могли пересоздать).
 */
export const KNOWN = {
  projectId: 'PVT_kwDOEU1U2M4BfVYJ',
  statusFieldId: 'PVTSSF_lADOEU1U2M4BfVYJzhZo_4U',
  options: {
    Todo: 'f75ad846',
    'In Progress': '47fc9ee4',
    Done: '98236657',
  },
}

/** Колонки борда Project 2. Ревью у нас отдельной колонкой не заведено. */
export const VALID_STATUS = ['Todo', 'In Progress', 'Done']

// ── таксономия (канон §2) ────────────────────────────────────────────────────

/**
 * Единственная КАСТОМНАЯ таксономия репо: происхождение задачи. Штатного поля
 * «кто это просил» у GitHub нет, поэтому здесь лейбл оправдан — в отличие от
 * класса задачи, который живёт в штатном поле Type (решение владельца
 * 2026-08-04: «не надо выдумывать новые поля взамен существующих»).
 */
export const SOURCE_LABELS = ['source:owner', 'source:spec', 'source:retro', 'source:agent']

/** Штатные org Issue Types. Ровно один обязателен на каждой задаче. */
export const ISSUE_TYPES = ['Bug', 'Feature', 'Task']

/** Постоянный fallback-milestone для процессных/эксплуатационных задач. */
export const FALLBACK_MILESTONE = 'Платформа: эксплуатация и упрочнение'

/**
 * Type → префикс ветки и Conventional-Commit-типа (канон §2). `docs/` остаётся
 * ручным префиксом для docs-only изменений: отдельного org-типа Docs нет, а
 * заводить его значило бы плодить сущности ровно там, где владелец просил их не
 * плодить.
 */
export const TYPE_TO_BRANCH = {
  Bug: 'fix',
  Feature: 'feat',
  Task: 'chore',
}

/** Type → префикс ветки; неизвестный/пустой Type → безопасный `chore`. */
export function branchTypeFromIssueType(typeName) {
  return TYPE_TO_BRANCH[typeName] ?? 'chore'
}

// ── обёртки над gh ───────────────────────────────────────────────────────────

/**
 * Запустить `gh <args>`; НИКОГДА не бросает и не выходит — возвращает
 * структурный результат, решение принимает вызывающий.
 * @returns {{ ok: boolean, status: number, stdout: string, stderr: string, error?: string }}
 */
export function ghResult(args, { input } = {}) {
  const res = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: GH_MAX_BUFFER,
    input,
  })
  if (res.error) {
    return {
      ok: false,
      status: -1,
      stdout: '',
      stderr: '',
      error: `не удалось запустить gh: ${res.error.message} (gh CLI установлен и в PATH?)`,
    }
  }
  const stdout = res.stdout ?? ''
  const stderr = res.stderr ?? ''
  if (res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? -1,
      stdout,
      stderr,
      error: `gh ${args.join(' ')} завершился с кодом ${res.status}: ${stderr.trim()}`,
    }
  }
  return { ok: true, status: 0, stdout, stderr }
}

/** `gh <args>` + JSON.parse. Возвращает `{ok, data}` либо `{ok:false, error}`. */
export function ghJson(args) {
  const res = ghResult(args)
  if (!res.ok) return res
  try {
    return { ok: true, data: JSON.parse(res.stdout) }
  } catch {
    return { ok: false, error: `не удалось разобрать JSON вывода: gh ${args.join(' ')}` }
  }
}

/**
 * `gh api graphql -f query=<q>`. GraphQL умеет вернуть 200 с непустым `errors`,
 * поэтому проверяются оба канала.
 * @returns {{ ok: boolean, data?: any, error?: string }}
 */
export function ghGraphqlResult(query) {
  const res = ghResult(['api', 'graphql', '-f', `query=${query}`])
  if (!res.ok) return { ok: false, error: res.error }
  let parsed
  try {
    parsed = JSON.parse(res.stdout)
  } catch {
    return { ok: false, error: 'не удалось разобрать ответ GraphQL как JSON' }
  }
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    return {
      ok: false,
      error: `GraphQL вернул ошибки: ${parsed.errors.map((e) => e?.message ?? '?').join('; ')}`,
    }
  }
  return { ok: true, data: parsed.data }
}

// ── чистые построители запросов (юнит-тестируются без сети) ──────────────────

/** Положительное целое — единственная форма, которую можно вставлять в запрос. */
function assertPositiveInt(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}: ожидалось положительное целое, получено ${value}`)
  }
}

/**
 * Непрозрачные id GitHub — base64-подобные строки. Кавычки/скобки внутри
 * означали бы попытку сломать строку запроса.
 */
function assertOpaqueId(name, value) {
  if (typeof value !== 'string' || value === '' || /["\\{}\s]/.test(value)) {
    throw new Error(`${name}: недопустимый id ${JSON.stringify(value)}`)
  }
}

/**
 * Targeted-запрос по ОДНОЙ issue: её строки на бордах + id проекта + поле
 * Status с опциями. Один дешёвый вызов вместо скана всего борда (квота 5000/ч
 * общая на все параллельные сессии).
 */
export function buildIssueProjectItemsQuery(issueNumber) {
  assertPositiveInt('buildIssueProjectItemsQuery', issueNumber)
  return (
    `query{repository(owner:"${OWNER}",name:"${REPO_NAME}"){` +
    `issue(number:${issueNumber}){projectItems(first:10){nodes{id ` +
    `project{id number title field(name:"Status"){` +
    `... on ProjectV2SingleSelectField{id name options{id name}}}}}}}}}`
  )
}

/** То же для PR — используется `pr:land` при снятии своей строки с борда. */
export function buildPrProjectItemsQuery(prNumber) {
  assertPositiveInt('buildPrProjectItemsQuery', prNumber)
  return (
    `query{repository(owner:"${OWNER}",name:"${REPO_NAME}"){` +
    `pullRequest(number:${prNumber}){projectItems(first:10){nodes{id project{id number title}}}}}}`
  )
}

/**
 * Страница элементов борда: номер issue + текущий Status. Нужна `backlog:triage`
 * — сверка claim-сигнала «статус In Progress» делается по всему борду разом,
 * это дешевле, чем targeted-запрос на каждую открытую задачу.
 * @param {string|null} [cursor]
 */
export function buildBoardItemsPageQuery(cursor = null) {
  if (cursor !== null) assertOpaqueId('buildBoardItemsPageQuery cursor', cursor)
  const after = cursor ? `,after:"${cursor}"` : ''
  return (
    `query{organization(login:"${OWNER}"){projectV2(number:${Number(PROJECT_NUMBER)}){` +
    `items(first:100${after}){pageInfo{hasNextPage endCursor}nodes{id ` +
    `fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} ` +
    `content{... on Issue{number state}... on PullRequest{number state}}}}}}}`
  )
}

/** Чтение строки борда по её node id — подтверждение без read-lag `item-list`. */
export function buildNodeQuery(itemId) {
  assertOpaqueId('buildNodeQuery itemId', itemId)
  return (
    `{node(id:"${itemId}"){... on ProjectV2Item{` +
    `content{... on Issue{number state url}} ` +
    `fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}`
  )
}

/** Мутация установки single-select Status. */
export function buildStatusMutation(projectId, itemId, fieldId, optionId) {
  assertOpaqueId('projectId', projectId)
  assertOpaqueId('itemId', itemId)
  assertOpaqueId('fieldId', fieldId)
  assertOpaqueId('optionId', optionId)
  return (
    `mutation{updateProjectV2ItemFieldValue(input:{projectId:"${projectId}",` +
    `itemId:"${itemId}",fieldId:"${fieldId}",` +
    `value:{singleSelectOptionId:"${optionId}"}}){projectV2Item{id}}}`
  )
}

/** Мутация удаления строки с борда (своя PR-строка после мержа). */
export function buildDeleteItemMutation(projectId, itemId) {
  assertOpaqueId('projectId', projectId)
  assertOpaqueId('itemId', itemId)
  return (
    `mutation{deleteProjectV2Item(input:{projectId:"${projectId}",itemId:"${itemId}"})` +
    `{deletedItemId}}`
  )
}

// ── чистые разборщики ответов ────────────────────────────────────────────────

/**
 * Выбрать строку НАШЕГО борда из списка projectItems. Задача может лежать на
 * нескольких досках; без фильтра по номеру проекта скрипт правил бы чужую.
 * Без указания номера берётся первая строка (у PR доска одна).
 * @param {any[]|null|undefined} nodes
 * @param {string|number|null} [projectNumber]
 */
export function pickProjectItem(nodes, projectNumber = null) {
  const list = Array.isArray(nodes) ? nodes : []
  if (projectNumber === null) return list[0] ?? null
  const wanted = Number(projectNumber)
  return list.find((n) => Number(n?.project?.number) === wanted) ?? null
}

/** Найти опцию Status по точному имени. */
export function resolveStatusOption(options, statusName) {
  if (!Array.isArray(options)) return null
  return options.find((o) => o?.name === statusName) ?? null
}

/**
 * Сверить резолвнутые живьём id с задокументированными. Возвращает строки
 * WARN; расхождение НИКОГДА не блокирует — побеждает резолвнутое значение.
 */
export function knownIdWarnings(resolved, known = KNOWN) {
  const warnings = []
  if (resolved.projectId && resolved.projectId !== known.projectId) {
    warnings.push(
      `id проекта ${resolved.projectId} не совпадает с задокументированным ${known.projectId} — используется резолвнутый`,
    )
  }
  if (resolved.statusFieldId && resolved.statusFieldId !== known.statusFieldId) {
    warnings.push(
      `id поля Status ${resolved.statusFieldId} не совпадает с задокументированным ${known.statusFieldId} — используется резолвнутый`,
    )
  }
  for (const option of resolved.options ?? []) {
    const documented = known.options[option?.name]
    if (documented && option.id !== documented) {
      warnings.push(
        `id опции «${option.name}» ${option.id} не совпадает с задокументированным ${documented} — используется резолвнутый`,
      )
    }
  }
  return warnings
}

/** Проверить node-readback против только что созданной issue. */
export function parseNodeReadback(apiData, expectedNumber, { expectTodo = false } = {}) {
  const node = apiData?.node
  if (!node) return { ok: false, reason: 'строки нет на борде (GraphQL вернул null)' }
  const number = node.content?.number
  if (number == null) return { ok: false, reason: 'у строки борда нет содержимого-issue' }
  if (number !== expectedNumber) {
    return {
      ok: false,
      reason: `строка борда указывает на issue #${number}, ожидалась #${expectedNumber}`,
    }
  }
  const status = node.fieldValueByName?.name ?? null
  if (expectTodo && status !== 'Todo') {
    return {
      ok: false,
      reason: `Status на борде читается как «${status ?? '(не задан)'}», ожидался «Todo»`,
      status,
      number,
    }
  }
  return { ok: true, status, number }
}
