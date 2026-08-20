#!/usr/bin/env node
// Stop-хук (issue #91, пункт 9; порт ds-platform tools/hooks/
// surface-decision-debt-gate.mjs с нашим маркером stage 7).
//
// Симптом-первопричина: отклонения от конвенций уезжали в тишину — задача
// закрывалась, а решение «сделал не по правилу, потому что …» нигде не
// всплывало; всплывало оно позже, как сюрприз в чужой сессии. Stage 7
// task-cycle требует в комментарии закрытия строку
// «Отклонения от конвенций: нет / <список>»; проза этого не удерживает.
//
// КОМПОЗИЦИЯ: гейт переиспользует распознаватель терминального отчёта из
// `completion-report-gate.mjs` (единый источник истины). Оба Stop-гейта
// срабатывают на одном и том же множестве сообщений и не маскируют друг друга:
// один блокирует по отсутствию «Проверить глазами», другой — по отсутствию
// «Отклонения от конвенций». Отчёт с обоими маркерами проходит оба.
//
// SECOND DUTY (retro 2026-08-05, theme "honest-status"): the line can be present
// and still say nothing — «Отклонения от конвенций: нет» in a session the owner
// had to halt is a self-certification, not a report. When the transcript carries
// an owner-halt (or an earlier Stop-gate block) the «нет» value is rejected too.
// The «нет» value is what arms that signal, so a corrected report — which lists
// deviations — passes on the next try instead of looping.
//
// Контракт Stop-хука: stdin — {session_id, transcript_path, stop_hook_active}.
// exit 0 = остановка разрешена; exit 2 + stderr = заблокирована. Loop-guard по
// `stop_hook_active` — блок ровно один раз. FAIL-OPEN.

import { readFileSync } from 'node:fs'

