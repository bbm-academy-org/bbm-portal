#!/usr/bin/env node
// bbm-portal — `pnpm pr:land <pr>`: хвост закрытия PR одной командой (#130).
//
// Почему: после мержа остаётся многошаговый хвост (снять свою PR-строку с
// борда, поставить Done каждой `Closes #N`, разобрать ворктри, пересвести
// остатки) — и именно он забывается чаще всего, потому что задача «уже
// сделана». Хвост здесь один детерминированный вызов, без ослабления гейта:
//
//   1. gate        — PR открыт и не draft, нет конфликта, есть `Closes #N`,
//                    все check-run'ы по ТЕКУЩЕМУ head SHA зелёные (ограниченный
//                    поллинг), head не сдвинулся за время ожидания;
//   2. merge       — `gh pr merge <N> --squash --delete-branch`;
//   3. board-clear — снять СВОЮ PR-строку с борда. НЕ фатально: мерж уже
//                    приземлился, провал здесь — строка отчёта, не откат;
//   4. board-done  — `Status=Done` каждой связанной `Closes #N`;
//   5. teardown    — `pnpm worktree:teardown <N>`, если ворктри есть на диске;
//   6. re-sweep    — открытые PR + head-ветки на origin, одной строкой.
//
// Первая упавшая стадия останавливает хвост, печатает имя стадии и одну строку
// «что доделать руками» (канон §7).
//
// Ревью-гейт: `--require-review` делает `reviewDecision=APPROVED` блокирующим.
// По умолчанию это НЕ блокирует и печатается напоминанием, потому что в этом
// репо ревьюер — субагент, оставляющий комментарий, а единственный человек с
// правами и есть автор PR: обязательный APPROVE был бы невыполним, а
// невыполнимый гейт обходят, а не соблюдают. Соблюдение stage 6 task-cycle
// (ревью + приёмка владельца) остаётся на лиде.
//
// Exit codes: 0 = хвост пройден; 1 = стадия упала (RED); 2 = таймаут гейта;
// 3 = ошибка использования/резолвинга; 4 = запуск из ворктри.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildDeleteItemMutation,
  buildPrProjectItemsQuery,
  ghGraphqlResult,
  ghJson,
  pickProjectItem,
} from './lib/gh.mjs'

const TAG = '[pr:land]'

// ── чистые сеймы (юнит-тестируются в tests/unit/gh-pr-land.spec.ts) ─────────

/** Канонический порядок стадий — контракт, который проверяет тест. */
export const STAGES = ['gate', 'merge', 'board-clear', 'board-done', 'teardown', 're-sweep']

/**
 * Кандидаты в номера ворктри: связанные `Closes #N` плюс номер из имени ветки
 * `<type>/<N>-<slug>` (ворктри именуются номером задачи, не PR).
 */
