#!/usr/bin/env node
// bbm-portal — `pnpm backlog:triage`: отчёт готовности бэклога (#130).
//
// Готовность считается из НАТИВНОГО графа GitHub (`dependencies/blocked_by`), а
// не из лейбла: статусный лейбл был бы вторым источником правды, который
// рассинхронизируется первым (канон §2). Проза «зависит от #N» в теле читается
// тоже, но как сигнал «ребро не проведено», а не как ребро.
//
// Что печатает (канон §7):
//   • берущиеся / заблокированные (+ причина по каждому ребру);
//   • расхождения claim'а: ворктри и `In Progress` — два обязательных сигнала
//     (§4), разрешение расхождения асимметрично и здесь только докладывается,
//     чужой claim скриптом не снимается;
//   • гигиена полей: Type / source:* / milestone / assignee;
//   • рёбра без записанного rationale (provenance-orphan, повод оспорить ребро);
//   • мега-блокеры — узел, блокирующий ≥5 задач.
//
// Только чтение: ни одной мутации, ни одного комментария. Exit 0 всегда, кроме
// невозможности получить список задач (exit 1) — отчёт не должен рушить сессию.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ISSUE_TYPES,
  PROJECT_NUMBER,
  REPO,
  SOURCE_LABELS,
  buildBoardItemsPageQuery,
  ghGraphqlResult,
  ghJson,
  ghResult,
} from './lib/gh.mjs'

const TAG = '[backlog:triage]'

/**
 * Дефолтные лейблы GitHub, которым в этом репо места нет (канон §2, судьба
 * решается миграцией 7.2). Здесь они только докладываются.
 */
export const LEGACY_LABELS = [
  'bug',
  'enhancement',
  'documentation',
  'duplicate',
  'invalid',
  'wontfix',
  'question',
  'good first issue',
  'help wanted',
]

/** Отношения, которые НИКОГДА не блокеры (канон §3): иерархия ≠ зависимость. */
const NON_BLOCKER_PHRASES = [
  'sub-issue of',
  'подзадача',
  'часть',
  'родитель',
  'parent',
  'эпик',
  'epic',
  'связано',
  'related',
  'преемник',
  'successor',
  'сначала обсудить',
]

// ── чистые сеймы (юнит-тестируются в tests/unit/gh-backlog-triage.spec.ts) ──

/**
 * Гигиена полей одной задачи. Классификатор — ШТАТНОЕ поле Type; кастомная
 * таксономия ровно одна (`source:*`), потому что штатного поля происхождения у
 * GitHub нет (решение владельца 2026-08-04).
 * @returns {string[]} список нарушений, пустой = чисто
 */
export function missingFields(issue) {
  const missing = []
  const labels = (issue?.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)

  const type = issue?.issueType?.name ?? issue?.issueType ?? null
  if (!type) missing.push('нет Type')
  else if (!ISSUE_TYPES.includes(type)) missing.push(`неизвестный Type «${type}»`)

  const sources = labels.filter((l) => l.startsWith('source:'))
  if (sources.length === 0) missing.push('нет source:*')
  else if (sources.length > 1) missing.push(`несколько source:* (${sources.join(', ')})`)
  else if (!SOURCE_LABELS.includes(sources[0])) missing.push(`неизвестный source «${sources[0]}»`)

  const kinds = labels.filter((l) => l.startsWith('kind:'))
  if (kinds.length > 0) missing.push(`упразднённые kind:*-лейблы (${kinds.join(', ')})`)

  const legacy = labels.filter((l) => LEGACY_LABELS.includes(l))
  if (legacy.length > 0) missing.push(`дефолтные лейблы GitHub (${legacy.join(', ')}) — миграция 7.2`)

  if (!issue?.milestone?.title && !issue?.milestone) missing.push('нет milestone')
  if ((issue?.assignees ?? []).length === 0) missing.push('нет assignee')

  return missing
}

/** Упоминает ли текст задачу #N (в т.ч. ссылкой). */
export function mentionsIssue(text, n) {
  if (!text || !Number.isInteger(n)) return false
  return new RegExp(`(?:#|/issues/|/pull/)${n}(?!\\d)`).test(String(text))
}

