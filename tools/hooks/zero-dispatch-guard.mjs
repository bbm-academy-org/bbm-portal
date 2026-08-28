#!/usr/bin/env node
// PreToolUse-гард «лид мутирует, но НИ РАЗУ не диспетчеризовал» (issue #322;
// источник — ретро сессии 2026-08-24, wrap оргработы по эпику #112).
//
// Симптом-первопричина: за целую сессию лид исполнил инлайном КАЖДУЮ мутацию —
// правки тел issue, правки спек, PR — при НУЛЕ вызовов `Agent`. Поправка
// владельца была дословно «Почему ты ОПЯТЬ делаешь всё инлайн, а не
// оркеструешь агентов?». Слово «опять» и есть находка: правило
// `lead-delegates-even-small-prep` (владелец, 2026-08-17) и раздел CLAUDE.md
// «Subagents and models» уже лежали в контексте и были пройдены мимо. Правило,
// которое рецидивирует прозой, переезжает в исполняемый гейт (task-cycle
// SKILL.md, «Enforcement hooks»), а не в новую прозу.
//
// ЧЕМ ЭТОТ ГАРД ОТЛИЧАЕТСЯ ОТ `dispatch-guard.mjs` (#91). Тот считает ПОДРЯД
// идущие правки и предупреждает на третьей; сброс — любой Agent, и после
// сброса он начинает считать заново. Он ловит «набор модуля инлайном» внутри
// хода. Этот ловит другое: сессию, в которой диспатча не было ВООБЩЕ. Поэтому
// счётчик здесь не «подряд», а накопительный по сессии, а первый же `Agent`
// снимает гард НАВСЕГДА до конца сессии — сессия, которая оркеструет, не
// прерывается ни на каком объёме собственных правок (AC #322).
//
// СУБАГЕНТ ПОД ЭТИМ ГАРДОМ НЕ ХОДИТ. Субагент — это и есть цель диспатча; он
// правит файлы, никого не диспетчеризуя, и это ровно то поведение, которого от
// него ждут. Дискриминатор выбран из того, что реально доступно хуку:
//   1) env `AI_AGENT` — харнес ставит его ТОЛЬКО в сессии-агенте: в спавн-env
//      Claude Code это `if (source === "agent") AI_AGENT = …_agent`, тогда как
//      `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` и `CLAUDE_CODE_CHILD_SESSION`
//      ставятся ЛЮБОМУ дочернему процессу и субагента не отличают (проверено на
//      бинаре claude 2.1.245, 2026-08-25);
//   2) маркер диспатча в транскрипте — `"promptSource":"sdk"` либо
//      `"isSidechain":true`. Тот же предикат `.claude/skills/wrap/SKILL.md`
//      применяет к ФАЙЛАМ логов, отсеивая логи диспатченных агентов (измерено
//      2026-08-05: 80 из 114). ЧЕСТНАЯ ГРАНИЦА заимствования (ревью PR #346,
//      минор): измерено там про классификацию файлов, а не про то, что в
//      транскрипте лида такие записи не встречаются — и sdk/headless-запущенный
//      ЛИД под этот маркер тоже подойдёт. Дискриминатор №1 — единственный
//      измеренный на самом харнесе; №2 остаётся эвристикой, и полярность у него
//      выбрана соответствующая;
//   3) Codex executor turn — стабильная пара `session_id` + `turn_id`, которую
//      `codex-subagent-turn-recorder.mjs` регистрирует на `SubagentStart` и
//      удаляет на terminal `SessionEnd`. Это turn-scoped identity: parent turn с тем
//      же session_id не становится executor; сам `SubagentStart` отдельно подтверждает
//      dispatch и снимает session-wide guard, Codex JSONL не читается;
//   4) сессия внутри `.claude/worktrees/…` — carve-out, общий с dispatch-guard.
// Слои складываются через ИЛИ: промах в сторону освобождения — это молчащий
// гард, промах в другую сторону — ложный блок исполнителя, и он дороже.
//
// СОСТОЯНИЕ КЛЮЧУЕТСЯ ПО `session_id`, а resume/fork сессии выдаёт новый id —
// значит сессия, которая уже диспетчеризовала, после resume перевзводится с
// нулевым счётчиком. Осознанно: цена — до шести лишних мутаций без блока,
// альтернатива — переносить состояние между id, которых хук не связывает.
//
// ПОБЕГ ДОЛЖЕН БЫТЬ ДОСТИЖИМ ИЗНУТРИ ЗАБЛОКИРОВАННОЙ СЕССИИ (ревью PR #346,
// BLOCKER 1). Первая редакция читала `process.env.DISPATCH_BYPASS` САМОГО
// процесса хука, а его env ставит харнес: `export DISPATCH_BYPASS=…` живёт в
// под-оболочке инструмента Bash, инлайн-префикс `DISPATCH_BYPASS=x <cmd>`
// уезжает в `tool_input.command`, которого хук не читал, а у `Edit`/`Write`
// env-канала нет вовсе. То есть побег включался только при СТАРТЕ `claude` —
// то есть ценой перезапуска сессии, ради которой он и заведён. Каналов теперь
// два, и оба видны хуку в том, что харнес ему реально передаёт:
//
//   A) ИНЛАЙН-ПРЕФИКС В КОМАНДЕ — форма СВОЯ у каждой оболочки:
//      Bash `DISPATCH_BYPASS="<причина>" <команда>`,
//      PowerShell `$env:DISPATCH_BYPASS='<причина>'; <команда>`. Значение
//      переменной оболочка никуда не донесёт, но САМА СТРОКА приходит хуку в
//      `tool_input.command`. Префикс вырезается перед проверкой мутации, иначе
//      настоящая команда перестаёт стоять в начале сегмента и гард молча
//      перестал бы считать её мутацией. Форма ЧУЖОЙ оболочки причину НЕ
//      расходует (ревью PR #346, MAJOR 2): bash-префикс в вызове `PowerShell`
//      уронил бы саму команду, поэтому засчитать по нему побег значило бы съесть
//      причину при неисполнившейся мутации. Такой вызов блокируется, а сообщение
//      называет правильную форму.
//   B) ФАЙЛ-ПОБЕГ В КАТАЛОГЕ СОСТОЯНИЯ — для `Edit`/`Write`/`MultiEdit`, у
//      которых строки команды нет. Взводится СВОЕЙ ЖЕ командой гарда:
//      `node <этот файл> --arm-bypass "<путь>" "<причина>"`. Она не мутирующая
//      по `MUTATING_COMMAND_RE`, поэтому проходит сквозь уже стоящий блок;
//      точный путь печатает само сообщение блока (session_id известен хуку, но
//      не сессии). Файл СЪЕДАЕТСЯ при срабатывании — ровно один пропуск.
//
// Обоим каналам общее: причина обязательна (пустая строка побегом не
// является), причина печатается в stderr и потому попадает в лог сессии, ЛЮБАЯ
// уже названная за сессию причина второй раз не проходит (`bypassUsed` — это
// СПИСОК всех израсходованных, а не последняя: с одной строкой две чередующиеся
// причины давали бесконечный побег, ревью PR #346, MAJOR 1), и та же причина
// обязана попасть в строку stage 7 «Отклонения от конвенций:».
// Env-канал сохранён третьим — он работает при старте сессии и ничего не
// стоит, но НЕ является тем, на что опирается запись §6.
//
// Контракт: stdin — JSON PreToolUse. exit 2 + stderr = BLOCK. exit 0 =
// разрешено. FAIL-OPEN: сломанный stdin / нечитаемое состояние → exit 0.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MUTATING_COMMAND_RE,
  SHELL_TOOLS,
  WRITE_TOOLS,
  stripNonCommandText,
} from './completion-report-gate.mjs'
import { isCodexExecutorTurn } from './codex-subagent-turn-recorder.mjs'
import {
  ZERO_DISPATCH_STATE_DIR_REL,
  hooksDisabled,
  inWorktree,
  isDirectRun,
  mainRepoRoot,
  norm,
  readHookPayload,
  readState,
  stateFilePath,
  writeState,
} from './shared.mjs'

