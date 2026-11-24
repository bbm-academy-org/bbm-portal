#!/usr/bin/env node
// PreToolUse-гард на Edit|Write|MultiEdit (+ Bash|PowerShell под Codex) — issue
// #91, пункт 2; v2 в #594. Порт ds-platform tools/hooks/worktree-path-guard.mjs.
// Две независимые обязанности.
//
// 1. Isolation BLOCK (exit 2). Симптом-первопричина: `EnterWorktree` меняет cwd
//    сессии, но НЕ перенаправляет абсолютные пути — Edit/Write с абсолютным
//    путём в основное дерево (притащенным из более раннего Read/Bash) молча
//    пишет в общий чекаут. Оттуда чужая параллельная сессия сметает правку в
//    свой PR, а любой «зелёный», увиденный там, относится к чужому чекауту
//    (`.claude/rules/parallel-sessions.md`). Ловится в момент выдачи пути.
//
//    v2 (#594) классифицирует цель по КОРНЯМ, которые git знает
//    (`git worktree list --porcelain`), а путь — по реальному месту на диске
//    (`canonicalPath` разворачивает junction/symlink-предков, так что новый
//    файл под junction, ведущим из worktree в общий чекаут, ловится). Три
//    вердикта на одну цель — `classifyWritePath`:
//      - `ok`: свой worktree, вне репо, либо сессия общего чекаута (она может
//        писать и в общий чекаут — это WARN пункта 2 — и в любой
//        зарегистрированный worktree, ds #2373);
//      - `main-tree-escape`: сессия в worktree пишет в ОБЩИЙ чекаут — прежний
//        блок #91, прежний текст;
//      - `wrong-worktree`: субагент или сессия, запущенная в worktree A, пишет в
//        ДРУГОЙ зарегистрированный worktree B (ds #1453; охват — ниже) — отдельное сообщение, потому что это не побег в
//        общий чекаут, а сессия не в том дереве; лекарство — `EnterWorktree`.
//    РЕАЛЬНЫЙ охват `wrong-worktree` (review PR #595): (а) субагенты — в
//    payload есть `agent_id`; (б) сессии, ЗАПУЩЕННЫЕ внутри worktree
//    (`CLAUDE_PROJECT_DIR` = этот worktree); (в) Codex (`CLAUDE_PROJECT_DIR`
//    нет). Лид, запущенный в ОБЩЕМ чекауте (`CLAUDE_PROJECT_DIR` = основной
//    корень, без `agent_id`), освобождён ПО ЗАМЫСЛУ — в том числе когда он
//    вошёл в worktree через `EnterWorktree`: Claude Code оставляет
//    `CLAUDE_PROJECT_DIR` на корне запуска, а `cwd` следует за сессией, так что
//    для хука это та же форма, что cwd-дрейф по Bash `cd` (#187). Причина
//    исключения: лид этого репо законно оркеструет несколько task-worktree из
//    одной сессии (по одной попытке в каждом, `.claude/rules/lead-delegation.md`
//    §1), и блок здесь бил бы ровно по этой работе. Цена — такой лид из своего
//    worktree не защищён от записи в worktree другой сессии; закрыть это можно
//    только настоящим источником личности (например, запись `session_id → root`
//    на `EnterWorktree`), а не cwd. Субагент (`agent_id` есть) наследует
//    `CLAUDE_PROJECT_DIR` лида, поэтому для него удостоверяет cwd — ровно
//    случай ds #1453. Сессия, чей собственный worktree уже снят (cwd не
//    под зарегистрированным корнем), и цель в незарегистрированном
//    worktree-образном каталоге `wrong-worktree` не получают: личность не
//    установлена, а «чужого» дерева, которое можно испортить, нет.
//
//    Shell-запись (Codex `exec_command`/`shell_command`, нормализуется в Bash):
//    литеральный писатель (`Set-Content`/`touch`/`mkdir`/`rm` …) классифицируется
//    по цели, как Edit. Запись, которую ограниченный парсер изолировать НЕ
//    может (цепочка, перенаправление, `mv`/`cp`, `Remove-Item`, интерпретатор,
//    `git checkout|reset|…`), отказывается — `unparseable-shell` — но только
//    если команда ВИДИМО достаёт до защищённого дерева: абсолютный путь или
//    `..`-путь в общий чекаут / чужой worktree, либо переменная
//    `CLAUDE_PROJECT_DIR`. Запись в свой worktree или вне репо проходит.
//
// 2. Write-WARN (exit 0 + systemMessage). Первая запись в основное дерево в
//    НЕизолированной сессии при живой параллели: предупреждение один раз плюс
//    отметка `mainTreeWriteSeen` в per-session state. Только WARN.
//
// Контракт: stdin — JSON PreToolUse ({session_id, cwd, tool_name, tool_input,
// agent_id?}). exit 2 + stderr = BLOCK. exit 0 (+ опциональный systemMessage) =
// разрешено. FAIL-OPEN: ошибка гарда, недоступный git или непрочитанный путь —
// это exit 0 (git недоступен → классификация по форме пути, как в v1), а не блок.

