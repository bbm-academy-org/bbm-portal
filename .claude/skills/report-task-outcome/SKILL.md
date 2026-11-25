---
name: report-task-outcome
description: The canon of the owner-facing report — four parts in fixed order («Что изменилось» / «Что нужно от тебя» / «Что дальше» / a collapsed «▸ Технически» appendix that is the only place for ids, paths and the marker lines), the owner's words only in parts 1–3, the «Проверить глазами» line, tracker counts instead of percentages, and the self-contained owner-question form. Use when writing the final report of any task, an interim owner-facing checkpoint, or a mid-thread question to the owner. Project-local; this repo only.
---

# report-task-outcome — the owner-facing report

The format is shared with ds-platform (its `report-task-outcome`). This file
owns the report's shape; `.claude/skills/task-cycle/SKILL.md` stage 6 says
WHEN the report is written and points here for WHAT it is. No hook enforces it
— see «No mechanical check» below.

**Why it is regulated:** a report built from identifiers buried whether the
owner had anything to check or decide at all — «а что мне открыть?», «куда — в
прод?», «я ничерта не понял из твоего отчёта». The form is product-first, and
everything internal is fenced into one appendix the owner may skip.

## When it applies

At the end of any task you report to the owner (a merged PR, a closed issue, a
blocked stop), and — for the words and the question form — to every
owner-facing interim checkpoint too.

**Language:** the report is live dialogue with the owner, so it is written in
**Russian** (`task-canon`: Russian is reserved for owner dialogue and end-user
text; every other artifact is English). The part headings and marker strings
below are fixed tokens — never translated or paraphrased.

**Plain text in chat.** A report, status, summary, retro or plan is chat text —
never an HTML page or a published artifact built for it (owner, 2026-08-15: a
styled page for a simple report added no fact, only layout time). A page is
right only when the owner asks for one or the content is unreadable as text
(an interactive diagram, a dashboard to click); unsure → ask in one line.

## Words