import {
  extractLastAssistantText,
  hasWriteAction,
  isEnforceableTerminalReport,
} from './completion-report-gate.mjs'
import { hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** Маркер stage 7. Регистронезависимо, с допуском пробела перед двоеточием;
 * markdown-выделение (`**Отклонения от конвенций:**`) содержит тот же токен.
 * Окончания слов — `[а-яё\w]*`, а не `\w*`: JS-класс `\w` ASCII-only и
 * кириллический хвост им не ловится. */
export const DEVIATIONS_MARKER_RE = /отклонени[а-яё\w]*\s+от\s+конвенц[а-яё\w]*\s*:/i

/** Строка присутствует. Достаточно ПРИСУТСТВИЯ: «нет» и список одинаково
 * валидны — содержание на совести автора, гейт его не судит. */
export function hasDeviationsLine(text) {
  return DEVIATIONS_MARKER_RE.test(String(text || ''))
}

/** Значение строки stage 7, нормализующееся в «отклонений нет». Хвост
 * `(?![а-яё\w])` вместо `\b`: JS-граница слова ASCII-only и после кириллического
 * «нет» не срабатывает вовсе (та же оговорка, что у DEVIATIONS_MARKER_RE).
 * Лукахед отсекает «нету», «нетривиально». */
export const NO_DEVIATIONS_VALUE_RE =
  /^(?:нет(?![а-яё\w])|значимых\s+отклонений\s+нет(?![а-яё\w])|нет\s+значимых)/i

/**
 * The value after the marker normalizes to "no deviations". ONLY the text that
 * follows the marker is judged — both branches (review PR #148, refs #149):
 * «значимых отклонений нет» said about something else earlier in the report must
 * not overrule a stage-7 line that actually lists deviations.
 */
export function hasNoDeviationsValue(text) {
  const t = String(text || '')
  const m = t.match(DEVIATIONS_MARKER_RE)
  if (!m) return false
  const value = t.slice((m.index ?? 0) + m[0].length).replace(/^\s*\**\s*/, '')
  return NO_DEVIATIONS_VALUE_RE.test(value)
}

/**
 * Owner halt wording (RU + EN). Two corrections from review PR #148 (refs #149):
 * the Cyrillic-safe `(?![а-яё\w])` lookahead instead of `\b`, and phrase
 * precision — a bare «останови» is the routine «останови стенд», not a halt of
 * the session, so the verb is required to name the work itself.
 */
export const HALT_RE =
  /тормози(?![а-яё\w])|прекрати\s+работу|останови(?:те)?\s+(?:вс[её]|работу)|стоп(?![а-яё\w])|stop everything|halt everything/i

/**
 * An earlier Stop-hook block, and ONLY as harness feedback. Review PR #148: the
 * bare marker armed the signal whenever a session merely READ these hook files —
 * their own source text lands in a tool_result line verbatim. The «Stop hook
 * feedback» frame is what distinguishes a block that actually happened.
 */
export const PRIOR_STOP_BLOCK_RE =
  /Stop hook feedback[\s\S]{0,200}?⛔ (?:deviations|completion-report) gate/

/** Текст человеческого сообщения; tool_result-блоки в user-записях игнорируются. */
function humanMessageText(message) {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

/**
 * Сигнал «сессия шла не гладко» по JSONL-транскрипту: (i) queued_command от
 * человека со стоп-формулировкой; (ii) обычное человеческое сообщение с ней же;
 * (iii) уже случившийся блок Stop-гейта. Битая строка пропускается по одной.
 *
 * Loop-guard: сигнал (iii) сам по себе НИКОГДА не блокирует — он работает только
 * в паре со значением «нет», а исправленный отчёт несёт список, поэтому один
 * блок не превращается в вечный.
 */
export function detectHaltSignal(jsonl) {
  for (const line of String(jsonl || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (PRIOR_STOP_BLOCK_RE.test(trimmed)) return true
    let entry
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue // битая строка — пропускаем
    }
    if (!entry || typeof entry !== 'object') continue
    const att = entry.attachment
    if (
      att &&
      att.type === 'queued_command' &&
      att.origin &&
      att.origin.kind === 'human' &&
      HALT_RE.test(String(att.prompt || ''))
    ) {
      return true
    }
    if (entry.type === 'user' && !entry.isMeta && HALT_RE.test(humanMessageText(entry.message))) {
      return true
    }
  }
  return false
}

export function blockMessage() {
  return (
    '⛔ deviations gate (#91): финальное сообщение читается как отчёт о завершении/закрытии ' +
    'задачи, но в нём нет обязательной строки stage 7 — «Отклонения от конвенций: нет / ' +
    '<список>» (.claude/skills/task-cycle/SKILL.md). Молчаливое отклонение от конвенции ' +
    'всплывает позже и уже как сюрприз. Добавь строку: либо «Отклонения от конвенций: нет», ' +
    'либо список — значимое отклонение заводится отдельной issue, мелкое строкой в DEBT.md.'
  )
}

export function selfCertBlockMessage() {
  return (
    '⛔ deviations gate (#91): в сессии был стоп владельца или блок Stop-хука — «отклонений нет» ' +
    'не проходит: перечисли, что пошло не по конвенции и чем кончилось.'
  )
}

/**
 * Чистый seam решения: блокировать остановку только когда это не продолжение
 * после блока, финальное сообщение — терминальный отчёт (ТОТ ЖЕ
 * распознаватель, что у completion-report-gate), и строки stage 7 в нём нет.
 *
 * Вторая проверка (retro 2026-08-05, тема «honest-status»): строка ЕСТЬ, но
 * самосертифицирована как «нет» — а сессия при этом была остановлена владельцем
 * либо уже ловила блок Stop-гейта. «Нет» в такой сессии это не отчёт, а
 * пропущенный разбор.
 */
export function decideBlock({
  stopHookActive,
  lastAssistantText,
  haltSignal = false,
  writeActionSeen = false,
}) {
  if (stopHookActive) return { block: false }
  if (!isEnforceableTerminalReport({ lastAssistantText, writeActionSeen })) return { block: false }
  if (!hasDeviationsLine(lastAssistantText)) return { block: true }
  if (haltSignal && hasNoDeviationsValue(lastAssistantText)) {
    return { block: true, reason: 'self-cert' }
  }
  return { block: false }
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
      haltSignal: detectHaltSignal(transcript),
      writeActionSeen: hasWriteAction(transcript),
    })
    if (decision.block) {
      process.stderr.write(
        decision.reason === 'self-cert' ? selfCertBlockMessage() : blockMessage(),
      )
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гейта не должен ломать нормальную остановку
  }
}

if (isDirectRun(import.meta.url)) main()