import { execFileSync } from 'node:child_process'

import {
  FRESH_WINDOW_MS,
  MAIN_TREE_STATE_DIR_REL,
  absolutePath,
  canonicalPath,
  emitWarn,
  hooksDisabled,
  inWorktree,
  isDirectRun,
  isUnder,
  liveSessionsFromFlag,
  mainRepoRoot,
  norm,
  readFlag,
  readHookPayload,
  readState,
  shellCommand,
  shellMutationPaths,
  stateFilePath,
  statMtimeMs,
  targetPath,
  writeState,
} from './shared.mjs'

const WORKTREE_SHAPE_RE = /^(.*)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/

const samePath = (a, b) => Boolean(a) && Boolean(b) && norm(a) === norm(b)

/**
 * Roots of every LIVE checkout git knows (main tree first, then the linked
 * worktrees) from `git worktree list --porcelain`. A `prunable` entry — its
 * directory is gone — is dropped: it is nobody's checkout any more. `exec` is
 * the injected seam. FAIL-OPEN to `[]`; the caller then classifies by shape.
 */
export function gitWorktreeRoots(cwd, exec) {
  try {
    const out = exec
      ? exec(cwd)
      : execFileSync('git', ['worktree', 'list', '--porcelain'], {
          cwd,
          encoding: 'utf8',
          timeout: 5_000,
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        })
    const roots = []
    for (const block of String(out).split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/)
      const head = lines.find((line) => line.startsWith('worktree '))
      if (!head || lines.some((line) => line.startsWith('prunable'))) continue
      const root = head.slice('worktree '.length).trim()
      if (root) roots.push(root)
    }
    return roots
  } catch {
    return []
  }
}

/** The `<…>/.claude/worktrees/<name>` root a path sits in, or "" — the shape fallback. */
export function worktreeRootOfPath(p) {
  const m = String(p || '').match(WORKTREE_SHAPE_RE)
  return m ? `${m[1]}/.claude/worktrees/${m[2]}` : ''
}

/** The longest candidate root that contains `target`, or "" when none does. */
export function owningRoot(target, roots) {
  let best = ''
  for (const root of roots) {
    if (root && isUnder(target, root) && norm(root).length > norm(best).length) best = root
  }
  return best
}

/**
 * Who is writing. `roots` are the git-registered roots (`[]` when git is
 * unavailable); `sessionRoot` is the registered root that contains cwd (`""`
 * when none does); `launchRoot` is `CLAUDE_PROJECT_DIR`; `agentId` the payload's
 * `agent_id`. All paths must already be in the same (canonical) form.
 *
 * @param {{ cwd?: string, roots?: string[], sessionRoot?: string, launchRoot?: string, agentId?: string }} args
 */
