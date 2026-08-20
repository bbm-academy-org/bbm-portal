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
minus negations, and excluding a short question to the owner, an interim
checkpoint (the declared marker «Статус промежуточный», or inferred from «⏳»,
«жду CI»), and a proposal of the next step — **and** the session
must carry at least one write action in its transcript (#158), so a read-only
answer that merely talks about a merged PR trips nothing. So a real report meets
all three, and a checkpoint meets none. Points 1, 3 and 4 have no
mechanical check — they are on you. `BBM_HOOKS_DISABLE=1` kills the whole stack;
using it to get a report past a gate is itself a deviation to surface.

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

A correctly formed report therefore usually ENDS on a question line — that is
expected and does not exempt it from the gates (the recognizer only exempts
short question-only turns).

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

## Related

- `.claude/skills/task-cycle/SKILL.md` — stages 5–7, the authority for this form.
- `.claude/skills/surface-decision-debt/SKILL.md` — deriving the two marker lines.
- `.claude/skills/write-iteration-summary/SKILL.md` — the stage-7 issue comment;
  the durable English record this Russian owner report is deliberately not.
- `.claude/skills/run-iteration-end-checklist/SKILL.md` — the pre-merge gate;
  it defers the report's own shape to this file rather than re-checking it.
- `tools/hooks/README.md` — the whole hook stack and the kill switch.
