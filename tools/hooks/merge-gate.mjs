#!/usr/bin/env node
// PreToolUse-гард на Bash (issue #91, пункт 7): `gh pr merge` напоминает состав
// stage 6 из `.claude/skills/task-cycle/SKILL.md`.
//
// Симптом-первопричина: мерж уезжал вперёд условий stage 6 — без APPROVE-ревью,
// на протухшей базе (без `git fetch`), либо без записанного «принято» владельца
// по видимым изменениям. Скилл это описывает, но описание не срабатывает в
// момент команды.
//
// Уровень WARN, всегда. Надёжно определить из хука, загружен ли в сессии скилл
// task-cycle, нельзя — угадывание дало бы либо ложную тишину, либо ложный блок;
// поэтому гард честно предупреждает на каждый `gh pr merge` и держит текст
// коротким, чтобы не превратиться в шум, который пролистывают.
//
// Контракт: stdin — JSON PreToolUse ({tool_name:"Bash", tool_input:{command}}).
// WARN = exit 0 + JSON на stdout. Никогда не блокирует. FAIL-OPEN.

import { emitWarn, hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** `gh pr merge` в любом месте команды (в т.ч. после `&&`, с флагами перед). */
export const MERGE_CMD_RE = /\bgh\b[^\n;|&]*?\bpr\s+merge\b/i

export function warnMessage() {
  return (
    '⚠ merge gate (#91): это stage 6 task-cycle. Проверь по пунктам — APPROVE-ревью получено? ' +
    'CI зелёный по фактическим check-run? `git fetch origin` сделан и база не протухла? ' +
    'для видимых изменений записано «принято» владельца? После мержа — деплой-постчек и ' +
    'stage 7 (закрытие issue с «Отклонения от конвенций»).'
  )
}

/** Чистый seam решения: предупреждать ли о команде. */
export function decideMergeWarn({ toolName, toolInput }) {
  if (toolName !== 'Bash') return { warn: false }
  const command = (toolInput && toolInput.command) || ''
  return { warn: MERGE_CMD_RE.test(String(command)) }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const decision = decideMergeWarn({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
    })
    if (decision.warn) emitWarn(warnMessage())
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить мерж
  }
}

if (isDirectRun(import.meta.url)) main()
