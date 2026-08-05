# docs/specs — light specs for owner sign-off

Part of the task-cycle regulation (`.claude/skills/task-cycle/SKILL.md`,
issue #65). The owner is a non-developer working through agents: the spec is
his control interface over what the agent is about to build — he approves the
spec, not an abstract plan or a diff.

## When a spec is required

A **new platform module** or **new user-facing behavior** (a page, route,
visible flow). The spec is written BEFORE any code (task-cycle stage 1a) and
is the subject of the owner's "go" (stage 2).

## When it is NOT required

CMS-contract upkeep (the source of truth is already code: `schemas.ts` + seed
fixtures), chore/fix/refactor tasks. When in doubt, ask at stage 1.

## Format (keep it light)

One markdown file per spec: `NNN-<slug>.md`, where `NNN` is the related
GitHub issue number. The file opens with YAML frontmatter carrying the status
(below), then the body.

```markdown
---
status: Draft
issue: 135
updated: 2026-08-05
---

# <Feature name> — spec (issue #N)

## Why

1–3 sentences: the problem / goal, in product language.

## Prior decisions

The ADRs this spec builds on, each with the section that binds it — e.g.
`ADR-002 §3` (module boundaries), `ADR-003 §2` (domain topology). One line
per ADR saying what it constrains here. A spec that cites none says so
explicitly and why.

## Requirements

EARS clauses, each with a stable `EARS-N` id (see "EARS" below). Constraints
(152-FZ, ADR-002 module boundaries, domain topology) called out explicitly.

- **EARS-1.** The hours page shall show the participant's own rate for the
  selected period.
- **EARS-2.** WHEN the owner publishes a period, the system shall freeze every
  submitted entry in it.
- **EARS-3.** IF a participant has no grade, THEN the system shall show the
  period as unavailable rather than a zero rate.

## Acceptance scenarios

Numbered "how the owner verifies it works" walkthroughs: the real URL,
what he opens, clicks, and sees. Each names the `EARS-N` clauses it
exercises. These double as the TDD test scenarios (task-cycle stage 3) and
the stage-5 live-stand acceptance script.

## Out of scope

What this task explicitly does NOT include.
```

## Status model

A spec is a living record of a decision, not a one-shot document. Its status
says what the reader is looking at: a proposal, a build in flight, or the
description of something running in production.

| Status       | Meaning                                                                                   | Set when                                              |
| ------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `Draft`      | Authored, not yet approved. Nothing may be built from it.                                 | The spec is written (task-cycle stage 1a).            |
| `In dev`     | The owner gave the "go"; implementation is in flight. The spec is the frozen scope.       | The owner's explicit "go" (stage 2).                  |
| `Shipped`    | Merged and live. The spec describes **production behavior** and is read as current truth. | The change is deployed and accepted (stages 5–7).     |
| `Superseded` | A newer spec replaces it. Kept for history; `superseded_by:` names the successor.         | The successor spec reaches `In dev`.                  |
| `Retired`    | The behavior was removed, or was never built and will not be. Kept for history.           | The module is deleted, or the owner cancels the idea. |

Rules:

- **Every spec file carries an explicit `status:`.** A spec with no status is
  unreadable — nobody can tell a proposal from production truth.
- **A spec is never deleted — it is retired by changing its status.** `git rm`
  on a spec (or an ADR) destroys the decision record: the next session
  re-derives a settled question from scratch and gets a different answer. If a
  spec is wrong, correct it in place while it is `Draft`/`In dev`; if it is
  obsolete, set `Superseded` (naming the successor) or `Retired`. A rename is
  fine — a deletion is not. This rule and the `superseded_by:` requirement are
  checked by `pnpm lint:spec-deletion` — see "Machine checks" below.
- **`Shipped` is not a freeze.** Changing an already-shipped behavior updates
  the existing spec (status goes back to `In dev` for the duration of the
  change, then to `Shipped`) — it does not spawn a second spec for the same
  surface. A genuinely new surface gets a new spec, and the old one becomes
  `Superseded` only if the new one replaces it wholesale.
- **The status is changed in the same PR as the thing it describes.** A
  `Shipped` status landing days after the deploy is a status nobody trusts.

Optional frontmatter fields: `superseded_by: <NNN-slug.md>` (required on
`Superseded`), `issue: <N>`, `updated: <YYYY-MM-DD>`.

Design specs under `docs/superpowers/specs/` (brainstorm-era, date-named)
carry the same `status:` frontmatter and the same ladder.

## Prior decisions — grounding a spec in architecture

Every spec names the ADRs it builds on in a `## Prior decisions` section
(above). The point is not bookkeeping: a spec that does not cite the ADR
constraining it is a spec that is about to re-litigate a settled decision.
Before authoring, load the ADRs with the `read-relevant-adrs` skill; before
changing one, use `do-adr-revision`.

## Machine checks

Four guards read this document. All four are **WARN**, registered in
[`docs/ci-guardrails.md`](../ci-guardrails.md) §5 with their §4 promotion
conditions; each exits non-zero on a finding so the signal is real.

| Command                   | Reads                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm lint:spec-link`     | a feature PR resolves to a spec that exists, has a ladder `status:`, and is past `Draft` (below) |
| `pnpm lint:spec-deletion` | the "Status model" rules: no spec/ADR is `git rm`-ed, and every spec carries a valid `status:`   |
| `pnpm lint:ears-test`     | clause ↔ test traceability both ways: no uncovered `EARS-N`, no test citing an undeclared one    |
| `pnpm lint:ears-naming`   | a test title that ATTEMPTS the `EARS-N:` prefix and misspells it                                 |

`lint:spec-deletion` sweeps `docs/specs/` and `docs/superpowers/specs/`; ADRs are
covered by its deletion rule but not by the status sweep, because ADRs record
status as `**Status:** Accepted` body prose (`docs/adr/README.md`), not this
ladder. `lint:ears-test` reads clause ids from a spec's `## Requirements`
section only — the acceptance scenarios NAME the clauses they exercise, and a
pointer is not a second declaration.

`pnpm lint:spec-link` — on a feature PR (a linked issue of type `Feature`, or a
`feat:` title, **and** a change under `src/`), it resolves the spec, then checks
that the file exists, that its `status:` is a valid ladder value, and that it is
not still `Draft`. **Severity: WARN**, registered in the guard register
([`docs/ci-guardrails.md`](../ci-guardrails.md) §5). In CI it runs as the
`spec-link` job of `pr-body-guards.yml`, invoked with `--severity block` so the
script gives a real signal while `continue-on-error` keeps the plane at WARN;
promotion to BLOCK follows the canon's §4 clauses (earliest 2026-09-02).

**Where the reference has to sit.** A spec path mentioned loosely in prose is
background reading, not a declaration — the guard only reads these positions:

- a **`Spec:`** (or `Spec reference:`) line in the PR body, e.g.
  `Spec: docs/specs/102-hours-hourly-rate-table-cleanup.md §3`;
- the linked issue's **`## Spec reference`** section (the task-canon skeleton);
- a spec file **edited by the PR itself**;
- an existing `docs/specs/<linked-issue>-*.md`.

The spec must also **relate** to the linked issue. Relation is established by
any one of:

- **declaration** — the linked issue's `## Spec reference` names it. An issue
  saying "this spec governs me" _is_ the relation, which is what makes the
  common case work: an epic sub-task governed by the parent epic's design spec,
  whose filename and `issue:` both point at the epic, not at the sub-task;
- the spec's **`NNN-` filename prefix** matching a linked issue;
- the spec's **`issue:` frontmatter** matching a linked issue;
- the PR **substantially editing** that spec (≥3 changed lines — a whitespace
  or typo touch is not "this PR works on that spec").

A spec that is merely named on a `Spec:` line but relates to none of the linked
issues is reported as background and does not satisfy the gate. Relatedness is
resolved **before** any status check, so a `Draft` spec belonging to someone
else's work never produces a finding against this PR.

**Escape hatch.** A PR that genuinely needs no spec writes, on a line of its
own in the PR body:

```
spec-exempt: CMS-contract upkeep, the contract lives in schemas.ts
```

The backticked form `` `spec-exempt: <reason>` `` is equally accepted. The
reason is mandatory — a bare marker is itself a finding. Quoted forms are
deliberately NOT matched (a blockquote `>`, a list item, an indented line, or a
fenced block): a PR that merely discusses the hatch, or pastes a review comment
containing it, must not exempt itself.

## EARS — ADOPTED (owner's decision, 2026-08-05)

**Owner's decision, 2026-08-05: EARS is adopted for all specs.** The 2026-07-24
rejection (#65 §4) is reversed.

**Why it was rejected before, and why that no longer holds.** The stated reason
in #65 §4 was that the value of EARS shows up with many parallel specs, which
this repo did not have. That premise is obsolete: the BBM Platform already runs
several user-facing apps with a large functional landscape and more planned, and
the consolidation (epic #117) puts eight epics with specs in flight. The owner's
own recorded revisit trigger — «≥3–4 live specs at once, and/or requirement ↔
test ↔ issue traceability starts getting confused» — is met on its own terms.
The standard the owner set for the platform is «полноценный SDD и полное
аккуратное покрытие документацией», and ds-platform already runs working
EARS↔test traceability mechanics to copy rather than invent (inventory #127).

### What this means in practice

- **Every NEW spec is written with EARS clauses** in its `## Requirements`
  section, per the template above.
- **A substantively revised spec is upgraded to EARS on that revision** —
  changing what the thing does means rewriting the clauses that describe it.
- **No mass rewrite pass.** Existing specs are upgraded **on touch**, the same
  way this repo handled translate-on-touch for its documents. A `Shipped` spec
  nobody is touching keeps its prose requirements and is not a defect.

### Clause form

Stable ids `EARS-1`, `EARS-2`, … per spec, never renumbered — a split retires
the old id and adds new ones, so a reference never dangles. The five standard
shapes:

| Shape        | Form                                                              |
| ------------ | ----------------------------------------------------------------- |
| Ubiquitous   | The `<system>` shall `<response>`.                                |
| Event-driven | WHEN `<trigger>`, the `<system>` shall `<response>`.              |
| State-driven | WHILE `<state>`, the `<system>` shall `<response>`.               |
| Unwanted     | IF `<condition>`, THEN the `<system>` shall `<response>`.         |
| Optional     | WHERE `<feature is included>`, the `<system>` shall `<response>`. |

The clause is the unit of testing: the test covering `EARS-3` is named
`it('EARS-3: …')`, so requirement ↔ test becomes a grep instead of a reading
exercise. Keep the clauses in the owner's product language — EARS constrains the
_sentence shape_, not the vocabulary. A spec he cannot read has failed at its
job whatever its syntax.

### Mechanics

`pnpm lint:ears-test` and `pnpm lint:ears-naming` (guard tranche 2, #157) check
the clause ↔ test link — see "Machine checks" above for what each one reads and
what it does not.
