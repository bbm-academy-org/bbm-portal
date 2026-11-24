---
name: report-task-outcome
description: The canon of the final task report — the fixed five-point stage-6 shape, the mandatory marker lines («Проверить глазами:», «Отклонения от конвенций:», plus `surface-decision-debt:`), the self-contained owner-question form, and what an honest status/percentage means here. Use when writing the final report of any task, an interim owner-facing checkpoint, or a mid-thread question to the owner. Project-local; this repo only.
---

# report-task-outcome — the canon of the final report

Ported from ds-platform (task 7.3, issue #134) onto **our** report form. This
skill **documents the existing required shape**; it does not introduce a
competing one. The authority is `.claude/skills/task-cycle/SKILL.md` stage 6
(the five points) and stage 7 (the deviations line). No hook enforces it — see
«No mechanical check» below. Where this skill and
`task-cycle` could ever diverge, `task-cycle` wins and this file is the bug.

**Why it is regulated:** an engineering-first report buried whether the owner had
anything to check at all — «а что мне открыть?», «куда — в прод?». The form is
product-first, and the "what to look at" line is not optional.

## When it applies

At the end of any task you report to the owner (a merged PR, a closed issue, a
blocked stop), and — for the language and the question form — to every
owner-facing interim checkpoint too.

**Language:** the report is live dialogue with the owner, so it is written in
**Russian** (`task-canon`: Russian is reserved for owner dialogue and end-user
text; every other artifact is English). The marker strings below are fixed
tokens — they are never translated or paraphrased.

**Plain text in chat.** A report, status, summary, retro or plan is chat text —
never an HTML page or a published artifact built for it (owner, 2026-08-15: a
styled page for a simple report added no fact, only layout time). A page is
right only when the owner asks for one or the content is unreadable as text
(an interactive diagram, a dashboard to click); unsure → ask in one line.

**Product terms, numbers as references** — in reports and in live dialogue
alike: a task is named by its product meaning («the audit ledger of edits»), its
number follows in parentheses on first mention («(#201)») and is dropped after
that. Tracker artifacts (issues, PRs, comments) keep their numbers.

## The fixed shape (task-cycle stage 6)

1. **Что изменилось — продуктовым языком.** 1–3 sentences a person would
   actually notice, naming the **product entity** — the hours page, the OKR
   dashboard, the lead form — never a bare mechanism («серверный гард», «сид
   коллекции»): «гард ЧЕГО?» must be answerable from the sentence itself. The
   shorthand ban and the two opening lines this point starts with are the
   «Owner-report form» section below.
2. **«Проверить глазами: \<URL\>»** — a real URL the owner opens themselves,
   with the access line (login + where the password comes from) when the surface
   is behind auth. A screenshot is the agent's working evidence, never the
   showing (stage 5). If the change has no visual surface, the honest form is
   the literal alternative: **«визуально ничего не меняется; проверяется так:
   \<тест / поведение / команда\>»** — do NOT fill the point with PR/repo links
   to make it look satisfied.
3. **Честный статус: смержено ≠ задеплоено ≠ доступно владельцу.** Name the
   exact landing state — «смержено в `main`, в прод НЕ выкачено» vs «выкачено в
   прод, postcheck: HEAD совпадает». A prod deploy is its own step, never
   implied by a merge.
4. **% от заявленного объёма** — computed from the tracker (closed vs total via
   `gh`), not estimated by eye; when under 100%, the stop reason comes with it.
5. **Вопросы владельцу** — self-contained wording, no «см. выше» / «см. issue».

Then the two lines carried over from stage 7 (see below). Anything else — files,
commits, CI, diff detail — goes AFTER these points, as a short technical tail:
the report reads as a product report, not as a diff.

## The two marker lines (stage 7, repeated in the report)

```
Отклонения от конвенций: <нет | список>
surface-decision-debt: <[] | по пункту на отклонение — куда ушло>
```

The first line is the stage-7 canon: it goes into the issue's closing comment
**and** is repeated in the session's final report, because the owner reads the
report, not the comment. A «нет» is not available to a session the owner had to
halt: its deviations are exactly what the line exists for. The second names where each deviation was routed (its own issue
/ a `DEBT.md` line / written off with a reason). How to derive both:
`.claude/skills/surface-decision-debt/SKILL.md`.

## No mechanical check — the markers are on you

Nothing reads the final report at session Stop. Three Stop gates used to
(`completion-report-gate`, `deviations-gate`, `surface-decision-debt-gate`); they
were **retired on 2026-11-24** (#589, owner decision, Антон, as ds-platform did
in its `#1744`): every block made the model re-read the whole session and re-emit
the same text — a pure token tax — and the free-prose recognizer behind them
misfired again and again (#158 → #299 → #374 → #392). The retirement record:
`docs/ci-guardrails.md` §6 and `tools/hooks/README.md`.

What went is the forced rewrite, not the contract. Every point of the shape
above and both marker lines are what a final report owes **by this canon** — a
report without them is wrong whether or not anything catches it.

## The owner's zone — prove there is no own path first (mandatory)

A report that splits the work into zones ("mine" / "the owner's") makes a claim
in every item it routes to the owner: **that no path of your own exists.** That
claim is checked BEFORE the item is written, not asserted by default.

Walk the four accesses you actually hold, and **name in the report which ones you
checked and what each answered**:

1. **ssh hosts** you can reach (the boxes the service in question runs on);
2. **PATs and service accounts** already configured in this environment;
3. **Terraform / provisioning state** — a credential this repo issued, it can
   re-issue;
4. **the provider's own API** with the token you have.

Only after all four come back negative does the item go to the owner, and it goes
with that list attached — "checked X, Y, Z; blocked because …". An item routed
with no such list is a guess, and a wrong guess parks work in the backlog that
was never blocked.

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

## Промежуточный чекпойнт — the marker, not the tail

An interim message is **not** a stage-6 report and does not carry its five points
or the two stage-7 lines. It carries one declared marker line:

```
Статус промежуточный
```

That line declares the message a checkpoint; it must stand on its own line, and
it overrides every other signal in the message — so a checkpoint that mentions a
merged PR is still a checkpoint. Everything else in the message is the actual
content: what just landed, what is running, what is next.

**Do not pay the ceremony defensively.** «Проверить глазами», an honest-status
paragraph, a percentage and «Отклонения от конвенций: нет / surface-decision-debt:
none» belong to the FINAL report of the iteration; repeating them on every
checkpoint buries the content the owner is reading for. _(symptom, 2026-08-20:
nine consecutive checkpoints in one session each carried the full tail.)_ The
owner-question and owner-report language rules below still apply — those are about
being understood, not about ceremony.

## Owner-report form (mandatory)

The twin of the question form below, applied to the report's **opening**. The
**first two paragraphs of any owner-facing report carry no internal shorthand**:
no bare issue/PR number without a gloss of what it is about, no table, file,
module or route name, no «stage N», no `EARS-N` id, no label or token syntax.
Every tool/token/process term (Payload, Zitadel, `channel:spec`, Stop-хук) is
glossed in plain Russian on first use or dropped, and mechanism vocabulary waits
for the technical tail. They open with two lines — **what we are building** and
**why it matters to you** — in the owner's own product vocabulary; everything
internal starts only after those two lines.

_(symptom, owner 2026-08-19: «Я ничерта не понял из твоего отчёта. Можешь
нормальным продуктовым языком разложить, что мы делаем и зачем».)_

## Owner-question form (mandatory)

Every question — in the report and in any mid-thread checkpoint — renders as a
self-contained block of four beats: **что случилось / почему спрашиваю / что
изменит ответ / где посмотреть** (a live URL or a concrete page — never "посмотри
диff"). Banned: internal shorthand (token names, stage numbers, label syntax
without a gloss) and any «см. issue/отчёт» redirect that makes the owner go read
something before they can parse the question. Self-check each question before
sending: someone who read nothing else must be able to answer it.

**One question at a time, in chat.** Questions go to the chat, ONE per message,
each with its own context; the next is asked after the answer. A batch in one
GitHub comment or a numbered list beside a report is not asking — the owner
declined to answer exactly that (2026-08-26, 2026-08-31); a reminder list is not
a question either. The GitHub comment stays the record of the decision, the
dialogue runs in chat.

**The four beats are a DECLARED form** (#374): a message carrying **two or more
of the four beat labels, each on its own line**, is a question and not a
completion report — however many merged PRs and issue numbers it mentions.

**A standalone owner question owes ONE declared line** (#392). The beats stay
the content canon, but a real question is often written as free prose, and the
owner must still be able to tell it apart from a report at a glance. So exactly
one of these lines, on its own line, is what a question message owes:

```
Вопрос владельцу: <the question>
```

```
Вопрос N из M — <the subject>
```

**The colon on the singular line is not optional.** «Вопрос владельцу — …» with
a dash is NOT read as a marker, while the numbered header takes a colon, a dash
or nothing. The asymmetry is deliberate: a bare «Вопрос владельцу» is one
inflection away from the plural heading below, and the colon is what separates
them. A list bullet or a blockquote in front of either line is fine.

**Singular, and the singular matters.** «Вопрос владельцу:» (SINGULAR + colon,
markdown emphasis around it tolerated) and the numbered «Вопрос N из M» header
are markers. The PLURAL **«Вопросы владельцу» is NOT** — it is point 5 of the
mandatory report shape above. Write the plural only as the report's section
heading and the singular only as a question's marker.

A correctly formed report still usually ENDS on a question line, and that does
not relieve it of its own markers — a final report owes points 1–5 and the two
stage-7 lines by this canon.

**Unanswered across more than two consecutive reports → escalate, do not
restate.** A question that has ridden point 5 of three reports has been shown to
be invisible there: the owner reads the report for what changed, and a tail item
is not where an unanswered decision gets noticed. On its third crossing it leaves
the report and is sent as its **own standalone chat message** — nothing but the
four beats, and the note that the work is waiting on it. Restating it as point 5
a fourth time is the failure, not the persistence.

_(symptom, 2026-08-26: the same owner question restated six times across
consecutive reports, never once asked on its own.)_

## Failure modes

- **Filling «Проверить глазами» with a PR or repo link** when there is nothing
  visual — the owner reads that as faking a check that does not exist. The
  honest no-visual formula is the correct answer.
- **«Готово / отгружено»** with no landing state — the owner then has to ask
  «куда, в прод?».
- **A percentage by eye** instead of the tracker's closed/total.
- **Jargon-first report**: a mechanism with no product entity, however green the
  CI.
- **`surface-decision-debt: []` next to a paragraph describing a deviation** —
  the empty list asserts the opposite of the paragraph.
- **«Отклонения от конвенций: нет» after the owner had to stop the session** —
  that session's deviations are exactly what the line exists for.
- **Questions in internal shorthand** — costs a full round-trip.
- **A guessed external value with a `TODO` beside it** — the placeholder ships
  and the question is never asked.
- **The same unanswered question as point 5 for the third report running** — it
  is a standalone message by then, not a tail item.

## Related

- `.claude/skills/task-cycle/SKILL.md` — stages 5–7, the authority for this form.
- `.claude/skills/surface-decision-debt/SKILL.md` — deriving the two marker lines.
- `.claude/skills/write-iteration-summary/SKILL.md` — the stage-7 issue comment;
  the durable English record this Russian owner report is deliberately not.
- `.claude/skills/run-iteration-end-checklist/SKILL.md` — the pre-merge gate;
  it defers the report's own shape to this file rather than re-checking it.
- `tools/hooks/README.md` — the whole hook stack and the kill switch.
