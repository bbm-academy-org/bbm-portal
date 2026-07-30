#!/usr/bin/env node
// PreToolUse-гард на Bash (issue #91, пункт 6). Блокирует команду, которая
// выводит секрет в лог сессии.
//
// Симптом-первопричина: 2026-07-24 `PLANE_API_TOKEN` засветился в выводе сессии
// (память `no-secret-echo`). Вывод сессии — это транскрипт, который уходит в
// логи и в handoff; напечатанный секрет считается утёкшим и требует ротации,
// а «замаскированный» вывод не спасает. Читать секрет надо в переменную или в
// файл — без эха.
//
// Что ловится:
//   A. читающая команда (cat/type/head/tail/less/more/grep/sed/awk/strings/
//      Get-Content…) с путём, похожим на секрет (`.env` кроме `.env.example`,
//      credentials/secret/token в имени), когда вывод идёт в сессию;
//   B. echo/printf/Write-Host по переменной с секретным именем ($PLANE_API_TOKEN,
//      %SECRET%, $env:API_KEY).
// Что НЕ ловится (осознанно — ложное срабатывание дороже пропуска для WARN, но
// это BLOCK, поэтому список узкий): `git add .env.example`, `ls` каталога,
// перенаправление в файл (`cat .env.prod > /tmp/x` — санкционированный способ),
// присваивание в переменную (`TOKEN=$(cat .env.prod)`), исходники с «token» в
// имени (design tokens: .ts/.css/.md/…).
//
// Контракт: stdin — JSON PreToolUse ({tool_name:"Bash", tool_input:{command}}).
// exit 2 + stderr = BLOCK. exit 0 = разрешено. FAIL-OPEN.

import { hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** Команды, чей аргумент-файл печатается в вывод сессии. */
export const READER_RE =
  /^(cat|tac|type|more|less|head|tail|strings|bat|grep|egrep|fgrep|rg|sed|awk|get-content|gc|select-string|sls)$/i

/** Команды, печатающие свои аргументы как есть. */
export const ECHO_RE = /^(echo|printf|write-host|write-output|write-information)$/i

/** Секретные слова в имени файла/переменной. */
export const SECRET_WORD_RE =
  /(credential|secret|token|password|passwd|api[_-]?key|private[_-]?key)/i

/** Расширения исходников/доков: «token» там почти всегда про design tokens. */
export const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|md|mdx|html|svg|snap)$/i

/** Разбивка команды на сегменты: `;`, `&&`, `||`, `|`, перевод строки. */
export function splitSegments(command) {
  return String(command || '')
    .split(/\|\||&&|;|\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Токены сегмента с сохранением кавычек как единого токена. */
export function tokenize(segment) {
  return String(segment || '').match(/"[^"]*"|'[^']*'|\S+/g) || []
}

export function stripQuotes(token) {
  return String(token || '').replace(/^["']|["']$/g, '')
}

/** Имя команды без пути и без `.exe`. */
export function commandName(token) {
  return stripQuotes(token)
    .split(/[\\/]/)
    .pop()
    .replace(/\.(exe|cmd|bat|ps1)$/i, '')
}

/**
 * Аргумент выглядит как путь к секрету. `.env` считается секретом всегда, кроме
 * `*.example` (это коммитимый шаблон). Слова credential/secret/token дают
 * срабатывание только на не-исходниках.
 */
export function isSensitivePath(arg) {
  const a = stripQuotes(arg)
  if (!a || a.startsWith('-')) return false
  // Похоже на путь, а не на regex-паттерн: только «путевые» символы и хотя бы
  // одна точка или разделитель.
  if (!/^[\w.\-/\\:~$@]+$/.test(a)) return false
  if (!/[./\\]/.test(a)) return false
  const base = a.split(/[\\/]/).pop().toLowerCase()
  if (/^\.env(\..+)?$/.test(base)) return !/\.example$/.test(base)
  if (SOURCE_EXT_RE.test(base)) return false
  return SECRET_WORD_RE.test(a)
}

/** Ссылка на переменную с секретным именем: `$TOKEN`, `${API_KEY}`, `$env:X`, `%SECRET%`. */
export function hasSensitiveVarRef(arg) {
  const a = stripQuotes(arg)
  const re = /\$\{?(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}?|%([A-Za-z_][A-Za-z0-9_]*)%/g
  let m
  while ((m = re.exec(a)) !== null) {
    if (SECRET_WORD_RE.test(m[1] || m[2] || '')) return true
  }
  return false
}

export function blockMessage(hit) {
  return (
    `⛔ secret-echo guard (#91): команда печатает секрет в вывод сессии — ` +
    `\`${hit.command}\` по \`${hit.arg}\`.\n` +
    `Напечатанный секрет считается утёкшим и требует ротации; маскировка не спасает ` +
    `(память \`no-secret-echo\`, симптом: PLANE_API_TOKEN в выводе 2026-07-24).\n` +
    `Читай без эха: сразу в переменную окружения (\`export X=$(…)\`) или в файл ` +
    `(\`… > /tmp/x\`), а в вывод отдавай только факт «прочитано/непусто».`
  )
}

/**
 * Чистый seam решения: `{ block: false }` либо
 * `{ block: true, command, arg, rule: 'reader' | 'echo' }`.
 */
export function decideSecretEcho(command) {
  for (const seg of splitSegments(command)) {
    let toks = tokenize(seg)
    // Префикс присваиваний: `VAR=… cmd …`. Присваивание с подстановкой команды
    // (`TOKEN=$(cat .env.prod)`) — это ровно рекомендованный способ, пропускаем.
    while (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) {
      if (toks[0].includes('$(') || toks[0].includes('`')) {
        toks = []
        break
      }
      toks = toks.slice(1)
    }
    while (toks.length && /^(sudo|command|env|time)$/i.test(commandName(toks[0]))) {
      toks = toks.slice(1)
    }
    if (toks.length === 0) continue
    const cmd = commandName(toks[0])
    const args = toks.slice(1)
    const redirected = /(^|\s)\d?>{1,2}(?!&)/.test(seg)
    if (READER_RE.test(cmd)) {
      if (redirected) continue // вывод уходит в файл, а не в сессию
      const hit = args.find((a) => isSensitivePath(a))
      if (hit) return { block: true, command: cmd, arg: stripQuotes(hit), rule: 'reader' }
      continue
    }
    if (ECHO_RE.test(cmd)) {
      if (redirected) continue
      const hit = args.find((a) => hasSensitiveVarRef(a))
      if (hit) return { block: true, command: cmd, arg: stripQuotes(hit), rule: 'echo' }
    }
  }
  return { block: false }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    if (payload.tool_name !== 'Bash') process.exit(0)
    const decision = decideSecretEcho(payload.tool_input && payload.tool_input.command)
    if (decision.block) {
      process.stderr.write(blockMessage(decision))
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить легитимную команду
  }
}

if (isDirectRun(import.meta.url)) main()
