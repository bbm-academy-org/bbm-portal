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

Plain-language numbered list: what the thing must do. Constraints
(152-FZ, ADR-002 module boundaries, domain topology) called out explicitly.

## Acceptance scenarios

Numbered "how the owner verifies it works" walkthroughs: the real URL,
what he opens, clicks, and sees. These double as the TDD test scenarios
(task-cycle stage 3) and the stage-5 live-stand acceptance script.

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
  fine — a deletion is not.
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

`pnpm lint:spec-link` — on a feature PR, checks that the linked issue resolves
to a spec file, that the spec exists, and that its `status:` is a valid ladder
value. **Severity today: WARN** (it reports and exits 0); promotion to BLOCK
happens under the severity canon of issue #136. Escape hatch for a PR that
genuinely needs no spec: a `spec-exempt: <reason>` line in the PR body.

## EARS — revisit prepared, decision PENDING OWNER DECISION

> **This section is a briefing for the owner, not a decision.** The decision
> slot at the bottom is deliberately empty. Nobody but the owner fills it.

**What was decided before.** Issue #65 §4 (2026-07-24) deliberately did NOT
adopt EARS clause syntax (`WHEN <trigger>, the system shall <response>`),
per-EARS issue slicing, `it('EARS-N: …')` test naming, or the spec↔test CI
guards. The stated reason: _their value shows up with many parallel specs,
which this repo does not have yet._ The recorded revisit trigger was «≥3–4 live
specs at once, and/or requirement ↔ test ↔ issue traceability starts getting
confused».

**What has changed since.** The platform consolidation (epic #117, spec
`docs/superpowers/specs/2026-08-04-platform-consolidation-design.md`) puts
**eight epics with specs** in flight. The original rejection's premise — "we
don't have many parallel specs" — is the thing that changed; the trigger the
owner himself wrote is met on its own terms.

**What the mechanism would buy.** ds-platform runs the EARS↔test traceability
end-to-end and it is portable (inventory #127): `ears-test-lint` checks both
directions (every `EARS-N` clause has a test; every `EARS-N`-named test maps to
a live clause, with a per-spec deferral allowlist), `ears-naming-lint` catches
malformed clause ids. Together they make "is this requirement actually tested?"
a CI answer instead of a reading exercise.

**What it would cost.** Every spec grows a formal clause layer (the current
light format is prose the owner reads in one pass); every test name becomes
load-bearing; two more guards enter the PR path. It is a change to the artifact
**the owner personally signs off on** — that is why it is his call and not the
lead's.

**Lead's recommendation.** Adopt EARS **narrowly**: clause ids + the two lints
only for specs of **platform-core modules** (the consolidation's data core,
auth, the shared admin), keeping the light prose format for everything else.
That gets traceability where eight parallel specs actually collide, without
turning every UI-tweak spec into a formal document. Whatever is decided, the
spec-link + status machinery above already lands and does not depend on it.

**Owner's decision:** _empty — awaiting the owner. Fill this line with the
verdict and its date; do not let anyone else fill it._