export function issueCandidates(closingIssueNumbers, branch) {
  const out = []
  const push = (n) => {
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  for (const n of Array.isArray(closingIssueNumbers) ? closingIssueNumbers : []) push(n)
  const m = /^[a-z]+\/(\d+)-/.exec(branch ?? '')
  if (m) push(Number(m[1]))
  return out
}

/** Одна строка «что доделать руками» на упавшую стадию. */
export function stageRemedy(stage, pr) {
  switch (stage) {
    case 'gate':
      return `разберись с причиной RED выше; НЕ мержи руками — почини и повтори \`pnpm pr:land ${pr}\`.`
    case 'merge':
      return `посмотри вывод gh выше и повтори \`pnpm pr:land ${pr}\` (гейт переподтвердит перед повтором).`
    case 'board-clear':
      return `мерж прошёл — PR-строку с борда снять не удалось (не фатально); удали её руками, если висит мёртвой.`
    case 'board-done':
      return `мерж прошёл — доделай руками: \`pnpm board:status <issue> Done\`, затем \`pnpm worktree:teardown <N>\`.`
    case 'teardown':
      return `мерж прошёл — доделай руками: \`pnpm worktree:teardown <N>\` (его вывод выше называет держателя).`
    case 're-sweep':
      return `мерж прошёл — пересведи руками: \`gh pr list\` + \`git ls-remote --heads origin\`.`
    default:
      return `повтори \`pnpm pr:land ${pr}\`.`
  }
}

/**
 * Нормализовать код выхода ребёнка: ненулевой числовой проходит как есть,
 * 0/null/undefined схлопываются в 1 — убитый сигналом ребёнок НИКОГДА не должен
 * читаться как успех.
 */
export function failCode(status) {
  return typeof status === 'number' && status !== 0 ? status : 1
}

/** Запуск из ворктри — это лид-сайд-команда основного чекаута. */
export function isWorktreeCwd(cwd) {
  return /[\\/]\.claude[\\/]worktrees[\\/]/.test(String(cwd ?? '') + '/')
}

export function cwdGuardMessage(cwd) {
  return (
    `отказ: команда запущена из ворктри (${cwd}). \`pr:land\` мержит и разбирает ворктри — ` +
    `запускать её из ворктри значит пилить сук, на котором сидишь. Перейди в основной чекаут.`
  )
}

/**
 * Структурная классификация check-run'ов. Разбор ТОЛЬКО по полям status /
 * conclusion / state — совпадение по названию джобы даёт ложный зелёный при
 * первом же переименовании.
 * @returns {{verdict:'green'|'pending'|'red', pending:string[], failed:string[]}}
 */
export function classifyChecks(rollup) {
  const list = Array.isArray(rollup) ? rollup : []
  const pending = []
  const failed = []
  for (const entry of list) {
    const name = entry?.name ?? entry?.context ?? '(без имени)'
    if (entry?.__typename === 'StatusContext' || entry?.state !== undefined) {
      const state = String(entry.state ?? '').toUpperCase()
      if (state === 'PENDING' || state === 'EXPECTED' || state === '') pending.push(name)
      else if (state !== 'SUCCESS') failed.push(`${name} (${state})`)
      continue
    }
    const status = String(entry?.status ?? '').toUpperCase()
    if (status !== 'COMPLETED') {
      pending.push(name)
      continue
    }
    const conclusion = String(entry?.conclusion ?? '').toUpperCase()
    // SKIPPED/NEUTRAL — законный «нечего делать» (path-фильтры); CANCELLED и
    // всё остальное — красное: отменённый прогон ничего не доказал.
    if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion)) {
      failed.push(`${name} (${conclusion || 'без вывода'})`)
    }
  }
  if (failed.length > 0) return { verdict: 'red', pending, failed }
  // Ноль зарегистрированных прогонов — это не «зелено», а «ещё не приехали»:
  // ждём в пределах таймаута, по его истечении стадия станет RED.
  if (pending.length > 0 || list.length === 0) return { verdict: 'pending', pending, failed }
  return { verdict: 'green', pending, failed }
}

/**
 * Не-CI-условия гейта. Возвращает список причин RED (пустой = ок) и отдельно
 * нефатальные замечания.
 */
export function gateConditions(pr, { requireReview = false } = {}) {
  const red = []
  const warn = []
  const state = String(pr?.state ?? '').toUpperCase()
  if (state !== 'OPEN') red.push(`PR не открыт (state=${state || 'неизвестно'})`)
  if (pr?.isDraft) red.push('PR в состоянии draft')
  if (String(pr?.mergeable ?? '').toUpperCase() === 'CONFLICTING') {
    red.push('PR конфликтует с базой — обнови ветку')
  }
  const closes = (pr?.closingIssuesReferences ?? []).map((r) => r?.number).filter(Boolean)
  if (closes.length === 0) {
    red.push('в теле PR нет `Closes #N` — без него board-done некуда ставить Done')
  }
  const decision = String(pr?.reviewDecision ?? '').toUpperCase()
  if (requireReview) {
    if (decision !== 'APPROVED') red.push(`ревью не APPROVED (reviewDecision=${decision || 'нет'})`)
  } else if (decision !== 'APPROVED') {
    warn.push(
      'APPROVE-ревью на PR нет — task-cycle stage 6 требует ревью и записанной приёмки владельца; ' +
        'гейт это не блокирует (см. шапку файла), ответственность на лиде',
    )
  }
  if (String(pr?.mergeStateStatus ?? '').toUpperCase() === 'BEHIND') {
    warn.push('ветка отстала от базы (mergeStateStatus=BEHIND) — при strict-проверках мерж откажет')
  }
  return { red, warn, closes }
}