/**
 * Разобрать секцию `## Dependencies` тела: строки `**Blocked by:** #N — почему`.
 * Заголовок принимается на уровнях `##`–`####`: `pnpm issue:create` пишет `##`,
 * issue-формы GitHub рендерят поля как `###`.
 * @returns {{blockedBy: {number:number, rationale:string|null}[], blocks:number[]}}
 */
export function parseDependenciesSection(body) {
  const text = String(body ?? '')
  const blockedBy = []
  const blocks = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const blockedMatch = line.match(/^\s*(?:[-*]\s*)?\*\*Blocked by:?\*\*:?\s*(.*)$/i)
    if (blockedMatch) {
      for (const ref of parseRefsWithRationale(blockedMatch[1])) blockedBy.push(ref)
      continue
    }
    const blocksMatch = line.match(/^\s*(?:[-*]\s*)?\*\*Blocks:?\*\*:?\s*(.*)$/i)
    if (blocksMatch) {
      for (const ref of parseRefsWithRationale(blocksMatch[1])) blocks.push(ref.number)
    }
  }
  return { blockedBy, blocks }
}

/** `#12 — почему, #34` → [{number:12, rationale:'почему'},{number:34, rationale:null}] */
export function parseRefsWithRationale(clause) {
  const text = String(clause ?? '').trim()
  if (isPlaceholder(text)) return []
  const out = []
  const re = /#(\d+)\s*(?:[—–-]\s*([^#\n]*))?/g
  let m
  while ((m = re.exec(text)) !== null) {
    const rationale = (m[2] ?? '').trim().replace(/[,;]\s*$/, '')
    out.push({ number: Number(m[1]), rationale: rationale === '' ? null : rationale })
  }
  return out
}

/** «нет», «—», «none», пустая строка, незаполненный плейсхолдер шаблона. */
export function isPlaceholder(text) {
  const t = String(text ?? '')
    .trim()
    .toLowerCase()
  if (t === '') return true
  if (/^<!--[\s\S]*-->$/.test(t)) return true
  return ['нет', 'none', 'нету', 'n/a', 'na', '—', '–', '-', 'tbd', '_no response_'].includes(t)
}

/**
 * Прозовые упоминания зависимости ВНЕ секции Dependencies — сигнал «ребро не
 * проведено», не ребро. Иерархические формулировки отбрасываются: родитель,
 * эпик, «связано», «преемник» блокерами не бывают (канон §3).
 */
export function parseProseBlockers(body) {
  const out = []
  for (const line of String(body ?? '').split(/\r?\n/)) {
    if (/^\s*(?:[-*]\s*)?\*\*Blocked by/i.test(line)) continue // это секция Dependencies
    if (!/(?:blocked by|зависит от|блокируется|ждёт|ждет)/i.test(line)) continue
    const lower = line.toLowerCase()
    if (NON_BLOCKER_PHRASES.some((p) => lower.includes(p))) continue
    for (const ref of parseRefsWithRationale(line)) out.push(ref.number)
  }
  return [...new Set(out)]
}

/**
 * Есть ли у ребра записанный rationale. Канон §3: rationale — строка в
 * `Dependencies` заблокированной задачи; допустим текст на любой из двух сторон.
 * @returns {'present'|'absent'|'unknown'}
 */
export function evaluateRationale(blockedNumber, blockerNumber, blockedText, blockerText) {
  if (blockedText == null && blockerText == null) return 'unknown'
  const deps = parseDependenciesSection(blockedText ?? '')
  const edge = deps.blockedBy.find((e) => e.number === blockerNumber)
  if (edge?.rationale) return 'present'
  if (blockedText && mentionsIssue(blockedText, blockerNumber)) {
    // упоминание есть, но не строкой ребра — засчитываем только если строка
    // несёт объяснение длиннее самой ссылки
    const line = String(blockedText)
      .split(/\r?\n/)
      .find((l) => mentionsIssue(l, blockerNumber) && l.replace(/[^\p{L}]/gu, '').length > 12)
    if (line) return 'present'
  }
  if (blockerText && mentionsIssue(blockerText, blockedNumber)) return 'present'
  return 'absent'
}