/**
 * Число мутаций лида без единого диспатча, на котором гард блокирует.
 *
 * Шесть, а не три (в теле #322 тройка стоит как ПРЕДЛОЖЕНИЕ, значение просят
 * решить и записать). Причина ровно одна: `dispatch-guard.mjs` уже
 * ПРЕДУПРЕЖДАЕТ на трёх правках подряд. Блок на том же числе сработал бы в тот
 * же момент, что и WARN, и обесценил бы его — предупреждение, после которого
 * ничего нельзя сделать, предупреждением не является. Шесть — это два полных
 * цикла того WARN'а: сессию предупредили, она прошла мимо, предупредили снова,
 * и только тогда остановили.
 */
export const ZERO_DISPATCH_BLOCK_THRESHOLD = 6

/** Диспетчеризующие инструменты (`Task` — кросс-харнесный алиас `Agent`). */
export const DISPATCH_TOOL_RE = /^(Agent|Task)$/

/**
 * Имя одноразового записанного побега. ЗНАЧЕНИЕ — это ПРИЧИНА, а не «1».
 * Одно имя на три канала: инлайн-префикс команды (A), файл-побег (B) и env
 * старта сессии — чтобы в сообщении блока, в README и в §6 стояло одно слово.
 */
export const BYPASS_ENV = 'DISPATCH_BYPASS'

