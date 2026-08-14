#!/usr/bin/env node
// Shared plumbing for the enforcement hook stack (issue #91 — расконсервация
// hook-стека; порт из ds-platform tools/hooks/*).
//
// Симптом-первопричина: пять рецидивов подряд тем, которые проза в CLAUDE.md /
// .claude/rules уже покрывала (запись мимо worktree, субагент без model, эхо
// секрета, отчёт без «Проверить глазами»). Проза не удерживает — правило
// переезжает в исполняемый гейт (task-cycle SKILL.md, «Enforcement hooks»).
//
// Инженерный контракт всего стека:
//   * FAIL-OPEN — любая внутренняя ошибка хука это exit 0. Баг гейта никогда не
//     блокирует работу; блокирует только явное, распознанное нарушение.
//   * Чистые seam-функции решения экспортируются отдельно от main() и покрыты
//     юнит-тестами (tests/unit/hooks-*.spec.ts); main() запускается только при
//     прямом вызове файла (entry-point guard), поэтому импорт в тестах безопасен.
//   * Корень репозитория резолвится через `git rev-parse --git-common-dir` —
//     hook-команды исполняются из cwd сессии, а состояние (флаг параллельных
//     сессий, guard-state) принадлежит ОСНОВНОМУ дереву даже когда сессия сидит
//     в worktree.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Файл-флаг живых параллельных сессий; пишет `session-flag-writer.mjs`. */
export const FLAG_REL = '.claude/parallel-sessions.flag.json'

/** Сессия считается живой, если её .jsonl трогали не позже этого окна.
 * Единственный источник истины: writer переэкспортирует эту же константу. */
export const FRESH_WINDOW_MS = 10 * 60 * 1000

/** Каталог per-session состояния read/write-гардов (`{noticeShown, mainTreeWriteSeen}`). */
export const MAIN_TREE_STATE_DIR_REL = '.claude/main-tree-guard-state'

/** Каталог per-session состояния dispatch-гарда (`{streak}`). */
export const DISPATCH_STATE_DIR_REL = '.claude/dispatch-guard-state'

/** Per-session state of the AskUserQuestion guard (`{headers: {<header>: len}}`). */
export const ASKUSERQUESTION_STATE_DIR_REL = '.claude/askuserquestion-guard-state'

/** Stable per-session write evidence recorded from Codex PostToolUse payloads. */
export const CODEX_WRITE_STATE_DIR_REL = '.claude/codex-write-state'

/** Per-session transcript registry shared by Claude and Codex hook invocations. */
export const HOOK_SESSION_REGISTRY_DIR_REL = '.claude/hook-session-registry'

/** Сравнение путей без учёта регистра и вида разделителя (Windows FS). */
export function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function isUnder(child, parent) {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + '/')
}

export function isAbsolutePath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || String(p).startsWith('/')
}

/** Путь лежит внутри линкованного worktree этого репо. */
export function inWorktree(p) {
  return /\/\.claude\/worktrees(\/|$)/.test(norm(p))
}

/**
 * Путь, по которому реально работает вызов инструмента: `file_path` (Read /
 * Edit / Write) либо `path` (Grep / Glob), относительный — от cwd сессии;
 * Grep/Glob без пути целятся в саму cwd.
 */
export function targetPath(toolInput, cwd) {
  const p = (toolInput && (toolInput.file_path || toolInput.path)) || ''
  if (!p) return cwd
  return isAbsolutePath(p) ? p : resolve(cwd, p)
}

/**
 * Корень ОСНОВНОГО рабочего дерева, даже когда вызов идёт из worktree:
 * `--git-common-dir` в worktree указывает на `<main>/.git`, в основном дереве —
 * на `.git`. Ошибка git → откат на CLAUDE_PROJECT_DIR / cwd (fail-open).
 */
export function mainRepoRoot(cwd, deps = {}) {
  const run =
    deps.run ||
    ((c) => {
      const res = spawnSync('git', ['rev-parse', '--git-common-dir'], {
        cwd: c || undefined,
        encoding: 'utf8',
      })
      return { status: res.status ?? -1, stdout: res.stdout ?? '' }
    })
  try {
    const res = run(cwd)
    if (res.status === 0 && res.stdout.trim()) {
      return dirname(resolve(cwd || '.', res.stdout.trim()))
    }
  } catch {
    // fail-open — ниже откат
  }
  return process.env.CLAUDE_PROJECT_DIR || cwd || ''
}

/** Разобранный флаг параллельных сессий или null (нет флага = нет параллели). */
export function readFlag(root) {
  try {
    return JSON.parse(readFileSync(resolve(root, FLAG_REL), 'utf8'))
  } catch {
    return null
  }
}

/** mtime файла в мс или null, если файла нет. */
export function statMtimeMs(p) {
  try {
    return statSync(p).mtimeMs
  } catch {
    return null
  }
}

/**
 * Пере-проверка живости по флагу: флаг это снимок на старте сессии, живой
 * считается только та сессия, чей лог всё ещё трогают. Протухший флаг никогда
 * не даёт предупреждения.
 */
