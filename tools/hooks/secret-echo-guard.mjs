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
//      %SECRET%, $env:API_KEY);
//   C. дампы РАЗРЕШЁННОГО окружения (#262): `docker compose config` (кроме
//      инвентарных `--services`/`--profiles`/`--volumes`, печатающих имена),
//      `docker inspect` без сужающего `--format`, голые `env`/`printenv`.
//
// Любая из форм ловится и внутри `ssh <host> …`: обёртка снимается, полезная
// нагрузка разбирается теми же правилами. Симптом-первопричина C: 2026-08-18
// субагент выполнил `ssh portal-prod-tw docker compose --profile tools config`,
// и весь host-only `.env.prod`, интерполированный в модель, уехал в транскрипт
// (issue #262 — ротация всего прод-набора).
// Что НЕ ловится (осознанно — ложное срабатывание дороже пропуска для WARN, но
// это BLOCK, поэтому список узкий): `git add .env.example`, `ls` каталога,
// перенаправление в файл (`cat .env.prod > /tmp/x` — санкционированный способ),
// присваивание в переменную (`TOKEN=$(cat .env.prod)`), исходники с «token» в
// имени (design tokens: .ts/.css/.md/…), префиксная форма `env VAR=x cmd`,
// `docker inspect` с шаблоном, не тянущим Env.
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

/** Опции docker/compose/ssh, съедающие СЛЕДУЮЩИЙ токен как своё значение. */
const DOCKER_OPT_WITH_VALUE =
  /^(-H|--host|-c|--context|--config|-l|--log-level|--tlscacert|--tlscert|--tlskey)$/i
const COMPOSE_OPT_WITH_VALUE =
  /^(-f|--file|-p|--project-name|--project-directory|--env-file|--profile|--parallel|--progress|--ansi)$/i
const SSH_OPT_WITH_VALUE = /^-[ipolFLRDbcEJmQSWw]$/
const ENV_OPT_WITH_VALUE = /^(-u|--unset|-C|--chdir|-S|--split-string)$/i

/** Флаги `compose config`, печатающие ИМЕНА, а не значения. */
export const COMPOSE_INVENTORY_RE = /^--(services|profiles|volumes)$/i

/** Пропустить опции с их значениями начиная с индекса `i`. */
function skipOptions(toks, i, withValue) {
  while (i < toks.length && stripQuotes(toks[i]).startsWith('-')) {
    const t = stripQuotes(toks[i])
    i += withValue.test(t) && !t.includes('=') ? 2 : 1
  }
  return i
}

/**
 * `docker compose …` / `docker-compose …` → `{ sub, rest }` первой подкоманды,
 * иначе `null`. Подкоманда — первый НЕ-опционный токен, поэтому `-f x.yml` и
 * `--profile tools` между `compose` и `config` ничего не ломают.
 */
export function composeSubcommand(toks) {
  if (!toks.length) return null
  const name = commandName(toks[0])
  let i = 1
  if (!/^docker-compose$/i.test(name)) {
    if (!/^docker$/i.test(name)) return null
    i = skipOptions(toks, i, DOCKER_OPT_WITH_VALUE)
    if (!/^compose$/i.test(stripQuotes(toks[i] || ''))) return null
    i += 1
  }
  i = skipOptions(toks, i, COMPOSE_OPT_WITH_VALUE)
  if (i >= toks.length) return null
  return { sub: stripQuotes(toks[i]).toLowerCase(), rest: toks.slice(i + 1) }
}

/** `docker inspect …` / `docker container inspect …` → аргументы, иначе `null`. */
export function dockerInspectArgs(toks) {
  if (!toks.length || !/^docker$/i.test(commandName(toks[0]))) return null
  let i = skipOptions(toks, 1, DOCKER_OPT_WITH_VALUE)
  if (/^(container|image|service|node|network|volume)$/i.test(stripQuotes(toks[i] || ''))) i += 1
  if (!/^inspect$/i.test(stripQuotes(toks[i] || ''))) return null
  return toks.slice(i + 1)
}

/**
 * Решение по `docker inspect`: без `--format` он печатает весь JSON, включая
 * `Config.Env` — то есть весь резолвнутый env контейнера. Сужающий шаблон
 * оставляем разрешённым осознанно: `-f '{{.State.Status}}'` и
 * `{{range .NetworkSettings.Networks}}…` — легитимная прод-разведка (так
 * проверяют состояние в runbook'ах и в `tools/deploy/prod.mjs`), и запрет на
 * них ничего не защищает. Небезопасным считается шаблон, который называет
 * `Env` либо выводит объект ЦЕЛИКОМ (`{{json .}}`, `{{json .Config}}`) —
 * такой дамп тянет Env за собой. `{{.Config.Image}}` — конкретное поле, ок.
 */
export function isEnvSafeFormat(tpl) {
  const t = stripQuotes(tpl)
  if (/\bEnv\b/.test(t)) return false
  if (/\{\{-?\s*(json\s+)?\.\s*(\}\}|\|)/.test(t)) return false
  if (/\.Config(?![.\w])/.test(t)) return false
  return true
}

/** Шаблон из `--format=X` / `--format X` / `-f X`, иначе `null`. */
export function formatTemplate(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = stripQuotes(args[i])
    if (/^--format=/.test(a)) return a.slice('--format='.length)
    if (/^(--format|-f)$/.test(a)) return stripQuotes(args[i + 1] || '')
  }
  return null
}

/**
 * `env` / `printenv` как дамп окружения. Префиксная форма (`env VAR=x cmd`,
 * `env -u X cmd`) дампом не является — там `env` только запускает команду.
 */
