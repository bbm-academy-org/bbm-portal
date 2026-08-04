#!/usr/bin/env node
// bbm-portal — `pnpm pr:land <pr>`: хвост закрытия PR одной командой (#130).
//
// Почему: после мержа остаётся многошаговый хвост (снять свою PR-строку с
// борда, поставить Done каждой `Closes #N`, разобрать ворктри, пересвести
// остатки) — и именно он забывается чаще всего, потому что задача «уже
// сделана». Хвост здесь один детерминированный вызов, без ослабления гейта:
//
//   1. gate        — PR открыт и не draft, нет конфликта, есть `Closes #N`,
//                    ревью подтверждено, все check-run'ы по ТЕКУЩЕМУ head SHA
//                    зелёные (ограниченный поллинг), head не сдвинулся;
//   2. merge       — `gh pr merge <N> --squash --delete-branch
//                    --match-head-commit <тот же SHA>`;
//   3. board-clear — снять СВОЮ PR-строку с борда. НЕ фатально: мерж уже
//                    приземлился, провал здесь — строка отчёта, не откат;
//   4. board-done  — `Status=Done` каждой связанной `Closes #N`;
//   5. teardown    — `pnpm worktree:teardown <N>`, если ворктри есть на диске;
//   6. re-sweep    — открытые PR + head-ветки на origin, одной строкой.
//
// Первая упавшая стадия останавливает хвост, печатает имя стадии и одну строку
// «что доделать руками» (канон §7).
//
// Ревью-гейт БЛОКИРУЮЩИЙ и по умолчанию включён, но засчитывает ту форму
// ревью, которая в этом репо реально существует: единственный человек с
// правами и есть автор PR (сам себе APPROVE он поставить не может), а ревьюер —
// субагент, оставляющий комментарий. Поэтому годится либо человеческий APPROVE,
// либо комментарий со строкой `VERDICT: APPROVE`, созданный ПОСЛЕ последнего
// коммита PR (одобрение старше кода относится к другому коду — та же логика,
// что у head-пиннинга). `--require-review` сужает до человеческого APPROVE;
// `--no-review-gate "<причина>"` снимает гейт с обязательной записанной
// причиной. Приёмка владельца (stage 5) — отдельное требование, и напоминание о
// ней печатается всегда: гейт её проверить не может.
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
 * Вердикт ревьюера-субагента из комментариев PR. У нас ревью приезжает
 * комментарием, а не GitHub-review (единственный человек с правами — автор PR,
 * сам себе APPROVE он поставить не может), поэтому проверяемым артефактом
 * служит строка `VERDICT: APPROVE` в теле комментария.
 *
 * Свежесть обязательна: одобрение, выданное до последнего коммита, относится к
 * другому коду — ровно та же логика, что у head-пиннинга проверок.
 * @param {{body?:string, createdAt?:string}[]} comments
 * @param {string|null} headCommittedDate  дата последнего коммита PR
 * @returns {{ok:true, at:string}|{ok:false, reason:'none'|'stale'|'changes', at?:string}}
 */
export function findAgentApproval(comments, headCommittedDate) {
  const verdicts = []
  for (const c of Array.isArray(comments) ? comments : []) {
    const m = /^VERDICT:\s*(APPROVE|REQUEST_CHANGES)\b/m.exec(String(c?.body ?? ''))
    if (!m) continue
    const at = Date.parse(c?.createdAt ?? '')
    if (!Number.isFinite(at)) continue
    verdicts.push({ verdict: m[1], at, iso: c.createdAt })
  }
  if (verdicts.length === 0) return { ok: false, reason: 'none' }
  verdicts.sort((a, b) => a.at - b.at)
  const latest = verdicts[verdicts.length - 1]
  if (latest.verdict !== 'APPROVE') return { ok: false, reason: 'changes', at: latest.iso }
  const head = Date.parse(headCommittedDate ?? '')
  if (Number.isFinite(head) && latest.at < head) return { ok: false, reason: 'stale', at: latest.iso }
  return { ok: true, at: latest.iso }
}

/** Дата последнего коммита PR — база для проверки свежести ревью. */
export function headCommittedDate(pr) {
  const commits = pr?.commits
  if (!Array.isArray(commits) || commits.length === 0) return null
  return commits[commits.length - 1]?.committedDate ?? null
}

/**
 * Не-CI-условия гейта. Возвращает список причин RED (пустой = ок) и отдельно
 * нефатальные замечания.
 * @param {object} pr
 * @param {{requireReview?:boolean, reviewGate?:boolean}} [opts]
 *   requireReview — засчитывать ТОЛЬКО человеческий APPROVE;
 *   reviewGate    — по умолчанию true: годится человеческий APPROVE ИЛИ свежий
 *                   `VERDICT: APPROVE` ревьюера-субагента. false — только WARN.
 */
