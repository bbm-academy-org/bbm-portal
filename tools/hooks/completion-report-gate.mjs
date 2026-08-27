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
// DECLARED FORMS BEAT HEURISTICS (#299, then #374). The recognizer knows two
// forms the canon mandates and reads each as itself: «Статус промежуточный»
// (`EXPLICIT_INTERIM_MARKER_RE`) and the FOUR BEATS of the owner question
// (`isOwnerQuestionForm`, canon: `.claude/skills/report-task-outcome/SKILL.md`,
// «Owner-question form»). Incident 2026-08-26: a canonical owner question tripped
// both BLOCK gates — «закрыты» was domain speech, `#338` was a spec reference —
// so almost every question was blocked once and re-sent, and the owner saw it
// twice. The direction of every fix here is «recognize the declared form», never
// «widen the heuristics».
//
// Контракт Stop-хука: stdin — {session_id, transcript_path, stop_hook_active}.
// exit 0 = остановка разрешена; exit 2 + stderr = остановка заблокирована,
// текст уходит модели. Loop-guard: при `stop_hook_active` никогда не exit 2 —
// сессия уже продолжена после одного блока. FAIL-OPEN: нет транскрипта, битый
// JSON, нет ассистентских сообщений → exit 0.

import { readFileSync } from 'node:fs'

import {
  applyBlockBudget,
  blockBudgetStatePath,
  budgetDemotedMessage,
  emitWarn,
  hasSpentBlockBudget,
  hooksDisabled,
  isDirectRun,
  mainRepoRoot,
  readHookPayload,
  readState,
  recordBlockBudgetSpend,
} from './shared.mjs'

/** This gate's key in the shared per-session block-budget state (#392). */
export const BUDGET_KEY = 'completion-report'

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

/** Промежуточный статус: подшаг смержен, задача — нет. Порядок слов инверсируется
 * свободно («промежуточный статус» / «Статус промежуточный») — ретро 2026-08-19:
 * инверсный чекпойнт проходил под Stop-гейты как терминальный отчёт. В инверсной
 * форме между словами почти всегда стоит разделитель («Статус: промежуточный»,
 * «статус — промежуточный»), поэтому там допускается не только пробел (ревью PR #290). */
export const INTERIM_STATUS_RE =
  /⏳|\bcheckpoint\b|чекпоинт|\bWIP\b|в процессе|в работе|жду\s+(?:вердикт|CI|ревью|приёмк|ответ)|ещё\s+не\s+(?:смерж|заверш)|промежуточн[а-яё\w]*\s+статус|статус[а-яё\w]*[\s:—–-]+промежуточн/i

/**
 * The EXPLICIT interim marker — the canonical, declared form, as opposed to the
 * heuristic bag above («⏳», «жду CI», «в работе»), which only INFERS a checkpoint.
 *
 * Retro 2026-08-20 (#299), theme `interim-status-ceremony-noise`: the #284 fix
 * did not go far enough. Nine consecutive checkpoints in one session carried the
 * full stage-6/7 tail («Проверить глазами… Честный статус… ~70%… Отклонения от
 * конвенций: нет. surface-decision-debt: none») because the session had no
 * DECLARED way to say "this is not the final report" and paid the ceremony
 * defensively. This marker is that way: one line, matched here, and the canon
 * (`.claude/skills/report-task-outcome/SKILL.md`, «Промежуточный чекпойнт»)
 * states that the marker — not the tail — is what an interim message owes.
 *
 * It is matched on its OWN line so that the phrase quoted inside a sentence of a
 * real final report cannot exempt that report; markdown emphasis and a heading
 * hash are stripped, they carry no meaning here. The trailing lookahead is
 * `(?![а-яё\w])` and not `\b` for the reason the rest of this file already
 * carries: JS word boundaries are ASCII-only and never fire after Cyrillic.
 */