/** Суффикс файла-побега (канал B) рядом с per-session файлом состояния. */
export const BYPASS_FILE_SUFFIX = '.bypass'

/** Флаг CLI-режима «взвести файл-побег» — им же гард и вызывают из сессии. */
export const ARM_BYPASS_FLAG = '--arm-bypass'

/**
 * Инлайн-префикс побега в начале строки команды (канал A), ФОРМА BASH:
 * `DISPATCH_BYPASS="причина" gh issue edit …`. Кавычки любые или без них —
 * без кавычек причина обрывается на первом пробеле, что для причины бесполезно,
 * но синтаксически честно.
 */
export const BYPASS_PREFIX_RE = new RegExp(
  String.raw`^\s*${BYPASS_ENV}=(?:"([^"]*)"|'([^']*)'|(\S*))\s+`,
)

/**
 * ТА ЖЕ форма для PowerShell: `$env:DISPATCH_BYPASS='причина'; <команда>`.
 *
 * Отдельная форма, а не «и так сойдёт» (ревью PR #346, MAJOR 2). Bash-префикс
 * `DISPATCH_BYPASS="x" gh …` в PowerShell присваиванием НЕ является — строка
 * разбирается как команда с именем `DISPATCH_BYPASS=x` и падает. Хук читает
 * только строку, поэтому раньше он спокойно СЪЕДАЛ бы причину, а настоящая
 * мутация не исполнилась бы вовсе: повтору нужна была бы новая причина. На этой
 * машине PowerShell — основная оболочка, так что путь живой.
 */
export const BYPASS_PS_PREFIX_RE = new RegExp(
  String.raw`^\s*\$env:${BYPASS_ENV}\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S*))\s*;\s*`,
)

/** Имя оболочки инструмента: `PowerShell` → `powershell`, иначе `bash`. */
export function shellOf(toolName) {
  return String(toolName || '') === 'PowerShell' ? 'powershell' : 'bash'
}

function prefixReason(m) {
  return String(m[1] ?? m[2] ?? m[3] ?? '').trim()
}

/**
 * Разбирает инлайн-префикс: `{ reason, command, wrongForm }`. Причины нет →
 * исходная строка и пустая причина. Префикс ОБЯЗАН быть срезан с команды:
 * `COMMAND_START` в `MUTATING_COMMAND_RE` требует начала сегмента, и с
 * оставленным префиксом `gh issue edit` перестал бы считаться мутацией — побег
 * молча превратился бы в рубильник без записи.
 *
 * ПРИЧИНА НЕ СЪЕДАЕТСЯ ФОРМОЙ ЧУЖОЙ ОБОЛОЧКИ. Если в вызове `PowerShell` стоит
 * bash-форма (или наоборот), команда всё равно не исполнилась бы — значит и
 * побегом это не является: `reason` пуст, а `wrongForm` называет, чья это форма,
 * чтобы сообщение блока подсказало правильную. Команда при этом всё равно
 * срезается: вызов обязан остаться СЧИТАННЫМ как мутация.
 */
