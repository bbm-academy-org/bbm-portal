#!/usr/bin/env node
// PreToolUse-гард на Agent|Task|Edit|Write|MultiEdit (issue #91, пункт 4; порт
// ds-platform tools/hooks/dispatch-guard.mjs).
//
// Симптом-первопричина: лид молча набирает имплементацию модуля инлайном в
// общем чекауте вместо диспетчеризации субагенту (task-cycle stage 3), и это
// видно только постфактум — по размеру диффа в PR. Гард делает расхождение
// ДЕТЕРМИНИРОВАННЫМ и в момент решения: считает ПОДРЯД идущие пишущие вызовы
// лида в основном дереве без вызова Agent между ними; порог
// DISPATCH_WARN_THRESHOLD → одно WARN. Agent сбрасывает счётчик.
//
// Matcher включает и Agent, и мутации, чтобы хук видел и то, что считает, и то,
// что сбрасывает. Read/Bash/Grep между правками матчер не поднимают — они и не
// считаются, и не сбрасывают, что и есть нужная семантика «подряд».
//
// Carve-out: (1) сессия в worktree — это и есть исполнитель-диспатч-таргет либо
// изолированный лид, ему инлайн положен; (2) read-only сессия сама никогда не
// доберётся до порога; (3) явный opt-out `BBM_DISPATCH_GUARD_DISABLE=1`.
//
// ВТОРАЯ, независимая обязанность — staging gate (retro 2026-08-05, рецидив темы
// «ceremony by task class»). A brief that tells the subagent to write drafts to
// disk instead of applying the edit buys nothing for a reversible,
// non-conflicting change: the lead then has to read every draft and re-apply it
// by hand, so the pipeline costs a full extra pass and delivers zero applied
// edits. Staging is a real answer only when the edit is irreversible, conflicts
// with someone else's work, or the owner asked to pre-approve it — which is what
// the explicit `STAGED:` token in the brief declares. WARN only: the two checks
// are mutually exclusive by tool (streak counts mutations, staging inspects
// dispatch), so at most one message is ever emitted.
//
// Контракт: stdin — JSON PreToolUse. WARN = exit 0 + JSON на stdout. Никогда не
// блокирует. FAIL-OPEN.

import {
  DISPATCH_STATE_DIR_REL,
  emitWarn,
  hooksDisabled,
  inWorktree,
  isDirectRun,
  mainRepoRoot,
  readHookPayload,
  readState,
  stateFilePath,
  writeState,
} from './shared.mjs'

/** Длина серии, на которой гард впервые предупреждает. Один именованный
 * настраиваемый порог: 2 правки подряд — обычная точечная работа, 3 — уже
 * похоже на набор модуля инлайном. */
export const DISPATCH_WARN_THRESHOLD = 3

/** Пишущие инструменты, чья непрерывная серия считается. */
export const MUTATION_TOOL_RE = /^(Edit|Write|MultiEdit)$/

/** Диспетчеризующие инструменты, сбрасывающие серию (`Task` — кросс-харнесный алиас). */
export const DISPATCH_TOOL_RE = /^(Agent|Task)$/

/** Env-переменная явного opt-out для санкционированного инлайна. */
export const CARVE_OUT_ENV = 'BBM_DISPATCH_GUARD_DISABLE'

export function isCarveOut(env = process.env) {
  const v = env && env[CARVE_OUT_ENV]
  return v === '1' || v === 'true' || v === 'yes'
}

/** Прочитать серию: нет файла / битый JSON / отрицательное → 0 (fail-open). */
export function readStreak(state) {
  const s = state && Number(state.streak)
  return Number.isFinite(s) && s >= 0 ? s : 0
}

export function warnMessage(streak, threshold = DISPATCH_WARN_THRESHOLD) {
  return (
    `⚠ dispatch guard (#91): ${streak} пишущих вызова лида подряд в ОБЩЕМ основном чекауте без ` +
    `единого Agent между ними (порог ${threshold}). Имплементация модуля диспетчеризуется ` +
    `(task-cycle stage 3): правки уходят субагенту в изолированный worktree, а не набираются ` +
    `лидом инлайном. Либо диспетчеризуй остаток (Agent с явным model — CLAUDE.md «Subagents and ` +
    `models»), либо продолжай осознанно, если это санкционированный инлайн (разведка, рамка ` +
    `задачи, правка доков/ADR). Только предупреждение; отключается ${CARVE_OUT_ENV}=1.`
  )
}

