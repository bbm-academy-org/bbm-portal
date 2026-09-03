# Enforcement-хуки (issue #91)

Стек исполняемых гейтов, привязанный в `.claude/settings.json`. Он **закоммичен
в репо**, то есть включается сам во всех сессиях этого репозитория и меняет их
поведение — поэтому хуки, которые блокируют, помечены **BLOCK** в таблице ниже.

Причина существования: правило, которое рецидивирует, переезжает из прозы в
исполняемый гейт (task-cycle SKILL.md, «Enforcement hooks»). Каждый файл в шапке
называет свой симптом-первопричину.

## Рубильник

```sh
BBM_HOOKS_DISABLE=1   # выключает ВЕСЬ стек — уважают все хуки без исключения
```

Точечный opt-out есть только у dispatch-гарда: `BBM_DISPATCH_GUARD_DISABLE=1`.
У zero-dispatch-гарда (#322) рубильника НЕТ — у него есть одноразовый
записанный побег `DISPATCH_BYPASS="<причина>"`: он пропускает ровно одну
мутацию и печатает причину в лог сессии. Это сознательно разные вещи —
рубильник молчит, побег оставляет запись.

**Побег берётся ИЗ заблокированной сессии, а не при старте `claude`** (ревью
PR #346). Env харнеса сессия поменять не может: `export` живёт в под-оболочке
Bash, а у `Edit`/`Write` env-канала нет вовсе. Поэтому каналов два, по форме
вызова:

```sh
# Bash — префикс прямо в команде; хук читает саму строку команды
DISPATCH_BYPASS="триаж бэклога, правки текста issue" gh issue edit 322 --body-file b.md
```

```powershell
# PowerShell — тот же канал, СВОЙ синтаксис. Bash-префикс тут не присваивание:
# строка разбирается как команда с именем `DISPATCH_BYPASS=…` и падает, поэтому
# побегом он не считается и причину НЕ расходует (ревью PR #346).
$env:DISPATCH_BYPASS='триаж бэклога, правки текста issue'; gh issue edit 322 --body-file b.md
```

```sh
# Edit / Write — файл-побег; команда НЕ мутирующая, поэтому проходит сквозь блок.
# Точный путь печатает само сообщение блока: session_id знает хук, а не сессия.
node tools/hooks/zero-dispatch-guard.mjs --arm-bypass "<путь из сообщения>" "<причина>"
```

Оба требуют причину (пустая строка побегом не является), печатают её в stderr,
пропускают ровно СЛЕДУЮЩУЮ мутацию и не примут ЛЮБУЮ уже израсходованную за эту
сессию причину — состояние хранит весь список, поэтому чередованием двух причин
побег не размножается. Свежая причина работает всегда: это запись, а не
рубильник.

## Состав

| Хук                                     | Событие / matcher                                                                | Семантика                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Carve-out'ы                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-flag-writer.mjs`               | SessionStart, UserPromptSubmit                                                   | пишет `.claude/parallel-sessions.flag.json` (живая сессия = `.jsonl` с mtime < 10 мин); нет параллели — файл удаляется                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `worktree-path-guard.mjs`               | PreToolUse `Edit\|Write\|MultiEdit`                                              | **BLOCK** записи абсолютным путём из worktree в общий чекаут; **WARN** один раз на первую запись в общее дерево при живой параллели                                                                                                                                                                                                                                                                                                                                       | путь внутри ЛЮБОГО worktree (`.claude/worktrees/…` — общим чекаутом не является, #187); путь вне репо; нет живых параллельных сессий                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `main-tree-read-guard.mjs`              | PreToolUse `Read\|Grep\|Glob`                                                    | **WARN** о чтении исходников общего чекаута при живой параллели                                                                                                                                                                                                                                                                                                                                                                                                           | изолированная сессия; `.claude/` и `.git/`; read-only лид — одно смягчённое уведомление; после первой записи — не чаще раза в 5 минут                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `dispatch-guard.mjs`                    | PreToolUse `Agent\|Task\|Edit\|Write\|MultiEdit`                                 | **WARN** на 3 правки лида подряд в общем дереве без Agent между ними (task-cycle stage 3); **WARN** on a dispatch brief that stages output to disk instead of applying it (retro 2026-08-05)                                                                                                                                                                                                                                                                              | worktree-сессия и `BBM_DISPATCH_GUARD_DISABLE=1` — для ОБЕИХ половин; `Agent` сбрасывает счётчик; an explicit `STAGED: irreversible\|conflicting\|owner-preapproval` token in the brief; a read-only brief that merely says «do not mutate» is not staging                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `zero-dispatch-guard.mjs`               | PreToolUse `Agent\|Task\|Edit\|Write\|MultiEdit\|NotebookEdit\|Bash\|PowerShell` | **BLOCK** на 6-й мутации лида ЗА СЕССИЮ при НУЛЕ вызовов `Agent` (#322, ретро 2026-08-24: «Почему ты опять делаешь всё инлайн?»). Отличие от `dispatch-guard` — тот считает ПОДРЯД и предупреждает, этот считает НАКОПИТЕЛЬНО и блокирует; порог 6 = два полных цикла того WARN'а                                                                                                                                                                                         | сессия-субагент (env `AI_AGENT`, либо `"promptSource":"sdk"` / `"isSidechain":true` в транскрипте); worktree-сессия; ПЕРВЫЙ же `Agent` снимает гард до конца сессии; одноразовый записанный побег `DISPATCH_BYPASS="<причина>"` — ДОСТИЖИМ из заблокированной сессии двумя каналами (инлайн-префикс команды: Bash `DISPATCH_BYPASS="<причина>" <cmd>`, PowerShell `$env:DISPATCH_BYPASS='<причина>'; <cmd>` — форма чужой оболочки причину НЕ расходует; `--arm-bypass`-файл для Edit/Write, путь печатает сообщение блока), пропускает ровно следующую мутацию, ЛЮБУЮ уже израсходованную за сессию причину второй раз не принимает, печатает причину в stderr и обязывает вписать её в строку stage 7 «Отклонения от конвенций:». Триаж-сессия (6 инлайновых `gh issue edit`) под блок ПОПАДАЕТ — это решение, а не промах: ответ на неё побег, а не расширение предиката (`docs/ci-guardrails.md` §6) |
| `agent-model-guard.mjs`                 | PreToolUse `Agent\|Task`                                                         | **BLOCK** вызова субагента без явного `model` (и явного Fable) — CLAUDE.md «Subagents and models»                                                                                                                                                                                                                                                                                                                                                                         | `subagent_type: "fork"` (там `model` игнорируется самим инструментом)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `askuserquestion-context-guard.mjs`     | PreToolUse `AskUserQuestion`                                                     | **BLOCK** a question the owner cannot answer from its own text: a still-UNANSWERED header re-asked without being expanded ≥2× the FIRST ask, or a question < 120 chars leaning on a bare `#N` (the owner sees only question+options — prose between tool calls never reaches them)                                                                                                                                                                                        | a header asked for the first time; an answered header (a `The user answered:` line after the ask clears it); a rewrite ≥2× the fixed baseline — allowed repeats never raise it; a self-contained question ≥120 chars; a hex colour (`#4a90e2`); unreadable `questions[]` payload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `secret-echo-guard.mjs`                 | PreToolUse `Bash`                                                                | **BLOCK** команды, печатающей секрет в вывод сессии: читатели секретных путей (`cat/head/grep/Get-Content …` по `.env`/credentials/token), `echo $*_TOKEN`, и (#262) дампы резолвнутого окружения — `docker compose config`, `docker inspect` без Env-безопасного `--format`, `env`/`printenv`. Обёртки `ssh <host> …`, `docker exec <c> …`, `sudo`, `bash -c "…"` снимаются и разбираются теми же правилами                                                              | `*.example`; редирект **стдаута** в файл (`2>/dev/null` не считается); присваивание в переменную; исходники с «token» в имени (`.ts/.css/.md/…`); флаги compose, не печатающие значений; `docker inspect --format` без `Env`; префиксная форма `env VAR=x cmd`; `printenv <НЕсекретное имя>`; ПАТТЕРН поиска у `grep`/`rg`/`sed`/`awk` — `grep -n -i "secret\|deploy" file` ищет СЛОВО и путём не считается, файловые операнды судятся как раньше (#268) — инвариант `patternFreeArgs`: из кандидатов уходит ровно паттерн и никогда файловый операнд, поэтому список опций-со-значением сведён к числовым (`-m`/`-A`/`-B`/`-C`), а «значение-таки путь» (`-f`/`--file`) вообще отключает позиционный поиск; расширять этот список — значит рисковать стереть настоящий путь. Точный список предикатов — в самом гарде                                                                                   |
| `merge-gate.mjs`                        | PreToolUse `Bash` (`gh pr merge`)                                                | **WARN**-чеклист stage 6                                                                                                                                                                                                                                                                                                                                                                                                                                                  | — (определить из хука, загружен ли скилл, нельзя — предупреждает всегда)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `completion-report-gate.mjs`            | Stop                                                                             | **BLOCK** остановки, если отчёт о завершении не несёт «Проверить глазами: \<URL\>» либо «визуально ничего не меняется»                                                                                                                                                                                                                                                                                                                                                    | сессия без write-действия в транскрипте — read-only ход ничего не завершал (#158); ОБЪЯВЛЕННЫЕ формы — промежуточный маркер «Статус промежуточный» (#299) и форма вопроса владельцу: строка-маркер «Вопрос владельцу:» (единственное число) либо «Вопрос N из M» (#392), ЛИБО два и более из четырёх тактов «что случилось / почему спрашиваю / что изменит ответ / где посмотреть», каждый отдельной строкой (#374); МНОЖЕСТВЕННОЕ «Вопросы владельцу» маркером не является — это пункт 5 самого отчёта; вопрос владельцу коротким ходом; промежуточный статус по эвристике; предложение следующего шага; `stop_hook_active` (блок ровно один раз); бюджет 1 блок/сессию (#392) — второе нарушение демотируется в `systemMessage`                                                                                                                                                                       |
| `deviations-gate.mjs`                   | Stop                                                                             | **BLOCK** остановки, если в отчёте нет строки stage 7 «Отклонения от конвенций:»; also **BLOCK** a self-certified «нет» when the transcript carries an owner halt or an earlier Stop-gate block (retro 2026-08-05)                                                                                                                                                                                                                                                        | те же, что у completion-report-gate, включая сессию без write-действия (#158) — распознаватель общий; a report that LISTS deviations always passes, so a corrected report ends the loop; бюджет 1 блок/сессию (#392), общий для обеих веток блока этого гейта                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `surface-decision-debt-gate.mjs`        | Stop                                                                             | **WARN** (#134; promotion → BLOCK per `docs/ci-guardrails.md` §4/§6): a completion report without a `surface-decision-debt:` routing line — deviations-gate names deviations, this line says where each was routed                                                                                                                                                                                                                                                        | same recognizer and carve-outs as completion-report-gate (imported, not mirrored), incl. a session with no write action in the transcript (#158); `stop_hook_active`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `handoff-verify-reminder.mjs`           | UserPromptSubmit                                                                 | **WARN** on a handoff-shaped prompt: reminds to run `pnpm handoff:verify` before acting on inherited claims (task-cycle stage 1 — handoff = hypotheses); injects the reminder as `additionalContext` so the MODEL sees it, plus a `systemMessage` for the operator                                                                                                                                                                                                        | non-handoff prompts; short prompts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `context-budget.mjs`                    | UserPromptSubmit                                                                 | advisory to the operator: `systemMessage` at ~110K tokens (warn) and ~120K (suggest wrapping up); never blocks, never emits `additionalContext` — сиблинг `lead-context-budget.mjs` (тот, наоборот, говорит МОДЕЛИ и ставит забор на диспатч)                                                                                                                                                                                                                             | transcript below the tiers; unreadable transcript                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `lead-context-budget.mjs`               | PreToolUse `Agent\|Task`                                                         | **WARN** лиду при ≈150K токенов контекста (`additionalContext`: волну в полёте довести, новую не начинать, довести задачу до точки остановки, финальный отчёт + handoff) и **BLOCK** НОВОГО диспатча при ≈160K (`permissionDecision: "deny"`, #457, порт из ds-platform). Обращён к МОДЕЛИ — в отличие от сиблинга `context-budget.mjs` (тот только к оператору); безопасно, потому что срабатывает ровно в момент запроса НОВОГО диспатча и ничего в полёте не прерывает | вызов ИЗ субагента (`agent_id` в payload) — молчит; маркер `.claude/lead-budget-override` снимает оба порога, но ГРОМКО (`additionalContext` называет override); `BBM_HOOKS_DISABLE=1`; нечитаемый/отсутствующий `transcript_path` — молча exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `screenshot-path-guard.mjs`             | PreToolUse `mcp__.*__browser_(take_screenshot\|pdf_save)`                        | **BLOCK** (exit 2; #134, promoted 2026-09-02 per `docs/ci-guardrails.md` §4/§6 — #438): a browser screenshot/pdf targeted at repo working trees instead of the git-ignored artifact sinks (`.playwright-mcp/`, `test-results/`, `playwright-report/`)                                                                                                                                                                                                                     | target already under an allowed sink; paths outside the guarded roots (incl. the session scratchpad — silent, but the denial text says not to retarget there)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `askuserquestion-calibration-guard.mjs` | PreToolUse `AskUserQuestion`                                                     | **WARN** calibration of the question itself: whose decision is it (lead-decidable → don't ask), option copy quality, repo jargon the owner can't parse. Jurisdiction split with the context-guard is deliberate: that one owns askability/self-containment, this one owns quality                                                                                                                                                                                         | clean questions; the context-guard's subjects (bare `#N`, unanswered repeats) are excluded here by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Для Codex формулировка «первый `Agent` снимает гард» в таблице означает первый
подтверждённый `SubagentStart`: отклонённая параллельным PreToolUse-гардом попытка
`spawn_agent` состояние не меняет.

Не гейт, но живёт в том же стеке настроек: `tools/gh/session-bootstrap.mjs`
(SessionStart) печатает снапшот ≤2 KB — git/PR/board/рекомендация; never-throw,
любая внутренняя ошибка деградирует в диагностическую строку с `exit 0`.

## Codex compatibility

`.codex/hooks.json` binds the critical compatible policy to Codex. `shared.mjs`
normalizes representative Codex tool payloads (`apply_patch`, `spawn_agent`,
and shell) before existing PreToolUse guards see them.
`write-evidence-recorder.mjs` records stable PostToolUse write evidence, and
`codex-stop-adapter.mjs` combines that evidence with Codex's
`last_assistant_message` field before calling the existing three Stop decision
seams. It does not parse the unstable Codex JSONL format to decide whether a
session wrote. The same recorder also persists owner-halt wording from stable
UserPromptSubmit prompts, preserving the deviations self-certification block at
Stop. Exact advisory parity is not claimed: arbitrary shell reads do not map
safely to Claude read tools, and Codex prompts expose no stable token count for
the context-budget advisory. Both advisory paths stay fail-open/manual.

`codex-subagent-turn-recorder.mjs` closes the lead-vs-executor gap without
reading Codex JSONL. `SubagentStart` confirms a successful dispatch and writes a
marker for the stable `session_id` + `turn_id` pair. `SubagentStop` preserves it
because another matching hook can continue that exact child turn; terminal
`SessionEnd` removes every executor marker owned by the session. A PreToolUse
call has executor identity only for that exact turn, so the parent does not
inherit it even though Codex subagent hooks use the parent's `session_id`; the
confirmed dispatch separately disarms the session-wide guard.
`zero-dispatch-guard.mjs` is therefore wired for Codex too: the lead blocks on
mutation 6 with zero successful `spawn_agent`; a rejected PreToolUse attempt
does not disarm it, while the first SubagentStart does. The same recorded
one-shot bypass remains available. A present but unreadable executor marker
fails toward exemption rather than false-blocking an executor.

Changes to `.codex/hooks.json` alter the project-hook trust definition. After
pulling such a change, inspect and trust the exact definitions again in `/hooks`.

Setup, Node 22, one-time `/hooks` trust, generated skill discovery, and the
explicit DesignSync exclusion are documented in
[`docs/codex-agent-mode.md`](../../docs/codex-agent-mode.md).

## Инженерный контракт

- **Fail-open.** Любая внутренняя ошибка хука — `exit 0`. Баг гейта не должен
  блокировать работу; блокирует только распознанное нарушение.
- **Отчёт о завершении требует write-действия** (#158, состав пересмотрен #439).
  Все три Stop-гейта ходят
  через `isEnforceableTerminalReport()` из `completion-report-gate.mjs`: текст
  читается как отчёт И `hasWriteAction()` нашёл в транскрипте хотя бы одно
  write-действие (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`;
  `Bash`/`PowerShell` по узкому белому списку мутаций — тела
  heredoc'ов и кавычек из строки вырезаются, упоминание команды не команда;
  `mcp__*`-инструмент с мутирующим глаголом в хвосте имени, а MCP-диспетчер
  (`plane_execute`) — по операции в своих аргументах, не по имени. Точный состав
  в самом файле). Read-only сессия ничего не завершала, отчитываться ей не о чем.
  Нечитаемый транскрипт ответа не даёт — гейты молчат (fail-open).
- **Диспатч субагента write-действием НЕ считается** (#439, груминг с Антоном
  2026-09-02 — четвёртый инцидент этого семейства). До #439 `Agent`/`Task` были
  в списке выше по доводу #158 «писали субагенты, отчитывается лид». Цена довода:
  сессия груминга/ретро, которая только читала канон, звала `gh issue view` и
  раздавала READ-ONLY разведку, была зачислена в пишущие, и оба BLOCK-гейта
  требовали от неё форму stage 6 за работу, которой не было. Диспатч на вопрос
  гейта не отвечает — что сделал субагент, лежит в ЕГО транскрипте, не в этом.
  Оркестрирующий лид из-под гейтов не выпадает: он приземляет работу сам
  (`pnpm pr:land` / `gh pr merge`) и пишет закрывающий комментарий stage 7
  (`gh issue comment` / `gh issue close`) — обе команды в белом списке мутаций.
  То же и в Codex-плоскости: `spawn_agent` нормализуется в `Agent` и уликой не
  является. Развёрнутое обоснование — в шапке `isWriteToolUse()`.
- **Невернувшийся фоновый агент снимает гейты** (#415). Диспатч `Agent`/`Task`,
  на `tool_use_id` которого нет ни одного `tool_result`
  (`hasUnreturnedDispatch()`), — это фан-аут В ПОЛЁТЕ: ход, который его
  объявляет, терминальным отчётом быть не может по построению, какие бы глаголы
  завершения в нём ни стояли. Наблюдение владельца 2026-08-31: на ВТОРОМ ходе
  сессии сообщение перечисляло, ЧТО ревьюят пять запущенных агентов («ревью кода
  смерженных PR #402, #407, …»), — глаголы принадлежали ОБЪЕКТУ их работы, и
  сработали все три гейта разом. Тем же #415 в `PROPOSAL_INFLIGHT_RE` добавлены
  формулировки фан-аута («агенты запущены», «работают в фоне», «когда …
  отчитаются», «background agents»); семейство «жду отчёт…» в список НЕ входит —
  оно ловится внутри настоящего финального отчёта («жду отчёта CI»), а случай
  ожидания и без словаря покрыт точнее, самим диспатчем (ревью PR #417).
  **Скан ограничен ХВОСТОМ транскрипта** — записями после ПОСЛЕДНЕГО настоящего
  хода пользователя (`isUserTurnBoundary()`): утверждение здесь «сессия ждёт
  агентов ПРЯМО СЕЙЧАС», а без границы один невернувшийся диспатч снимал бы все
  три гейта до конца сессии и во всякой сессии, продолженной на том же JSONL.
  Границей считается запись `type:"user"`, в контенте которой НЕТ блока
  `tool_result`: возврат инструмента приходит такой же записью пользователя, и
  считать границей всякую из них значило бы обрывать хвост на первом же
  вернувшемся агенте, теряя второго, ещё висящего. Блок `tool_use` БЕЗ `id`
  сопоставить не с чем, уликой он не считается — иначе транскрипт без id снимал
  бы гейты со всякой сессии, раздавшей субагентов (#158).
- **Механический пол объёма транскрипта** (#415, решение владельца, Антон,
  2026-08-31). Транскрипт легче `VOLUME_FLOOR_BYTES` (300 КБ) **ИЛИ** короче
  `VOLUME_FLOOR_ASSISTANT_TURNS` (25 записей `"type":"assistant"`) — сессия
  такого объёма концом задачи быть не может, и гейты на ней молчат
  (`isBelowVolumeFloor()`). ИЛИ, а не И: байты искажают картинки, вшитые в блоки
  `tool_result`, число записей не искажает ничто. Порог именно 300 КБ, а не
  850: из 74 транскриптов проекта с write- или dispatch-действием 17 лежат ниже
  850 КБ и лишь 2 — ниже 300 КБ, то есть порог повыше молча выключил бы гейт в
  четверти реальных сессий.
- **Объявленная форма бьёт эвристику** (#299, затем #374, затем #392).
  Распознаватель знает формы, которые канон предписывает, и читает каждую как она
  объявлена: маркер «Статус промежуточный» и вопрос владельцу
  (`.claude/skills/report-task-outcome/SKILL.md` → «Owner-question form») — либо
  по ОБЪЯВЛЕННОЙ строке-маркеру, либо по двум и более из четырёх тактов, каждый
  отдельной строкой. Форму задаёт скилл, а не хук; точные предикаты
  (`EXPLICIT_INTERIM_MARKER_RE`, `OWNER_QUESTION_MARKER_RE`, `QUESTION_BEAT_RES`,
  `isOwnerQuestionForm`) — в `completion-report-gate.mjs`.
  **Единственное и постоянное исключение — МНОЖЕСТВЕННОЕ «Вопросы владельцу»:**
  это пункт 5 обязательного отчёта, и распознавать его значило бы освобождать от
  гейтов ПРАВИЛЬНО оформленный отчёт (ревью PR #375, та же дыра, что закрыта в
  ревью PR #99). Маркерами являются только единственное «Вопрос владельцу:» и
  нумерованный заголовок «Вопрос N из M» — с этим заголовком отчёта коллизии нет,
  и в этом вся разница. Плата объявлена: финальный отчёт, вписавший в себя форму
  вопроса, уходит из-под всех трёх гейтов — это fail-open по решению, а не
  промах. Направление любой правки здесь — «распознать объявленную форму», а не
  «расширить эвристику».
- **Расхождение с `tools/lint/stage-b-lint.mjs` по цитатам — осознанное.**
  Stop-хуки НЕ вырезают fenced-блоки и инлайн-бэктики, поэтому отчёт, который
  лишь ЦИТИРУЕТ маркер (например, отчёт про этот самый механизм), освобождает
  себя от всех трёх гейтов. `stage-b-lint` в такой же ситуации цитату вырезает
  («текст, который лишь _рассказывает_ о маркере, доказательством не является»).
  Оба поведения намеренные и живут в разных плоскостях: lint судит PR как
  доказательство, Stop-хук читает намерение автора хода и уже объявлен
  fail-open. Если это когда-нибудь начнут эксплуатировать — чинить надо здесь,
  добавив вырезание fenced-блоков в `EXPLICIT_INTERIM_MARKER_RE` и
  `OWNER_QUESTION_MARKER_RE` разом, а не по одному.
- **Бюджет блоков: 1 блок на гейт на сессию** (#392). Каждый из двух BLOCK-гейтов
  блокирует остановку не более одного раза за сессию; следующее распознанное
  нарушение демотируется в `systemMessage` и `exit 0`. Решение — чистая функция
  `applyBlockBudget()` в `shared.mjs`, состояние — per-session файл в
  `.claude/stop-gate-budget-state/` (`{blocked: {"completion-report": true,
"deviations": true}}`), I/O живёт в `main()` каждого гейта. У deviations-гейта
  обе ветки блока (нет строки stage 7 / самосертификация «нет») делят ОДИН ключ:
  для сессии это один и тот же гейт. Fail-open: нечитаемое или потерянное
  состояние читается как «ещё не блокировал» — цена ровно один лишний блок.
  Зачем: распознавание свободной прозы — игра в кошки-мышки (#158 → #299 → #374 →
  #392, три жалобы владельца подряд), и цена ошибки распознавателя должна быть
  ОГРАНИЧЕНА, не снимая с гейтов их BLOCK-плоскость целиком.
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