export function isolationContext({
  cwd,
  roots = [],
  sessionRoot = '',
  launchRoot = '',
  agentId = '',
}) {
  const known = (roots || []).filter(Boolean)
  const shapedCwd = String(cwd || '').match(WORKTREE_SHAPE_RE)
  const mainRoot = known[0] || (shapedCwd ? shapedCwd[1] : '')
  const session =
    sessionRoot ||
    worktreeRootOfPath(cwd) ||
    (mainRoot && cwd && isUnder(cwd, mainRoot) ? mainRoot : '')
  return {
    mainRoot,
    sessionRoot: session,
    roots: known,
    pinned: Boolean(mainRoot && session && !samePath(session, mainRoot)),
    sessionRegistered: known.some((r) => samePath(r, session)),
    leadFromMain: !agentId && samePath(launchRoot, mainRoot),
  }
}

/**
 * Verdict for ONE (canonical) write target — see the header for the three.
 *
 * @param {string} target
 * @param {ReturnType<typeof isolationContext>} ctx
 * @returns {{ verdict: 'ok' | 'main-tree-escape' | 'wrong-worktree', targetRoot?: string }}
 */
export function classifyWritePath(target, ctx) {
  if (!ctx.pinned) return { verdict: 'ok' }
  const candidates = [ctx.mainRoot, ctx.sessionRoot, ...ctx.roots, worktreeRootOfPath(target)]
  const owner = owningRoot(target, candidates.filter(Boolean))
  if (!owner || samePath(owner, ctx.sessionRoot)) return { verdict: 'ok' }
  if (samePath(owner, ctx.mainRoot)) return { verdict: 'main-tree-escape' }
  const registered = ctx.roots.some((r) => samePath(r, owner))
  if (!registered || !ctx.sessionRegistered || ctx.leadFromMain) return { verdict: 'ok' }
  return { verdict: 'wrong-worktree', targetRoot: owner }
}

/**
 * Paths a shell command visibly reaches: absolute (drive, POSIX, MSYS `/c/…`
 * when cwd is a drive path) and `..`-traversal tokens resolved against cwd, plus
 * the main root when the command names `CLAUDE_PROJECT_DIR` / `CODEX_PROJECT_DIR`
 * (a subagent inherits the lead's, which is the main checkout). Used only to
 * decide whether an UNPARSEABLE write is relevant.
 */