export const EXPLICIT_INTERIM_MARKER_RE =
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?[*_`]*[ \t]*(?:статус[а-яё\w]*[\s:—–-]+промежуточн[а-яё\w]*|промежуточн[а-яё\w]*\s+статус[а-яё\w]*|interim\s+status)(?![а-яё\w])/i

export function hasExplicitInterimMarker(text) {
  return EXPLICIT_INTERIM_MARKER_RE.test(String(text || ''))
}

export function isInterimStatus(text) {
  return hasExplicitInterimMarker(text) || INTERIM_STATUS_RE.test(String(text || ''))
}

/**
 * The DECLARED owner-question form — the second declared form the recognizer
 * knows, next to `EXPLICIT_INTERIM_MARKER_RE` above, and built on the same
 * philosophy: a form the canon MANDATES is read as itself, never re-derived from
 * heuristics.
 *
 * Incident 2026-08-26 (#374), owner's complaint: almost every owner-facing
 * question was blocked once and re-sent, so the owner saw each question twice.
 * The message was in the canonical four-beat form of
 * `.claude/skills/report-task-outcome/SKILL.md` («Owner-question form») —
 * «Вопрос 2 из 8 — … / Что случилось: … / Почему спрашиваю: … / Что изменит
 * ответ: … / Где посмотреть: …» — and every branch of the recognizer missed it:
 * `COMPLETION_VERB_RE` matched «закрыты» in domain speech («записи… временно
 * закрыты на роль»), `REF_RE` matched the spec reference `#338`, and
 * `isDecisionRequest` needs ≤ 4 lines, which the four-beat form never is.
 *
 * THE PLURAL «Вопросы владельцу» IS NEVER A MARKER (review of PR #375,
 * BLOCKER, and still the invariant here): `report-task-outcome` defines point 5
 * of the MANDATORY stage-6 report shape as literally «Вопросы владельцу» on its
 * own line, so recognizing that heading would exempt the CORRECTLY formed final
 * report from all three gates — re-opening through a different door exactly the
 * hole the length condition of `isDecisionRequest` closed in the PR #99 review.
 * PR #375 therefore dropped its whole header branch; #392 brings back only the
 * shapes that do NOT collide with that heading, and pins the plural in both
 * directions by test.
 *
 * INCIDENT 2026-08-27 (#392) — the owner's SECOND complaint, one day later. A
 * free-form binary decision request about PR #354 was blocked and re-sent: it
 * was written as free sections («Что происходит», «Почему мерж не происходит
 * сам», «Что нужно от тебя»), carried ZERO beat labels, and tripped
 * `COMPLETION_VERB_RE` on «Осталось только смержить» plus `REF_RE` on `PR #354`
 * while being far longer than the `isDecisionRequest` four-line cap. The beats
 * are the CONTENT canon, but real questions do not reliably come in that shape —
 * and this one already carried the literal line «Вопрос владельцу: …». So the
 * form gets a second, cheaper entrance: ONE declared marker line.
 */

/**
 * The declared marker line, in the exact style of `EXPLICIT_INTERIM_MARKER_RE`:
 * own line, leading heading hashes and markdown emphasis stripped, Cyrillic-safe
 * `(?![а-яё\w])` lookaheads instead of `\b` (JS word boundaries are ASCII-only
 * and never fire after Cyrillic). Two shapes, and only two:
 *
 *   * «Вопрос владельцу:» — SINGULAR, with the colon (emphasis between the word
 *     and the colon tolerated: `**Вопрос владельцу:**`, `**Вопрос владельцу**:`).
 *     The `вопрос(?![а-яё\w])` lookahead is what keeps the PLURAL «Вопросы
 *     владельцу» — the report's point-5 heading — out, in every one of its forms.
 *   * «Вопрос N из M» — the numbered header of a standalone question, with or
 *     without a trailing colon or dash. It has no collision with any heading a
 *     real report carries, which is precisely why it is safe and the plural is not.
 *
 * The colon is REQUIRED for the singular shape and optional for the numbered
 * one. That asymmetry is deliberate: the colon is what the skill prescribes, and
 * a bare «Вопрос владельцу» is one inflection away from the plural heading the
 * lookahead exists to keep out. It is stated in `report-task-outcome/SKILL.md`
 * so the next author does not learn it by getting blocked.
 *
 * The prefix class tolerates a list bullet (`- `, `* `, `+ `) and a blockquote
 * (`> `) in front, nested and indented, on the same «the prefix carries no
 * meaning here» principle as the heading hashes (review of PR #393: a free-prose
 * question written inside a bulleted «Что нужно от тебя» section — exactly the
 * 2026-08-27 incident genre — otherwise missed the marker). The bullet group
 * requires the trailing space, which is what disambiguates a `* ` bullet from
 * the `**` of markdown emphasis.
 *
 * NOT stripped, knowingly: fenced code blocks and inline backticks, so a report
 * that merely QUOTES the marker exempts itself. That matches
 * `EXPLICIT_INTERIM_MARKER_RE` and diverges from `tools/lint/stage-b-lint.mjs`,
 * which does strip fences; the divergence is recorded in `tools/hooks/README.md`
 * rather than silently carried.
 */
export const OWNER_QUESTION_MARKER_RE =
  /(?:^|\n)[ \t]*(?:[-*+>][ \t]+)*(?:#{1,6}[ \t]*)?[*_`]*[ \t]*вопрос(?![а-яё\w])[ \t]*(?:владельцу[*_`]*[ \t]*:|\d+[ \t]+из[ \t]+\d+(?![а-яё\w\d]))/i

export function hasOwnerQuestionMarker(text) {
  return OWNER_QUESTION_MARKER_RE.test(String(text || ''))
}

/** The four beat labels of the form, each on its own line and followed by a
 * colon. Markdown emphasis and a heading hash are stripped — they carry no
 * meaning here, as everywhere else in this file. Matching on the OWN line is the
 * same discipline `EXPLICIT_INTERIM_MARKER_RE` carries: a label quoted inside a
 * sentence of a real report is not a beat. Word tails are written `[а-яё\w]*`
 * rather than `\w*` because JS `\w` is ASCII-only and never covers a Cyrillic
 * ending. */
export const QUESTION_BEAT_RES = [
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?[*_`]*[ \t]*что\s+случилось[*_`]*[ \t]*:/i,
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?[*_`]*[ \t]*почему\s+спрашива[а-яё\w]*[*_`]*[ \t]*:/i,
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?[*_`]*[ \t]*что\s+изменит\s+ответ[*_`]*[ \t]*:/i,
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?[*_`]*[ \t]*где\s+посмотреть[*_`]*[ \t]*:/i,
]

/**
 * The declared owner-question form: the declared MARKER line (#392) OR at least
 * TWO DISTINCT beat labels (#374).
 *
 * Two beats and not one, deliberately: «Что случилось:» alone is ordinary prose
 * and appears in real completion reports, while two beats on their own lines is
 * already nobody's accident — it is the canonical form being written out. The
 * marker is the cheap second entrance for a question whose BODY is free prose:
 * the beats remain the content canon, the marker is what the gate can rely on.
 */
export function isOwnerQuestionForm(text) {
  const t = String(text || '')
  if (!t) return false
  if (hasOwnerQuestionMarker(t)) return true
  let beats = 0
  for (const re of QUESTION_BEAT_RES) {
    if (re.test(t)) beats += 1
    if (beats >= 2) return true
  }
  return false
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
  // The DECLARED marker is checked first and beats every other branch (#299):
  // a message that states «Статус промежуточный» is the author saying this is
  // not the final report, and no heuristic below may overrule that declaration.
  if (hasExplicitInterimMarker(text)) return false
  // The second DECLARED form (#374): the canonical owner-question shape from
  // `.claude/skills/report-task-outcome/SKILL.md` («Owner-question form»). It is
  // checked before the heuristics for the same reason as the marker above — the
  // author declared what this message is.
  //
  // The deliberate trade-off: a would-be FINAL report that embeds the four-beat
  // question form escapes all three gates. That is fail-open BY DESIGN, exactly
  // as with the declared interim marker — the recognizer trusts declared forms,
  // and a missed gate on a report costs far less than blocking (and thereby
  // duplicating) every owner question, which is what #374 actually observed.
  if (isOwnerQuestionForm(text)) return false
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

/**
 * Убирает из строки команды всё, что КОМАНДОЙ НЕ ЯВЛЯЕТСЯ: тела heredoc'ов и
 * содержимое кавычек.
 *
 * Ревью PR #159 (MAJOR): белый список бежал по всей строке, а `\n` считался
 * началом команды — поэтому текст, лишь УПОМИНАЮЩИЙ «git commit» (тело
 * коммит-сообщения, body PR-комментария с инструкциями), зачислял сессию в
 * пишущие. Это тот же ложный BLOCK, ради которого заведён #158.
 *
 * Выбранная семантика: цитата — не команда, но настоящая мутация в той же
 * строке ловиться обязана. Поэтому вырезается только СОДЕРЖИМОЕ, а разделители
 * остаются: `git -C "$W" commit` → `git -C "" commit` по-прежнему совпадает, а
 * `gh pr comment … --body "$(cat <<'EOF' … EOF)"` остаётся мутацией по своему
 * глаголу, что бы ни лежало в теле.
 *
 * Порядок важен: heredoc'и первыми (их тело может нести непарные кавычки),
 * двойные кавычки раньше одинарных (`-m "don't"`). Оборванный heredoc —
 * обрезанный транскрипт — режется до конца строки: тело командой не было.
 */
export function stripNonCommandText(command) {
  let s = String(command || '')
  const HEREDOC_BODY_RE = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?![\w-])/g
  const HEREDOC_UNTERMINATED_RE = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1([^\n]*)\n[\s\S]*$/
  // Заменяется на ОСТАТОК строки-открывашки, а не на плейсхолдер с `<<`:
  // плейсхолдер сам подходил под правило оборванного heredoc'а и съедал
  // настоящую команду ПОСЛЕ терминатора (`… EOF\ngit -C x commit`).
  s = s.replace(HEREDOC_BODY_RE, (_m, _q, _d, rest) => rest)
  s = s.replace(HEREDOC_UNTERMINATED_RE, (_m, _q, _d, rest) => rest)
  return s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'[^']*'/g, "''")
}

/**
 * Хвостовой сегмент имени MCP-инструмента: `mcp__<сервер>__<инструмент>` →
 * `<инструмент>`. Решает именно хвост, а не сервер: список серверов меняется
 * от сессии к сессии, а глагол в имени инструмента — нет.
 */
export function mcpToolTail(name) {
  const parts = String(name || '').split('__')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * Мутирующий глагол в имени MCP-инструмента. MCP — такой же способ изменить
 * состояние, как `Edit` и `gh`: в этом окружении включены GitHub MCP
 * (`issue_write`, `add_issue_comment`, `merge_pull_request`, `push_files`, …) и
 * Plane MCP (`plane_execute`, `attach_file`, …), и сессия, чья единственная
 * мутация прошла через них, иначе уходила бы из-под всех трёх гейтов на одном
 * тексте.
 *
 * Философия та же, что у белого списка shell-команд: ловится только явный
 * глагол. Read-shaped имена (`get_*`, `list_*`, `search_*`, `*_read`) не
 * содержат ни одного из них и не считаются. `add`/`set` требуют границу
 * сегмента (`^add_`, `_set$`), чтобы не ловиться внутри слов.
 */
export const MCP_MUTATION_RE =
  /write|create|update|delete|destroy|remove|merge|push|edit|close|import|attach|(?:^|_)add(?:$|_)|(?:^|_)set(?:$|_)/i

/**
 * ДИСПЕТЧЕРЫ: инструменты, которые исполняют ПРОИЗВОЛЬНЫЙ вызов API. Глагол в
 * их имени не говорит ничего — через `plane_execute` идут и `states.list`, и
 * `work-items.create`, поэтому слово «execute» в имени зачисляло в пишущие ЛЮБОЕ
 * обращение к Plane, включая чистое чтение (ревью PR #159). Мутабельность живёт
 * в АРГУМЕНТАХ, там её и надо смотреть; глагол `execute` из имён убран вовсе.
 */
export const MCP_DISPATCHER_TAILS = new Set(['plane_execute'])

/**
 * Операция диспетчера — хвост `endpoint_id` ПОСЛЕ ПОСЛЕДНЕЙ ТОЧКИ
 * (`work-items.create` → `create`). Именно хвост, а не весь идентификатор:
 * `issue-attachments.list` — чтение, но `attach` сидит в имени ресурса и
 * зачислил бы его в записи.
 */
export const MCP_OPERATION_MUTATION_RE =
  /create|update|patch|delete|destroy|remove|merge|archive|upload|import|(?:^|[-_])(?:add|set)(?:$|[-_])/i

/** Мутирующий вызов диспетчера. Нет аргумента — нет улики → false. */
export function isMutatingMcpDispatch(input) {
  const id = String((input && (input.endpoint_id || input.endpointId)) || '')
  if (!id) return false
  return MCP_OPERATION_MUTATION_RE.test(id.slice(id.lastIndexOf('.') + 1))
}

/**
 * Инструменты браузерной автоматизации исключены из проверки выше: они ВОДЯТ
 * страницу, а не мутируют репо или трекер. Без исключения `browser_close`
 * ловился бы словом «close» и превращал сессию приёмки — открыл стенд,
 * посмотрел, закрыл — ровно в тот ложный BLOCK, который чинит #158.
 */
export const MCP_BROWSER_TAIL_RE = /^browser_/i

/** Один блок `tool_use` — write-действие? */
export function isWriteToolUse(name, input) {
  const tool = String(name || '')
  if (WRITE_TOOLS.has(tool) || DISPATCH_TOOLS.has(tool)) return true
  if (SHELL_TOOLS.has(tool)) {
    return MUTATING_COMMAND_RE.test(stripNonCommandText(input && input.command))
  }
  if (tool.startsWith('mcp__')) {
    const tail = mcpToolTail(tool)
    if (MCP_BROWSER_TAIL_RE.test(tail)) return false
    if (MCP_DISPATCHER_TAILS.has(tail)) return isMutatingMcpDispatch(input)
    return MCP_MUTATION_RE.test(tail)
  }
  return false
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
      // PER-SESSION BLOCK BUDGET (#392): this gate blocks at most ONCE per
      // session. A second recognized violation is demoted to a warning, so a
      // recognizer that is wrong about free prose costs the session one block,
      // not one block per message. State I/O lives here — inside the blocking
      // branch, so the overwhelmingly common quiet path pays no `spawnSync`; the
      // decision itself is the pure `applyBlockBudget` seam.
      //
      // NO SESSION ID → NO BUDGET. `stateFilePath` would otherwise fall back to
      // a shared `unknown.json` that nothing ever expires, and one block written
      // there would demote this BLOCK gate to warn-only for every later
      // id-less session on the box — permanently. A gate silently disarmed
      // forever is far worse than one extra block, so this is the one place the
      // fail-open default is inverted (review of PR #393).
      const sessionId = payload.session_id
      const statePath = sessionId
        ? blockBudgetStatePath(mainRepoRoot(process.cwd()), sessionId)
        : null
      const state = statePath ? readState(statePath) : {}
      const budgeted = applyBlockBudget({
        decision,
        alreadyBlocked: Boolean(statePath) && hasSpentBlockBudget(state, BUDGET_KEY),
      })
      if (budgeted.demoted) {
        emitWarn(budgetDemotedMessage(blockMessage()))
        process.exit(0)
      }
      if (statePath) recordBlockBudgetSpend(statePath, state, BUDGET_KEY)
      process.stderr.write(blockMessage())
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail-open: баг гейта не должен ломать нормальную остановку
  }
}

if (isDirectRun(import.meta.url)) main()
