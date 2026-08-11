#!/usr/bin/env node
// PreToolUse-гард на Edit|Write|MultiEdit (issue #91, пункт 2; порт ds-platform
// tools/hooks/worktree-path-guard.mjs). Две независимые обязанности.
//
// 1. Escape-BLOCK (exit 2). Симптом-первопричина: `EnterWorktree` меняет cwd
//    сессии, но НЕ перенаправляет абсолютные пути — Edit/Write с абсолютным
//    путём в основное дерево (притащенным из более раннего Read/Bash) молча
//    пишет в общий чекаут. Оттуда чужая параллельная сессия сметает правку в
//    свой PR, а любой «зелёный», увиденный там, относится к чужому чекауту
//    (`.claude/rules/parallel-sessions.md`). Ловится в момент выдачи пути.
//    Защищаемый класс — ОБЩИЙ чекаут, и классифицируется ЦЕЛЬ, а не сессия
//    (#187). Прежняя редакция выводила «свой worktree» из cwd и блокировала всё
//    под основным корнем, кроме него: два ложных срабатывания — сессия, чей
//    worktree запуска удалён (писать нельзя было НИ В ОДИН worktree), и
//    сессия основного чекаута, которую Bash `cd` в `worktrees/79` заставил
//    считать себя изолированной и запретил правку в `worktrees/169`. cwd
//    дрейфует и потому не удостоверяет личность; путь под
//    `<mainRoot>/.claude/worktrees/` — это ЧЬЁ-ТО изолированное дерево, а не
//    общий чекаут, и не блокируется никогда.
//
// 2. Write-WARN (exit 0 + systemMessage). Первая запись в основное дерево в
//    НЕизолированной сессии при живой параллели: предупреждение один раз плюс
//    отметка `mainTreeWriteSeen` в per-session state — это write-половина
//    carve-out'а read-only лида из `main-tree-read-guard.mjs` (после первой
//    записи чтения предупреждаются в полную силу). Только WARN: блокировать
//    здесь значит приучать к обходу, а не закрывать дыру пункта 1.
//
// Контракт: stdin — JSON PreToolUse ({session_id, cwd, tool_name,
// tool_input:{file_path}}). exit 2 + stderr = BLOCK. exit 0 (+ опциональный
// systemMessage) = разрешено. FAIL-OPEN.

import {
  FRESH_WINDOW_MS,
  MAIN_TREE_STATE_DIR_REL,
  emitWarn,
  hooksDisabled,
  inWorktree,
  isAbsolutePath,
  isDirectRun,
  isUnder,
  liveSessionsFromFlag,
  mainRepoRoot,
  norm,
  readFlag,
  readHookPayload,
  readState,
  stateFilePath,
  statMtimeMs,
  targetPath,
  writeState,
} from './shared.mjs'

export function escapeBlockMessage(filePath, mainRoot, worktreeName) {
  return (
    `BLOCKED (#91): '${filePath}' — абсолютный путь в ОБЩИЙ основной чекаут (вне ` +
    `'${mainRoot}\\.claude\\worktrees\\'), а cwd этой сессии стоит в worktree.\n` +
    `Побег в общий чекаут: чужая параллельная сессия сметёт правку в свой PR, ` +
    `а «зелёный» там относится к чужому чекауту (.claude/rules/parallel-sessions.md).\n` +
    `Пиши в worktree: относительный путь от его корня либо префикс ` +
    `'${mainRoot}\\.claude\\worktrees\\${worktreeName}\\…' (путь в ЛЮБОЙ worktree гард пропускает).\n`
  )
}

export function writeWarnMessage(liveCount) {
  return (
    `⚠ main-tree write guard (#91): живых параллельных сессий — ${liveCount}, а эта сессия ` +
    `ПИШЕТ исходники в ОБЩЕМ основном чекауте без изоляции. Carve-out read-only оркестрации ` +
    `закончился — гард снова в полную силу. Изолируйся до дальнейших правок: ` +
    `\`pnpm task:worktree <N>\` → \`EnterWorktree path:.claude/worktrees/<N>\` ` +
    `(.claude/rules/parallel-sessions.md). Только предупреждение.`
  )
}

/**
 * Чистый seam пункта 1: абсолютный путь из worktree-сессии, уводящий в ОБЩИЙ
 * чекаут. Возвращает `{block:false}` либо `{block:true, mainRoot, worktreeName}`.
 * Решение не зависит ни от флага, ни от FS — только от cwd и пути.
 *
 * Классифицируется цель, а не сессия (#187): блокируется путь под основным
 * корнем и ВНЕ `<mainRoot>/.claude/worktrees/`. Любой путь внутри worktrees —
 * чьё-то изолированное дерево, общему чекауту он не угрожает и проходит.
 */
export function decideEscapeBlock({ toolName, toolInput, cwd }) {
  if (!/^(Edit|Write|MultiEdit)$/.test(toolName || '')) return { block: false }
  const filePath = (toolInput && toolInput.file_path) || ''
  if (!cwd || !filePath || !isAbsolutePath(filePath)) return { block: false }
  const m = String(cwd).match(/^(.*)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/)
  if (!m) return { block: false, inWorktreeSession: false }
  const mainRoot = m[1]
  const worktreesRoot = `${m[1]}/.claude/worktrees`
  const underMain = isUnder(filePath, norm(mainRoot))
  const underAnyWorktree = isUnder(filePath, norm(worktreesRoot))
  if (underMain && !underAnyWorktree) {
    return { block: true, mainRoot, worktreeName: m[2] }
  }
  return { block: false, inWorktreeSession: true }
}

/**
 * Чистый seam пункта 2: предупреждать ли о ЗАПИСИ в основное дерево. Да —
 * только когда инструмент пишущий, сессия НЕ в worktree (изолированная сессия
 * это ровно правильный случай), параллельные сессии живы и цель — исходники
 * репо (не `.claude/`, не `.git/`).
 */
export function decideWriteWarn({
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
  if (!/^(Edit|Write|MultiEdit)$/.test(toolName || '')) return { warn: false }
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

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const tool = payload.tool_name || ''
    if (!/^(Edit|Write|MultiEdit)$/.test(tool)) process.exit(0)
    const cwd = payload.cwd || ''

    const escape = decideEscapeBlock({ toolName: tool, toolInput: payload.tool_input, cwd })
    if (escape.block) {
      process.stderr.write(
        escapeBlockMessage(payload.tool_input.file_path, escape.mainRoot, escape.worktreeName),
      )
      process.exit(2)
    }
    // Сессия в worktree с корректным путём — изолирована, предупреждать не о чем.
    if (escape.inWorktreeSession) process.exit(0)

    const projectDir = mainRepoRoot(cwd)
    const decision = decideWriteWarn({
      toolName: tool,
      toolInput: payload.tool_input,
      cwd,
      sessionId: payload.session_id || '',
      projectDir,
      flag: readFlag(projectDir),
      statMtime: statMtimeMs,
      nowMs: Date.now(),
    })
    if (decision.warn) {
      const statePath = stateFilePath(projectDir, MAIN_TREE_STATE_DIR_REL, payload.session_id || '')
      const state = readState(statePath)
      // Предупреждаем один раз — на ПЕРВОЙ записи; дальше `mainTreeWriteSeen`
      // заставляет read-гард предупреждать в полную силу.
      if (!state.mainTreeWriteSeen) {
        emitWarn(writeWarnMessage(decision.liveCount))
        writeState(statePath, { ...state, mainTreeWriteSeen: true })
      }
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить легитимную правку
  }
}

if (isDirectRun(import.meta.url)) main()
