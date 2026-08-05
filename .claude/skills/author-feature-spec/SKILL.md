---
name: author-feature-spec
description: Drive spec authoring end-to-end for a new module or user-facing behavior — review the surface that exists today, load the governing ADRs, settle the product scope with the owner, then write the light spec in docs/specs/ and take it through the "go". Use at task-cycle stage 1a, before any implementation. Project-local; this repo only.
---

# author-feature-spec — from a feature need to an approved spec

**Kind:** orchestration · **Mode:** inline (the lead runs the sequence itself).

Adapted from ds-platform's skill of the same name (inventory #127) **without the
EARS machinery**: ds dispatches a subagent to produce a three-file EARS triplet;
here the deliverable is the single light spec of
[`docs/specs/README.md`](../../../docs/specs/README.md), which the owner — a
non-developer — reads in one pass. That format is the point: it is his control
interface, and formal clause syntax would take it away from him. (The EARS
question is open and owner-facing; see the revisit brief in
`docs/specs/README.md`.)

## When this applies

Task-cycle **stage 1a**: a new platform module, or new user-facing behavior (a
page, route, visible flow). Not for CMS-contract upkeep, chore/fix/refactor —
those skip the spec by the gate in `task-cycle` stage 0.

If the feature has no product definition yet (no owner brief, no decided
stories), it enters **upstream** at
[`do-product-discovery`](../do-product-discovery/SKILL.md) and comes back here
once a PRD exists.

## Cannot proceed without

- The ADRs loaded (step 1) **before** any open-ended brainstorm.
- The step-0 "what exists today → what changes" delta, or an explicit note that
  there is no existing counterpart.

## Procedure

Each step is a gate: the next one does not start until the previous produced its
output.

0. **Review what exists today.** The portal already runs surfaces
   (`portal.bbm.academy/p/*`, the CMS admin). Open the real one in the area the
   feature touches, read its module under `src/modules/`, and write a short
   **"current behavior → replacement delta"**. Every external reference gets an
   **artifact passport** (path + owner + type: original / export / build) per
   task-cycle stage 1 — a mockup export mistaken for the original has cost this
   repo three owner escalations. Skip only when there is genuinely no
   counterpart, and then say so in writing.
1. **[`read-relevant-adrs`](../read-relevant-adrs/SKILL.md)** — load the ADRs
   governing the domain and cite them (`per ADR-00N §X`) in the first reply.
   Brainstorming before this is how a settled decision gets re-litigated.
2. **Settle the product scope with the owner.** One question at a time.
   **Product-scope forks are the owner's**; technical, architectural and
   sequencing calls are the lead's own — do not spend the owner's attention on
   them. `superpowers:brainstorming` is the vehicle. Do **not** chain into
   `superpowers:writing-plans`: the spec is the plan.
   - Any form in scope → run the **CRUD check** now (task-cycle stage 1a):
     Create / Read / Update / Delete spelled out, and which case is deliberately
     unsupported.
   - Any computed or money formula in scope → the spec is mandatory **and** gets
     an independent review of the spec itself.
3. **Write the spec** — `docs/specs/<issue-number>-<slug>.md`, the template and
   frontmatter of `docs/specs/README.md`, **`status: Draft`**. It is one file:
   the lead writes it directly rather than dispatching. Sections that carry the
   weight: `## Prior decisions` (the ADRs from step 1, one line each on what
   they constrain here) and `## Acceptance scenarios` (the owner's own
   verification walkthrough — these become the TDD scenarios at stage 3 and the
   live-stand script at stage 5).
4. **New or reshaped UI → the stage-1b design gate.** 2–3 options of any
   fidelity to the owner before any markup; his pick is recorded in the issue and
   referenced from the spec. No pick, no markup.
5. **Take it through the "go" (stage 2).** The owner approves the **spec**, in
   session, explicitly. On "go": flip the frontmatter to **`status: In dev`** —
   that flip is what the `spec-link` guard reads, and a spec left on `Draft`
   while its code is in review is a finding.
6. **If the spec spawns a set of tasks**, open them with
   [`spec-issue-graph`](../spec-issue-graph/SKILL.md) — native sub-issues and
   `blocked_by` edges, exactly one takeable task at the end — and write the
   issue numbers back into the spec header.

## Output

- `docs/specs/NNN-<slug>.md` on `main`, status `In dev`, citing its ADRs.
- The owner's recorded "go" on that spec (issue comment).
- The design-gate pick recorded, for a UI feature.
- The issue graph opened and its numbers written back, when the spec is a set.

## Failure modes

- **Designing without opening the live surface.** The replacement gets specified
  against an imagined current state.
- **Brainstorming before the ADRs** — re-deriving a decision already recorded.
- **Spending the owner on technical forks** — the questions he must answer get
  lost among the ones he should not have been asked.
- **A spec with no acceptance scenarios**, or scenarios that are not something a
  non-developer can perform on a real URL. Stage 5 then has no script.
- **Leaving the spec on `Draft` after the "go"** — the status is the machine-
  readable trace of the owner's approval; unflipped, it says he never approved.
- **Writing a spec for a chore** because it felt safer. The gate exists in both
  directions; ask at stage 1 when unsure.

## Related

- [`read-relevant-adrs`](../read-relevant-adrs/SKILL.md) · [`do-product-discovery`](../do-product-discovery/SKILL.md) — upstream.
- [`spec-issue-graph`](../spec-issue-graph/SKILL.md) — spec → issue set.
- [`task-cycle`](../task-cycle/SKILL.md) — the outer lifecycle; this is stage 1a.
- `docs/specs/README.md` — the format, the status ladder, the EARS revisit.
