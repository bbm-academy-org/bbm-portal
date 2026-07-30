#!/usr/bin/env node
// PreToolUse-гард на Read|Grep|Glob (issue #91, пункт 3; порт ds-platform
// tools/hooks/main-tree-read-guard.mjs).
//
// Симптом-первопричина: пока живы параллельные сессии, чужой push может увести
// origin/main и HEAD общего чекаута из-под тебя — анализ, построенный на чтении
// «грязного» основного дерева, построен на устаревшем содержимом, а любой
// «зелёный», увиденный там, относится к чужому чекауту
// (`.claude/rules/parallel-sessions.md`). Изоляция включает и аналитические
// чтения, не только записи.
//
// Уровень WARN — никогда не блокирует: сессии триажа борды и `gh`-чтений должны
// оставаться работоспособными. Carve-out для read-only лида: одно смягчённое
// уведомление вместо предупреждения на каждое чтение; полное предупреждение
// возвращается с первой записью в основное дерево (флаг `mainTreeWriteSeen`
// ставит `worktree-path-guard.mjs`).
//
// Контракт: stdin — JSON PreToolUse ({session_id, cwd, tool_name, tool_input}).
// WARN = exit 0 + JSON на stdout. Тихо = exit 0 без вывода. FAIL-OPEN.

import {
  FRESH_WINDOW_MS,
  MAIN_TREE_STATE_DIR_REL,
  emitWarn,
  inWorktree,
  isDirectRun,
  isUnder,
  liveSessionsFromFlag,
  mainRepoRoot,
  readFlag,
  readHookPayload,
  readState,
  stateFilePath,
  statMtimeMs,
  targetPath,
  writeState,
} from './shared.mjs'

export function warnMessage(liveCount) {
  return (
    `⚠ main-tree read guard (#91): живых параллельных сессий — ${liveCount}, а эта сессия ` +
    `читает исходники в ОБЩЕМ основном чекауте без изоляции. Заведи worktree до дальнейших ` +
    `Read/Grep/Glob по исходникам: \`pnpm task:worktree <N>\` → ` +
    `\`EnterWorktree path:.claude/worktrees/<N>\` (.claude/rules/parallel-sessions.md — ` +
    `аналитические чтения тоже входят в изоляцию). Только предупреждение: чтения борды/триажа ` +
    `можно продолжать.`
  )
}

/** Одно смягчённое уведомление для read-only лида-оркестратора. */
export function softenedNoticeMessage(liveCount) {
  return (
    `ℹ main-tree read guard (#91): живых параллельных сессий — ${liveCount}, ты читаешь общий ` +
    `основной чекаут. Carve-out для read-only оркестрации — это ЕДИНСТВЕННОЕ уведомление, ` +
    `дальнейшие чтения молчат. Полное предупреждение вернётся с первой ЗАПИСЬЮ в основное ` +
    `дерево. Если будешь править файлы — изолируйся сейчас: \`pnpm task:worktree <N>\` → ` +
    `\`EnterWorktree path:.claude/worktrees/<N>\`.`
  )
}

/**
 * Чистый seam решения: предупреждать ли о чтении. Да — только когда инструмент
 * читающий, сессия НЕ в worktree, параллельные сессии всё ещё живы и цель это
 * исходники репо (под корнем, но не `.claude/` и не `.git/`).
 */
export function decideWarn({
  toolName,
  toolInput,
  cwd,
  sessionId,
  projectDir,
  flag,
  statMtime,
  nowMs,
  freshWindowMs = FRESH_WINDOW_MS,
}) {
  if (!/^(Read|Grep|Glob)$/.test(toolName || '')) return { warn: false }
  if (!cwd || !projectDir) return { warn: false }
  if (inWorktree(cwd) || inWorktree(projectDir)) return { warn: false }
  const live = liveSessionsFromFlag({ flag, sessionId, statMtime, nowMs, freshWindowMs })
  if (live.length === 0) return { warn: false }

  const target = targetPath(toolInput, cwd)
  if (!isUnder(target, projectDir)) return { warn: false }
  if (isUnder(target, `${projectDir}/.claude`) || isUnder(target, `${projectDir}/.git`)) {
    return { warn: false }
  }
  return { warn: true, liveCount: live.length }
}

/**
 * Наложение carve-out'а на вердикт `decideWarn()`:
 * - условия не выполнены → `silent`;
 * - запись в основное дерево уже была → `warn` (полное предупреждение);
 * - уведомление ещё не показано → `notice` (один раз);
 * - иначе → `silent`.
 */
export function decideReadAction({ warnDecision, state }) {
  if (!warnDecision || !warnDecision.warn) return { action: 'silent' }
  const s = state || {}
  if (s.mainTreeWriteSeen) return { action: 'warn', liveCount: warnDecision.liveCount }
  if (!s.noticeShown) {
    return { action: 'notice', liveCount: warnDecision.liveCount, setNoticeShown: true }
  }
  return { action: 'silent' }
}

function main() {
  try {
    const payload = readHookPayload()
    const cwd = payload.cwd || ''
    const projectDir = mainRepoRoot(cwd)
    const decision = decideWarn({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      cwd,
      sessionId: payload.session_id || '',
      projectDir,
      flag: readFlag(projectDir),
      statMtime: statMtimeMs,
      nowMs: Date.now(),
    })
    const statePath = stateFilePath(projectDir, MAIN_TREE_STATE_DIR_REL, payload.session_id || '')
    const state = readState(statePath)
    const action = decideReadAction({ warnDecision: decision, state })
    if (action.action === 'warn' || action.action === 'notice') {
      emitWarn(
        action.action === 'warn'
          ? warnMessage(action.liveCount)
          : softenedNoticeMessage(action.liveCount),
      )
      if (action.setNoticeShown) writeState(statePath, { ...state, noticeShown: true })
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить легитимное чтение
  }
}

if (isDirectRun(import.meta.url)) main()
