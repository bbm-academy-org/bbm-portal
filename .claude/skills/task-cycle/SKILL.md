---
name: task-cycle
description: Mandatory lifecycle for every tracked task in this repo — issue → plan → design gate (UI) → owner "go" → implementation (TDD) → review → live-stand acceptance → merge → close. Use when picking up, planning, implementing, reviewing, or closing any task. Project-local; this repo only.
---

# task-cycle — the task lifecycle regulation

Agreed by the owner in issue #65 (v3, 2026-07-24), extended in #92 (v4,
2026-07-30). Written against real retro symptoms: a session running to merge
without a "go", a screenshot offered as acceptance, a domain "decided" by
extrapolating a Caddyfile. Every tracked piece of work passes these stages, in
order.

## Stage 0 — file it

Work exists as a task BEFORE the first edited file: code/dev → GitHub issue;
org/strategy → Plane `BBMP-*` (`--workspace bbm`). On the issue: type label,
epic link / blocked-by, honest origin (owner request vs agent initiative —
mark which). Classify against the spec gate: a new platform module or new
user-facing behavior → the task needs a spec (stage 1a); CMS-contract upkeep
and chore/fix work → no spec.

## Stage 1 — orient & plan (no implementation)

The session's first reply is a "Session plan": task type; 1–3 deliverables;
why; scope — what is IN and what is explicitly OUT. Everything inherited from
a handoff, task text, or config is a HYPOTHESIS: a mismatch with the tracker,
or an unproven "already agreed" claim, goes to the owner as a question — it is
not executed. (Memory: `orient-before-acting`.)

Any external reference the plan leans on (mockup, prototype, config) is named
with an **artifact passport: path + owner + type — original / export / build**;
if the original was not opened, the plan says «оригинал не проверен» outright.
(2026-07-27: the build `deploy/index.html` and an export were taken for the
mockup — three owner escalations to reach the Claude.Design original.)

## Stage 1a — spec (new module / user-facing behavior only)

A light spec in `docs/specs/` (template: `docs/specs/README.md`): requirements
in plain language + acceptance scenarios ("how the owner verifies it works").
The spec is the subject of the stage-2 "go": the owner approves IT, not an
abstract plan. No EARS formalism — deferred with an explicit revisit trigger
(see `docs/specs/README.md`). Chore/fix/CMS-contract tasks skip this stage —
except the two rules below, which have no exemption by task type.

**CRUD-чек — mandatory for any form**, whatever the task is labelled: a task of
ANY type that adds or changes a form runs it. Spell out Create/Read/Update/
Delete and write down which scenario is NOT supported and why. (2026-07-30:
/p/hours shipped an upsert with no pre-fill — «как редактировать участников?»
four minutes after the final report.) **A change to any computed/money formula
ALWAYS needs a spec + an independent review of that spec**, even when the task
arrived as a layout fix; an owner's answer inside AskUserQuestion is not a
spec. (2026-07-30: the auto-rate «середина трети» was settled by one
AskUserQuestion.)

## Stage 1b — design gate (Stage A)

