#!/usr/bin/env node
// bbm-portal — `pnpm taxonomy:bootstrap`: идемпотентная заводка таксономии (#130).
//
// Что заводит:
//   • четыре лейбла `channel:*` — единственная кастомная таксономия репо: канал
//     попадания задачи в бэклог, штатного поля под это у GitHub нет. Класс
//     задачи живёт в штатном Type, а происхождение — свободным текстом в строке
//     `**Source:**` тела (оба — решения владельца 2026-08-04);
//   • ПОСТОЯННЫЕ milestone (`PERMANENT_MILESTONES` в `./lib/gh.mjs`) — темы,
//     которые не закрываются никогда: fallback «Platform: operations and
//     hardening» для процессных/эксплуатационных задач, не попадающих ни в одну
//     тему (канон §2), и «Dependencies» для PR автоматического обновления
//     зависимостей. Постоянство здесь — не украшение: на такой milestone
//     ссылаются извне именем (`issue:create`) и НОМЕРОМ (`renovate.json`), а
//     номер закрывшейся темы протухает молча.
//   • проверяет наличие org Issue Types Bug/Feature/Task (создать их из репо
//     нельзя — это org-настройка; отсутствие докладывается, а не чинится).
//
// Чего НЕ делает намеренно: ничего не удаляет. Судьба дефолтных лейблов GitHub
// (`bug`, `enhancement`, `documentation`, `duplicate`, …) — миграция задачи 7.2,
// и она идёт вместе с переоформлением задач, которые их носят. Скрипт, который
// сносит лейбл раньше миграции, обесцвечивает открытый бэклог.
//
// По умолчанию — СУХОЙ ПРОГОН: печатает план и выходит. Запись только по явному
// `--apply`. Так лид может прочитать план до того, как что-то поедет в облако.
//
// Exit codes: 0 = состояние соответствует плану (или план напечатан);
// 1 = ошибка gh при применении.

import { pathToFileURL } from 'node:url'

import {
  CHANNEL_LABELS,
  ISSUE_TYPES,
  PERMANENT_MILESTONES,
  OWNER,
  REPO,
  ghJson,
  ghResult,
} from './lib/gh.mjs'

const TAG = '[taxonomy:bootstrap]'

/**
 * Цвет и описание каждого channel-лейбла — таксономия читается глазами тоже.
 * Канал отвечает на «кто завёл задачу в трекер», а НЕ на «на основании чего она
 * существует»: второе — свободный текст в строке `**Source:**` тела.
 */
export const CHANNEL_LABEL_SPECS = [
  {
    name: 'channel:owner',
    color: '0e8a16',
    description: 'Канал: задачу завёл или запросил владелец',
  },
  {
    name: 'channel:spec',
    color: '1d76db',
    description: 'Канал: открыта механически из спеки или ADR (issue-граф)',
  },
  {
    name: 'channel:retro',
    color: 'fbca04',
    description: 'Канал: пришла из ретро, /wrap или разбора инцидента',
  },
  {
    name: 'channel:agent',
    color: 'd4c5f9',
    description: 'Канал: инициатива агента',
  },
]

// ── чистые сеймы (юнит-тестируются в tests/unit/gh-board-tools.spec.ts) ──

/**
 * План по лейблам: что создать, что обновить (описание/цвет разошлись), что
 * оставить как есть. Ничего не удаляет — удаления в этом инструменте нет.
 * @param {{name:string,color?:string,description?:string}[]} existing
 * @returns {{create:object[], update:object[], keep:object[]}}
 */
export function planLabels(existing, specs = CHANNEL_LABEL_SPECS) {
  const byName = new Map((existing ?? []).map((l) => [l.name, l]))
  const create = []
  const update = []
  const keep = []
  for (const spec of specs) {
    const found = byName.get(spec.name)
    if (!found) {
      create.push(spec)
    } else if (
      (found.color ?? '').toLowerCase() !== spec.color.toLowerCase() ||
      (found.description ?? '') !== spec.description
    ) {
      update.push(spec)
    } else {
      keep.push(spec)
    }
  }
  return { create, update, keep }
}

/**
 * Спека постоянного milestone — то, чем он заводится, а не то, чем его вернул
 * GitHub. Именованной её делает `planMilestones`: без typedef `@returns` пришлось
 * бы расширить до `object[]`, и вызывающий код (в том числе юнит-тест) потерял бы
 * `.title` под `noImplicitAny`.
 * @typedef {{title: string, description: string}} MilestoneSpec
 */

/**
 * План по ПОСТОЯННЫМ milestone: каких из набора не хватает. Существующий (в
 * любом состоянии, включая `closed`) не трогается — закрытие темы это решение
 * владельца, а не дрейф, который инструмент откатывает.
 * @param {{title:string,state?:string}[]} existing
 * @param {MilestoneSpec[]} [specs]
 * @returns {{create: MilestoneSpec[], keep: MilestoneSpec[]}}
 */
export function planMilestones(existing, specs = PERMANENT_MILESTONES) {
  const byTitle = new Map((existing ?? []).map((m) => [m?.title, m]))
  const create = []
  const keep = []
  for (const spec of specs) {
    if (byTitle.has(spec.title)) keep.push(spec)
    else create.push(spec)
  }
  return { create, keep }
}

