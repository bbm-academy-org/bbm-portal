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
// Контракт Stop-хука: stdin — {session_id, transcript_path, stop_hook_active}.
// exit 0 = остановка разрешена; exit 2 + stderr = заблокирована. Loop-guard по
// `stop_hook_active` — блок ровно один раз. FAIL-OPEN.

import { readFileSync } from 'node:fs'

import { extractLastAssistantText, isTerminalReport } from './completion-report-gate.mjs'
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

export function blockMessage() {
  return (
    '⛔ deviations gate (#91): финальное сообщение читается как отчёт о завершении/закрытии ' +
    'задачи, но в нём нет обязательной строки stage 7 — «Отклонения от конвенций: нет / ' +
    '<список>» (.claude/skills/task-cycle/SKILL.md). Молчаливое отклонение от конвенции ' +
    'всплывает позже и уже как сюрприз. Добавь строку: либо «Отклонения от конвенций: нет», ' +
    'либо список — значимое отклонение заводится отдельной issue, мелкое строкой в DEBT.md.'
  )
}

/**
 * Чистый seam решения: блокировать остановку только когда это не продолжение
 * после блока, финальное сообщение — терминальный отчёт (ТОТ ЖЕ
 * распознаватель, что у completion-report-gate), и строки stage 7 в нём нет.
 */
export function decideBlock({ stopHookActive, lastAssistantText }) {
  if (stopHookActive) return { block: false }
  if (!isTerminalReport(lastAssistantText)) return { block: false }
  if (hasDeviationsLine(lastAssistantText)) return { block: false }
  return { block: true }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    if (payload.stop_hook_active) process.exit(0)
    if (!payload.transcript_path) process.exit(0)
    const decision = decideBlock({
      stopHookActive: Boolean(payload.stop_hook_active),
      lastAssistantText: extractLastAssistantText(readFileSync(payload.transcript_path, 'utf8')),
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