/**
 * Классифицировать задачу: берётся или заблокирована. Блокируют ТОЛЬКО открытые
 * задачи — закрытый блокер это уже не блокер.
 * @param {{number:number,title:string,labels:string[]}} issue
 * @param {{number:number, source:'native'|'prose', open:boolean, rationale:'present'|'absent'|'unknown'}[]} edges
 */
export function classify(issue, edges) {
  const seen = new Map()
  for (const e of edges ?? []) {
    const prev = seen.get(e.number)
    // нативное ребро побеждает прозовое: оно и есть граф
    if (!prev || (prev.source === 'prose' && e.source === 'native')) seen.set(e.number, e)
  }
  const unique = [...seen.values()]
  const blockers = unique.filter((e) => e.open)
  return {
    number: issue.number,
    title: issue.title,
    blocked: blockers.length > 0,
    edges: unique,
    blockers,
  }
}

/** Узлы, блокирующие ≥ threshold открытых задач. */
export function findMegaBlockers(triaged, threshold = 5) {
  const fanout = new Map()
  for (const t of triaged ?? []) {
    for (const e of t.blockers ?? []) {
      if (!fanout.has(e.number)) fanout.set(e.number, [])
      fanout.get(e.number).push(t.number)
    }
  }
  return [...fanout.entries()]
    .filter(([, blocked]) => blocked.length >= threshold)
    .map(([number, blocked]) => ({ number, blocked, count: blocked.length }))
    .sort((a, b) => b.count - a.count)
}