A new or reshaped UI surface gets **2–3 design options** to the owner BEFORE any
code; the owner's pick is recorded in the issue. No pick — no markup. An option
is a sketch or mockup of ANY fidelity that is enough to choose a direction — a
described layout, a wireframe, a rendered page; the lead (or the implementer it
dispatches) prepares them, the owner picks. (Owner decision 2026-07-30; the
price of not having this gate was the rework cycles #76 and #84.)

The pick is then **vendored as a file in `design-source/`** and the build goes
against that file, never against issue prose
([`.claude/rules/design-process.md`](../../rules/design-process.md)). Procedure:
the skills [`author-design-mockup`](../author-design-mockup/SKILL.md) (whole
surface) and
[`build-ui-from-design-system`](../build-ui-from-design-system/SKILL.md)
(element class, incl. the reuse ladder).

## Stage 2 — the "go" gate (key)

Implementation starts only after the owner's EXPLICIT confirmation IN THIS
SESSION on the presented scope (for spec tasks — on the spec). Handoff ≠ go;
task text ≠ go; a config/Caddyfile ≠ an owner decision. The "go" freezes the
scope: inside it the agent is autonomous through merge; stepping outside it
(new files/domains/repos/deploys beyond what was stated) = a new checkpoint
with the owner. An owner reply that is itself a clarifying question is NOT an
answer: proceeding on a default is allowed only for reversible actions, and any
such default MUST land in the final report's «Отклонения от конвенций» line as
"applied without owner confirmation: \<what\>" — never only in a flags list.

## Stage 3 — implementation

Branch `<type>/<N>-<slug>` off fresh `main`; Conventional Commits. Root cause,
not workarounds — if a workaround is unavoidable, stop and file a separate
blocked-by task (memory: `fix-root-cause-not-workarounds`). **TDD — hard rule
for platform-module code:** no production module code without a failing test
first; derive tests from the spec's acceptance scenarios where a spec exists.
(The CMS mirror is covered by the site's contract test — unchanged.) Before
pushing, run `pnpm ci:verify-base` (exit 0 green / 1 red / 2 pending): an
inherited red on `main` must not be mistaken for your own, and on exit 1 the
command prints the disclaimer to paste into the PR body.

**UI diff** (`*.css`, view-layer `*.tsx`): load the `frontend-design` skill
BEFORE writing markup, and list explicitly the states the prototype does not
show — hover, focus, empty, loading, error. **Dispatch:** implementing a module
goes to a subagent; the lead writes only edits of ≤1 file itself. Every `Agent`
call names an explicit `model`.

## Stage 4 — review (mandatory)

PR with `Closes #N` + the PR template (`.github/pull_request_template.md`). An
independent review subagent (fresh context, read-only) posts a PR comment
containing a `VERDICT: APPROVE | REQUEST_CHANGES` line. **The review is
dispatched by the orchestrating lead, never by the implementer:** a review the
implementer commissioned for its own PR does not satisfy this gate and is
re-run by the lead. (2026-07-24: PR #72's implementer self-commissioned its
«independent» review; the lead's re-review was still required.) On
REQUEST_CHANGES: address every point — fix it, or reject it with reasoning in
the thread — then re-review, looping until APPROVE. Docs-only PRs may merge on
green CI without the subagent. Decision context goes onto the PR as comments,
proactively (memory: `always-document-on-prs`).

## Stage 5 — acceptance of visible changes (blocks merge)

An owner-visible change does NOT merge without the owner's "принято" on a
LIVE stand. The showing is always a real URL the owner opens themselves:
normally the preview stand; until it exists — the dev stand or a tunnel. A
screenshot or localhost render is the agent's working evidence, never the
showing. **Precondition for inviting the owner to any UI/auth flow: a green
browser E2E pass (Playwright) of the acceptance scenarios first — curl + unit
tests do not satisfy this.** (2026-07-24: the P2b invite nearly went out on
curl evidence alone; the Playwright pre-pass caught a login-blocking IdP defect
— «Ты проверял через Playwright CLI?».) **The invitation always carries the
access line: URL + login + where to get the password.** The stand stays up
until the verdict; an unanswered design/visual question = merge stays blocked.
Invisible changes (internals, refactoring, docs, backend without UI) skip this
stage — but the PR still records **which** case it is: every PR carries a
`Stage-B:` line (`GO` / `batched at #N` / `N/A — lead-certified`), checked by
`pnpm lint:stage-b <PR>` (`.claude/rules/design-process.md`).

## Stage 6 — merge (autonomous)

APPROVE + green CI (check the actual check-run statuses — not "probably
passed") + for visible changes the recorded stage-5 "принято" → the agent
merges itself: `gh pr merge --squash --delete-branch` (memory:
`agent-merges-prs-after-review`). Never merge on a stale base: run
`git fetch origin && git log --oneline HEAD..origin/main` first — if main moved
under someone else's commits, read what landed before merging. After the deploy
— **postcheck: the commit deployed on prod == `origin/main` HEAD** (recipe in
`deploy/README.md`); on a mismatch, finish shipping it, don't just report it.
Then the final task report, fixed form:

1. What changed — in product language.
2. **«Проверить глазами: \<URL\>»** — or honestly «визуально ничего не
   меняется; проверяется так: …».
3. Honest status: merged ≠ deployed ≠ reachable by the owner.
4. % delivered of the stated scope.
5. Questions to the owner — self-contained wording (no "see above").

## Stage 7 — close

Issue closed (verify `Closes #N` actually fired) with a results comment:
artifacts, what was done, what got unblocked + the mandatory line
**«Отклонения от конвенций: нет / \<список\>»** (significant deviation → its
own issue; minor → a line in `DEBT.md`). **The same line is repeated in the
session's final report** — that is where the Stop gate
`tools/hooks/deviations-gate.mjs` checks it (a hook cannot read the issue
comment). Plane task (if any) → Done + a results comment. Branch deleted. The next step is NAMED as a recommendation
but not started without a "go" — stage 2 of a new cycle.

## Enforcement hooks — no longer deferred

The 2026-07-24 deferral is lifted (owner, 2026-07-30): the "first recurrence"
trigger fired five times over. The hook stack is issue **#91** — what each hook
blocks vs. warns, its carve-outs, and the `BBM_HOOKS_DISABLE=1` kill switch are
documented in [`tools/hooks/README.md`](../../../tools/hooks/README.md).
Standing rule: **a recurrence of a theme this prose already covers escalates to
a hook/lint — not to more prose.**