/** Каких org Issue Types не хватает. Завести их из репо нельзя — только доложить. */
export function missingIssueTypes(existing, required = ISSUE_TYPES) {
  const names = new Set((existing ?? []).map((t) => t?.name))
  return required.filter((t) => !names.has(t))
}

/** План человекочитаемой строкой на каждое действие. */
export function formatPlan({ labels, milestones, missingTypes }) {
  const lines = []
  for (const l of labels.create) lines.push(`СОЗДАТЬ лейбл ${l.name} (#${l.color}) — ${l.description}`)
  for (const l of labels.update) lines.push(`ОБНОВИТЬ лейбл ${l.name} (#${l.color}) — ${l.description}`)
  for (const l of labels.keep) lines.push(`уже есть: ${l.name}`)
  for (const m of milestones.create) lines.push(`СОЗДАТЬ milestone «${m.title}» — ${m.description}`)
  for (const m of milestones.keep) lines.push(`уже есть: milestone «${m.title}»`)
  for (const t of missingTypes) {
    lines.push(`⚠ org Issue Type «${t}» отсутствует — заводится в настройках организации ${OWNER}, не отсюда`)
  }
  if (lines.every((l) => l.startsWith('уже есть'))) lines.push('изменений не требуется')
  return lines
}

// ── импуративная часть ───────────────────────────────────────────────────────

function out(msg) {
  process.stdout.write(`${TAG} ${msg}\n`)
}

function die(msg) {
  process.stderr.write(`${TAG} ${msg}\n`)
  process.exit(1)
}

export const USAGE = `Использование: pnpm taxonomy:bootstrap [--apply]

  Идемпотентно доводит таксономию репо ${REPO} до канона §2:
    • четыре лейбла channel:* (${CHANNEL_LABELS.join(', ')});
    • постоянные milestone (${PERMANENT_MILESTONES.map((m) => `«${m.title}»`).join(', ')})
      — темы, которые не закрываются никогда, поэтому на них можно ссылаться
      извне именем и номером;
    • проверяет наличие org Issue Types ${ISSUE_TYPES.join('/')} — завести их из
      репо нельзя, это настройка организации, поэтому отсутствие докладывается.

  Без флагов — СУХОЙ ПРОГОН: печатает план и выходит. Запись только по --apply.

  Ничего не удаляет и удалять не умеет: судьба дефолтных лейблов GitHub идёт
  вместе с переоформлением задач (задача 7.2), а лейбл, снесённый раньше
  миграции, обесцвечивает открытый бэклог.

  Exit codes: 0 — план напечатан или применён; 1 — ошибка gh / использования.
`

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  const apply = argv.includes('--apply')
  for (const a of argv) {
    if (a !== '--apply') {
      process.stderr.write(`${TAG} неизвестный флаг «${a}»\n${USAGE}`)
      process.exit(1)
    }
  }

  const labelsRes = ghJson(['label', 'list', '--repo', REPO, '--limit', '200', '--json', 'name,color,description'])
  if (!labelsRes.ok) die(labelsRes.error)
  const milestonesRes = ghJson(['api', `repos/${REPO}/milestones?state=all&per_page=100`])
  if (!milestonesRes.ok) die(milestonesRes.error)
  const typesRes = ghJson([
    'api',
    'graphql',
    '-f',
    `query={organization(login:"${OWNER}"){issueTypes(first:20){nodes{id name}}}}`,
  ])
  const orgTypes = typesRes.ok ? (typesRes.data?.data?.organization?.issueTypes?.nodes ?? []) : []

  const labels = planLabels(labelsRes.data)
  const milestones = planMilestones(milestonesRes.data)
  const missingTypes = missingIssueTypes(orgTypes)

  out(apply ? 'план (применяется):' : 'СУХОЙ ПРОГОН — план (примени с `--apply`):')
  for (const line of formatPlan({ labels, milestones, missingTypes })) out(`  ${line}`)

  if (!apply) {
    out('ничего не изменено.')
    process.exit(0)
  }

  for (const spec of labels.create) {
    const res = ghResult([
      'label',
      'create',
      spec.name,
      '--repo',
      REPO,
      '--color',
      spec.color,
      '--description',
      spec.description,
    ])
    if (!res.ok) die(res.error)
    out(`создан лейбл ${spec.name}`)
  }
  for (const spec of labels.update) {
    const res = ghResult([
      'label',
      'edit',
      spec.name,
      '--repo',
      REPO,
      '--color',
      spec.color,
      '--description',
      spec.description,
    ])
    if (!res.ok) die(res.error)
    out(`обновлён лейбл ${spec.name}`)
  }
  for (const spec of milestones.create) {
    const res = ghResult([
      'api',
      '--method',
      'POST',
      `repos/${REPO}/milestones`,
      '-f',
      `title=${spec.title}`,
      '-f',
      `description=${spec.description}`,
    ])
    if (!res.ok) die(res.error)
    out(`создан milestone «${spec.title}»`)
  }

  out('ГОТОВО — таксономия приведена к плану (ничего не удалено).')
  process.exit(0)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