export function gateConditions(pr, { requireReview = false, reviewGate = true } = {}) {
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

  const humanApproved = String(pr?.reviewDecision ?? '').toUpperCase() === 'APPROVED'
  const agent = findAgentApproval(pr?.comments, headCommittedDate(pr))
  const AGENT_REASON = {
    none: 'ни одного комментария со строкой `VERDICT: APPROVE`',
    stale: 'последний `VERDICT: APPROVE` старше последнего коммита — он про другой код',
    changes: 'последний вердикт ревьюера — `REQUEST_CHANGES`',
  }
  if (requireReview) {
    if (!humanApproved) red.push('нет человеческого APPROVE-ревью (--require-review)')
  } else if (reviewGate) {
    if (!humanApproved && !agent.ok) {
      red.push(
        `ревью не подтверждено: ${AGENT_REASON[agent.reason]}. ` +
          `Запусти ревью (субагент bbm-reviewer, task-cycle stage 4) либо, если класс работы ` +
          `ревью не требует, укажи причину: --no-review-gate "<причина>"`,
      )
    }
  } else if (!humanApproved && !agent.ok) {
    warn.push(`ревью-гейт отключён вручную, а подтверждения нет: ${AGENT_REASON[agent.reason]}`)
  }

  // Приёмка владельца (stage 5) — отдельное от ревью требование, поэтому
  // напоминание печатается ВСЕГДА: при APPROVE о ней иначе не напомнит никто.
  warn.push(
    'task-cycle stage 5: для изменений, видимых владельцу, мерж идёт только после записанной ' +
      'приёмки на живом стенде — гейт этого не проверяет',
  )
  if (String(pr?.mergeStateStatus ?? '').toUpperCase() === 'BEHIND') {
    warn.push('ветка отстала от базы (mergeStateStatus=BEHIND) — при strict-проверках мерж откажет')
  }
  return { red, warn, closes }
}

export const USAGE = `Использование: pnpm pr:land <pr#> [флаги]

  Хвост закрытия PR одной командой: гейт → мерж → снятие PR-строки с борда →
  Status=Done каждой \`Closes #N\` → teardown ворктри → пересводка. Первая
  упавшая стадия останавливает хвост и печатает, что доделать руками.

  Гейт: PR открыт и не draft, нет конфликта, есть \`Closes #N\`, ревью
  подтверждено, все проверки по ТЕКУЩЕМУ head SHA зелёные. Тот же SHA уходит в
  \`gh pr merge --match-head-commit\`, поэтому коммит, приземлившийся во время
  ожидания, мерж отвергнет, а не пропустит.

  Ревью по умолчанию засчитывается двумя способами: человеческий APPROVE ИЛИ
  комментарий ревьюера со строкой \`VERDICT: APPROVE\`, созданный ПОСЛЕ
  последнего коммита PR.

  Флаги:
    --timeout <сек>            ожидание проверок, по умолчанию 900
    --interval <сек>           период опроса, по умолчанию 20
    --require-review           засчитывать только человеческий APPROVE
    --no-review-gate "<причина>"  снять ревью-гейт; причина обязательна и печатается

  Exit codes: 0 — хвост пройден; 1 — стадия упала; 2 — таймаут гейта;
  3 — ошибка использования; 4 — запуск из ворктри.
`

