#!/usr/bin/env node
// PreToolUse-гард на Agent (issue #91, пункт 5). Блокирует вызов субагента без
// явного `model`.
//
// Симптом-первопричина: «Деплой-агент опять Fable?!» — правило «каждый Agent-
// вызов передаёт явный model» было записано в память и в CLAUDE.md, и нарушено
// через восемь минут после записи (2026-07-30). Без явного model субагент
// наследует модель сессии лида, поэтому Fable-лид молча плодит Fable-субагентов
// — а Fable субагентом не бывает, он только оркестратор. Проза это уже
// покрывала; рецидив темы эскалируется в гейт, а не в новую прозу.
//
// Это ЕДИНСТВЕННЫЙ PreToolUse-гард стека, блокирующий по умолчанию: цена ошибки
// — целая задача, выполненная не той моделью, и обнаруживается это постфактум.
//
// Контракт: stdin — JSON PreToolUse ({tool_name:"Agent", tool_input}). exit 2 +
// stderr = BLOCK. exit 0 = разрешено. FAIL-OPEN: сломанный stdin → exit 0.

import { hooksDisabled, isDirectRun, readHookPayload } from './shared.mjs'

/** Fable оркеструет, но никогда не исполняет как субагент. */
export const FORBIDDEN_MODEL_RE = /fable/i

/** `subagent_type: "fork"` — форк всегда наследует модель лида по устройству
 * инструмента, параметр `model` там игнорируется; требовать его бессмысленно. */
export const MODEL_EXEMPT_SUBAGENT_RE = /^fork$/i

export function blockMessage(reason) {
  return (
    `⛔ agent-model guard (#91): ${reason}\n` +
    `Явный model обязателен для каждого Agent-вызова (CLAUDE.md, «Subagents and models»): ` +
    `механика — поиск, инвентаризация, сбор фактов → \`bbm-explorer\` (sonnet); суждение — ` +
    `ревью, архитектура, имплементация → opus (\`bbm-reviewer\` для ревью PR, иначе ` +
    `\`general-purpose\` с \`model: "opus"\`). Fable субагентом не бывает — только оркестратор.\n` +
    `Повтори вызов, добавив параметр model.`
  )
}

/**
 * Чистый seam решения: блокировать ли Agent-вызов.
 * - не Agent/Task                → `{ block: false }`;
 * - `subagent_type: "fork"`      → `{ block: false }` (model игнорируется);
 * - model отсутствует/пустой     → `{ block: true, reason: 'missing' }`;
 * - model это Fable              → `{ block: true, reason: 'fable' }`;
 * - иначе                        → `{ block: false }`.
 */
export function decideAgentModel({ toolName, toolInput }) {
  if (!/^(Agent|Task)$/.test(toolName || '')) return { block: false }
  if (!toolInput || typeof toolInput !== 'object') return { block: false } // fail-open
  const subagent = String(toolInput.subagent_type || '')
  if (MODEL_EXEMPT_SUBAGENT_RE.test(subagent)) return { block: false }
  const model = typeof toolInput.model === 'string' ? toolInput.model.trim() : ''
  if (!model) {
    return {
      block: true,
      reason: 'missing',
      message: `вызов субагента${subagent ? ` \`${subagent}\`` : ''} не передаёт model — субагент унаследует модель сессии лида.`,
    }
  }
  if (FORBIDDEN_MODEL_RE.test(model)) {
    return {
      block: true,
      reason: 'fable',
      message: `вызов субагента передаёт model: "${model}" — Fable субагентом не бывает.`,
    }
  }
  return { block: false }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const decision = decideAgentModel({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
    })
    if (decision.block) {
      process.stderr.write(blockMessage(decision.message))
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить легитимный диспатч
  }
}

if (isDirectRun(import.meta.url)) main()