/** Разбор флагов `pr:land`. */
export function parseFlags(argv) {
  const list = argv ?? []
  const rawPr = list[0]
  const pr = Number(rawPr)
  if (!rawPr || !Number.isInteger(pr) || pr <= 0) {
    return { ok: false, error: `недопустимый номер PR: «${rawPr ?? ''}»` }
  }
  const opts = { pr, timeout: 900, interval: 20, requireReview: false }
  for (let i = 1; i < list.length; i++) {
    const a = list[i]
    if (a === '--require-review') opts.requireReview = true
    else if (a === '--timeout') opts.timeout = Number(list[++i])
    else if (a === '--interval') opts.interval = Number(list[++i])
    else return { ok: false, error: `неизвестный флаг «${a}»` }
  }
  for (const key of ['timeout', 'interval']) {
    if (!Number.isFinite(opts[key]) || opts[key] <= 0) {
      return { ok: false, error: `--${key} должен быть положительным числом секунд` }
    }
  }
  return { ok: true, ...opts }
}

// ── импуративные раннеры (инжектируются в тестах) ────────────────────────────

const PR_FIELDS =
  'state,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,headRefName,headRefOid,statusCheckRollup'

function runViewPr(pr) {
  return ghJson(['pr', 'view', String(pr), '--json', PR_FIELDS])
}

function runMerge(pr) {
  return spawnSync('gh', ['pr', 'merge', String(pr), '--squash', '--delete-branch'], {
    stdio: 'inherit',
  })
}

function runMergedSha(pr) {
  const res = ghJson(['pr', 'view', String(pr), '--json', 'mergeCommit'])
  return res.ok ? (res.data?.mergeCommit?.oid ?? null) : null
}

function runClearPrBoardItem(pr) {
  const resolved = ghGraphqlResult(buildPrProjectItemsQuery(pr))
  if (!resolved.ok) return { status: 'error', detail: resolved.error }
  const item = pickProjectItem(resolved.data?.repository?.pullRequest?.projectItems?.nodes)
  if (!item?.id || !item.project?.id) return { status: 'absent' }
  const deleted = ghGraphqlResult(buildDeleteItemMutation(item.project.id, item.id))
  if (!deleted.ok) return { status: 'error', detail: deleted.error }
  return { status: 'deleted', detail: item.id }
}

function runBoardDone(issue) {
  return spawnSync('node', ['tools/gh/set-board-status.mjs', String(issue), 'Done'], {
    stdio: 'inherit',
  })
}

function defaultWorktreeExists(n) {
  return existsSync(join(process.cwd(), '.claude', 'worktrees', String(n)))
}

function runTeardown(n) {
  return spawnSync('node', ['tools/dev/worktree-teardown.mjs', String(n)], { stdio: 'inherit' })
}

function runListOpenPrs() {
  const res = ghJson(['pr', 'list', '--json', 'number'])
  if (!res.ok) return { status: 1, count: null }
  return { status: 0, count: Array.isArray(res.data) ? res.data.length : null }
}

function runListRemoteBranches() {
  const res = spawnSync('git', ['ls-remote', '--heads', 'origin'], { encoding: 'utf8' })
  if (res.error || res.status !== 0) return { status: failCode(res.status), count: null }
  return { status: 0, count: (res.stdout ?? '').split(/\r?\n/).filter((l) => l.trim() !== '').length }
}

function sleepSync(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000)
}

// ── гейт ─────────────────────────────────────────────────────────────────────

