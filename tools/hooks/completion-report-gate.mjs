#!/usr/bin/env node
// Stop-хук (issue #91, пункт 8; порт ds-platform tools/hooks/
// completion-report-gate.mjs с заменой маркеров на наши, из
// `.claude/skills/task-cycle/SKILL.md` stage 6).
//
// Симптом-первопричина: сессия отчитывалась «смержено, задача выполнена», а
// владелец не знал, что открыть и что смотреть — либо открывал и видел ровно
// то же самое, потому что изменение было невидимым, но об этом не сказали.
// Stage 6 фиксирует форму отчёта: пункт «Проверить глазами: <URL>» ЛИБО честная
// формула «визуально ничего не меняется; проверяется так: …».
//
// Гейт распознаёт финальное сообщение как ОТЧЁТ О ЗАВЕРШЕНИИ (глаголы
// завершения + ссылка на issue/PR, с вычетом отрицаний и с исключениями для
// вопросов владельцу, промежуточных статусов и предложений) и блокирует
// остановку, если ни одного маркера нет.
//
// Этот файл — ЕДИНСТВЕННЫЙ источник истины по распознаванию «терминального
// отчёта»: второй Stop-гейт (`deviations-gate.mjs`) импортирует те же seam'ы,
// поэтому оба гейта срабатывают ровно на одном и том же множестве сообщений.
//
// ВТОРАЯ ПОЛОВИНА РАСПОЗНАВАТЕЛЯ (#158, стоп владельца 2026-08-05): текста мало.
// Read-only сессия-ориентировка («про что issue #157?») неизбежно несёт слова
// «закрыт», «смержен» и номера PR — оба BLOCK-гейта срабатывали на чистом
// чтении, и сессия шла перевыпускать отчёт о работе, которой не делала.
// Первопричина: сессии, не совершившей ни одного write-действия, НЕЧЕГО
// объявлять завершённым. Сигнал берётся из транскрипта, который Stop-хук и так
// получает: `hasWriteAction()` ищет в нём хотя бы одно write-действие, а
// `isEnforceableTerminalReport()` — тот самый общий seam — соединяет обе
// половины. Все три Stop-гейта ходят через него.
//
// Контракт Stop-хука: stdin — {session_id, transcript_path, stop_hook_active}.
// exit 0 = остановка разрешена; exit 2 + stderr = остановка заблокирована,
// текст уходит модели. Loop-guard: при `stop_hook_active` никогда не exit 2 —
// сессия уже продолжена после одного блока. FAIL-OPEN: нет транскрипта, битый
// JSON, нет ассистентских сообщений → exit 0.

import { readFileSync } from 'node:fs'

import { hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** Маркер stage 6: пункт «Проверить глазами: <URL>». */
export const EYES_MARKER_RE = /проверить\s+глазами\s*:/i

/** Честная альтернатива того же пункта: «визуально ничего не меняется».
 * Хвосты слов пишутся как `[а-яё\w]*`, а не `\w*`: JS-класс `\w` — ASCII-only и
 * кириллическое окончание им не ловится (та же оговорка ниже у отрицаний). */
export const NO_VISUAL_CHANGE_RE =
  /визуальн[а-яё\w]*\s+(?:ничего\s+не\s+мен|изменений\s+нет)|ничего\s+визуальн[а-яё\w]*\s+не\s+мен|не\s+меняет[а-яё\w]*\s+визуальн/i

/** Глаголы завершения (RU + EN). Отчёт о завершении утверждает, что работа
 * сделана; статусы и вопросы говорят о работе в полёте другими словами. */
export const COMPLETION_VERB_RE = /смерж|замерж|\bmerged\b|выполнен|заверш[её]н|закрыт/i

/** Отрицания тех же глаголов («не смержен», "not merged") — это работа в
 * полёте, а не заявка о завершении; вырезаются до проверки. Ведущая группа
 * заменяет `\b`: JS-граница слова ASCII-only и вокруг кириллицы не работает. */
export const NEGATED_COMPLETION_RE =
  /(^|[^а-яa-zё])(?:не|not)\s+(?:смерж|замерж|выполнен|заверш[её]н|закрыт|merged)\S*/gi

/** Ссылки на issue/PR: `#123`, `PR 123`, `PR №123`. */
export const REF_RE = /#\d+|\bPR\s*№?\s*\d+/i

/** Глаголы завершения И ссылка на issue/PR, с вычетом отрицаний. */
export function isCompletionReport(text) {
  const t = String(text || '').replace(NEGATED_COMPLETION_RE, '$1')
  return COMPLETION_VERB_RE.test(t) && REF_RE.test(t)
}

/** Сколько непустых строк ещё считается коротким вопросом, а не отчётом. */
export const DECISION_REQUEST_MAX_LINES = 4

/**
 * Ход, который СПРАШИВАЕТ владельца, — не отчёт о завершении, даже если несёт
 * глаголы и ссылки. Сигнал: последняя непустая строка оканчивается вопросом И
 * ход КОРОТКИЙ.
 *
 * Условие длины принципиально (ревью PR #99): пункт 5 формы stage 6 — «вопросы
 * владельцу», поэтому ПРАВИЛЬНО оформленный финальный отчёт почти всегда
 * оканчивается строкой с «?». Проверка одной лишь последней строки вырезала
 * из-под обоих Stop-гейтов ровно каноничную форму — гейт ловил бы только
 * отчёты, нарушающие форму по последнему пункту. Развёрнутый отчёт (5 пунктов)
 * длиннее порога и остаётся терминальным; короткий «смержил, закрывать?» —
 * настоящий вопрос — по-прежнему освобождается.
 */
export function isDecisionRequest(text) {
  const t = String(text || '').trim()
  if (!t) return false
  const lines = t.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length > DECISION_REQUEST_MAX_LINES) return false
  const last = (lines[lines.length - 1] || '').trim()
  return last.replace(/[\s*_`~»"'）)\]]+$/g, '').endsWith('?')
}

/** Промежуточный статус: подшаг смержен, задача — нет. */
export const INTERIM_STATUS_RE =
  /⏳|\bcheckpoint\b|чекпоинт|\bWIP\b|в процессе|в работе|жду\s+(?:вердикт|CI|ревью|приёмк|ответ)|ещё\s+не\s+(?:смерж|заверш)|промежуточн[а-яё\w]*\s+статус/i

export function isInterimStatus(text) {
  return INTERIM_STATUS_RE.test(String(text || ''))
}

/** Предложение следующего шага / работа в полёте: перечисление уже смерженных
 * подшагов в рамке «сейчас запускаю следующее» — тоже не терминальный отчёт. */
export const PROPOSAL_INFLIGHT_RE =
  /предлага[ею]|приступа[ею]|запуска[ею]\s+\/?(?:wrap|агент)|субагент[а-яё\w]*\s+(?:ещё\s+)?(?:работает|в\s+работе|бежит)|жду\s+возврат|\bproposing\b|\bdispatching\b/i

export function isProposalOrInFlight(text) {
  return PROPOSAL_INFLIGHT_RE.test(String(text || ''))
}

/**
 * ЕДИНЫЙ распознаватель терминального отчёта — им пользуются оба Stop-гейта.
 * Отчёт о завершении, который не является вопросом владельцу, промежуточным
 * статусом или предложением следующего шага.
 */
export function isTerminalReport(text) {
  if (!text) return false
  if (isDecisionRequest(text)) return false
  if (isInterimStatus(text)) return false
  if (isProposalOrInFlight(text)) return false
  return isCompletionReport(text)
}

/** Инструменты, само использование которых — запись. */
export const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * Диспетчеризация субагента. Лид, раздавший работу, сам мог не тронуть ни
 * строки — но писали ЕГО субагенты, а отчитывается за них он: оркестрирующая
 * сессия обязана ОСТАВАТЬСЯ под гейтами, иначе из-под них выпадает ровно тот
 * класс сессий, ради которых форма отчёта и заводилась.
 */
export const DISPATCH_TOOLS = new Set(['Agent', 'Task'])

/** Инструменты оболочки: решает не имя, а сама команда. */
export const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

/** Начало команды: старт строки либо разделитель цепочки (`&&`, `;`, `|`). */
const COMMAND_START = String.raw`(?:^|[\n;&|(])\s*`

/**
 * Консервативный белый список мутирующих shell-команд. Список НАМЕРЕННО узкий:
 * цена пропущенной мутации — один не сработавший гейт, цена лишней записи в
 * список — возврат ровно того ложного блока, который чинит #158. Поэтому
 * распознаются только команды, у которых мутация написана в самом глаголе, и
 * только в начале сегмента команды (`gh api` — только с явным мутирующим
 * методом; `git -C <path>` учтён: в этом репо это каноничная форма).
 */
export const MUTATING_COMMAND_RE = new RegExp(
  COMMAND_START +
    '(?:' +
    [
      String.raw`git\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?(?:commit|push|merge)(?![\w:-])`,
      String.raw`gh\s+pr\s+(?:create|merge|edit|close|comment)(?![\w:-])`,
      String.raw`gh\s+issue\s+(?:create|edit|close|comment)(?![\w:-])`,
      String.raw`gh\s+api\s[^\n;|&]*?(?:--method[=\s]|-X\s)\s*(?:POST|PUT|PATCH|DELETE)(?![\w:-])`,
      String.raw`pnpm\s+(?:pr:land|issue:create|board:status|deploy(?::[\w-]+)?)(?![\w:-])`,
    ].join('|') +
    ')',
  'i',
)

/** Один блок `tool_use` — write-действие? */
export function isWriteToolUse(name, input) {
  const tool = String(name || '')
  if (WRITE_TOOLS.has(tool) || DISPATCH_TOOLS.has(tool)) return true
  if (!SHELL_TOOLS.has(tool)) return false
  return MUTATING_COMMAND_RE.test(String((input && input.command) || ''))
}

/**
 * В транскрипте есть хотя бы одно write-действие. Единственное место, где эта
 * проверка живёт: оба других Stop-гейта импортируют её отсюда.
 *
 * Отсутствие ответа = `false` = гейты молчат. Это тот же FAIL-OPEN, что и у
 * остального стека: нечитаемый транскрипт не даёт улики, а гейт блокирует
 * только распознанное нарушение. Плата — настоящий отчёт при битом транскрипте
 * пройдёт молча; принято сознательно (#158).
 */
export function hasWriteAction(jsonl) {
  const text = String(jsonl || '')
  if (!text) return false
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    // Дешёвый префильтр: JSON.parse только строк, где вообще есть tool_use.
    if (!trimmed || !trimmed.includes('"tool_use"')) continue
    let entry
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue // битая строка — пропускаем по одной, а не роняем чтение
    }
    const content = entry && entry.message && entry.message.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue
      if (isWriteToolUse(block.name, block.input)) return true
    }
  }
  return false
}

/**
 * ПОЛНЫЙ распознаватель, через который ходят ВСЕ ТРИ Stop-гейта: текст читается
 * как терминальный отчёт И сессия действительно что-то сделала. Один seam, а не
 * три копии условия, — гейты не могут разъехаться (#158).
 */
export function isEnforceableTerminalReport({ lastAssistantText, writeActionSeen = false }) {
  if (!writeActionSeen) return false
  return isTerminalReport(lastAssistantText)
}

/** Пункт stage 6 присутствует: либо «Проверить глазами:», либо честная формула. */
export function hasEyesOrNoVisualChange(text) {
  const t = String(text || '')
  return EYES_MARKER_RE.test(t) || NO_VISUAL_CHANGE_RE.test(t)
}

/**
 * Текст ПОСЛЕДНЕГО ассистентского сообщения из JSONL-транскрипта. Claude Code
 * может писать по записи на блок контента с одним `message.id` — последний ход
 * это все хвостовые записи с id последней, их текстовые блоки склеены. Битая
 * строка пропускается по одной, а не роняет чтение целиком.
 */
export function extractLastAssistantText(jsonl) {
  const entries = []
  for (const line of String(jsonl).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const entry = JSON.parse(trimmed)
      if (entry && entry.type === 'assistant' && entry.message) entries.push(entry)
    } catch {
      // битая строка — пропускаем
    }
  }
  if (entries.length === 0) return null
  const last = entries[entries.length - 1]
  const lastId = last.message.id
  const turn = lastId ? entries.filter((e) => e.message.id === lastId) : [last]
  const parts = []
  for (const entry of turn) {
    const content = entry.message.content
    if (typeof content === 'string') {
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
    }
  }
  return parts.join('\n').trim() || null
}

export function blockMessage() {
  return (
    '⛔ completion-report gate (#91): финальное сообщение читается как отчёт о завершении ' +
    'задачи, но в нём нет обязательного пункта stage 6 — ни «Проверить глазами: <URL>», ни ' +
    'честной формулы «визуально ничего не меняется; проверяется так: …». Владелец должен ' +
    'знать, что открыть и что там увидеть (.claude/skills/task-cycle/SKILL.md, stage 6). ' +
    'Перевыпусти отчёт в форме stage 6: что изменилось продуктовым языком, «Проверить ' +
    'глазами», честный статус (смержено ≠ задеплоено ≠ доступно владельцу), % от заявленного ' +
    'объёма, вопросы владельцу.'
  )
}

/**
 * Чистый seam решения: блокировать остановку только когда это не продолжение
 * после блока, финальное сообщение — терминальный отчёт СЕССИИ, КОТОРАЯ ПИСАЛА
 * (#158), и маркера stage 6 в нём нет.
 */
export function decideBlock({ stopHookActive, lastAssistantText, writeActionSeen = false }) {
  if (stopHookActive) return { block: false }
  if (!isEnforceableTerminalReport({ lastAssistantText, writeActionSeen })) return { block: false }
  if (hasEyesOrNoVisualChange(lastAssistantText)) return { block: false }
  return { block: true }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    if (payload.stop_hook_active) process.exit(0)
    if (!payload.transcript_path) process.exit(0)
    const transcript = readFileSync(payload.transcript_path, 'utf8')
    const decision = decideBlock({
      stopHookActive: Boolean(payload.stop_hook_active),
      lastAssistantText: extractLastAssistantText(transcript),
      writeActionSeen: hasWriteAction(transcript),
    })
    if (decision.block) {
      process.stderr.write(blockMessage())
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гейта не должен ломать нормальную остановку
  }
}

if (isDirectRun(import.meta.url)) main()
