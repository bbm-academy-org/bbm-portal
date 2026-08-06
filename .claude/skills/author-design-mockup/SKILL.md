---
name: author-design-mockup
description: Mechanizes Stage A (task-cycle 1b) for a whole SURFACE — inventory design-source/ first, prepare 2-3 layout options for the owner, get the pick recorded in the issue, and vendor the picked design as a file before any markup. Use when a new or reshaped screen needs an owner layout decision. Project-local; this repo only.
---

# author-design-mockup — the Stage-A gate for a whole surface

**Kind:** procedural · **Mode:** inline (the lead prepares the options and drives
the owner's pick; it may dispatch the option-building, never the asking).

This is **task-cycle stage 1b made mechanical**. Stage 1b says: a new or reshaped
UI surface gets 2–3 design options to the owner BEFORE any code, and the pick is
recorded in the issue. This skill says _how_, and adds the one thing the prose
lacked — the picked design ends up as a **file in
[`design-source/`](../../../design-source/README.md)**, so the next session
cannot rebuild it from a paraphrase.

**Altitude.** This skill is about a **surface's layout** — how a screen is
composed. A single **element class** (button, field, table row, tabs) is the
subject of [`build-ui-from-design-system`](../build-ui-from-design-system/SKILL.md)
and [`research-ui-element`](../research-ui-element/SKILL.md); this skill delegates
down to them and never invents an element on its own.

## When this applies

A task that creates a new screen, or reshapes an existing one enough that its
arrangement changes. Not for a single control or a copy fix — those run the
element-class gate directly. Never for backend-only work.

## Procedure

**0. Inventory before claiming anything is new (hard gate).** Before you call a
block "new", ask a Stage-A question, or dispatch research: `ls design-source/`
and grep it for the surface, the route and the units it renders. Also read the
**whole** issue thread (`gh issue view <N> -c`, untruncated) — a prior session
may already have the owner's pick recorded. A "new surface" claim and a Stage-A
ask are both licensed only after this inventory returns empty. The design is
often already there and unseen.

**1. Name the artifact passport of everything you were handed.** For each
reference (mockup, prototype, page, config): path + who produced it + type —
**original / export / build**. If you did not open the original, say «оригинал не
проверен» outright, in the plan. Do not build a Stage-A option on top of an
artifact whose type you have not established (2026-07-27).

**2. Frame the surface.** Its content set (what must appear), its flows, its
states — empty, loading, error, permission-denied — and the constraints (this is
a Next.js app; the surface lives under `/p/*`, ADR-003). A layout option that
cannot hold the real content set is not an option.

**3. Prepare 2–3 options where a choice is genuinely open.** An option is a
sketch or mockup of **any fidelity** that is enough to choose a direction — a
described layout, a wireframe, a rendered page. Fidelity is not the bar;
_distinguishability_ is: two options that differ only in wording are one option.
Where the owner's own Claude Design project is the medium, hand them the material
they need to work there (content contract, flows, the open question) — in the
owner's terms, naming who does what in which app, never as a bare tool-name verb.

**4. Ask, and record.** Put the choice to the owner as an explicit question and
**record the answer in the issue** (a comment — that is the artifact). No pick,
no markup. A handoff's "already approved" is a hypothesis, not the pick — re-ask
the live owner (task-cycle stage 1; memory `orient-before-acting`).

**5. Vendor the pick into `design-source/`.** The approved artifact becomes a
file with a provenance row, per
[`design-source/README.md`](../../../design-source/README.md), in the same task's
PR. This is the step that makes the pick survive the session. **Every** unit the
surface renders that has its own design source gets vendored too.

**6. Hand it to delivery.** Implementation runs
[`build-ui-from-design-system`](../build-ui-from-design-system/SKILL.md) against
the vendored file; uncovered element classes go to
[`research-ui-element`](../research-ui-element/SKILL.md). Stage B (the owner's
live «принято», task-cycle stage 5) still runs at merge — the Stage-A pick never
substitutes for it.

## Output

- The owner's recorded layout pick, in the issue.
- The picked design vendored in `design-source/` with its provenance row.
- A stated list of the states the picked option does **not** show.

## Failure modes

- **Asking a Stage-A question before the inventory** — the design was already
  vendored and you did not look.
- **Reaching for the owner with one option** — that is a proposal to rubber-stamp,
  not a choice; or with three that differ trivially.
- **A pick recorded only in the session** — if it is not in the issue and the
  file is not in `design-source/`, it does not exist next session.
- **Building an option on an export or a build** without saying so (2026-07-27).
- **Inventing an element class here** instead of delegating down.
- **Treating the Stage-A pick as acceptance** — Stage B is a separate, live gate.
