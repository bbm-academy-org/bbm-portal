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
    if (decision.action === 'warn') emitWarn(warnMessage(decision.streak))
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить легитимный вызов
  }
}

if (isDirectRun(import.meta.url)) main()
