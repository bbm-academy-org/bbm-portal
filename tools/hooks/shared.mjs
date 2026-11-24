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

import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, posix, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Файл-флаг живых параллельных сессий; пишет `session-flag-writer.mjs`. */
export const FLAG_REL = '.claude/parallel-sessions.flag.json'

/** Сессия считается живой, если её .jsonl трогали не позже этого окна.
 * Единственный источник истины: writer переэкспортирует эту же константу. */
export const FRESH_WINDOW_MS = 10 * 60 * 1000

/** Каталог per-session состояния write-WARN гарда (`{mainTreeWriteSeen}` — «уже предупредили»). */
export const MAIN_TREE_STATE_DIR_REL = '.claude/main-tree-guard-state'

/** Каталог per-session состояния dispatch-гарда (`{streak}`). */
export const DISPATCH_STATE_DIR_REL = '.claude/dispatch-guard-state'

/** Каталог per-session состояния zero-dispatch-гарда (#322):
 * `{mutations, dispatched, bypassUsed}` — накопительный счёт мутаций лида,
 * флаг «диспатч в этой сессии уже был» и израсходованная причина побега. */
export const ZERO_DISPATCH_STATE_DIR_REL = '.claude/zero-dispatch-guard-state'

/** Per-session state of the AskUserQuestion guard (`{headers: {<header>: len}}`). */
export const ASKUSERQUESTION_STATE_DIR_REL = '.claude/askuserquestion-guard-state'

