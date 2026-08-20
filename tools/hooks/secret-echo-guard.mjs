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
//      флагов, не печатающих значений, — см. `COMPOSE_INVENTORY_RE`),
//      `docker inspect` без сужающего `--format`, `env`/`printenv` как дамп,
//      в том числе внутри контейнера (`docker exec <c> env`).
//
// Любая из форм ловится и внутри обёртки, которая несёт команду как полезную
// нагрузку: `ssh <host> …`, `docker exec [опции] <c> …`,
// `docker compose exec [опции] <svc> …`, `sudo [-u x] …`, `bash -c "…"` /
// `sh -lc "…"`, `eval "…"`. Обёртка снимается, нагрузка разбирается теми же
// правилами (рекурсия с депт-капом 3). Симптом-первопричина C: 2026-08-18
// субагент выполнил `ssh portal-prod-tw docker compose --profile tools config`,
// и весь host-only `.env.prod`, интерполированный в модель, уехал в транскрипт
// (issue #262 — ротация всего прод-набора).
// Что НЕ ловится (осознанно — ложное срабатывание дороже пропуска для WARN, но
// это BLOCK, поэтому список узкий): `git add .env.example`, `ls` каталога,
// редирект СТДАУТА в файл (`cat .env.prod > /tmp/x` — санкционированный
// способ), присваивание в переменную (`TOKEN=$(cat .env.prod)`), исходники с
// «token» в имени (design tokens: .ts/.css/.md/…), префиксная форма
// `env VAR=x cmd`, `docker inspect` с шаблоном, не тянущим Env,
// `printenv <НЕСЕКРЕТНОЕ_ИМЯ>` (`printenv PATH`), ПАТТЕРН поиска у
// `grep`/`rg`/`sed`/`awk` (`grep -n -i "secret\|deploy" file` — поиск слова, а не
// чтение секретного пути; #268), файловые операнды при этом судятся как раньше.
// Известные пробелы (осознанные, гард — растяжка, а не песочница): намеренный
// обход через переменную-конструктор (`C=co; docker compose ${C}nfig`) и pty-
// обёртки (`script`, `expect`). Разрыв кавычек в `bash -c "a && b"` закрыт
// вместе с #268: разбивка сегментов больше не режет по `&&` ВНУТРИ кавычек,
// поэтому обёртка снимается целиком и её нагрузка разбирается рекурсивно.
// Осознанно широко: `printenv` c СЕКРЕТНЫМ именем блокируется, хотя печатает
// одно значение, — печать одного значения и есть предмет правила.
//
// Контракт: stdin — JSON PreToolUse ({tool_name:"Bash", tool_input:{command}}).
// exit 2 + stderr = BLOCK. exit 0 = разрешено. FAIL-OPEN.

import { hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** Команды, чей аргумент-файл печатается в вывод сессии. */
export const READER_RE =
  /^(cat|tac|type|more|less|head|tail|strings|bat|grep|egrep|fgrep|rg|sed|awk|get-content|gc|select-string|sls)$/i

/** Команды, печатающие свои аргументы как есть. */
export const ECHO_RE = /^(echo|printf|write-host|write-output|write-information)$/i

/** Читатели, у которых первый позиционный аргумент — ПАТТЕРН, а не файл. */
export const PATTERN_READER_RE = /^(grep|egrep|fgrep|rg|sed|awk|select-string|sls)$/i

/** Секретные слова в имени файла/переменной. */
export const SECRET_WORD_RE =
  /(credential|secret|token|password|passwd|api[_-]?key|private[_-]?key)/i

/** Расширения исходников/доков: «token» там почти всегда про design tokens. */
export const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|md|mdx|html|svg|snap)$/i

/**
 * Разбивка команды на сегменты: `;`, `&&`, `||`, `|`, перевод строки — но ТОЛЬКО
 * на разделителях, которые действительно разделяют команды (#268). Кавычки и
 * экранирование обратным слэшем пропускаются как есть: до этой правки регулярка
 * резала `grep -n -i "secret\|deploy" file` по `|` ВНУТРИ кавычек, и обломок
 * `"secret\` доезжал до `isSensitivePath` уже без закрывающей кавычки — поиск
 * СЛОВА выглядел как чтение секретного ПУТИ.
 *
 * Если кавычка так и не закрылась (тело heredoc с апострофом: `don't`), точный
 * сканер откатывается к наивной разбивке: незакрытая кавычка обязана деградировать
 * до СТАРОГО поведения, а не до «перестать искать» — иначе всё, что идёт после
 * такой строки, становится для гарда невидимым (ревью PR #302).
 */