export function liveSessionsFromFlag({
  flag,
  sessionId,
  statMtime,
  nowMs,
  freshWindowMs = FRESH_WINDOW_MS,
}) {
  if (!flag || !Array.isArray(flag.sessions)) return []
  return flag.sessions.filter((s) => {
    if (!s || !s.logPath || s.id === sessionId) return false
    const m = statMtime(s.logPath)
    return m != null && nowMs - m <= freshWindowMs
  })
}

/** Путь per-session state-файла; id санируется до безопасного имени. */
export function stateFilePath(root, dirRel, sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')
  return resolve(root, dirRel, `${safe}.json`)
}

/** Прочитать state-объект; нет файла / битый JSON → {} (fail-open). */
export function readState(path, readFile = (p) => readFileSync(p, 'utf8')) {
  try {
    const s = JSON.parse(readFile(path))
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

/** Записать state (best-effort). Ошибка записи никогда не роняет вызов. */
export function writeState(path, state, deps = {}) {
  const mkdir = deps.mkdir || ((d) => mkdirSync(d, { recursive: true }))
  const writeFile = deps.writeFile || ((p, c) => writeFileSync(p, c))
  try {
    mkdir(dirname(path))
    writeFile(path, JSON.stringify(state))
  } catch {
    // fail-open: состояние — вспомогательное, его потеря не повод падать
  }
}

/**
 * PreToolUse-предупреждение: только `systemMessage`, БЕЗ `hookSpecificOutput`.
 *
 * `permissionDecision: "allow"` — это не «промолчать», а активное разрешение
 * вызова в обход обычного разрешительного потока владельца: WARN-гард на
 * `gh pr merge` или на третьей правке лида преавторизовал бы ровно тот вызов,
 * который он же пометил как подозрительный. Нейтральное значение называется
 * `"defer"` и по справочнику эквивалентно «exit 0 без вывода», поэтому блок
 * решения тут не нужен вовсе — предупреждение доходит через `systemMessage`,
 * а разрешение остаётся за владельцем. Форма закреплена тестом (ревью PR #99).
 */
export function emitWarn(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }))
}

/** Env-переменная общего рубильника: выключает ВЕСЬ стек хуков. */
export const HOOKS_DISABLE_ENV = 'BBM_HOOKS_DISABLE'

/**
 * Общий рубильник (ревью PR #99): `.claude/settings.json` закоммичен, то есть
 * стек включается у владельца сам и меняет поведение его сессий, а четыре хука
 * жёстко блокируют. Один env-выключатель уважают все десять хуков — это выход
 * из положения, когда гард ошибается, а чинить его прямо сейчас некогда.
 */
export function hooksDisabled(env = process.env) {
  const v = env && env[HOOKS_DISABLE_ENV]
  return v === '1' || v === 'true' || v === 'yes'
}

/** Payload хука со stdin; любая ошибка разбора — забота вызывающего main(). */
export function applyPatchPaths(command) {
  const paths = []
  for (const line of String(command || '').split(/\r?\n/)) {
    const match = /^\*\*\*\s+(?:Add|Update|Delete) File:\s*(.+?)\s*$/.exec(line)
    const move = /^\*\*\*\s+Move to:\s*(.+?)\s*$/.exec(line)
    const path = (match || move)?.[1]
    if (path && !paths.includes(path)) paths.push(path)
  }
  return paths
}

/**
 * Adapt the small set of Codex canonical tool payloads to the Claude-shaped
 * contracts consumed by the existing hook stack. Unknown payloads pass
 * through unchanged so the stack remains fail-open as tools evolve.
 */
export function normalizeHookPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const toolName = String(payload.tool_name || '')
  const sourceInput =
    payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {}
  let normalizedName = toolName
  let toolInput = sourceInput

  if (toolName === 'apply_patch') {
    const filePaths = applyPatchPaths(sourceInput.command)
    normalizedName = 'MultiEdit'
    toolInput = {
      ...sourceInput,
      file_path: filePaths[0] || '',
      file_paths: filePaths,
    }
  } else if (toolName === 'spawn_agent') {
    normalizedName = 'Agent'
    toolInput = {
      ...sourceInput,
      prompt: sourceInput.prompt || sourceInput.message || '',
      subagent_type: sourceInput.subagent_type || sourceInput.task_name || '',
    }
  } else if (['shell_command', 'exec_command', 'shell'].includes(toolName)) {
    normalizedName = 'Bash'
  } else if (toolName === 'request_user_input') {
    normalizedName = 'AskUserQuestion'
  }

  if (normalizedName === toolName && toolInput === sourceInput) return payload
  return {
    ...payload,
    harness_tool_name: toolName,
    tool_name: normalizedName,
    tool_input: toolInput,
  }
}

export function readHookPayload() {
  return normalizeHookPayload(JSON.parse(readFileSync(0, 'utf8')))
}

/**
 * Entry-point guard: main() исполняется только при прямом запуске файла, чтобы
 * спеки могли импортировать чистые seam-функции без чтения stdin и process.exit.
 */
export function isDirectRun(metaUrl) {
  const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : ''
  return Boolean(invoked) && invoked === norm(fileURLToPath(metaUrl))
}
