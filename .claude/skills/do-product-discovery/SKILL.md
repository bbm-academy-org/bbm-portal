---
name: do-product-discovery
description: Drive the discovery half of a product epic — review the prior art with artifact passports, brainstorm the product with the owner, dispatch the epic brief and feature PRDs, run the design gate, and hand off to spec authoring. Use when an epic or user-facing feature has no product definition yet. Project-local; this repo only.
---

# do-product-discovery — the track before the spec

**Kind:** orchestration · **Mode:** inline (the lead runs the sequence; it
dispatches [`author-product-spec`](../author-product-spec/SKILL.md) at step 4).

Adapted from ds-platform (inventory #127). Two things were rebuilt for this
repo: ds mines a legacy Bubble app as its source system, while bbm-portal's
prior art is its **own live surfaces plus the owner's briefs**; and ds has a
dedicated design-mockup skill, while here the design decision is task-cycle's
**stage-1b gate**.

Discovery produces the product layer and an owner-picked design direction. It
does **not** own issue filing, branches, review or merge — `task-cycle` does.

## When this applies

A new product epic, or a user-facing feature with no PRD. Not for: a backend-only
change with an existing spec (go to `author-feature-spec`), a bugfix, or a
feature already designed and entering implementation.

> **⛔ Scope ceiling — a remediation is not a greenfield epic.**
> When the trigger is fixing or retiring an **existing** surface (a broken page,
> a rejected layout, a bug on a shipped route), this skill is anchored to that
> surface and to destinations that **already ship**. Before brainstorming
> anything, enumerate what actually exists (`ls src/app/(platform)`,
> `src/modules/*`): if the destination already ships, the answer is a minimal
> re-point or render swap, and discovery produces a one-line PRD increment — not
> an epic, not a new shell, nav or component. A rebuild, or ANY net-new surface,
> needs the owner's **explicit opt-in in his own words**; discovery never
> introduces one on its own initiative. Routing a remediation through the spec
> process is correct; inflating its scope on the way is not.

## Cannot proceed to delivery without

Both halves of the step-6 handoff gate: the owner's recorded design pick (or the
`backend-only` skip) **and** the PRD's product acceptance criteria.

## Procedure

1. **[`read-relevant-adrs`](../read-relevant-adrs/SKILL.md)** — ADR-002 (module
   and repo strategy), ADR-003 (domain topology), plus whatever governs the
   epic's domain. Cite them in the first reply.
2. **Review the prior art.** For BBM that is, in order: the **live surfaces**
   this epic touches (`portal.bbm.academy/p/*`, the CMS admin) and their modules
   under `src/modules/`; the owner's product briefs (`../bbm/outputs/*`); the
   platform PRD in `bbm-platform-prd` (D-001..D-029) when the epic is
   platform-wide. Each source gets an **artifact passport** — path + owner +
   type (original / export / build) — and if the original was not opened, say so
   outright. Take the domain and the intent; never copy a structure because it
   is there. When discovery spans sessions, commit the review as
   `docs/product/<epic>/prior-art.md` so the next session does not re-mine it.
3. **Brainstorm the product with the owner** (`superpowers:brainstorming`).
   Settle jobs-to-be-done, the information architecture, the feature
   decomposition and the per-feature stories. **Product-scope forks are his**
   (`AskUserQuestion`); sequencing and architecture are yours. Mark provenance
   per item: what he picked is owner-approved, what you generated to connect the
   picture is `agent-proposed — UNCONFIRMED` until he confirms it in his own
   words. **Persist approved decisions immediately** into the tracking issue
   body (and later into `brief.md`) — that is their durable home; a session's
   context is not.
4. **Dispatch [`author-product-spec`](../author-product-spec/SKILL.md)** —
   `general-purpose`, explicit `model: opus`, return contract ≤30 lines. It
   writes `docs/product/<epic>/brief.md` and one `<NNN>-product.md` per feature.
   The product-layer PR is a spec artifact: it takes a real review, not the
   docs-only fast path.
5. **Design gate (task-cycle stage 1b)** for every `user-facing` feature: 2–3
   options of any fidelity — described layout, wireframe, rendered page — to the
   owner **before** any markup. Record his pick in the issue and reference it
   from the PRD. Loop back to step 4 when the design exposes a missing or wrong
   story. Skip entirely for `surface: backend-only`.
6. **Handoff gate → spec authoring.** A feature is ready to be specced only when
   both the design pick (or the backend-only skip) and the product acceptance
   criteria exist. The brief stays revisable throughout — a changed decomposition
   re-flows into the affected PRDs _before_ this gate, not after. Then hand each
   feature to [`author-feature-spec`](../author-feature-spec/SKILL.md), which
   reads the PRD as its product input and writes the light spec the owner signs
   off on.

## Output

- `docs/product/<epic-slug>/brief.md` — the thin epic PRD.
- `docs/product/<epic-slug>/<NNN>-product.md` per feature, with stable `US-N`
  ids and the recorded design pick.
- `docs/product/<epic-slug>/prior-art.md` when discovery spanned sessions.
- Approved decisions persisted in the tracking issue.
- A per-feature handoff into `author-feature-spec`.

## Failure modes

- **Inflating a remediation into an epic** — the scope ceiling above exists
  because this has already happened elsewhere and was cancelled after the fact.
- **Laundering agent-invented scope as owner-approved** — per-item provenance,
  always.
- **Prior art taken as a template** — copying a structure instead of designing
  from the need. Passports say what a source _is_; an export is not an original.
- **Skipping the design gate** and writing a spec for a user-facing feature from
  text alone — the rework cycles this repo already paid for.
- **Crossing into delivery with only half the gate** — a design pick with no
  acceptance criteria, or the reverse.
- **Re-implementing the lifecycle** — issue filing, branches, review and merge
  belong to `task-cycle` and `task-canon`, not here.
- **Proposing `/wrap` before the decisions are written down** — an approved
  decomposition that lives only in the session dies with it.

## Related

- [`author-product-spec`](../author-product-spec/SKILL.md) — step 4 dispatch.
- [`author-feature-spec`](../author-feature-spec/SKILL.md) — the downstream track.
- [`read-relevant-adrs`](../read-relevant-adrs/SKILL.md) — step 1.
- [`task-cycle`](../task-cycle/SKILL.md) — stage 1b is step 5; the lifecycle owns the rest.