/**
 * Чистый seam решения:
 * - Agent/Task            → `{ action: 'reset', streak: 0 }`;
 * - не пишущий инструмент → `{ action: 'silent' }` (состояние не трогаем);
 * - carve-out             → `{ action: 'silent' }`;
 * - серия+1 < порога      → `{ action: 'count', streak }`;
 * - серия+1 >= порога     → `{ action: 'warn',  streak }`.
 */
export function decideDispatch({
  toolName,
  cwd,
  projectDir,
  streak,
  threshold = DISPATCH_WARN_THRESHOLD,
  carveOut = false,
}) {
  if (DISPATCH_TOOL_RE.test(toolName || '')) return { action: 'reset', streak: 0 }
  if (!MUTATION_TOOL_RE.test(toolName || '')) return { action: 'silent' }
  if (carveOut) return { action: 'silent' }
  if (inWorktree(cwd) || inWorktree(projectDir)) return { action: 'silent' }
  const next = (Number.isFinite(streak) && streak >= 0 ? streak : 0) + 1
  if (next >= threshold) return { action: 'warn', streak: next }
  return { action: 'count', streak: next }
}

/**
 * Phrasings that stage the subagent's output instead of applying it.
 *
 * Review PR #148 (refs #149) removed the bare `do not mutate` / `no mutation`
 * alternatives: those are the standard wording of ANY read-only recon brief
 * (`bbm-explorer` says exactly that), so they flagged briefs that stage nothing.
 * What is left names the draft itself — the artifact staging actually produces.
 */
export const STAGING_RE =
  /drafts? (?:on disk|only)|drafts? file|write .{0,40}draft|lead applies|черновик/i

/** The escape hatch: staging declared, with the reason that justifies it. */
export const STAGED_TOKEN_RE = /STAGED:\s*(irreversible|conflicting|owner-preapproval)/

export function stagingWarnMessage() {
  return (
    '⚠ dispatch guard (#91): the agent brief stages output to disk instead of applying it. ' +
    'A reversible, non-conflicting edit is dispatched to APPLY DIRECTLY (read → rewrite → apply); ' +
    'staging is justified only as irreversible / conflicting / owner-requested preapproval — add ' +
    'an explicit `STAGED: irreversible|conflicting|owner-preapproval` token to the brief or ' +
    're-dispatch as direct-apply. (Retro 2026-08-05: a 3-stage pipeline for plain issue-text edits ' +
    'burned ~155k tokens producing zero applied edits before the owner halted it.)'
  )
}

/**
 * Pure decision seam of the staging gate: warn when a dispatch brief stages its
 * output and does not carry the explicit `STAGED:` justification token. A brief
 * we cannot read (missing / non-string prompt) is never a violation — fail-open.
 *
 * Carve-outs are the SAME as the streak half (review PR #148, refs #149): the
 * env opt-out and an isolated worktree session. One guard, one set of exits —
 * otherwise `BBM_DISPATCH_GUARD_DISABLE=1` would silence half of it.
 */
export function decideStaging({
  toolName,
  prompt = '',
  cwd = '',
  projectDir = '',
  carveOut = false,
}) {
  if (!DISPATCH_TOOL_RE.test(toolName || '')) return { warn: false }
  if (carveOut) return { warn: false }
  if (inWorktree(cwd) || inWorktree(projectDir)) return { warn: false }
  const text = typeof prompt === 'string' ? prompt : ''
  if (!text) return { warn: false }
  if (!STAGING_RE.test(text)) return { warn: false }
  if (STAGED_TOKEN_RE.test(text)) return { warn: false }
  return { warn: true }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const cwd = payload.cwd || ''
    const projectDir = mainRepoRoot(cwd)
    const statePath = stateFilePath(projectDir, DISPATCH_STATE_DIR_REL, payload.session_id || '')
    const decision = decideDispatch({
      toolName: payload.tool_name,
      cwd,
      projectDir,
      streak: readStreak(readState(statePath)),
      carveOut: isCarveOut(process.env),
    })
    if (decision.action !== 'silent') writeState(statePath, { streak: decision.streak })
    if (decision.action === 'warn') {
      emitWarn(warnMessage(decision.streak))
      process.exit(0)
    }
    const staging = decideStaging({
      toolName: payload.tool_name,
      prompt: payload.tool_input && payload.tool_input.prompt,
      cwd,
      projectDir,
      carveOut: isCarveOut(process.env),
    })
    if (staging.warn) emitWarn(stagingWarnMessage())
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить легитимный вызов
  }
}

if (isDirectRun(import.meta.url)) main()
