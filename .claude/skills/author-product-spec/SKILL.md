---
name: author-product-spec
description: Author the product layer of an epic — a thin epic brief plus a per-feature PRD with stable US-N user-story ids, flows and product acceptance criteria, in docs/product/. Dispatched to a subagent during product discovery; it is the source the feature spec is written from, never its duplicate. Project-local; this repo only.
---

# author-product-spec — the PRD layer above the spec

**Kind:** procedural · **Mode:** dispatch. The lead passes this file's
"Subagent brief" to a subagent (`general-purpose`, explicit `model: opus`) and
consumes the verdict; it does not write the PRD inline.

Adapted from ds-platform (inventory #127), minus the EN/RU mirroring — docs in
this repo are English-only.

**Where the layer lives:** `docs/product/<epic-slug>/`. The product layer answers
_what the user needs and why_; the light spec in `docs/specs/` answers _what gets
built and how the owner verifies it_. Two layers, one direction: the PRD is the
source the spec is written from, never a second copy of it.

## When to dispatch it

Step 4 of [`do-product-discovery`](../do-product-discovery/SKILL.md) — a product
epic, or a user-facing feature with no product definition yet. A feature that
already has an owner-approved brief goes straight to
[`author-feature-spec`](../author-feature-spec/SKILL.md); do not manufacture a
PRD layer for a single small change.

---

## Subagent brief

You are authoring the product layer for a BBM Platform epic. Write in English.
The reader is the owner: a non-developer founder who decides product questions
and approves what gets built.

### Input (the lead supplies these)

- The epic slug and the feature list under discussion.
- The prior-art review from discovery step 2, each source with its **artifact
  passport** (path + owner + type: original / export / build).
- The brainstorm outcome: jobs-to-be-done, information architecture, feature
  decomposition, per-feature stories — with the provenance of each item marked.
- The ADRs governing the domain (from `read-relevant-adrs`).

### Procedure

1. **Write the epic brief** — `docs/product/<epic-slug>/brief.md`, deliberately
   **thin** (bullets, not stories):
   - Frontmatter: `status: Draft`, `epic: <issue #>`, `features:` (the
     decomposition), `updated:`.
   - Sections: Problem · Jobs-to-be-done · Information architecture (how the
     epic's surfaces compose into one cabinet) · Feature decomposition · Success
     metrics · **Prior art — what exists today** (the reviewed sources, each with
     its passport; reference material, never a template to reproduce).
   - One brief per epic, revisable throughout discovery: a changed decomposition
     re-flows into the feature PRDs.
2. **Write one PRD per feature** — `docs/product/<epic-slug>/<NNN>-product.md`,
   where `NNN` is the feature's GitHub issue number:
   - Frontmatter: `status: Draft`, `epic:` (back-link to the brief),
     `surface: user-facing | backend-only`, `updated:`.
   - Sections: Feature summary · **User stories** (each with a stable `US-N` id)
     · Flows (happy path plus the branches that matter) · **Product acceptance
     criteria** in outcome language · Out of scope · Open questions.
   - A `user-facing` feature carries a slot for the stage-1b design pick, filled
     when the owner picks.
3. **`US-N` ids are the traceability anchor.** Minted here, per feature, stable
   for the life of the PRD. When a story splits, **retire the old id and add new
   ones** — never silently renumber, or every downstream reference dangles.
4. **Mark provenance on every item.** Only what the owner actually chose is
   owner-approved. Anything you generated to connect the picture — a nav item, an
   IA element, a surface he never named — is labelled
   **`agent-proposed — UNCONFIRMED`** and stays that way until he confirms it in
   his own words. A "settled decisions" block the owner does not recognise is the
   exact failure this guards against.
5. **Do not write acceptance scenarios or requirements.** Product acceptance
   criteria stop at outcome language ("the participant can see last month's
   payout without asking anyone"). The verifiable walkthrough on a real URL is
   the spec's job, downstream, in `docs/specs/`.
6. **Commit** the product layer on the discovery branch. Prettier formats
   markdown in this repo — run `pnpm format:check` before handing back.

### Output

- `docs/product/<epic-slug>/brief.md` plus one `<NNN>-product.md` per feature,
  committed.
- A verdict of at most ten lines: epic and features authored, story count and
  `US-N` range per feature, which items are `UNCONFIRMED`, prior art used, open
  questions for the owner.

### Failure modes

- **Duplicating the spec** — writing requirements or acceptance scenarios in the
  PRD. The PRD is outcome language; the spec is the verifiable one.
- **A fat brief** — all the stories in the epic doc. Depth lives in the feature
  PRD; the brief stays scannable.
- **Unstable `US-N` ids** — a silent renumber breaks every back-reference.
- **Laundering agent-invented scope as owner-approved** — the provenance mark is
  not optional decoration.
- **Reproducing a prior-art system's structure** as the design. It is a
  functional reference; the model is designed fresh.
- **Missing or wrong `surface:`** — it decides whether the design gate applies.

## Related

- [`do-product-discovery`](../do-product-discovery/SKILL.md) — dispatches this at step 4.
- [`author-feature-spec`](../author-feature-spec/SKILL.md) — the downstream layer.
- [`task-canon`](../task-canon/SKILL.md) — how the resulting issues are filed.
