---
name: task-cycle
description: Mandatory lifecycle for every tracked task in this repo — issue → plan → owner "go" → implementation (TDD) → review → live-stand acceptance → merge → close. Use when picking up, planning, implementing, reviewing, or closing any task. Project-local; this repo only.
---

# task-cycle — the task lifecycle regulation

Agreed by the owner in issue #65 (v3, 2026-07-24). Written against real retro
symptoms: a session running to merge without a "go", a screenshot offered as
acceptance, a domain "decided" by extrapolating a Caddyfile. Every tracked
piece of work passes these stages, in order.

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

## Stage 1a — spec (new module / user-facing behavior only)

A light spec in `docs/specs/` (template: `docs/specs/README.md`): requirements
in plain language + acceptance scenarios ("how the owner verifies it works").
The spec is the subject of the stage-2 "go": the owner approves IT, not an
abstract plan. No EARS formalism — deferred with an explicit revisit trigger
(see `docs/specs/README.md`). Chore/fix/CMS-contract tasks skip this stage.

## Stage 2 — the "go" gate (key)

Implementation starts only after the owner's EXPLICIT confirmation IN THIS
SESSION on the presented scope (for spec tasks — on the spec). Handoff ≠ go;
task text ≠ go; a config/Caddyfile ≠ an owner decision. The "go" freezes the
scope: inside it the agent is autonomous through merge; stepping outside it
(new files/domains/repos/deploys beyond what was stated) = a new checkpoint
with the owner.

## Stage 3 — implementation

Branch `<type>/<N>-<slug>` off fresh `main`; Conventional Commits. Root cause,
not workarounds — if a workaround is unavoidable, stop and file a separate
blocked-by task (memory: `fix-root-cause-not-workarounds`). **TDD — hard rule
for platform-module code:** no production module code without a failing test
first; derive tests from the spec's acceptance scenarios where a spec exists.
(The CMS mirror is covered by the site's contract test — unchanged.) Before
pushing, check CI is green on `main`, so an inherited red is not mistaken for
your own.

## Stage 4 — review (mandatory)

PR with `Closes #N` + the PR template (`.github/pull_request_template.md`). An independent review subagent (fresh
context, read-only) posts a PR comment containing a
`VERDICT: APPROVE | REQUEST_CHANGES` line. On REQUEST_CHANGES: address every
point — fix it, or reject it with reasoning in the thread — then re-review,
looping until APPROVE. Docs-only PRs may merge on green CI without the
subagent. Decision context goes onto the PR as comments, proactively
(memory: `always-document-on-prs`).

## Stage 5 — acceptance of visible changes (blocks merge)

An owner-visible change does NOT merge without the owner's "принято" on a
LIVE stand. The showing is always a real URL the owner opens themselves:
normally the preview stand; until it exists — the dev stand or a tunnel. A
screenshot or localhost render is the agent's working evidence, never the
showing. The stand stays up until the verdict; an unanswered design/visual
question = merge stays blocked. Invisible changes (internals, refactoring,
docs, backend without UI) skip this stage.

## Stage 6 — merge (autonomous)

APPROVE + green CI (check the actual check-run statuses — not "probably
passed") + for visible changes the recorded stage-5 "принято" → the agent
merges itself: `gh pr merge --squash --delete-branch` (memory:
`agent-merges-prs-after-review`). Never merge on a stale base. Then the final
task report, fixed form:

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
own issue; minor → a line in `DEBT.md`). Plane task (if any) → Done + a
results comment. Branch deleted. The next step is NAMED as a recommendation
but not started without a "go" — stage 2 of a new cycle.

## Enforcement hooks — deferred, not rejected

Deterministic hooks enforcing this regulation are deliberately NOT added now
(issue #65, owner decision 2026-07-24). **Revisit trigger: the first
recurrence of a symptom this regulation targets.** Candidate #1 on
recurrence: a Stop-hook blocking any final task report that lacks the
«Проверить глазами: \<URL\>» line.
