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
//      `"isSidechain":true`. Это уже канон репо: тем же предикатом
//      `.claude/skills/wrap/SKILL.md` отсеивает логи диспатченных агентов
//      (измерено 2026-08-05: 80 логов из 114);
//   3) сессия внутри `.claude/worktrees/…` — carve-out, общий с dispatch-guard.
// Слои складываются через ИЛИ: промах в сторону освобождения — это молчащий
// гард, промах в другую сторону — ложный блок исполнителя, и он дороже.
//
// Контракт: stdin — JSON PreToolUse. exit 2 + stderr = BLOCK. exit 0 =
// разрешено. FAIL-OPEN: сломанный stdin / нечитаемое состояние → exit 0.

import { readFileSync } from 'node:fs'

import {
  MUTATING_COMMAND_RE,
  SHELL_TOOLS,
  WRITE_TOOLS,
  stripNonCommandText,
} from './completion-report-gate.mjs'
import {
  ZERO_DISPATCH_STATE_DIR_REL,
  hooksDisabled,
  inWorktree,
  isDirectRun,
  mainRepoRoot,
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

/** Env-переменная одноразового записанного побега. ЗНАЧЕНИЕ — это ПРИЧИНА. */
export const BYPASS_ENV = 'DISPATCH_BYPASS'

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
    return MUTATING_COMMAND_RE.test(stripNonCommandText(toolInput && toolInput.command))
  }
  return false
}

/** Причина побега или '' — пустая строка и пробелы причиной не являются. */
export function bypassReason(env = process.env) {
  return String((env && env[BYPASS_ENV]) || '').trim()
}

/**
 * Сессия-субагент. Два независимых дискриминатора через ИЛИ (см. шапку);
 * нечитаемый транскрипт уликой не является ни за, ни против.
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

/** Нормализованное состояние; всё нечитаемое трактуется как чистый ноль. */
export function readCounterState(state) {
  const raw = state && typeof state === 'object' ? state : {}
  const mutations = Number(raw.mutations)
  return {
    mutations: Number.isFinite(mutations) && mutations >= 0 ? mutations : 0,
    dispatched: raw.dispatched === true,
    bypassUsed: typeof raw.bypassUsed === 'string' ? raw.bypassUsed : '',
  }
}

export function blockMessage({ mutations, exhausted, threshold = ZERO_DISPATCH_BLOCK_THRESHOLD }) {
  const head = exhausted
    ? `одноразовый побег уже израсходован на эту причину — новая причина или диспатч.`
    : `${mutations} мутаций лида за сессию (порог ${threshold}) при НУЛЕ вызовов Agent.`
  return (
    `⛔ zero-dispatch guard (#322): ${head}\n` +
    'Правило `lead-delegates-even-small-prep` (владелец, 2026-08-17): лид не делает руками ' +
    `даже мелкую подготовку — исполнение уходит агентам. Лестница делегирования (CLAUDE.md, ` +
    `«Subagents and models»): механика — поиск, инвентаризация, сбор фактов → \`bbm-explorer\` ` +
    `(sonnet); суждение — ревью, архитектура, имплементация → opus (\`bbm-reviewer\` для ревью ` +
    `PR, иначе \`general-purpose\` с \`model: "opus"\`).\n` +
    `Два законных хода: (1) диспетчеризуй остаток — один Agent снимает этот гард до конца ` +
    `сессии; (2) если инлайн осознан, назови причину — \`${BYPASS_ENV}="<причина>"\` пропускает ` +
    `ровно СЛЕДУЮЩУЮ мутацию, печатает причину в лог сессии, и эта же причина обязана попасть ` +
    `в строку stage 7 «Отклонения от конвенций:». Побег — это запись, а не кнопка «выключить».`
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
  if (subagent || worktree) return { action: 'silent' }
  if (DISPATCH_TOOL_RE.test(toolName || '')) {
    return { action: 'dispatched', state: { mutations: 0, dispatched: true, bypassUsed: '' } }
  }
  if (s.dispatched) return { action: 'silent' }
  if (!isMutatingCall(toolName, toolInput)) return { action: 'silent' }

  const next = s.mutations >= threshold ? s.mutations : s.mutations + 1
  if (next < threshold) {
    return { action: 'count', state: { ...s, mutations: next } }
  }
  const reason = String(bypass || '').trim()
  if (reason && reason !== s.bypassUsed) {
    return {
      action: 'bypass',
      reason,
      state: { ...s, mutations: next, bypassUsed: reason },
    }
  }
  return {
    action: 'block',
    mutations: next,
    exhausted: Boolean(reason && reason === s.bypassUsed),
    state: { ...s, mutations: next },
  }
}

function main() {
  try {
    if (hooksDisabled()) process.exit(0)
    const payload = readHookPayload()
    const cwd = payload.cwd || ''
    const projectDir = mainRepoRoot(cwd)
    const statePath = stateFilePath(
      projectDir,
      ZERO_DISPATCH_STATE_DIR_REL,
      payload.session_id || '',
    )
    const decision = decideZeroDispatch({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      state: readState(statePath),
      subagent: isSubagentSession({
        env: process.env,
        transcriptPath: payload.transcript_path || '',
      }),
      worktree: inWorktree(cwd) || inWorktree(projectDir),
      bypass: bypassReason(process.env),
    })
    if (decision.state) writeState(statePath, decision.state)
    if (decision.action === 'bypass') {
      process.stderr.write(bypassMessage(decision.reason))
      process.exit(0)
    }
    if (decision.action === 'block') {
      process.stderr.write(
        blockMessage({ mutations: decision.mutations, exhausted: decision.exhausted }),
      )
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гарда не должен рушить легитимную работу
  }
}

if (isDirectRun(import.meta.url)) main()