/**
 * Ограниченный поллинг гейта. Head пинится: если за время ожидания приехал
 * новый коммит, зелёный старого SHA ничего не доказывает — это RED.
 * @returns {{verdict:'green'|'red'|'timeout', reasons:string[], warn:string[], closes:number[], branch:string|null}}
 */
export function runGate(pr, { timeout, interval, requireReview }, io = {}) {
  const viewPr = io.viewPr ?? runViewPr
  const sleep = io.sleep ?? sleepSync
  const now = io.now ?? (() => Date.now())

  const deadline = now() + timeout * 1000
  let pinnedSha = null
  let lastPending = []

  for (;;) {
    const res = viewPr(pr)
    if (!res.ok) return { verdict: 'red', reasons: [res.error], warn: [], closes: [], branch: null }
    const data = res.data ?? {}
    const cond = gateConditions(data, { requireReview })
    if (cond.red.length > 0) {
      return {
        verdict: 'red',
        reasons: cond.red,
        warn: cond.warn,
        closes: cond.closes,
        branch: data.headRefName ?? null,
      }
    }

    const sha = data.headRefOid ?? null
    if (pinnedSha === null) pinnedSha = sha
    else if (sha !== pinnedSha) {
      return {
        verdict: 'red',
        reasons: [`head сдвинулся во время ожидания (${pinnedSha} → ${sha}) — проверки не о том коде`],
        warn: cond.warn,
        closes: cond.closes,
        branch: data.headRefName ?? null,
      }
    }

    const checks = classifyChecks(data.statusCheckRollup)
    if (checks.verdict === 'red') {
      return {
        verdict: 'red',
        reasons: [`красные проверки: ${checks.failed.join(', ')}`],
        warn: cond.warn,
        closes: cond.closes,
        branch: data.headRefName ?? null,
      }
    }
    if (checks.verdict === 'green') {
      return {
        verdict: 'green',
        reasons: [],
        warn: cond.warn,
        closes: cond.closes,
        branch: data.headRefName ?? null,
      }
    }

    lastPending = checks.pending
    if (now() >= deadline) {
      return {
        verdict: 'timeout',
        reasons: [
          `проверки не завершились за ${timeout} с (в ожидании: ${lastPending.join(', ') || 'ни одна проверка не зарегистрирована'})`,
        ],
        warn: cond.warn,
        closes: cond.closes,
        branch: data.headRefName ?? null,
      }
    }
    process.stdout.write(
      `${TAG} гейт: ждём ${lastPending.length || 'регистрации'} проверк(и/у)… ` +
        `следующая проба через ${interval} с\n`,
    )
    sleep(interval)
  }
}

// ── оркестрация ──────────────────────────────────────────────────────────────

/**
 * Шесть стадий хвоста. Каждая стадия — свой отдельный вызов (никаких пайпов:
 * в пайпе shell видит код последней команды, а не гейта). Раннеры
 * инжектируются, чтобы тест прогонял все ветки без подпроцессов.
 */