Parts 1–3 — and every chat answer to the owner, not only reports and
checkpoints — use only words the owner used and product nouns — the hours page, the
OKR dashboard, the lead form, the budget dashboard, a partner, an employee. No
internal term there, glossed or not: no issue/PR number, SHA, branch, path,
file, table, module or route name, no «stage N», no `EARS-N` id, no label or
token syntax, no tool, library, hook or guard name. A task is named by its
product meaning («журнал правок», not «#201»); its number lives in the appendix.
A mechanism is always named through the product entity it serves — «гард ЧЕГО?»
must be answerable from the sentence itself. A vendor the owner must act on is
named once, with who it is to us.

_(symptom, owner 2026-08-19: «Я ничерта не понял из твоего отчёта. Можешь
нормальным продуктовым языком разложить, что мы делаем и зачем».)_

## The report — four parts, fixed order

1. **Что изменилось.** For each landed unit, one line that opens with the
   product entity and what a person can now do or will notice — 1–3 sentences in
   total. Merged and live in prod are stated separately: «в прод» only with the
   deploy evidence in the appendix; a merge is never implied to be a deploy.
   Say «работает само» only for an automatic trigger you observed running.
   The part ends with the line

   ```
   Проверить глазами: <URL>
   ```

   — a real URL the owner opens themselves, with the access line (login + where
   the password comes from, in product words — «пароль — в общем файле учёток
   dev-стенда»; the path goes to the appendix) when the surface is behind auth, on every change
   tier: this report follows the deploy, so a Show change is live too. Show's PR
   screenshots were the pre-merge acceptance (task-cycle stage 5), never this
   line. With no visual surface the honest form is the literal alternative
   **«визуально ничего не меняется; проверяется так: \<тест / поведение /
   команда\>»**. Git links — a PR, a commit, a repo page — never go on this
   line: the owner reads them as a faked check.

   **This part is the release note.** On a PR whose body carries a real
   `## Product note (RU)` (`.github/pull_request_template.md`; the
   `product-note` guard, `docs/ci-guardrails.md` §5, makes it non-optional on
   a render-surface diff, and the merge-time Mattermost delivery renders it),
   part 1's product sentences are mirrored there verbatim — the report and the
   team's note are the same text, authored once. Only those sentences: never the
   «Проверить глазами» line, the access line or the merged / in-prod status — the
   note is public, goes to the team channel, and is written before the deploy. `none` there only for a PR nobody
   sees (tooling, docs, backend without UI).

2. **Что нужно от тебя** — or «ничего». Only what the owner decides
   (`AGENTS.md` §3) and what you provably cannot do or check yourself («The
   owner's zone» below). Each item is a question in the owner-question form
   below; a stand handed over carries a login that works on the first click.

3. **Что дальше.** The next step and why, in product words; what is deferred
   and why. It is named as a recommendation, not started without a «go»
   (task-cycle stage 7).

4. **▸ Технически** — the last part, collapsed where the medium folds
   (`<details>` in a GitHub comment); in chat it is simply the final block under
   that heading. It is the ONLY place for `#N`, PR, SHA, `EARS-N`, migrations,
   paths and CI. It holds:
   - the requested outcome vs the actual state — achieved / partial / not
     achieved, with evidence and the remaining acceptance conditions; merge and
     prod stated separately (`смержено в main` ≠ `выкачено в прод, postcheck:
HEAD совпадает`), a prod claim with its deployed SHA or release tag;
   - **tracker counts** — closed / total with the scope named, read from the
     tracker via `gh` («2 из 2 PR», «4 из 6 задач эпика»), **never a
     percentage**; under full, the stop reason comes with it;
   - files, commits, CI, the iteration-summary comment URL
     (`.claude/skills/write-iteration-summary/SKILL.md`);
   - the two marker lines, last:

     ```
     Отклонения от конвенций: <нет | список>
     surface-decision-debt: <[] | по пункту на отклонение — куда ушло>
     ```

     Their meaning and how to derive both is owned by
     `.claude/skills/surface-decision-debt/SKILL.md`; the first is also the
     stage-7 line of the issue's closing comment, repeated here because the
     owner reads the report, not the comment. A «нет» is not available to a
     session the owner had to halt: its deviations are exactly what the line
     exists for.

## No mechanical check — the shape is on you

Nothing reads the final report at session Stop. Three Stop gates used to
(`completion-report-gate`, `deviations-gate`, `surface-decision-debt-gate`); they
were **retired on 2026-11-24** (#589, owner decision, Антон, as ds-platform did
in its `#1744`): every block made the model re-read the whole session and re-emit
the same text — a pure token tax — and the free-prose recognizer behind them
misfired again and again (#158 → #299 → #374 → #392). The retirement record:
`docs/ci-guardrails.md` §6 and `tools/hooks/README.md`.

What went is the forced rewrite, not the contract. The four parts and both
marker lines are what a final report owes **by this canon** — a report without
them is wrong whether or not anything catches it. (`pnpm session:last-report`
finds a past report by its «Проверить глазами:» / «Отклонения от конвенций:»
lines — `tools/session/last-report.mjs` — which is one more reason they stay
literal.)

## The owner's zone — prove there is no own path first (mandatory)

An item in part 2 makes a claim: **that no path of your own exists.** That
claim is checked BEFORE the item is written, not asserted by default.

Walk the four accesses you actually hold, and **name in the appendix which ones
you checked and what each answered**:

1. **ssh hosts** you can reach (the boxes the service in question runs on);
2. **PATs and service accounts** already configured in this environment;
3. **Terraform / provisioning state** — a credential this repo issued, it can
   re-issue;
4. **the provider's own API** with the token you have.

Only after all four come back negative does the item go to the owner, with
part 2 saying in plain words what was tried and why it is blocked. An item
routed with no such check is a guess, and a wrong guess parks work in the
backlog that was never blocked.

_(symptom, owner 2026-08-19: «Почему ты перекладываешь работу на меня? Ты же сам
заводил и прописывал все эти ключи. Сделай всё сам.» — within the same hour the
session rotated the Zitadel client secret, the Plane token, the SSOT-sync key and
the preview token, and rolled S3 credentials onto five boxes. Every one of them
had been routed to the owner's zone a moment earlier.)_

### A fact that exists nowhere in the repo is a stop-state input

The four accesses above answer «can I DO this myself». They do not answer «what
is the value». When the four come back negative **and** the fact itself exists
nowhere in the repo, the environment or the provider's API — an external origin
or URL, an organisation or workspace name, where a credential lives — that fact
is a **stop-state input**: it goes to the owner as a question and the work waits.

**Never a guessed value with a TODO built around it.** A plausible-looking
placeholder compiles, reviews clean and ships; the TODO next to it does not make
the value less wrong, it only records that someone knew it might be. Guessing
also destroys the question: the owner is never asked, because the code looks
answered.

_(symptom, 2026-08-26: a Mattermost origin nobody in the repo knew was guessed
and wrapped in a TODO instead of being asked about.)_

## Промежуточный чекпойнт — the marker, not the parts

An interim message is **not** a final report and does not carry its four parts
or the marker lines. It carries one declared marker line:

```
Статус промежуточный
```

That line declares the message a checkpoint; it must stand on its own line, and
it overrides every other signal in the message — so a checkpoint that mentions a
merged PR is still a checkpoint. Everything else in the message is the actual
content: what just landed, what is running, what is next.

**Do not pay the ceremony defensively.** «Проверить глазами», the appendix, the
tracker counts and «Отклонения от конвенций: нет / surface-decision-debt: []»
belong to the FINAL report of the iteration; repeating them on every checkpoint
buries the content the owner is reading for. _(symptom, 2026-08-20: nine
consecutive checkpoints in one session each carried the full tail.)_ The words
rule and the owner-question form still apply — those are about being
understood, not about ceremony.

## Owner-question form (mandatory)

Every question — in part 2 and in any mid-thread checkpoint — renders as a
self-contained block: **что случилось / почему спрашиваю / что изменит ответ /
где посмотреть** (a live URL or a concrete page — never "посмотри дифф"), then
the options and your recommendation. Banned: internal shorthand and any «см.
issue/отчёт» redirect that makes the owner go read something before they can
parse the question. Self-check each question before sending: someone who read
nothing else must be able to answer it.

**One question at a time, in chat.** Questions go to the chat, ONE per message,
each with its own context; the next is asked after the answer. A batch in one
GitHub comment or a numbered list beside a report is not asking — the owner
declined to answer exactly that (2026-08-26, 2026-08-31); a reminder list is not
a question either. The GitHub comment stays the record of the decision, the
dialogue runs in chat. A report whose part 2 holds more than one item asks the
first and says the rest follow one by one.

**A standalone owner question owes ONE declared line**, on its own line, so the
owner can tell it apart from a report at a glance:

```
Вопрос владельцу: <the question>
```

```
Вопрос N из M — <the subject>
```

**Unanswered across more than two consecutive reports → escalate, do not
restate.** A question that has ridden part 2 of three reports has been shown to
be invisible there: the owner reads the report for what changed. On its third
crossing it leaves the report and is sent as its **own standalone chat message**
— nothing but the question block, and the note that the work is waiting on it.

_(symptom, 2026-08-26: the same owner question restated six times across
consecutive reports, never once asked on its own.)_

## Failure modes

- **A line built from identifiers instead of a product fact**, or any internal
  term in parts 1–3, glossed or not.
- **Filling «Проверить глазами» with a PR or repo link** when there is nothing
  visual — the honest no-visual formula is the correct answer.
- **«Готово / отгружено»** with no landing state — the owner then has to ask
  «куда, в прод?».
- **A percentage** of anything instead of the tracker's closed / total.
- **Part 1 and the PR's `## Product note (RU)` saying different things** — the
  note is the same text, not a second draft.
- **A question you could have answered yourself**, or a lead decision (anything
  off the `AGENTS.md` §3 owner list) pushed into part 2.
- **`surface-decision-debt: []` next to a paragraph describing a deviation** —
  the empty list asserts the opposite of the paragraph.
- **«Отклонения от конвенций: нет» after the owner had to stop the session.**
- **A guessed external value with a `TODO` beside it** — the placeholder ships
  and the question is never asked.
- **The same unanswered question in part 2 for the third report running** — it
  is a standalone message by then.

## Related

- `.claude/skills/task-cycle/SKILL.md` — stages 5–7: when this report is due.
- `.claude/skills/surface-decision-debt/SKILL.md` — deriving the two marker lines.
- `.claude/skills/write-iteration-summary/SKILL.md` — the stage-7 issue comment;
  the durable English record this Russian owner report is deliberately not.
- `.claude/skills/run-iteration-end-checklist/SKILL.md` — the pre-merge gate;
  it defers the report's own shape to this file rather than re-checking it.
- `tools/hooks/README.md` — the whole hook stack and the kill switch.