/** Разбор флагов `pr:land`. */
export function parseFlags(argv) {
  const list = argv ?? []
  if (list.includes('--help') || list.includes('-h')) return { ok: true, help: true }
  const rawPr = list[0]
  const pr = Number(rawPr)
  if (!rawPr || !Number.isInteger(pr) || pr <= 0) {
    return { ok: false, error: `недопустимый номер PR: «${rawPr ?? ''}»` }
  }
  const opts = {
    pr,
    timeout: 900,
    interval: 20,
    requireReview: false,
    reviewGate: true,
    reviewGateWaiver: null,
  }
  for (let i = 1; i < list.length; i++) {
    const a = list[i]
    if (a === '--require-review') opts.requireReview = true
    else if (a === '--no-review-gate') {
      // Причина обязательна: снятие гейта без записанного основания — это и
      // есть тихий обход, ради которого гейты потом объявляют бесполезными.
      const reason = list[++i]
      if (!reason || reason.startsWith('--')) {
        return { ok: false, error: '--no-review-gate требует причину: --no-review-gate "<причина>"' }
      }
      opts.reviewGate = false
      opts.reviewGateWaiver = reason
    } else if (a === '--timeout') opts.timeout = Number(list[++i])
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
  'state,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,' +
  'headRefName,headRefOid,statusCheckRollup,comments,commits'

function runViewPr(pr) {
  return ghJson(['pr', 'view', String(pr), '--json', PR_FIELDS])
}

/**
 * Мерж, привязанный к тому же SHA, который прошёл гейт. Без
 * `--match-head-commit` пиннинг был бы только на чтении: между зелёным гейтом
 * (а он может ждать до 900 с) и `gh pr merge` в ветку успевает приземлиться
 * коммит — и приземлится он не проверенным ничем. В репо с параллельными
 * сессиями это не теоретический сценарий; GitHub отвергнет мерж сам, если head
 * сдвинулся.
 */
function runMerge(pr, sha) {
  const args = ['pr', 'merge', String(pr), '--squash', '--delete-branch']
  if (sha) args.push('--match-head-commit', String(sha))
  return spawnSync('gh', args, { stdio: 'inherit' })
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
 * новый коммит, зелёный старого SHA ничего не доказывает — это RED. Тот же SHA
 * уезжает наружу и дальше в `gh pr merge --match-head-commit`, иначе пиннинг
 * остался бы обещанием на чтении.
 * @returns {{verdict:'green'|'red'|'timeout', reasons:string[], warn:string[], closes:number[], branch:string|null, sha:string|null}}
 */
export function runGate(pr, { timeout, interval, requireReview = false, reviewGate = true }, io = {}) {
  const viewPr = io.viewPr ?? runViewPr
  const sleep = io.sleep ?? sleepSync
  const now = io.now ?? (() => Date.now())

  const deadline = now() + timeout * 1000
  let pinnedSha = null
  let lastPending = []

  for (;;) {
    const res = viewPr(pr)
    if (!res.ok) {
      return { verdict: 'red', reasons: [res.error], warn: [], closes: [], branch: null, sha: null }
    }
    const data = res.data ?? {}
    const cond = gateConditions(data, { requireReview, reviewGate })
    const sha = data.headRefOid ?? null
    const out = (verdict, reasons) => ({
      verdict,
      reasons,
      warn: cond.warn,
      closes: cond.closes,
      branch: data.headRefName ?? null,
      sha: pinnedSha ?? sha,
    })

    if (cond.red.length > 0) return out('red', cond.red)

    if (pinnedSha === null) pinnedSha = sha
    else if (sha !== pinnedSha) {
      return out('red', [
        `head сдвинулся во время ожидания (${pinnedSha} → ${sha}) — проверки не о том коде`,
      ])
    }

    const checks = classifyChecks(data.statusCheckRollup)
    if (checks.verdict === 'red') return out('red', [`красные проверки: ${checks.failed.join(', ')}`])
    if (checks.verdict === 'green') return out('green', [])

    lastPending = checks.pending
    if (now() >= deadline) {
      return out('timeout', [
        `проверки не завершились за ${timeout} с (в ожидании: ${lastPending.join(', ') || 'ни одна проверка не зарегистрирована'})`,
      ])
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

  // 2. Мерж — привязанный к тому же SHA, который прошёл гейт.
  const mergeRes = merge(pr, g.sha)
  if (mergeRes.error) return fail('merge', 3, `не удалось запустить gh pr merge: ${mergeRes.error.message}`)
  if (mergeRes.status !== 0) return fail('merge', failCode(mergeRes.status))
  const sha = mergedSha(pr)
  report.push(
    `merge: ОК (squash${g.sha ? `, head закреплён ${String(g.sha).slice(0, 12)}` : ''}` +
      `${sha ? `, ${String(sha).slice(0, 12)}` : ''})`,
  )

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
  if (parsed.ok && parsed.help) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (!parsed.ok) {
    process.stderr.write(`${TAG} ${parsed.error}\n${USAGE}`)
    process.exit(3)
  }
  const cwd = process.cwd()
  if (isWorktreeCwd(cwd)) {
    process.stderr.write(`${TAG} ${cwdGuardMessage(cwd)}\n`)
    process.exit(4)
  }
  if (parsed.reviewGateWaiver) {
    process.stdout.write(
      `${TAG} ревью-гейт СНЯТ вручную. Причина: ${parsed.reviewGateWaiver}\n` +
        `${TAG} это записывается в вывод сессии намеренно — снятие гейта должно быть видно.\n`,
    )
  }
  landPr(parsed)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) main()