export function landPr(opts, io = {}) {
  const { pr } = opts
  const gate = io.gate ?? ((o) => runGate(pr, o))
  const merge = io.merge ?? runMerge
  const mergedSha = io.mergedSha ?? runMergedSha
  const clearBoardItem = io.clearBoardItem ?? runClearPrBoardItem
  const boardDone = io.boardDone ?? runBoardDone
  const worktreeExists = io.worktreeExists ?? defaultWorktreeExists
  const teardown = io.teardown ?? runTeardown
  const listOpenPrs = io.listOpenPrs ?? runListOpenPrs
  const listRemoteBranches = io.listRemoteBranches ?? runListRemoteBranches
  const exit = io.exit ?? ((code) => process.exit(code))
  const log = io.log ?? ((msg) => process.stdout.write(msg))
  const err = io.err ?? ((msg) => process.stderr.write(`${TAG} ${msg}\n`))

  const report = []
  const printReport = () => {
    log(`${TAG} ── хвост закрытия PR #${pr} ──\n`)
    for (const line of report) log(`${TAG}   ${line}\n`)
  }
  const fail = (stage, code, detail) => {
    report.push(`${stage}: ПРОВАЛ${detail ? ` (${detail})` : ''}`)
    printReport()
    err(`стадия «${stage}» упала на PR #${pr}${detail ? ` — ${detail}` : ''}. Что делать: ${stageRemedy(stage, pr)}`)
    return exit(code)
  }

  // 1. Гейт.
  const g = gate(opts)
  for (const w of g.warn ?? []) err(`гейт, замечание: ${w}`)
  if (g.verdict === 'timeout') return fail('gate', 2, g.reasons.join('; '))
  if (g.verdict !== 'green') return fail('gate', 1, g.reasons.join('; '))
  report.push('gate: ОК (проверки зелёные, head зафиксирован)')

  const issues = (g.closes ?? []).filter((n) => Number.isInteger(n) && n > 0)

  // 2. Мерж.
  const mergeRes = merge(pr)
  if (mergeRes.error) return fail('merge', 3, `не удалось запустить gh pr merge: ${mergeRes.error.message}`)
  if (mergeRes.status !== 0) return fail('merge', failCode(mergeRes.status))
  const sha = mergedSha(pr)
  report.push(`merge: ОК (squash${sha ? `, ${String(sha).slice(0, 12)}` : ''})`)

  // 3. board-clear — НЕ фатально: мерж уже приземлился.
  const clear = clearBoardItem(pr)
  if (clear.status === 'deleted') report.push('board-clear: ОК (PR-строка снята с борда)')
  else if (clear.status === 'absent') report.push('board-clear: пропуск (PR не стоял на борде)')
  else report.push(`board-clear: ЗАМЕЧАНИЕ (не фатально — ${clear.detail ?? 'неизвестная ошибка'})`)

  // 4. board-done.
  if (issues.length === 0) {
    report.push('board-done: пропуск (у PR нет связанных `Closes #N`)')
  } else {
    for (const issue of issues) {
      const res = boardDone(issue)
      if (res.error) return fail('board-done', 3, `не удалось запустить board:status: ${res.error.message}`)
      if (res.status !== 0) return fail('board-done', failCode(res.status), `задача #${issue}`)
    }
    report.push(`board-done: ОК (#${issues.join(', #')} → Done)`)
  }

  // 5. teardown ворктри.
  const candidates = issueCandidates(issues, g.branch)
  const present = candidates.filter((n) => worktreeExists(n))
  if (present.length === 0) {
    report.push(`teardown: пропуск (на диске нет .claude/worktrees/{${candidates.join(',') || '-'}})`)
  } else {
    for (const n of present) {
      const res = teardown(n)
      if (res.error) return fail('teardown', 3, `не удалось запустить worktree:teardown: ${res.error.message}`)
      if (res.status !== 0) return fail('teardown', failCode(res.status), `.claude/worktrees/${n}`)
    }
    report.push(`teardown: ОК (.claude/worktrees/{${present.join(',')}})`)
  }

  // 6. Пересводка.
  const prs = listOpenPrs()
  if (prs.status !== 0) return fail('re-sweep', 1, '`gh pr list` не отработал')
  const branches = listRemoteBranches()
  if (branches.status !== 0) return fail('re-sweep', 1, '`git ls-remote --heads origin` не отработал')
  report.push(`re-sweep: ОК (открытых PR: ${prs.count}; head-веток на origin: ${branches.count})`)

  printReport()
  log(`${TAG} хвост закрытия PR #${pr} ПРОЙДЕН.\n`)
  return exit(0)
}

function main() {
  const parsed = parseFlags(process.argv.slice(2))
  if (!parsed.ok) {
    process.stderr.write(
      `${TAG} ${parsed.error}\n` +
        `Использование: pnpm pr:land <pr#> [--timeout <сек>] [--interval <сек>] [--require-review]\n`,
    )
    process.exit(3)
  }
  const cwd = process.cwd()
  if (isWorktreeCwd(cwd)) {
    process.stderr.write(`${TAG} ${cwdGuardMessage(cwd)}\n`)
    process.exit(4)
  }
  landPr(parsed)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
