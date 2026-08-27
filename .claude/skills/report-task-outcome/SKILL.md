---
name: report-task-outcome
description: The canon of the final task report — the fixed five-point stage-6 shape, the two mandatory marker lines the Stop gates read («Проверить глазами:», «Отклонения от конвенций:», plus `surface-decision-debt:`), the self-contained owner-question form, and what an honest status/percentage means here. Use when writing the final report of any task, an interim owner-facing checkpoint, or a mid-thread question to the owner. Project-local; this repo only.
---

# report-task-outcome — the canon of the final report

Ported from ds-platform (task 7.3, issue #134) onto **our** report form. This
skill **documents the existing required shape**; it does not introduce a
competing one. The authority is `.claude/skills/task-cycle/SKILL.md` stage 6
(the five points) and stage 7 (the deviations line); three Stop hooks in
`tools/hooks/` enforce parts of it mechanically. Where this skill and
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
tokens the hooks match — they are never translated or paraphrased.

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
**and** is repeated in the session's final report, because a hook cannot read a
GitHub comment. The second names where each deviation was routed (its own issue
/ a `DEBT.md` line / written off with a reason). How to derive both:
`.claude/skills/surface-decision-debt/SKILL.md`.

## What the hooks actually check

| Hook                                         | Severity  | Trips on                                                                                                                                                                              |
| -------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/hooks/completion-report-gate.mjs`     | **BLOCK** | point 2 missing — neither «Проверить глазами:» nor the honest no-visual formula                                                                                                       |
| `tools/hooks/deviations-gate.mjs`            | **BLOCK** | the «Отклонения от конвенций:» line missing; **also** a «нет» value in a session that had an owner halt or an earlier Stop-gate block — a halted session cannot self-certify as clean |
| `tools/hooks/surface-decision-debt-gate.mjs` | **WARN**  | the `surface-decision-debt:` line missing (systemMessage only; the stop proceeds — promotion per `docs/ci-guardrails.md` §4/§6)                                                       |

All three share ONE recognizer of "a completion report" (defined in
`completion-report-gate.mjs`): a completion verb plus an issue/PR reference,
minus negations, and excluding a short question to the owner, the declared
owner-question form below (its **marker line**, or two of its four beat labels
each on its own line), an interim
checkpoint (the declared marker «Статус промежуточный», or inferred from «⏳»,
«жду CI»), and a proposal of the next step — **and** the session
must carry at least one write action in its transcript (#158), so a read-only
answer that merely talks about a merged PR trips nothing. So a real report meets
all three, and a checkpoint meets none. Points 1, 3 and 4 have no
mechanical check — they are on you. `BBM_HOOKS_DISABLE=1` kills the whole stack;
using it to get a report past a gate is itself a deviation to surface.

**Each BLOCK gate blocks at most ONCE per session** (#392, `applyBlockBudget` in
`tools/hooks/shared.mjs`). A second recognized violation in the same session is
demoted to a `systemMessage` warning and the stop proceeds. The budget bounds the
cost of the recognizer being wrong about free prose — three owner complaints in a
row (#158 → #299 → #374 → #392) each came from a message the recognizer misread
and then blocked again and again. It is a backstop on the tax, **not** a licence
to skip the markers: the first block is a real one, and this canon is what the
report owes regardless of what the hook does.

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

That line is what the Stop gates read (`EXPLICIT_INTERIM_MARKER_RE` in
`tools/hooks/completion-report-gate.mjs`); it must stand on its own line, and it
overrides every other signal in the message — so a checkpoint that mentions a
merged PR is still a checkpoint. Everything else in the message is the actual
content: what just landed, what is running, what is next.

**Do not pay the ceremony defensively.** «Проверить глазами», an honest-status
paragraph, a percentage and «Отклонения от конвенций: нет / surface-decision-debt:
none» belong to the FINAL report of the iteration; repeating them on every
checkpoint buries the content the owner is reading for. _(symptom, 2026-08-20:
nine consecutive checkpoints in one session each carried the full tail.)_ The
owner-question and owner-report language rules below still apply — those are about
being understood, not about the gates.

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

**The four beats are a DECLARED form, and the Stop gates read them as one**
(#374, `isOwnerQuestionForm` in `tools/hooks/completion-report-gate.mjs`): a
message carrying **two or more of the four beat labels, each on its own line**, is
a question and not a completion report — however many merged PRs and issue
numbers it mentions. Before #374 the gate read none of it, and the owner saw
almost every question twice: the gates blocked it once and the session re-sent it.

**A standalone owner question owes ONE declared line** (#392,
`OWNER_QUESTION_MARKER_RE` in the same file). The beats stay the content canon,
but a real question is often written as free prose, and the gate must still be
able to tell it apart. So exactly one of these lines, on its own line, is what a
question message owes:

```
Вопрос владельцу: <the question>
```

```
Вопрос N из M — <the subject>
```

**Singular, and the singular matters.** «Вопрос владельцу:» (SINGULAR + colon,
markdown emphasis around it tolerated) and the numbered «Вопрос N из M» header
are markers. The PLURAL **«Вопросы владельцу» is NOT** — it is point 5 of the
mandatory report shape above, so reading it as a marker would exempt exactly the
correctly formed final report from all three gates. Write the plural only as the
report's section heading and the singular only as a question's marker; the gate
holds that line in both directions.

Before #392 the gate read only the beats, and the owner's second complaint
(2026-08-27) was a free-form binary decision request — sections, no beat labels —
that carried «Осталось только смержить» and `PR #354` and was therefore blocked
and re-sent. It already had the «Вопрос владельцу: …» line; the gate simply did
not look at it.

A correctly formed report still usually ENDS on a question line, and that does
not relieve it of its own markers — a final report owes points 1–5 and the two
stage-7 lines by this canon, not because a hook forces them. What changed is only
whom the gate trusts: it takes the declared form at its word, exactly as it does
«Статус промежуточный». A report that writes out the whole four-beat block will
therefore pass the gates unchecked — that is a deliberate fail-open, and writing
the markers is on you.

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
  rejected by the gate, and rightly: that session's deviations are exactly what
  the line exists for.
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
