# Enforcement-хуки (issue #91)

Стек исполняемых гейтов, привязанный в `.claude/settings.json`. Он **закоммичен
в репо**, то есть включается сам во всех сессиях этого репозитория и меняет их
поведение — поэтому четыре хука, которые блокируют, названы здесь явно.

Причина существования: правило, которое рецидивирует, переезжает из прозы в
исполняемый гейт (task-cycle SKILL.md, «Enforcement hooks»). Каждый файл в шапке
называет свой симптом-первопричину.

## Рубильник

```sh
BBM_HOOKS_DISABLE=1   # выключает ВЕСЬ стек — уважают все хуки без исключения
```

Точечный opt-out есть только у dispatch-гарда: `BBM_DISPATCH_GUARD_DISABLE=1`.

## Состав

| Хук                                     | Событие / matcher                                         | Семантика                                                                                                                                                                                                                                                                          | Carve-out'ы                                                                                                                                                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-flag-writer.mjs`               | SessionStart, UserPromptSubmit                            | пишет `.claude/parallel-sessions.flag.json` (живая сессия = `.jsonl` с mtime < 10 мин); нет параллели — файл удаляется                                                                                                                                                             | —                                                                                                                                                                                                                                                                                |
| `worktree-path-guard.mjs`               | PreToolUse `Edit\|Write\|MultiEdit`                       | **BLOCK** записи абсолютным путём из worktree в общий чекаут; **WARN** один раз на первую запись в общее дерево при живой параллели                                                                                                                                                | путь внутри своего worktree; путь вне репо; нет живых параллельных сессий                                                                                                                                                                                                        |
| `main-tree-read-guard.mjs`              | PreToolUse `Read\|Grep\|Glob`                             | **WARN** о чтении исходников общего чекаута при живой параллели                                                                                                                                                                                                                    | изолированная сессия; `.claude/` и `.git/`; read-only лид — одно смягчённое уведомление; после первой записи — не чаще раза в 5 минут                                                                                                                                            |
| `dispatch-guard.mjs`                    | PreToolUse `Agent\|Task\|Edit\|Write\|MultiEdit`          | **WARN** на 3 правки лида подряд в общем дереве без Agent между ними (task-cycle stage 3); **WARN** on a dispatch brief that stages output to disk instead of applying it (retro 2026-08-05)                                                                                       | worktree-сессия и `BBM_DISPATCH_GUARD_DISABLE=1` — для ОБЕИХ половин; `Agent` сбрасывает счётчик; an explicit `STAGED: irreversible\|conflicting\|owner-preapproval` token in the brief; a read-only brief that merely says «do not mutate» is not staging                       |
| `agent-model-guard.mjs`                 | PreToolUse `Agent\|Task`                                  | **BLOCK** вызова субагента без явного `model` (и явного Fable) — CLAUDE.md «Subagents and models»                                                                                                                                                                                  | `subagent_type: "fork"` (там `model` игнорируется самим инструментом)                                                                                                                                                                                                            |
| `askuserquestion-context-guard.mjs`     | PreToolUse `AskUserQuestion`                              | **BLOCK** a question the owner cannot answer from its own text: a still-UNANSWERED header re-asked without being expanded ≥2× the FIRST ask, or a question < 120 chars leaning on a bare `#N` (the owner sees only question+options — prose between tool calls never reaches them) | a header asked for the first time; an answered header (a `The user answered:` line after the ask clears it); a rewrite ≥2× the fixed baseline — allowed repeats never raise it; a self-contained question ≥120 chars; a hex colour (`#4a90e2`); unreadable `questions[]` payload |
| `secret-echo-guard.mjs`                 | PreToolUse `Bash`                                         | **BLOCK** команды, печатающей секрет в вывод сессии (`cat/head/grep/Get-Content …` по `.env`/credentials/token, `echo $*_TOKEN`)                                                                                                                                                   | `*.example`; редирект в файл; присваивание в переменную; исходники с «token» в имени (`.ts/.css/.md/…`)                                                                                                                                                                          |
| `merge-gate.mjs`                        | PreToolUse `Bash` (`gh pr merge`)                         | **WARN**-чеклист stage 6                                                                                                                                                                                                                                                           | — (определить из хука, загружен ли скилл, нельзя — предупреждает всегда)                                                                                                                                                                                                         |
| `completion-report-gate.mjs`            | Stop                                                      | **BLOCK** остановки, если отчёт о завершении не несёт «Проверить глазами: \<URL\>» либо «визуально ничего не меняется»                                                                                                                                                             | сессия без write-действия в транскрипте — read-only ход ничего не завершал (#158); вопрос владельцу коротким ходом; промежуточный статус; предложение следующего шага; `stop_hook_active` (блок ровно один раз)                                                                  |
| `deviations-gate.mjs`                   | Stop                                                      | **BLOCK** остановки, если в отчёте нет строки stage 7 «Отклонения от конвенций:»; also **BLOCK** a self-certified «нет» when the transcript carries an owner halt or an earlier Stop-gate block (retro 2026-08-05)                                                                 | те же, что у completion-report-gate, включая сессию без write-действия (#158) — распознаватель общий; a report that LISTS deviations always passes, so a corrected report ends the loop                                                                                          |
| `surface-decision-debt-gate.mjs`        | Stop                                                      | **WARN** (#134; promotion → BLOCK per `docs/ci-guardrails.md` §4/§6): a completion report without a `surface-decision-debt:` routing line — deviations-gate names deviations, this line says where each was routed                                                                 | same recognizer and carve-outs as completion-report-gate (imported, not mirrored), incl. a session with no write action in the transcript (#158); `stop_hook_active`                                                                                                             |
| `handoff-verify-reminder.mjs`           | UserPromptSubmit                                          | **WARN** on a handoff-shaped prompt: reminds to run `pnpm handoff:verify` before acting on inherited claims (task-cycle stage 1 — handoff = hypotheses); injects the reminder as `additionalContext` so the MODEL sees it, plus a `systemMessage` for the operator                 | non-handoff prompts; short prompts                                                                                                                                                                                                                                               |
| `context-budget.mjs`                    | UserPromptSubmit                                          | advisory to the operator: `systemMessage` at ~110K tokens (warn) and ~120K (suggest wrapping up); never blocks, never emits `additionalContext`                                                                                                                                    | transcript below the tiers; unreadable transcript                                                                                                                                                                                                                                |
| `screenshot-path-guard.mjs`             | PreToolUse `mcp__.*__browser_(take_screenshot\|pdf_save)` | **WARN** (#134; promotion → BLOCK per `docs/ci-guardrails.md` §4/§6): a browser screenshot/pdf targeted at repo working trees instead of the git-ignored artifact sinks (`.playwright-mcp/`, `test-results/`, `playwright-report/`)                                                | target already under an allowed sink; paths outside the guarded roots (incl. the session scratchpad — silent, but the warn text says not to retarget there)                                                                                                                      |
| `askuserquestion-calibration-guard.mjs` | PreToolUse `AskUserQuestion`                              | **WARN** calibration of the question itself: whose decision is it (lead-decidable → don't ask), option copy quality, repo jargon the owner can't parse. Jurisdiction split with the context-guard is deliberate: that one owns askability/self-containment, this one owns quality  | clean questions; the context-guard's subjects (bare `#N`, unanswered repeats) are excluded here by design                                                                                                                                                                        |

Не гейт, но живёт в том же стеке настроек: `tools/gh/session-bootstrap.mjs`
(SessionStart) печатает снапшот ≤2 KB — git/PR/board/рекомендация; never-throw,
любая внутренняя ошибка деградирует в диагностическую строку с `exit 0`.

## Инженерный контракт

- **Fail-open.** Любая внутренняя ошибка хука — `exit 0`. Баг гейта не должен
  блокировать работу; блокирует только распознанное нарушение.
- **Отчёт о завершении требует write-действия** (#158). Все три Stop-гейта ходят
  через `isEnforceableTerminalReport()` из `completion-report-gate.mjs`: текст
  читается как отчёт И `hasWriteAction()` нашёл в транскрипте хотя бы одно
  write-действие (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`; диспатч
  `Agent`/`Task`; `Bash`/`PowerShell` по узкому белому списку мутаций — тела
  heredoc'ов и кавычек из строки вырезаются, упоминание команды не команда;
  `mcp__*`-инструмент с мутирующим глаголом в хвосте имени, а MCP-диспетчер
  (`plane_execute`) — по операции в своих аргументах, не по имени. Точный состав
  в самом файле). Read-only сессия ничего не завершала, отчитываться ей не о чем.
  Нечитаемый транскрипт ответа не даёт — гейты молчат (fail-open).
- **WARN не выдаёт разрешений.** Предупреждающий хук печатает только
  `systemMessage` и не отдаёт `permissionDecision` — иначе он бы
  преавторизовывал ровно тот вызов, который пометил (ревью PR #99).
- **Чистые seam-функции** решения экспортируются отдельно от `main()`
  (entry-point guard), тесты — `tests/unit/hooks-*.spec.ts`.
- **Корень репо** резолвится через `git rev-parse --git-common-dir`: команды
  исполняются из cwd сессии, а состояние принадлежит основному дереву.
- **Состояние** (`.claude/parallel-sessions.flag.json`, `.claude/*-guard-state/`)
  машинное и в `.gitignore`; удалить его безопасно в любой момент.
- **`tools/hooks/*.mjs` держатся в LF** (`.gitattributes`): шебанг + CRLF ломает
  импорт seam'ов в vitest, и видно это только на Windows.

## Известное ограничение

Живость сессий меряется по mtime транскрипта. Лид, который 10+ минут ждёт
возврата субагента, перестаёт считаться живым для чужих гардов — ошибка в
безопасную сторону (гарды молчат, а не шумят).