export function splitInlineBypass(command, toolName = 'Bash') {
  const raw = String(command || '')
  const own = shellOf(toolName) === 'powershell' ? BYPASS_PS_PREFIX_RE : BYPASS_PREFIX_RE
  const foreign = shellOf(toolName) === 'powershell' ? BYPASS_PREFIX_RE : BYPASS_PS_PREFIX_RE
  const mine = own.exec(raw)
  if (mine) return { reason: prefixReason(mine), command: raw.slice(mine[0].length), wrongForm: '' }
  const theirs = foreign.exec(raw)
  if (theirs) {
    return {
      reason: '',
      command: raw.slice(theirs[0].length),
      wrongForm: shellOf(toolName) === 'powershell' ? 'bash' : 'powershell',
    }
  }
  return { reason: '', command: raw, wrongForm: '' }
}

/** Правильная форма инлайн-побега для оболочки инструмента (канал A). */
export function inlineBypassForm(toolName) {
  return shellOf(toolName) === 'powershell'
    ? `$env:${BYPASS_ENV}='<причина>'; <твоя команда>`
    : `${BYPASS_ENV}="<причина>" <твоя команда>`
}

/**
 * Форма чужой оболочки в вызове (`'bash'` / `'powershell'` / `''`) — то, из-за
 * чего побег НЕ засчитан и команда бы не исполнилась.
 */
export function wrongShellForm({ toolName, toolInput }) {
  if (!SHELL_TOOLS.has(String(toolName || ''))) return ''
  return splitInlineBypass(toolInput && toolInput.command, toolName).wrongForm
}

/** Путь файла-побега для данного per-session файла состояния (канал B). */
export function bypassFilePath(statePath) {
  return String(statePath || '').replace(/\.json$/i, '') + BYPASS_FILE_SUFFIX
}

/** Причина из файла-побега или '' (нет файла / пусто — не улика). */
export function readBypassFile(path, readFile = (p) => readFileSync(p, 'utf8')) {
  try {
    return String(readFile(path) || '').trim()
  } catch {
    return ''
  }
}

/** Маркер сессии-агента в спавн-env харнеса (см. шапку, дискриминатор №1). */
export const AGENT_ENV_MARKER = 'AI_AGENT'

/** Маркеры диспатченного лога в транскрипте (см. шапку, дискриминатор №2). */
export const DISPATCHED_TRANSCRIPT_RE = /"promptSource":"sdk"|"isSidechain":true/

/**
 * Мутация лида. Состав НЕ ДУБЛИРУЕТСЯ: пишущие инструменты и узкий белый список
 * мутирующих shell-команд импортируются из `completion-report-gate.mjs` — там их
 * единственный источник истины, и там же живёт вырезание тел heredoc'ов и
 * кавычек (упоминание `git commit` в теле коммит-сообщения командой не
 * является). `Agent`/`Task` мутацией здесь НЕ считаются, хотя в том модуле
 * считаются write-действием: там вопрос «сессия что-то делала?», здесь —
 * «сессия делала это САМА?».
 */
export function isMutatingCall(toolName, toolInput) {
  const tool = String(toolName || '')
  if (WRITE_TOOLS.has(tool)) return true
  if (SHELL_TOOLS.has(tool)) {
    const { command } = splitInlineBypass(toolInput && toolInput.command, tool)
    return MUTATING_COMMAND_RE.test(stripNonCommandText(command))
  }
  return false
}

/** Причина побега из env старта сессии, или '' — пробелы причиной не являются. */
export function bypassReason(env = process.env) {
  return String((env && env[BYPASS_ENV]) || '').trim()
}

/**
 * Причина побега из ВСЕХ каналов, в порядке «что сессия реально контролирует»:
 * инлайн-префикс команды → файл-побег → env старта. Первая непустая выигрывает.
 */
export function resolveBypassReason({ toolName, toolInput, bypassFile = '', env = process.env }) {
  if (SHELL_TOOLS.has(String(toolName || ''))) {
    const { reason } = splitInlineBypass(toolInput && toolInput.command, toolName)
    if (reason) return reason
  }
  const fromFile = String(bypassFile || '').trim()
  if (fromFile) return fromFile
  return bypassReason(env)
}

/**
 * Сессия-субагент. Два независимых дискриминатора через ИЛИ (см. шапку);
 * нечитаемый транскрипт уликой не является ни за, ни против.
 *
 * ЧИТАЕТСЯ ЛЕНИВО. Транскрипт лида растёт до многих мегабайт, а матчер гарда
 * включает `Bash`, поэтому первая редакция перечитывала весь файл на КАЖДОМ
 * вызове оболочки (ревью PR #346, MAJOR 3). Теперь `decideZeroDispatch` зовёт
 * этот предикат только когда от него реально зависит решение, а положительный
 * вердикт кэшируется в состоянии сессии: субагентом сессия рождается и
 * перестать им быть не может, поэтому одного успешного чтения хватает навсегда.
 */
