#!/usr/bin/env node
// Хук SessionStart + UserPromptSubmit (issue #91, пункт 1): пишет машиночитаемый
// флаг живых параллельных сессий, на который опираются PreToolUse-гарды
// (`worktree-path-guard.mjs`, `main-tree-read-guard.mjs`).
//
// Почему ДВА события (ревью PR #99): снимок только на старте не покрывает самый
// частый случай — ровно две сессии. A стартует одна (флаг удалён), затем
// стартует B и пишет флаг со списком [A]; A читает флаг, вычёркивает себя и
// видит ноль живых — то есть долгоживущий лид в общем чекауте не узнаёт о
// параллели никогда. Перезапись флага на каждый пользовательский промпт чинит
// это без единой строки кода: A обновляет собственный снимок на следующем
// промпте и видит B. Альтернатива — пересканировать каталог логов в каждом
// гарде на каждый Read/Grep/Glob — дороже и на горячем пути.
//
// Симптом-первопричина: за неделю четыре инцидента общего чекаута — force-push
// по ветке чужой сессии, субагент переключил ветку под живым стендом приёмки,
// чекаут уехал на чужую ветку посреди приёмки владельца
// (`.claude/rules/parallel-sessions.md`). Гард не может сам узнать, сколько
// сессий живо, — этот writer сканирует логи сессий Claude Code и оставляет
// снимок; гарды перепроверяют свежесть по mtime, поэтому протухший флаг молчит.
//
// Мини-порт ds-platform `tools/agent-bootstrap.ts` (только parallel-flag,
// без board rollup). Контракт: stdin — JSON SessionStart ({session_id, cwd}).
// Всегда exit 0 — SessionStart-хук ничего не блокирует. FAIL-OPEN.

import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import {
  FLAG_REL,
  FRESH_WINDOW_MS,
  HOOK_SESSION_REGISTRY_DIR_REL,
  hooksDisabled,
  isDirectRun,
  mainRepoRoot,
  readHookPayload,
  readState,
  stateFilePath,
  statMtimeMs,
  writeState,
} from './shared.mjs'

/** Единый источник истины с гардами (равенство закреплено тестом). */
export const PARALLEL_FLAG_REL = FLAG_REL
export const SESSION_WINDOW_MS = FRESH_WINDOW_MS

/**
 * Кодирование абсолютного пути так, как Claude Code именует каталог логов под
 * `~/.claude/projects/` — каждый не-алфацифровой символ становится дефисом
 * (`C:\Users\…\bbm-portal` → `C--Users-…-bbm-portal`).
 */
export function encodeProjectSlug(absPath) {
  return String(absPath).replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Каталог логов принадлежит ЭТОМУ репо: либо ровно слаг основного дерева, либо
 * его worktree-сосед `…--claude-worktrees-<name>`. Голый `startsWith` поймал бы
 * и соседний репозиторий (`…-bbm-portal-2`), поэтому суффикс проверяется явно.
 */
export function isRepoSessionDir(dirName, mainSlug) {
  return dirName === mainSlug || dirName.startsWith(`${mainSlug}--claude-worktrees-`)
}

/**
 * Чистый seam: живые чужие сессии из списка логов. Живая — та, чей лог трогали
 * не позже окна; сдвиг часов в будущее считается живым, но никогда не
 * отрицательным. Своя сессия исключается по id (пустой selfId не исключает
 * ничего — пере-счёт безопаснее недо-счёта).
 */
export function liveSessions(logs, { nowMs, windowMs = SESSION_WINDOW_MS, selfId = '' }) {
  return logs.filter((l) => l && l.id !== selfId && nowMs - l.mtimeMs <= windowMs)
}

/** Тело флага в форме, которую читают гарды. */
export function buildParallelFlag(live, generatedAt) {
  return {
    generatedAt,
    liveSessions: live.length,
    sessions: live.map((l) => ({ id: l.id, logPath: l.logPath })),
  }
}

/** Сканирует `~/.claude/projects/**` и возвращает логи сессий этого репо. */
export function collectSessionLogs(mainRoot, deps = {}) {
  const projectsDir = deps.projectsDir || resolve(homedir(), '.claude', 'projects')
  const readdir = deps.readdir || ((p, o) => readdirSync(p, o))
  const mtime = deps.statMtime || statMtimeMs
  const mainSlug = encodeProjectSlug(mainRoot)
  const logs = []
  let dirs = []
  try {
    dirs = readdir(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isRepoSessionDir(d.name, mainSlug))
      .map((d) => d.name)
  } catch {
    return logs
  }
  for (const dir of dirs) {
    const full = resolve(projectsDir, dir)
    let files = []
    try {
      files = readdir(full).filter((f) => String(f).endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const logPath = resolve(full, f)
      const m = mtime(logPath)
      if (m == null) continue
      logs.push({ id: String(f).replace(/\.jsonl$/, ''), mtimeMs: m, logPath })
    }
  }
  return logs
}

/** Register the stable transcript path supplied by either hook harness. */
export function registerSessionLog(mainRoot, payload, deps = {}) {
  try {
    const id = payload && payload.session_id
    const logPath = payload && payload.transcript_path
    if (!mainRoot || !id || !logPath) return false
    const path = stateFilePath(mainRoot, HOOK_SESSION_REGISTRY_DIR_REL, id)
    const write = deps.writeState || writeState
    write(path, { id, logPath })
    return true
  } catch {
    return false
  }
}

/** Read registered Claude/Codex logs without depending on either JSONL shape. */
export function collectRegisteredSessionLogs(mainRoot, deps = {}) {
  const readdir = deps.readdir || ((p) => readdirSync(p))
  const mtime = deps.statMtime || statMtimeMs
  const read = deps.readState || readState
  const dir = resolve(mainRoot, HOOK_SESSION_REGISTRY_DIR_REL)
  let files = []
  try {
    files = readdir(dir).filter((file) => String(file).endsWith('.json'))
  } catch {
    return []
  }
  const logs = []
  for (const file of files) {
    const state = read(resolve(dir, file))
    if (!state.id || !state.logPath) continue
    const mtimeMs = mtime(state.logPath)
    if (mtimeMs == null) continue
    logs.push({ id: state.id, logPath: state.logPath, mtimeMs })
  }
  return logs
}

export function mergeSessionLogs(...sets) {
  const byPath = new Map()
  for (const log of sets.flat()) {
    if (!log || !log.logPath) continue
    byPath.set(log.logPath, log)
  }
  return [...byPath.values()]
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    let payload = {}
    try {
      payload = readHookPayload() || {}
    } catch {
      payload = {}
    }
    const cwd = payload.cwd || process.cwd()
    const mainRoot = mainRepoRoot(cwd)
    if (!mainRoot) process.exit(0)
    const selfId = payload.session_id || process.env.CLAUDE_CODE_SESSION_ID || ''
    registerSessionLog(mainRoot, payload)
    const logs = mergeSessionLogs(
      collectSessionLogs(mainRoot),
      collectRegisteredSessionLogs(mainRoot),
    )
    const live = liveSessions(logs, {
      nowMs: Date.now(),
      selfId,
    })
    const flagPath = resolve(mainRoot, PARALLEL_FLAG_REL)
    if (live.length > 0) {
      const flag = buildParallelFlag(live, new Date().toISOString())
      writeFileSync(flagPath, JSON.stringify(flag, null, 2) + '\n', 'utf8')
    } else {
      // Нет параллели — флаг убирается, гарды молчат.
      rmSync(flagPath, { force: true })
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: старт сессии не ломается из-за бага хука
  }
}

if (isDirectRun(import.meta.url)) main()