export function commandReachPaths(command, cwd, mainRoot = '') {
  const text = String(command || '')
  const out = []
  const push = (p) => {
    const abs = absolutePath(p, cwd)
    if (!out.includes(abs)) out.push(abs)
  }
  const driveCwd = /^[a-zA-Z]:[\\/]/.test(String(cwd || ''))
  for (const token of text.split(/[\s'"`;|&<>(){},=]+/)) {
    if (!token || token.startsWith('$')) continue
    if (/^[a-zA-Z]:[\\/]/.test(token)) push(token)
    else if (token.startsWith('/')) {
      const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(token)
      push(msys && driveCwd ? `${msys[1]}:${msys[2] || '/'}` : token)
    } else if (/(^|[\\/])\.\.([\\/]|$)/.test(token)) push(token)
  }
  if (mainRoot && /\b(?:CLAUDE|CODEX)_PROJECT_DIR\b/.test(text) && !out.includes(mainRoot)) {
    out.push(mainRoot)
  }
  return out
}

/** Write targets of a tool call: `{ paths, unparseable, execCwd }`. */
export function writeCandidates(toolName, toolInput, cwd) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {}
  if (/^(Bash|PowerShell)$/.test(toolName || '')) {
    const execCwd = input.workdir || input.cwd || cwd
    const paths = Array.isArray(input.file_paths) ? input.file_paths.filter(Boolean) : []
    let unparseable = ''
    try {
      for (const p of shellMutationPaths(input, execCwd || '.')) paths.push(p)
    } catch (error) {
      unparseable = (error && error.message) || 'an unparseable shell write'
    }
    return { paths, unparseable, execCwd }
  }
  if (!/^(Edit|Write|MultiEdit)$/.test(toolName || '')) {
    return { paths: [], unparseable: '', execCwd: cwd }
  }
  const paths = Array.isArray(input.file_paths) ? input.file_paths : [input.file_path || '']
  return { paths: paths.filter(Boolean), unparseable: '', execCwd: cwd }
}

/**
 * Pure decision seam of duty 1. Returns `{block:false}` (nothing to check),
 * `{block:false, inWorktreeSession:false}` (a main-tree / unplaced session —
 * duty 2 decides), `{block:false, inWorktreeSession:true}` (isolated and clean),
 * or `{block:true, verdict, filePath, mainRoot, sessionRoot, worktreeName,
 * targetRoot?, reason?}`. `canonical` maps a resolved path to its real
 * location (identity in the pure specs; `canonicalPath` in main()).
 *
 * @param {{ toolName?: string, toolInput?: any, cwd?: string, roots?: string[],
 *   sessionRoot?: string, launchRoot?: string, agentId?: string,
 *   canonical?: (p: string) => string }} args
 * @returns {{ block: boolean, inWorktreeSession?: boolean, verdict?: string,
 *   filePath?: string, mainRoot?: string, sessionRoot?: string,
 *   worktreeName?: string, targetRoot?: string, reason?: string }}
 */
export function decideEscapeBlock({
  toolName,
  toolInput,
  cwd,
  roots = [],
  sessionRoot = '',
  launchRoot = '',
  agentId = '',
  canonical = (p) => p,
}) {
  if (!/^(Edit|Write|MultiEdit|Bash|PowerShell)$/.test(toolName || '')) return { block: false }
  const { paths, unparseable, execCwd } = writeCandidates(toolName, toolInput, cwd)
  if (paths.length === 0 && !unparseable) return { block: false }
  if (!cwd) return { block: false }
  const ctx = isolationContext({ cwd, roots, sessionRoot, launchRoot, agentId })
  if (!ctx.pinned) return { block: false, inWorktreeSession: false }
  const shape = String(ctx.sessionRoot).match(WORKTREE_SHAPE_RE)
  const blocked = (verdict, filePath, extra = {}) => ({
    block: true,
    verdict,
    filePath,
    mainRoot: ctx.mainRoot,
    sessionRoot: ctx.sessionRoot,
    worktreeName: shape ? shape[2] : ctx.sessionRoot,
    ...extra,
  })
  for (const p of paths) {
    const target = canonical(absolutePath(String(p), execCwd || cwd))
    const v = classifyWritePath(target, ctx)
    if (v.verdict !== 'ok') return blocked(v.verdict, target, { targetRoot: v.targetRoot })
  }
  if (unparseable) {
    const command = shellCommand(toolInput || {})
    for (const p of commandReachPaths(command, execCwd || cwd, ctx.mainRoot)) {
      const reached = canonical(p)
      if (classifyWritePath(reached, ctx).verdict !== 'ok') {
        return blocked('unparseable-shell', reached, { reason: unparseable })
      }
    }
  }
  return { block: false, inWorktreeSession: true }
}

export function escapeBlockMessage(filePath, mainRoot, worktreeName) {
  return (
    `BLOCKED (#91): '${filePath}' — абсолютный путь в ОБЩИЙ основной чекаут (вне ` +
    `'${mainRoot}\\.claude\\worktrees\\'), а cwd этой сессии стоит в worktree.\n` +
    `Побег в общий чекаут: чужая параллельная сессия сметёт правку в свой PR, ` +
    `а «зелёный» там относится к чужому чекауту (.claude/rules/parallel-sessions.md).\n` +
    `Пиши в worktree: относительный путь от его корня либо префикс ` +
    `'${mainRoot}\\.claude\\worktrees\\${worktreeName}\\…'.\n`
  )
}

/** `EnterWorktree path:` argument for a checkout root. */
export function enterWorktreeArg(root) {
  const m = String(root).match(/[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/)
  return m ? `.claude/worktrees/${m[1]}` : String(root)
}

export function wrongWorktreeMessage(target, targetRoot, currentRoot) {
  return (
    `BLOCKED (wrong-worktree, #594): '${target}' belongs to ANOTHER worktree ` +
    `('${targetRoot}'), but this session is pinned to '${currentRoot}'.\n` +
    `This is NOT a main-tree escape — the path is fine, the session is in the wrong ` +
    `checkout (typically a dispatch that inherited a stale cwd; ds-platform #1453). ` +
    `Writing here would land the edit on the other worktree's branch — another ` +
    `session's work (.claude/rules/parallel-sessions.md).\n` +
    `If that worktree is yours, switch the session to it and re-issue the write: ` +
    `EnterWorktree path:${enterWorktreeArg(targetRoot)}\n` +
    `A SUBAGENT cannot switch worktrees: stop and return to the lead naming the ` +
    `target path — the lead re-dispatches into the right worktree.\n` +
    `Do NOT author the file elsewhere (scratchpad, main tree) and copy it in.\n`
  )
}

export function unparseableShellMessage(reason, reachedPath, sessionRoot) {
  return (
    `BLOCKED (unparseable-shell, #594): ${reason} — and the command reaches ` +
    `'${reachedPath}', outside this session's worktree ('${sessionRoot}').\n` +
    `The guard cannot tell where such a write lands, so it does not let it near the ` +
    `shared checkout or another session's worktree (.claude/rules/parallel-sessions.md).\n` +
    `Use the file tools (Edit / Write / apply_patch) or ONE literal writer ` +
    `(Set-Content -LiteralPath '<path>' …, touch, mkdir, rm) with a path inside your worktree.\n`
  )
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

function blockMessage(escape) {
  if (escape.verdict === 'wrong-worktree') {
    return wrongWorktreeMessage(escape.filePath, escape.targetRoot, escape.sessionRoot)
  }
  if (escape.verdict === 'unparseable-shell') {
    return unparseableShellMessage(escape.reason, escape.filePath, escape.sessionRoot)
  }
  return escapeBlockMessage(escape.filePath, escape.mainRoot, escape.worktreeName)
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const tool = payload.tool_name || ''
    if (!/^(Edit|Write|MultiEdit|Bash|PowerShell)$/.test(tool)) process.exit(0)
    const rawCwd = payload.cwd || ''
    // A shell call that writes nothing recognisable costs no git spawn.
    const candidates = writeCandidates(tool, payload.tool_input, rawCwd)
    if (candidates.paths.length === 0 && !candidates.unparseable) process.exit(0)

    const cwd = rawCwd ? canonicalPath(rawCwd) : ''
    const roots = cwd ? gitWorktreeRoots(cwd).map(canonicalPath) : []
    const escape = decideEscapeBlock({
      toolName: tool,
      toolInput: payload.tool_input,
      cwd,
      roots,
      sessionRoot: owningRoot(cwd, roots),
      launchRoot: process.env.CLAUDE_PROJECT_DIR
        ? canonicalPath(process.env.CLAUDE_PROJECT_DIR)
        : '',
      agentId: payload.agent_id || '',
      canonical: canonicalPath,
    })
    if (escape.block) {
      process.stderr.write(blockMessage(escape))
      process.exit(2)
    }
    // Сессия в worktree с корректным путём — изолирована, предупреждать не о чем.
    if (escape.inWorktreeSession) process.exit(0)

    const projectDir = mainRepoRoot(rawCwd)
    const decision = decideWriteWarn({
      toolName: tool,
      toolInput: payload.tool_input,
      cwd: rawCwd,
      sessionId: payload.session_id || '',
      projectDir,
      flag: readFlag(projectDir),
      statMtime: statMtimeMs,
      nowMs: Date.now(),
    })
    if (decision.warn) {
      const statePath = stateFilePath(projectDir, MAIN_TREE_STATE_DIR_REL, payload.session_id || '')
      const state = readState(statePath)
      // Предупреждаем один раз — на ПЕРВОЙ записи; `mainTreeWriteSeen` — защёлка.
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

export function writeWarnMessage(liveCount) {
  return (
    `⚠ main-tree write guard (#91): живых параллельных сессий — ${liveCount}, а эта сессия ` +
    `ПИШЕТ исходники в ОБЩЕМ основном чекауте без изоляции. Carve-out read-only оркестрации ` +
    `закончился — гард снова в полную силу. Изолируйся до дальнейших правок: ` +
    `\`pnpm task:worktree <N>\` → \`EnterWorktree path:.claude/worktrees/<N>\` ` +
    `(.claude/rules/parallel-sessions.md). Только предупреждение.`
  )
}

if (isDirectRun(import.meta.url)) main()