export function isSubagentSession({ env = process.env, transcriptPath = '' } = {}) {
  if (String((env && env[AGENT_ENV_MARKER]) || '').trim()) return true
  if (!transcriptPath) return false
  try {
    return DISPATCHED_TRANSCRIPT_RE.test(readFileSync(transcriptPath, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Нормализованное состояние; всё нечитаемое трактуется как чистый ноль.
 *
 * `bypassUsed` — СПИСОК всех израсходованных за сессию причин, а не последняя
 * (ревью PR #346, MAJOR 1). С одной строкой две чередующиеся причины
 * (`r1 → r2 → r1 → …`) давали неограниченное число побегов, тогда как сообщение
 * блока и §6 обещают отказ по ЛЮБОЙ уже названной причине. Форма-строка из
 * старого состояния читается как список из одного элемента: сессия, начатая до
 * этой правки, не теряет свою запись и не получает лишний побег.
 */
export function readCounterState(state) {
  const raw = state && typeof state === 'object' ? state : {}
  const mutations = Number(raw.mutations)
  const used = Array.isArray(raw.bypassUsed)
    ? raw.bypassUsed
    : typeof raw.bypassUsed === 'string'
      ? [raw.bypassUsed]
      : []
  return {
    mutations: Number.isFinite(mutations) && mutations >= 0 ? mutations : 0,
    dispatched: raw.dispatched === true,
    bypassUsed: used.filter((r) => typeof r === 'string' && r.trim() !== ''),
    subagent: raw.subagent === true,
  }
}

export function blockMessage({
  mutations,
  exhausted,
  threshold = ZERO_DISPATCH_BLOCK_THRESHOLD,
  bypassPath = '',
  guardPath = 'tools/hooks/zero-dispatch-guard.mjs',
  wrongForm = '',
}) {
  const head = exhausted
    ? `одноразовый побег уже израсходован на эту причину — новая причина или диспатч.`
    : `${mutations} мутаций лида за сессию (порог ${threshold}) при НУЛЕ вызовов Agent.`
  const armCommand = `node "${guardPath}" ${ARM_BYPASS_FLAG} "${bypassPath || '<путь>'}" "<причина>"`
  const wrongFormHint = wrongForm
    ? `⚠ Форма побега не от этой оболочки: в вызове стоит ` +
      `${wrongForm === 'bash' ? 'bash' : 'powershell'}-форма. Причина НЕ засчитана и НЕ ` +
      `израсходована — сама команда в этой оболочке тоже не исполнилась бы. Повтори в форме ` +
      `своей оболочки (ниже).\n`
    : ''
  return (
    wrongFormHint +
    `⛔ zero-dispatch guard (#322): ${head}\n` +
    'Правило `lead-delegates-even-small-prep` (владелец, 2026-08-17): лид не делает руками ' +
    `даже мелкую подготовку — исполнение уходит агентам. Лестница делегирования (CLAUDE.md, ` +
    `«Subagents and models»): механика — поиск, инвентаризация, сбор фактов → \`bbm-explorer\` ` +
    `(sonnet); суждение — ревью, архитектура, имплементация → opus (\`bbm-reviewer\` для ревью ` +
    `PR, иначе \`general-purpose\` с \`model: "opus"\`).\n` +
    `Два законных хода.\n` +
    `(1) Диспетчеризуй остаток — один Agent снимает этот гард до конца сессии.\n` +
    `(2) Если инлайн осознан, назови причину. Побег одноразовый и достижим ОТСЮДА, из этой ` +
    `сессии. Форма префикса — СВОЯ у каждой оболочки:\n` +
    `    • Bash — \`${inlineBypassForm('Bash')}\` (хук читает саму строку команды, а не env);\n` +
    `    • PowerShell — \`${inlineBypassForm('PowerShell')}\`; bash-префикс здесь присваиванием ` +
    `НЕ является и команду бы уронил, поэтому побегом он не считается;\n` +
    `    • Edit/Write — взведи файл-побег НЕ мутирующей командой, она проходит сквозь этот ` +
    `блок: \`${armCommand}\`, затем повтори правку.\n` +
    `Побег пропускает ровно СЛЕДУЮЩУЮ мутацию, печатает причину в лог сессии, съедается, и ` +
    `эта же причина обязана попасть в строку stage 7 «Отклонения от конвенций:». Побег — это ` +
    `запись, а не кнопка «выключить»; ЛЮБУЮ уже названную в этой сессии причину гард второй ` +
    `раз не примет — чередованием двух причин побег не размножается.`
  )
}

export function bypassMessage(reason) {
  return (
    `↪ zero-dispatch guard (#322): ${BYPASS_ENV} израсходован — пропущена ровно одна мутация лида.\n` +
    `Причина: ${reason}\n` +
    `Эта причина обязана попасть в строку stage 7 «Отклонения от конвенций:» финального отчёта.`
  )
}

/**
 * Чистый seam решения.
 * - субагент / worktree      → `{ action: 'silent' }` (состояние не трогаем);
 * - Agent/Task               → `{ action: 'dispatched' }`, счётчик в 0, флаг вверх;
 * - сессия уже диспетчеризовала → `{ action: 'silent' }` — она оркеструет;
 * - не мутация               → `{ action: 'silent' }`;
 * - счёт+1 < порога          → `{ action: 'count' }`;
 * - порог + свежая причина   → `{ action: 'bypass', reason }`;
 * - порог                    → `{ action: 'block' }`.
 *
 * Заблокированный вызов НЕ ИСПОЛНИЛСЯ, поэтому на пороге счётчик больше не
 * растёт: иначе повтор той же правки раздувал бы число в сообщении и врал о
 * количестве реальных мутаций.
 *
 * `subagent` принимает и булево, и ФУНКЦИЮ — ленивый предикат зовётся только на
 * той единственной ветке, где от него зависит исход (мутация лида в сессии без
 * диспатча). Дешёвые ветки — не мутация, уже диспетчеризованная сессия — до
 * чтения транскрипта не доходят вовсе.
 *
 * @param {{
 *   toolName?: string,
 *   toolInput?: any,
 *   state?: any,
 *   subagent?: boolean | (() => boolean),
 *   worktree?: boolean,
 *   bypass?: string,
 *   threshold?: number,
 * }} args
 */
export function decideZeroDispatch({
  toolName,
  toolInput,
  state,
  subagent = false,
  worktree = false,
  bypass = '',
  threshold = ZERO_DISPATCH_BLOCK_THRESHOLD,
}) {
  const s = readCounterState(state)
  const isSubagent = () =>
    s.subagent ? true : typeof subagent === 'function' ? subagent() : Boolean(subagent)
  if (worktree) return { action: 'silent' }
  if (DISPATCH_TOOL_RE.test(toolName || '')) {
    if (isSubagent()) return { action: 'silent' }
    return {
      action: 'dispatched',
      state: { mutations: 0, dispatched: true, bypassUsed: [], subagent: false },
    }
  }
  if (s.dispatched) return { action: 'silent' }
  if (!isMutatingCall(toolName, toolInput)) return { action: 'silent' }
  if (isSubagent()) {
    // Положительный вердикт кэшируется: перечитывать многомегабайтный
    // транскрипт на каждой мутации незачем, субагентом сессия и останется.
    return s.subagent ? { action: 'silent' } : { action: 'silent', state: { ...s, subagent: true } }
  }

  const next = s.mutations >= threshold ? s.mutations : s.mutations + 1
  if (next < threshold) {
    return { action: 'count', state: { ...s, mutations: next } }
  }
  const reason = String(bypass || '').trim()
  if (reason && !s.bypassUsed.includes(reason)) {
    return {
      action: 'bypass',
      reason,
      state: { ...s, mutations: next, bypassUsed: [...s.bypassUsed, reason] },
    }
  }
  return {
    action: 'block',
    mutations: next,
    exhausted: Boolean(reason && s.bypassUsed.includes(reason)),
    state: { ...s, mutations: next },
  }
}

/**
 * CLI-режим «взвести файл-побег» (канал B). Точный путь сессия получает из
 * сообщения блока — сама она свой `session_id` не знает. Путь проверяется, а не
 * принимается на веру: это запись в каталог состояния гарда, и превращать её в
 * произвольную запись по любому пути незачем.
 *
 * Возвращает exit-код; печатает результат в stderr (лог сессии).
 */
export function armBypass(argv, deps = {}) {
  const write = deps.write || ((p, c) => writeFileSync(p, c))
  const mkdir = deps.mkdir || ((d) => mkdirSync(d, { recursive: true }))
  const log = deps.log || ((m) => process.stderr.write(m))
  const path = String(argv[0] || '')
  const reason = String(argv.slice(1).join(' ') || '').trim()
  if (!path.endsWith(BYPASS_FILE_SUFFIX) || !norm(path).includes('zero-dispatch-guard-state')) {
    log(
      `zero-dispatch guard (#322): ${ARM_BYPASS_FLAG} принимает только путь вида ` +
        `<…/zero-dispatch-guard-state/<session>${BYPASS_FILE_SUFFIX}> — возьми его из сообщения блока.\n`,
    )
    return 2
  }
  if (!reason) {
    log(
      `zero-dispatch guard (#322): причина обязательна — ` +
        `${ARM_BYPASS_FLAG} "<путь>" "<причина>". Побег это запись, а не рубильник.\n`,
    )
    return 2
  }
  try {
    mkdir(dirname(path))
    write(path, reason)
  } catch {
    log(`zero-dispatch guard (#322): не удалось записать файл-побег ${path}.\n`)
    return 2
  }
  log(
    `↪ zero-dispatch guard (#322): побег взведён, причина «${reason}». ` +
      `Он пропустит ровно СЛЕДУЮЩУЮ мутацию лида и будет съеден. ` +
      `Причина обязана попасть в строку stage 7 «Отклонения от конвенций:».\n`,
  )
  return 0
}

function main() {
  try {
    const argv = process.argv.slice(2)
    if (argv[0] === ARM_BYPASS_FLAG) process.exit(armBypass(argv.slice(1)))
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const cwd = payload.cwd || ''
    const projectDir = mainRepoRoot(cwd)
    if (isCodexExecutorTurn(payload, { root: projectDir })) process.exit(0)
    // Matching Codex PreToolUse hooks run concurrently, so an Agent attempt can
    // still be rejected by another guard. SubagentStart records the confirmed dispatch.
    if (DISPATCH_TOOL_RE.test(payload.tool_name || '') && String(payload.turn_id || '').trim()) {
      process.exit(0)
    }
    const statePath = stateFilePath(
      projectDir,
      ZERO_DISPATCH_STATE_DIR_REL,
      payload.session_id || '',
    )
    const bypassPath = bypassFilePath(statePath)
    const decision = decideZeroDispatch({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      state: readState(statePath),
      // Ленивый предикат: транскрипт читается только если решение от него
      // зависит (ревью PR #346, MAJOR 3).
      subagent: () =>
        isSubagentSession({
          env: process.env,
          transcriptPath: payload.transcript_path || '',
        }),
      worktree: inWorktree(cwd) || inWorktree(projectDir),
      bypass: resolveBypassReason({
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        bypassFile: readBypassFile(bypassPath),
        env: process.env,
      }),
    })
    if (decision.state) writeState(statePath, decision.state)
    if (decision.action === 'bypass') {
      // Файл-побег СЪЕДАЕТСЯ: одноразовость канала B держится на удалении, а не
      // на памяти сессии. Канал A одноразовый через `bypassUsed` — любую уже
      // названную за сессию причину гард повторно не примет.
      try {
        rmSync(bypassPath, { force: true })
      } catch {
        // fail-open: не съеденный файл ловится `bypassUsed` на следующем витке
      }
      process.stderr.write(bypassMessage(decision.reason))
      process.exit(0)
    }
    if (decision.action === 'block') {
      process.stderr.write(
        blockMessage({
          mutations: decision.mutations,
          exhausted: decision.exhausted,
          bypassPath,
          guardPath: fileURLToPath(import.meta.url),
          // Форма чужой оболочки — причина, по которой побег НЕ засчитан:
          // сообщение обязано назвать правильную форму, а не молчать
          // (ревью PR #346, MAJOR 2).
          wrongForm: wrongShellForm({
            toolName: payload.tool_name,
            toolInput: payload.tool_input,
          }),
        }),
      )
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить легитимную работу
  }
}

if (isDirectRun(import.meta.url)) main()