export function splitSegments(command) {
  const src = String(command || '')
  const out = []
  let buf = ''
  let quote = null
  const flush = () => {
    const s = buf.trim()
    if (s) out.push(s)
    buf = ''
  }
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quote) {
      buf += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '\\') {
      buf += ch + (src[i + 1] || '') // `\|` — экранированная труба, не разделитель
      i += 1
      continue
    }
    if (ch === '\n' || ch === ';') {
      flush()
      continue
    }
    if (ch === '|') {
      flush()
      if (src[i + 1] === '|') i += 1
      continue
    }
    if (ch === '&' && src[i + 1] === '&') {
      flush()
      i += 1
      continue
    }
    buf += ch
  }
  flush()
  if (quote !== null) {
    return src
      .split(/\|\||&&|;|\n|\|/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return out
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

/** Опции, НАЗЫВАЮЩИЕ паттерн: их значение — паттерн, а не путь. */
export const PATTERN_FLAG_RE = /^(-e|--regexp)$/
/** То же для PowerShell (`Select-String -Pattern x`) — регистр там не значим. */
export const PS_PATTERN_FLAG_RE = /^-pattern$/i

/**
 * Опции читателей, съедающие СЛЕДУЮЩИЙ токен как своё значение. Только те, где
 * значение обязательно во всех читателях набора: `-r`/`-v`/`-F` намеренно НЕ
 * здесь — в grep это флаги без значения, и они съели бы файловый операнд.
 */
export const VALUE_FLAG_RE =
  /^(-f|-m|-A|-B|-C|-d|-g|--file|--max-count|--after-context|--before-context|--context|--include|--exclude|--exclude-dir|--label|--binary-files|--devices|--glob|--type|--max-depth)$/
/** Параметры Select-String со значением — включая `-Path`, естественную форму на этом боксе. */
export const PS_VALUE_FLAG_RE =
  /^-(path|literalpath|include|exclude|encoding|context|inputobject)$/i

/**
 * Аргументы читателя-с-паттерном БЕЗ самого паттерна (#268). Поиск СЛОВА
 * `secret` — не чтение секрета: команда печатает строки файла, совпавшие со
 * словом, и ничего чувствительного не дампит. `-e X` / `--regexp X` / `-eX` /
 * `--regexp=X` называют паттерн явно; иначе паттерн — первый непозиционный…
 * точнее, первый НЕ-опционный токен. Всё остальное — включая настоящий файл
 * паттернов `-f patterns.txt` и все файловые операнды — остаётся кандидатом на
 * путь, поэтому `grep foo deploy/.env.prod` блокируется как и раньше.
 */
export function patternFreeArgs(args) {
  const rest = []
  /** Параллельно `rest`: может ли токен быть ПОЗИЦИОННЫМ паттерном. */
  const positional = []
  let explicit = false
  let expectValue = false
  for (let i = 0; i < args.length; i += 1) {
    const t = stripQuotes(args[i])
    if (!expectValue && (PATTERN_FLAG_RE.test(t) || PS_PATTERN_FLAG_RE.test(t))) {
      explicit = true
      i += 1 // паттерн идёт следующим токеном
      continue
    }
    if (!expectValue && /^(--regexp=|-e.)/.test(t)) {
      explicit = true
      continue
    }
    if (!expectValue && (VALUE_FLAG_RE.test(t) || PS_VALUE_FLAG_RE.test(t))) {
      rest.push(args[i])
      positional.push(false)
      expectValue = true
      continue
    }
    rest.push(args[i])
    // Значение опции — это её значение (файл!), а не паттерн.
    positional.push(!expectValue)
    expectValue = false
  }
  if (explicit) return rest
  const at = rest.findIndex((a, i) => {
    if (!positional[i]) return false
    const t = stripQuotes(a)
    // Пустая строка — валидный паттерн (`grep "" file` печатает файл целиком),
    // и выкинуть надо ЕЁ, а не файловый операнд следом (ревью PR #302).
    return t !== '-' && !t.startsWith('-')
  })
  return at === -1 ? rest : rest.filter((_, i) => i !== at)
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
const EXEC_OPT_WITH_VALUE =
  /^(-u|--user|-w|--workdir|-e|--env|--env-file|-l|--label|--detach-keys|--index)$/i
const SUDO_OPT_WITH_VALUE =
  /^(-u|--user|-g|--group|-p|--prompt|-C|--close-from|-h|--host|-r|--role|-t|--type|-U|--other-user)$/i

/**
 * Флаги `compose config`, при которых ЗНАЧЕНИЯ не печатаются: инвентарь имён
 * (`--services`/`--profiles`/`--volumes`/`--images`/`--hash`) и `-q`/`--quiet`
 * (канонический «просто провалидируй файл», вывод пуст by design).
 * `--no-interpolate` сюда НЕ входит осознанно: он печатает файл целиком, и
 * значения, записанные в compose-файле литералами, всё равно уезжают в вывод.
 */
export const COMPOSE_INVENTORY_RE =
  /^(--(services|profiles|volumes|images|quiet)|--hash(=.*)?|-q)$/i

/** Цели редиректа, которые всё равно печатают в сессию. */
const TERMINAL_REDIRECT_TARGET_RE =
  /^(\/dev\/(stdout|stderr|tty|console|fd\/[0-2])|\/proc\/self\/fd\/[0-2])$/i

/**
 * Сегмент уводит СТДАУТ в настоящий файл — то есть в вывод сессии ничего не
 * попадает. Ровно stdout: `2>/dev/null` уводит только stderr и от правила не
 * спасает (`tools/deploy/prod.mjs:676` пишет именно так, и такая команда обязана
 * судиться по своему stdout). Дублирование дескриптора (`1>&2`) файлом не
 * является, терминальные цели (`/dev/stdout`, `/dev/tty`, `/dev/fd/1`) — тоже.
 */
export function isStdoutRedirectedToFile(segment) {
  const re = /(^|\s)(\d+)?(&?>>?)\s*("[^"]*"|'[^']*'|\S+)?/g
  let m
  while ((m = re.exec(String(segment || ''))) !== null) {
    const op = m[3]
    const target = stripQuotes(m[4] || '')
    if (!op.startsWith('&') && (m[2] || '1') !== '1') continue
    if (!target || target.startsWith('&')) continue
    if (TERMINAL_REDIRECT_TARGET_RE.test(target)) continue
    return true
  }
  return false
}

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
  if (/^printenv$/i.test(cmd)) {
    // `printenv` без имени — дамп; с именем — дамп ОДНОГО значения, а это
    // предмет правила ровно тогда, когда имя секретное (`printenv PATH` — нет).
    const names = args.map(stripQuotes).filter((a) => a && !a.startsWith('-'))
    return names.length === 0 || names.some((n) => SECRET_WORD_RE.test(n))
  }
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

/**
 * Полезная нагрузка `docker exec [опции] <контейнер> <cmd…>` и
 * `docker compose exec [опции] <сервис> <cmd…>`, иначе `null`. Это третья дверь
 * к тому же дампу резолвнутого окружения, что `compose config` и `inspect`:
 * `docker exec app env` печатает окружение контейнера целиком.
 */
export function dockerExecPayload(toks) {
  const compose = composeSubcommand(toks)
  if (compose && compose.sub === 'exec') {
    const rest = compose.rest
    const payload = rest.slice(skipOptions(rest, 0, EXEC_OPT_WITH_VALUE) + 1)
    return payload.length ? payload.join(' ') : null
  }
  if (!toks.length || !/^docker$/i.test(commandName(toks[0]))) return null
  let i = skipOptions(toks, 1, DOCKER_OPT_WITH_VALUE)
  if (/^container$/i.test(stripQuotes(toks[i] || ''))) i += 1
  if (!/^exec$/i.test(stripQuotes(toks[i] || ''))) return null
  const payload = toks.slice(skipOptions(toks, i + 1, EXEC_OPT_WITH_VALUE) + 1)
  return payload.length ? payload.join(' ') : null
}

/**
 * Полезная нагрузка `bash -c "…"` / `sh -lc "…"` / `eval "…"`, иначе `null`.
 * В этом стеке `-c` — обычный способ протащить кавычки, а не попытка обхода.
 */
export function shellPayload(toks) {
  if (!toks.length) return null
  const name = commandName(toks[0])
  if (/^eval$/i.test(name)) {
    const rest = toks.slice(1)
    return rest.length ? rest.map(stripQuotes).join(' ') : null
  }
  if (!/^(bash|sh|zsh|dash|ksh|ash)$/i.test(name)) return null
  for (let i = 1; i < toks.length; i += 1) {
    const t = stripQuotes(toks[i])
    if (!t.startsWith('-')) return null // `bash script.sh` — не инлайн-команда
    if (/^-[a-z]*c$/i.test(t)) {
      const script = stripQuotes(toks[i + 1] || '')
      return script || null
    }
  }
  return null
}

/**
 * Убрать токены редиректа из сегмента. Куда уходит вывод, уже решено
 * `isStdoutRedirectedToFile`, а как аргументы команды эти токены только мешают:
 * без чистки `env 2>/dev/null` выглядел как префиксная форма `env <cmd>`.
 * Снимается ПОСЛЕ извлечения нагрузки обёртки, чтобы `docker exec app env >
 * /tmp/x` донёс свой редирект до рекурсии.
 */
export function stripRedirects(toks) {
  const out = []
  for (let i = 0; i < toks.length; i += 1) {
    const t = stripQuotes(toks[i])
    if (/^(\d*&?>>?|<{1,3})$/.test(t)) {
      i += 1 // цель редиректа отдельным токеном
      continue
    }
    if (/^(\d*&?>>?|<)\S/.test(t)) continue
    out.push(toks[i])
  }
  return out
}

/** Что именно печатает пойманная команда — по правилу. */
const RULE_WHAT = {
  reader: 'печатает секрет в вывод сессии',
  echo: 'печатает секрет в вывод сессии',
  'compose-config':
    'печатает РАЗРЕШЁННУЮ модель compose — каждое значение, интерполированное из `.env.prod`',
  'docker-inspect': 'печатает контейнер целиком, вместе с секцией `Env`',
  'env-dump': 'печатает всё окружение процесса',
}

/** Что делать вместо — по правилу. */
const RULE_INSTEAD = {
  'compose-config':
    'Нужен инвентарь — бери ИМЕНА, а не значения: `docker compose config --services` / `--profiles` / `--volumes` / `--images`; нужна только валидация файла — `--quiet`. Нужна вся модель — только в файл на боксе (`… config > /tmp/model.yml`), не в вывод; `2>/dev/null` не считается — он уводит stderr, а модель печатается в stdout.',
  'docker-inspect':
    "Сузь шаблоном, не тянущим Env: `docker inspect -f '{{.State.Status}}' <c>`, `-f '{{.Config.Image}}' <c>`.",
  'env-dump':
    'Проверяй ФАКТ, а не значение: `test -n "$X" && echo set`. Одну переменную читай в переменную, не в вывод (`printenv` по НЕсекретному имени разрешён).',
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
    `Обёртки \`ssh <host> …\`, \`docker exec <c> …\`, \`sudo\`, \`bash -c "…"\` от правила не спасают — ` +
    `они снимаются и разбираются так же, как и \`2>/dev/null\` (он уводит только stderr).`
  )
}

/**
 * Чистый seam решения: `{ block: false }` либо `{ block: true, command, arg,
 * rule: 'reader' | 'echo' | 'compose-config' | 'docker-inspect' | 'env-dump' }`.
 * `depth` — защита от бесконечной рекурсии при разворачивании ssh-обёрток.
 */
export function decideSecretEcho(command, depth = 0) {
  for (const seg of splitSegments(command)) {
    const redirected = isStdoutRedirectedToFile(seg)
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
    // Префиксы-обёртки. У `sudo` снимаются и его собственные опции — иначе
    // `sudo -u root docker compose config` разбирался как команда `-u`.
    for (;;) {
      if (!toks.length) break
      const name = commandName(toks[0])
      if (/^(sudo|doas)$/i.test(name)) {
        toks = toks.slice(skipOptions(toks, 1, SUDO_OPT_WITH_VALUE))
        continue
      }
      if (/^(command|time|nohup|stdbuf)$/i.test(name)) {
        toks = toks.slice(1)
        continue
      }
      break
    }
    if (toks.length === 0) continue

    // Обёртки, несущие команду нагрузкой: ssh, docker exec, bash -c / eval (#262).
    const payload =
      depth < 3 ? sshPayload(toks) || dockerExecPayload(toks) || shellPayload(toks) : null
    if (payload) {
      const inner = decideSecretEcho(payload, depth + 1)
      if (inner.block) return inner
      continue
    }

    toks = stripRedirects(toks)
    if (toks.length === 0) continue

    let cmd = commandName(toks[0])
    let args = toks.slice(1)

    // `env` — либо дамп окружения, либо префикс перед настоящей командой.
    if (/^(env|printenv)$/i.test(cmd)) {
      if (isEnvDump(cmd, args)) {
        if (redirected) continue // дамп уходит в файл, а не в вывод сессии
        return { block: true, command: cmd, arg: seg.trim(), rule: 'env-dump' }
      }
      if (/^printenv$/i.test(cmd)) continue
      // Префиксная форма: собственные опции `env` (`-i`, `-u X`, `-C dir`) не
      // часть команды — иначе `env -i cat .env.prod` разбирался как команда `-i`.
      args = args.slice(skipOptions(args, 0, ENV_OPT_WITH_VALUE))
      const rest = decideSecretEcho(args.map(stripQuotes).join(' '), depth + 1)
      if (rest.block) return rest
      continue
    }

    const compose = composeSubcommand(toks)
    if (compose && compose.sub === 'config') {
      if (redirected) continue
      if (!compose.rest.some((a) => COMPOSE_INVENTORY_RE.test(stripQuotes(a)))) {
        const label = /^docker-compose$/i.test(cmd)
          ? 'docker-compose config'
          : 'docker compose config'
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
      const candidates = PATTERN_READER_RE.test(cmd) ? patternFreeArgs(args) : args
      const hit = candidates.find((a) => isSensitivePath(a))
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
