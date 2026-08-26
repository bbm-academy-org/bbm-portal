---
name: author-feature-spec
description: Drive spec authoring end-to-end for a new module or user-facing behavior — review the surface that exists today, load the governing ADRs, settle the product scope with the owner, then write the light spec in docs/specs/ and take it through the "go". Use at task-cycle stage 1a, before any implementation. Project-local; this repo only.
---

# author-feature-spec — from a feature need to an approved spec

**Kind:** orchestration · **Mode:** inline (the lead runs the sequence itself).

Adapted from ds-platform's skill of the same name (inventory #127). The
deliverable here is the **single** light spec of
[`docs/specs/README.md`](../../../docs/specs/README.md) — not ds's three-file
triplet — but its requirements are **EARS clauses**: the owner adopted EARS for
all specs on 2026-08-05 (see `docs/specs/README.md` § EARS). One file, formal
clause shape, still readable in one pass.

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
- The step-2 primitive cross-check done **before** any mechanism reaches the
  owner.

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
2. **Platform-primitive cross-check** — mandatory, and it runs **before** any
   mechanism is proposed to the owner. Walk the proposal's concerns against the
   cross-cutting primitives this platform already runs — the universal edit
   audit ([`docs/specs/201-universal-edit-audit.md`](../../../docs/specs/201-universal-edit-audit.md),
   `core.audit_event`, `tools/lint/audit-coverage-lint.mjs`), auth claims and
   roles, the migrations pipeline — and **name in the spec which primitive
   covers each concern** instead of inventing a parallel one. A mechanism that
   duplicates a primitive is deleted before the owner ever sees it; where the
   primitive genuinely does not fit, the spec says why in one line.
   _(2026-08-26: the F1 spec offered the owner a «binding-change journal» the
   platform already had (#201); the owner caught it, not the process.)_
3. **Donor & benchmark pass** — mandatory, and it runs **before** a single
   question reaches the owner. Its outcome is recorded by one line in the spec
   body («Donor & benchmark pass: …»), so a skipped pass is visible in the file.
   Three clauses:
   - **Every constraint inherited from a donor spec is marked in the spec**
     «inherited from `<donor>` / justified for us: …». A constraint you cannot
     justify for our domain is **deleted**, not promoted into an owner question:
     asking about it spends the owner on a requirement nobody here has.
     _(symptom: «Предмет Q1 не понял… Она живёт вместе с проектом, столько же
     сколько и проект».)_
   - **An owner question is allowed only where public research cannot answer
     it.** Law, regulation and market best practice are researched first — then,
     and only then, what is left is asked. _(symptom: «сделай ресёрч, как это
     правильно в соответствии с законом… Мы же не первооткрыватели тут».)_
   - **«Exclude X from a rule because of the shape of the data» is a schema bug
     below, never a spec parameter.** It becomes a sub-task against the schema;
     the spec does not encode the workaround. _(symptom: «Может мы криво
     спроектировали публикацию?… Откуда тут мусор?».)_
4. **Settle the product scope with the owner.** One question at a time.
   **Product-scope forks are the owner's**; technical, architectural and
   sequencing calls are the lead's own — do not spend the owner's attention on
   them. `superpowers:brainstorming` is the vehicle. Do **not** chain into
   `superpowers:writing-plans`: the spec is the plan.
   - Any form in scope → run the **CRUD check** now (task-cycle stage 1a):
     Create / Read / Update / Delete spelled out, and which case is deliberately
     unsupported.
   - Any computed or money formula in scope → the spec is mandatory **and** gets
     an independent review of the spec itself.
5. **Write the spec** — `docs/specs/<issue-number>-<slug>.md`, the template and
   frontmatter of `docs/specs/README.md`, **`status: Draft`**. It is one file:
   the lead writes it directly rather than dispatching. Sections that carry the
   weight:
   - `## Prior decisions` — the ADRs from step 1, one line each on what they
     constrain here.
   - `## Requirements` — **EARS clauses** with stable `EARS-N` ids (the five
     shapes are tabulated in `docs/specs/README.md` § EARS). Product language
     inside the clause shape; ids are never renumbered, a split retires the old
     id. Revising an existing prose spec upgrades it to EARS on that revision —
     on touch, never as a mass rewrite pass.
   - `## Acceptance scenarios` — the owner's own verification walkthrough, each
     naming the `EARS-N` clauses it exercises. These become the TDD tests at
     stage 3 (named `it('EARS-N: …')`, so requirement ↔ test is a grep) and the
     live-stand script at stage 5.
6. **New or reshaped UI → the stage-1b design gate.** 2–3 options of any
   fidelity to the owner before any markup; his pick is recorded in the issue and
   referenced from the spec. No pick, no markup.
7. **Take it through the "go" (stage 2).** The owner approves the **spec**, in
   session, explicitly. On "go": flip the frontmatter to **`status: In dev`** —
   that flip is what the `spec-link` guard reads, and a spec left on `Draft`
   while its code is in review is a finding.
8. **If the spec spawns a set of tasks**, open them with
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
- **Offering the owner a mechanism the platform already runs** — the spec grows
  a second audit trail, a second role model or a second migration path, and the
  owner does the cross-check the process should have done.
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
- `docs/specs/README.md` — the format, the status ladder, the EARS canon.