export function isEnvDump(cmd, args) {
  if (/^printenv$/i.test(cmd)) return true
  if (!/^env$/i.test(cmd)) return false
  const i = skipOptions(args, 0, ENV_OPT_WITH_VALUE)
  return i >= args.length
}

/**
 * Полезная нагрузка `ssh <host> <cmd…>` (в кавычках или голая), иначе `null`.
 * Инцидент #262 был именно в такой обёртке.
 */
export function sshPayload(toks) {
  if (!toks.length || !/^(ssh|plink)$/i.test(commandName(toks[0]))) return null
  let i = skipOptions(toks, 1, SSH_OPT_WITH_VALUE)
  i += 1 // сам хост
  const rest = toks.slice(i)
  if (!rest.length) return null
  return rest.length === 1 ? stripQuotes(rest[0]) : rest.join(' ')
}

/** Что именно печатает пойманная команда — по правилу. */
const RULE_WHAT = {
  reader: 'печатает секрет в вывод сессии',
  echo: 'печатает секрет в вывод сессии',
  'compose-config': 'печатает РАЗРЕШЁННУЮ модель compose — каждое значение, интерполированное из `.env.prod`',
  'docker-inspect': 'печатает контейнер целиком, вместе с секцией `Env`',
  'env-dump': 'печатает всё окружение процесса',
}

/** Что делать вместо — по правилу. */
const RULE_INSTEAD = {
  'compose-config':
    'Нужен инвентарь — бери ИМЕНА, а не значения: `docker compose config --services` / `--profiles` / `--volumes`. Нужна вся модель — только в файл на боксе (`… config > /tmp/model.yml`), не в вывод.',
  'docker-inspect':
    "Сузь шаблоном, не тянущим Env: `docker inspect -f '{{.State.Status}}' <c>`, `-f '{{.Config.Image}}' <c>`.",
  'env-dump':
    'Проверяй ФАКТ, а не значение: `test -n "$X" && echo set`. Одну переменную читай в переменную, не в вывод.',
}

export function blockMessage(hit) {
  const what = RULE_WHAT[hit.rule] || 'печатает секрет в вывод сессии'
  const instead =
    RULE_INSTEAD[hit.rule] ||
    'Читай без эха: сразу в переменную окружения (`export X=$(…)`) или в файл (`… > /tmp/x`), а в вывод отдавай только факт «прочитано/непусто».'
  return (
    `⛔ secret-echo guard (#91): команда ${what} — ` +
    `\`${hit.command}\` по \`${hit.arg}\`.\n` +
    `Напечатанный секрет считается утёкшим и требует ротации; маскировка не спасает ` +
    `(правило \`no-secret-echo\`, симптомы: PLANE_API_TOKEN в выводе 2026-07-24, ` +
    `резолвнутый \`.env.prod\` через \`docker compose config\` 2026-08-18 → #262).\n` +
    `${instead}\n` +
    `Обёртка \`ssh <host> …\` от правила не спасает — она снимается и разбирается так же.`
  )
}

/**
 * Чистый seam решения: `{ block: false }` либо `{ block: true, command, arg,
 * rule: 'reader' | 'echo' | 'compose-config' | 'docker-inspect' | 'env-dump' }`.
 * `depth` — защита от бесконечной рекурсии при разворачивании ssh-обёрток.
 */
export function decideSecretEcho(command, depth = 0) {
  for (const seg of splitSegments(command)) {
    const redirected = /(^|\s)\d?>{1,2}(?!&)/.test(seg)
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
    while (toks.length && /^(sudo|command|time|nohup)$/i.test(commandName(toks[0]))) {
      toks = toks.slice(1)
    }
    if (toks.length === 0) continue

    // ssh-обёртка: разбираем полезную нагрузку теми же правилами (#262).
    const payload = depth < 3 ? sshPayload(toks) : null
    if (payload) {
      const inner = decideSecretEcho(payload, depth + 1)
      if (inner.block) return inner
      continue
    }

    let cmd = commandName(toks[0])
    let args = toks.slice(1)

    // `env` — либо дамп окружения, либо префикс перед настоящей командой.
    if (/^(env|printenv)$/i.test(cmd)) {
      if (isEnvDump(cmd, args)) {
        if (redirected) continue // дамп уходит в файл, а не в вывод сессии
        return { block: true, command: cmd, arg: seg.trim(), rule: 'env-dump' }
      }
      if (/^printenv$/i.test(cmd)) continue
      const rest = decideSecretEcho(args.map(stripQuotes).join(' '), depth + 1)
      if (rest.block) return rest
      continue
    }

    const compose = composeSubcommand(toks)
    if (compose && compose.sub === 'config') {
      if (redirected) continue
      if (!compose.rest.some((a) => COMPOSE_INVENTORY_RE.test(stripQuotes(a)))) {
        const label = /^docker-compose$/i.test(cmd) ? 'docker-compose config' : 'docker compose config'
        return { block: true, command: label, arg: seg.trim(), rule: 'compose-config' }
      }
      continue
    }

    const inspectArgs = dockerInspectArgs(toks)
    if (inspectArgs) {
      if (redirected) continue
      const tpl = formatTemplate(inspectArgs)
      if (tpl === null || !isEnvSafeFormat(tpl)) {
        return {
          block: true,
          command: 'docker inspect',
          arg: tpl === null ? inspectArgs.map(stripQuotes).join(' ') : tpl,
          rule: 'docker-inspect',
        }
      }
      continue
    }

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