/** Возраст в человеческом виде. */
export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '<1м'
  if (minutes < 60) return `${minutes}м`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}ч`
  return `${Math.floor(hours / 24)}д`
}

/**
 * Сверка двух claim-сигналов (канон §4). Разрешение асимметрично: ворктри —
 * факт файловой системы, борд — право взять. Скрипт НИЧЕГО не снимает, он
 * только называет расхождение.
 * @returns {{kind:'in-flight'|'board-lags'|'branch-only'|'stale-claim'|'free', message:string}}
 */
export function detectClaimState({ number, hasWorktree, hasBranch, boardStatus, ageMs }) {
  const inProgress = boardStatus === 'In Progress'
  if (hasWorktree && inProgress) {
    return { kind: 'in-flight', message: 'ворктри + In Progress — claim полон' }
  }
  if (hasWorktree && !inProgress) {
    return {
      kind: 'board-lags',
      message:
        `ворктри есть, статус «${boardStatus ?? 'не задан'}» — работа идёт, отстал борд; ` +
        `чинится борд: pnpm board:status ${number} "In Progress"`,
    }
  }
  if (inProgress && !hasWorktree && hasBranch) {
    return {
      kind: 'branch-only',
      message:
        'статус In Progress, ворктри нет, но ветка на origin есть — работа существует вне этой машины; не трогать',
    }
  }
  if (inProgress && !hasWorktree && !hasBranch) {
    return {
      kind: 'stale-claim',
      message:
        `статус In Progress, ворктри и ветки нет (простой ${formatAge(ageMs)}) — claim протух; ` +
        `решение освободить принимает лид/владелец, не скрипт`,
    }
  }
  return { kind: 'free', message: '' }
}

/** Собрать markdown-отчёт. Чистая функция: ни одного вызова наружу. */
export function formatReport(model) {
  const {
    generatedAt,
    takeable = [],
    inFlight = [],
    blocked = [],
    claimIssues = [],
    epics = [],
    hygiene = [],
    orphanEdges = [],
    megaBlockers = [],
    warnings = [],
  } = model

  const lines = []
  lines.push(`# backlog triage — ${REPO} — ${generatedAt}`)
  lines.push('')
  lines.push(
    `Открытых: ${takeable.length + inFlight.length + blocked.length + epics.length} ` +
      `(берущихся ${takeable.length}, в работе ${inFlight.length}, заблокированных ${blocked.length}, эпиков ${epics.length}).`,
  )
  lines.push('')

  lines.push(`## Берущиеся (${takeable.length})`)
  if (takeable.length === 0) lines.push('_нет — пустой список берущихся ≠ пустой бэклог, смотри блокированные ниже_')
  for (const t of takeable) lines.push(`- #${t.number} ${t.title}`)
  lines.push('')

  lines.push(`## В работе (${inFlight.length})`)
  if (inFlight.length === 0) lines.push('_нет_')
  for (const t of inFlight) lines.push(`- #${t.number} ${t.title} — ${t.claim}`)
  lines.push('')

  lines.push(`## Расхождения claim (${claimIssues.length})`)
  if (claimIssues.length === 0) lines.push('_нет — оба сигнала сходятся_')
  for (const c of claimIssues) lines.push(`- #${c.number} — ${c.message}`)
  lines.push('')

  lines.push(`## Заблокированные (${blocked.length})`)
  if (blocked.length === 0) lines.push('_нет_')
  for (const t of blocked) {
    lines.push(`- #${t.number} ${t.title}`)
    for (const e of t.blockers) {
      const rat =
        e.rationale === 'present'
          ? 'rationale записан'
          : e.rationale === 'absent'
            ? '⚠ rationale не записан'
            : 'rationale не проверен'
      lines.push(`  ↳ #${e.number} (${e.source === 'native' ? 'нативное ребро' : 'ТОЛЬКО проза — ребро не проведено'}) — ${rat}`)
    }
  }
  lines.push('')

  lines.push(`## Рёбра без rationale (${orphanEdges.length})`)
  if (orphanEdges.length === 0) lines.push('_нет_')
  for (const e of orphanEdges) {
    lines.push(`- #${e.blocked} ← #${e.blocker} — provenance-orphan: повод оспорить ребро, а не считать фактом`)
  }
  lines.push('')

  lines.push(`## Мега-блокеры (${megaBlockers.length})`)
  if (megaBlockers.length === 0) lines.push('_нет узлов, блокирующих ≥5 задач_')
  for (const m of megaBlockers) {
    lines.push(`- #${m.number} блокирует ${m.count}: #${m.blocked.join(', #')}`)
  }
  lines.push('')

  lines.push(`## Эпики (${epics.length})`)
  if (epics.length === 0) lines.push('_нет_')
  for (const e of epics) lines.push(`- #${e.number} ${e.title} — зонтик, сам по себе не берётся`)
  lines.push('')

  lines.push(`## Гигиена полей (${hygiene.length})`)
  if (hygiene.length === 0) lines.push('_чисто_')
  for (const h of hygiene) lines.push(`- #${h.number} — ${h.missing.join('; ')}`)
  lines.push('')

  if (warnings.length > 0) {
    lines.push(`## Предупреждения (${warnings.length})`)
    for (const w of warnings) lines.push(`- ${w}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ── импуративная часть ───────────────────────────────────────────────────────

function labelNames(issue) {
  return (issue?.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
}

/**
 * Корень ОСНОВНОГО чекаута: ворктри лежат под ним, а не под тем деревом, из
 * которого запустили triage. `--git-common-dir` даёт `<корень>/.git` даже
 * изнутри ворктри (тот же приём, что в `tools/dev/task-worktree.mjs`).
 */
function mainRepoRoot() {
  const res = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' })
  if (res.status !== 0 || !res.stdout) return process.cwd()
  return dirname(resolve(res.stdout.trim()))
}

function listWorktreeNumbers(root) {
  const dir = join(root, '.claude', 'worktrees')
  if (!existsSync(dir)) return new Map()
  const out = new Map()
  for (const entry of readdirSync(dir)) {
    if (!/^\d+$/.test(entry)) continue
    let mtime = null
    try {
      mtime = statSync(join(dir, entry)).mtimeMs
    } catch {
      /* каталог мог исчезнуть между чтениями */
    }
    out.set(Number(entry), mtime)
  }
  return out
}

function listRemoteBranchNumbers() {
  const res = ghResult(['api', `repos/${REPO}/branches?per_page=100`, '--jq', '.[].name'])
  if (!res.ok) return new Set()
  const out = new Set()
  for (const name of res.stdout.split(/\r?\n/)) {
    const m = /^[a-z]+\/(\d+)-/.exec(name.trim())
    if (m) out.add(Number(m[1]))
  }
  return out
}

/** Статусы борда: одна пагинированная выборка вместо запроса на каждую задачу. */
function fetchBoardStatuses(warnings) {
  const statuses = new Map()
  let cursor = null
  for (let page = 0; page < 10; page++) {
    const res = ghGraphqlResult(buildBoardItemsPageQuery(cursor))
    if (!res.ok) {
      warnings.push(`не удалось прочитать борд Project ${PROJECT_NUMBER}: ${res.error}`)
      return statuses
    }
    const items = res.data?.organization?.projectV2?.items
    for (const node of items?.nodes ?? []) {
      const number = node?.content?.number
      if (number != null) statuses.set(number, node?.fieldValueByName?.name ?? null)
    }
    if (!items?.pageInfo?.hasNextPage) break
    cursor = items.pageInfo.endCursor
  }
  return statuses
}

function fetchNativeBlockers(number, warnings) {
  const res = ghJson(['api', `repos/${REPO}/issues/${number}/dependencies/blocked_by`])
  if (!res.ok) {
    warnings.push(`#${number}: не удалось прочитать нативные blocked_by — ${res.error}`)
    return []
  }
  return (Array.isArray(res.data) ? res.data : []).map((i) => ({
    number: i?.number,
    open: String(i?.state ?? 'open') === 'open',
  }))
}