/** Stable Codex executor-turn markers recorded from SubagentStart until SessionEnd. */
export const CODEX_EXECUTOR_TURN_DIR_REL = '.claude/codex-executor-turns'

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
 * Предупреждение БЕЗ блока: только `systemMessage`, БЕЗ `hookSpecificOutput`.
 * Пользователи — PreToolUse-гарды. (Stop-гейты, которые с #392 тоже
 * демотировали сюда свой повторный блок, выведены из эксплуатации в #589.)
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

/** Literal targets of common PowerShell content-writing cmdlets. */
export function powershellFileWritePaths(command) {
  const paths = []
  const segments = []
  let tokens = []
  let token = ''
  let tokenQuoted = false
  let quote = ''
  const source = String(command || '')
  const pushToken = () => {
    if (token) tokens.push({ quoted: tokenQuoted, value: token })
    token = ''
    tokenQuoted = false
  }
  const pushSegment = () => {
    pushToken()
    if (tokens.length > 0) segments.push(tokens)
    tokens = []
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '`' && index + 1 < source.length) token += source[++index]
      else if (char === quote) {
        if (quote === "'" && source[index + 1] === "'") token += source[++index]
        else quote = ''
      } else token += char
    } else if (char === "'" || char === '"') {
      quote = char
      tokenQuoted = true
    } else if (char === '<' && source[index + 1] === '#') {
      const end = source.indexOf('#>', index + 2)
      if (end < 0) break
      index = end + 1
    } else if (char === '#') {
      pushSegment()
      while (index + 1 < source.length && source[index + 1] !== '\n') index += 1
    } else if (char === ';' || char === '|' || char === '\n') {
      pushSegment()
    } else if (/\s/.test(char)) {
      pushToken()
    } else {
      token += char
    }
  }
  pushSegment()

  for (const segmentTokens of segments) {
    const offset = segmentTokens[0]?.value === '&' ? 1 : 0
    if (!/^(?:Set-Content|Add-Content|Out-File)$/i.test(segmentTokens[offset]?.value || ''))
      continue
    const pathFlagIndex = segmentTokens.findIndex(
      (tokenPart, index) =>
        index > offset &&
        !tokenPart.quoted &&
        /^-(?:LiteralPath|Path|FilePath)$/i.test(String(tokenPart.value || '')),
    )
    const path = pathFlagIndex >= 0 ? segmentTokens[pathFlagIndex + 1]?.value : ''
    if (!path || /[$*?\[\]`]/.test(path)) continue
    if (path && !paths.includes(path)) paths.push(path)
  }
  return paths
}

/**
 * Resolve `value` against `cwd` with the path flavour the paths themselves use:
 * a drive-letter path is resolved as win32 on every platform, so a spec with
 * `C:/…` fixtures reads the same on the Linux CI runner (ds-platform
 * `hook-compat.mjs`).
 */
export function absolutePath(value, cwd) {
  const api = /^[a-zA-Z]:[\\/]/.test(value) || /^[a-zA-Z]:[\\/]/.test(cwd) ? win32 : posix
  return api.resolve(cwd || '.', value)
}

/**
 * The real filesystem location of `value`, resolving every EXISTING ancestor —
 * so a new file under a junction / symlink that points out of a worktree is
 * classified where it would actually land (#594, ported from ds-platform
 * `hook-compat.mjs`). A path that is not absolute for this platform (a `C:/…`
 * fixture on Linux) and any IO error return the path unchanged: canonicalisation
 * only ever adds precision, it never turns into a reason to block.
 *
 * The ancestor is resolved with `realpathSync.native` (review PR #595): unlike
 * the JS `realpathSync` it expands an 8.3 short name (`BBM-PO~1` → `bbm-portal`)
 * and returns the on-disk case, so the short form of a checkout compares equal
 * to its registered root. If the native call fails, the JS one is the fallback.
 */
export function canonicalPath(value) {
  try {
    if (!isAbsolute(String(value))) return String(value)
    let parent = resolve(value)
    const tail = []
    while (!existsSync(parent)) {
      const up = dirname(parent)
      if (up === parent) return resolve(value)
      tail.unshift(parent.slice(up.length).replace(/^[\\/]/, ''))
      parent = up
    }
    return join(realAncestor(parent), ...tail)
  } catch {
    return String(value)
  }
}

function realAncestor(p) {
  try {
    return realpathSync.native(p)
  } catch {
    return realpathSync(p)
  }
}

/** The command string of a shell tool input (Claude `command`, Codex `cmd`). */
export function shellCommand(input) {
  return typeof input === 'string' ? input : (input?.command ?? input?.cmd)
}

/**
 * Bounded literal shell-writer parser (#594, ported from ds-platform
 * `tools/hooks/shell-mutations.mjs`) — not a shell grammar and not a security
 * boundary. Returns the absolute targets of ONE literal writer
 * (`Set-Content`/`Add-Content`/`Out-File`/`Clear-Content`, `touch`/`mkdir`/`rm`/
 * `rmdir`), `[]` for a command that writes nothing it recognises, and THROWS
 * (the message is the reason) for a write it cannot isolate: a chained /
 * redirected / dynamic writer, a move or copy, an interpreter write, a
 * `git checkout|switch|restore|reset|clean|apply|read-tree`. What a throw costs
 * is the caller's decision — `worktree-path-guard.mjs` refuses it only when the
 * command visibly reaches a protected checkout.
 *
 * bbm adaptation: the read/checkpoint fast path also accepts `git -C <path> …`,
 * the form `.claude/rules/dev-env.md` mandates, so a commit message that merely
 * mentions `rm` is not mistaken for a write.
 */
export function shellMutationPaths(input, cwd) {
  const command = shellCommand(input)
  if (typeof command !== 'string') throw new Error('unparseable shell command')
  // Quoted data (a commit message) is not a command: ignore it for the chain check.
  const outsideQuotes = command.replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, '')
  if (
    /^\s*git\s+(?:-C\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\S+)\s+)?(?:status|diff|log|show|rev-parse|add|commit|push)\b/.test(
      command,
    ) &&
    !/[;&|`$<>\r\n]/.test(outsideQuotes)
  )
    return []
  if (
    /^\s*git\b/.test(command) &&
    /\b(?:apply|checkout|switch|restore|reset|clean|read-tree)\b/.test(outsideQuotes)
  )
    throw new Error('a git checkout mutation cannot be isolated; use the file tools for edits')
  const writer =
    /\b(?:Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Clear-Content|tee|touch|mkdir|rmdir|rm|mv|cp)\b|(?:^|\s)sed\s+-i\b|writeFile(?:Sync)?\s*\(|\.write_text\s*\(|\.write_bytes\s*\(|open\s*\([^\n]*,[\s]*['"](?:w|a)|(?:^|[^>])>{1,2}(?!&)/i
  if (!writer.test(command)) return []
  // Redirection, chaining and PowerShell arrays could add destinations the
  // single-target check below never sees.
  if (/[;&|`$\r\n(){},<>]/.test(command))
    throw new Error('a dynamic, chained or redirected shell write cannot be isolated')
  const tokens = command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g) || []
  const unquote = (s) => s.replace(/^(['"])(.*)\1$/, '$2')
  const cmd = tokens[0]?.toLowerCase()
  const paths = []
  if (['set-content', 'add-content', 'out-file', 'clear-content'].includes(cmd)) {
    const ix = tokens.findIndex((t) => /^-(?:literalpath|path|filepath)$/i.test(t))
    const target = ix >= 0 ? tokens[ix + 1] : tokens[1]
    if (!target || target.startsWith('-')) throw new Error('the shell writer has no literal target')
    paths.push(unquote(target))
  } else if (['touch', 'mkdir', 'rm', 'rmdir'].includes(cmd)) {
    paths.push(
      ...tokens
        .slice(1)
        .filter((t) => !t.startsWith('-'))
        .map(unquote),
    )
  } else {
    // Moves, copies, removals with flags and interpreter writes need a real
    // grammar to find every destination; refusing to guess is the point.
    throw new Error('an unparsed shell write (move, copy, remove or interpreter write)')
  }
  if (!paths.length || paths.some((p) => /[*?[\]<>]/.test(p)))
    throw new Error('the shell write has ambiguous targets')
  return paths.map((p) => absolutePath(p, cwd))
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
    const forkTurns = sourceInput.fork_turns
    const fullHistory = forkTurns == null || String(forkTurns).toLowerCase() === 'all'
    normalizedName = 'Agent'
    toolInput = {
      ...sourceInput,
      prompt: sourceInput.prompt || sourceInput.message || '',
      subagent_type: fullHistory
        ? 'fork'
        : sourceInput.subagent_type || sourceInput.task_name || '',
    }
  } else if (['shell_command', 'exec_command', 'shell', 'Bash', 'PowerShell'].includes(toolName)) {
    if (['shell_command', 'exec_command', 'shell'].includes(toolName)) normalizedName = 'Bash'
    const filePaths = powershellFileWritePaths(sourceInput.command)
    if (filePaths.length > 0) toolInput = { ...sourceInput, file_paths: filePaths }
  } else if (['request_user_input', 'request_user_input_async'].includes(toolName)) {
    normalizedName = 'AskUserQuestion'
    const questions = Array.isArray(sourceInput.questions)
      ? sourceInput.questions.map((item) => {
          if (!item || typeof item !== 'object') return item
          const question =
            typeof item.question === 'string'
              ? item.question
              : typeof item.title === 'string'
                ? item.title
                : ''
          const header =
            typeof item.header === 'string'
              ? item.header
              : typeof item.id === 'string'
                ? item.id
                : ''
          const options = Array.isArray(item.options)
            ? item.options.map((option) =>
                typeof option === 'string' ? { label: option, description: '' } : option,
              )
            : item.options
          return { ...item, header, question, options }
        })
      : sourceInput.questions
    toolInput = { ...sourceInput, questions }
  }

  if (normalizedName === toolName && toolInput === sourceInput) return payload
  return {
    ...payload,
    harness_tool_name: toolName,
    tool_name: normalizedName,
    tool_input: toolInput,
  }
}

/**
 * Last `maxBytes` of a file as UTF-8 — the transcript reader of the context
 * budget hooks (`lead-context-budget.mjs`, `subagent-context-budget.mjs`). The
 * usage parser scans from the END and stops at the first assistant usage block,
 * so the tail yields the same number as the whole file while a long session's
 * transcript is tens of MB. A truncated first line is fine — the parser skips
 * unparseable lines. IO errors propagate to the caller's fail-open catch.
 *
 * @param {string} path
 * @param {number} maxBytes
 */
export function readTail(path, maxBytes) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, maxBytes)
    const buf = Buffer.allocUnsafe(length)
    readSync(fd, buf, 0, length, size - length)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
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