function main() {
  const warnings = []
  const issuesRes = ghJson([
    'issue',
    'list',
    '--repo',
    REPO,
    '--state',
    'open',
    '--limit',
    '300',
    '--json',
    'number,title,body,labels,milestone,assignees,issueType,updatedAt',
  ])
  if (!issuesRes.ok) {
    process.stderr.write(`${TAG} ${issuesRes.error}\n`)
    process.exit(1)
  }
  const issues = issuesRes.data ?? []
  const byNumber = new Map(issues.map((i) => [i.number, i]))

  const boardStatuses = fetchBoardStatuses(warnings)
  const root = resolve(mainRepoRoot())
  const worktrees = listWorktreeNumbers(root)
  const branchNumbers = listRemoteBranchNumbers()
  const now = Date.now()

  const triaged = []
  const hygiene = []
  const orphanEdges = []
  const claimIssues = []
  const epics = []
  const inFlight = []

  for (const issue of issues) {
    const labels = labelNames(issue)
    const missing = missingFields(issue)
    if (missing.length > 0) hygiene.push({ number: issue.number, missing })

    // Рёбра: нативные (граф) + прозовые (сигнал «ребро не проведено»).
    const native = fetchNativeBlockers(issue.number, warnings)
    const prose = parseProseBlockers(issue.body).concat(
      parseDependenciesSection(issue.body).blockedBy.map((e) => e.number),
    )
    const edges = []
    for (const n of native) {
      const rationale = evaluateRationale(
        issue.number,
        n.number,
        issue.body,
        byNumber.get(n.number)?.body ?? null,
      )
      edges.push({ number: n.number, source: 'native', open: n.open, rationale })
      if (rationale === 'absent') orphanEdges.push({ blocked: issue.number, blocker: n.number })
    }
    for (const n of new Set(prose)) {
      if (native.some((e) => e.number === n)) continue
      const target = byNumber.get(n)
      edges.push({
        number: n,
        source: 'prose',
        open: target ? true : false,
        rationale: evaluateRationale(issue.number, n, issue.body, target?.body ?? null),
      })
    }

    const t = classify({ number: issue.number, title: issue.title, labels }, edges)

    const claim = detectClaimState({
      number: issue.number,
      hasWorktree: worktrees.has(issue.number),
      hasBranch: branchNumbers.has(issue.number),
      boardStatus: boardStatuses.get(issue.number) ?? null,
      ageMs: now - Date.parse(issue.updatedAt ?? '') || 0,
    })
    if (claim.kind === 'in-flight') {
      inFlight.push({ number: issue.number, title: issue.title, claim: claim.message })
      continue
    }
    if (claim.kind !== 'free') claimIssues.push({ number: issue.number, message: claim.message })

    if (labels.includes('epic')) {
      epics.push({ number: issue.number, title: issue.title })
      continue
    }
    triaged.push(t)
  }

  const report = formatReport({
    generatedAt: new Date().toISOString(),
    takeable: triaged.filter((t) => !t.blocked),
    inFlight,
    blocked: triaged.filter((t) => t.blocked),
    claimIssues,
    epics,
    hygiene,
    orphanEdges,
    megaBlockers: findMegaBlockers(triaged),
    warnings,
  })
  process.stdout.write(`${report}\n`)
  process.exit(0)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
