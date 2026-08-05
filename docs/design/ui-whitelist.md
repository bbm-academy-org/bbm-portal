# UI whitelist registry — what may be reused instead of built

This is the second rung of the reuse ladder that every UI task in this repo
climbs (`.claude/rules/design-process.md`):

> **reuse from `design-source/` → adopt from this whitelist → bespoke, with a
> written justification → Stage A/B per task-cycle.**

A whitelist **entry** answers one question: _for this element class, is there
something already settled that a new surface must reuse instead of inventing?_

**The registry is empty today, on purpose.** This repo has no UI kit: there is no
`src/ui`, no tokens file, no showcase, and exactly one shared component
(`src/components/PublishPanel.tsx`). So the ladder currently resolves
`design-source/` → **(empty)** → **bespoke with a justification**, and that is
the correct, working answer — not a failure of the procedure. The kit
(`src/ui` + showcase, epic 2 / #112) will **add rows here**; it does not change
the ladder.

## Entries

| Element class | Settled implementation | Approved at (issue/PR) | Notes |
| ------------- | ---------------------- | ---------------------- | ----- |

_No entries._ Every element class is currently uncovered → a UI task builds it
bespoke and records the justification in its PR (see below).

## Adding a row

A row is added when an element class becomes genuinely reusable — i.e. all three:

1. it has **one implementation** other surfaces can import (a `src/ui` export, or
   a vendored `design-source/` unit built once and referenced);
2. the owner has **approved its look** at Stage A, and the surface that shipped
   it passed **Stage B** on a live stand (task-cycle stages 1b/5);
3. its states are known and written down — default / hover / focus-visible /
   active / disabled / loading / empty / error.

The row is added in the PR that satisfies (1)–(3), not in a follow-up.

## Where an adoption may come from

When a class is uncovered and the surface needs one, the candidate sources, in
order:

1. **`design-source/`** — the owner already designed this unit for another
   surface; reuse the vendored source (this is rung 1, not an adoption).
2. **`src/ui`** — once #112 lands. Not present today.
3. **Upstream component registries**, MIT/permissive only, adopted **as owned
   code** (copied in, re-skinned to our own styles — never a runtime UI-kit
   dependency): shadcn/ui (Radix) · Origin UI · Intent UI / JollyUI (React-Aria)
   · Kibo UI. This repo is `UNLICENSED` (proprietary) — paid/proprietary
   registries are **pattern-only**, their code is never committed here.

An adoption is a **decision**, so it lands in a PR that names what was searched,
what was found, and the license — and adds a row above once the class is settled.

## Bespoke — the last resort, and what "justification" means

Bespoke is legitimate today (empty registry, no kit) but never silent. The PR
body of a bespoke UI diff states, in one line:

> `bespoke — whitelist empty for <element class>; searched <sources>; not
adopted because <reason>` (e.g. "no kit in repo; a Radix dependency is not
> justified for one non-interactive table").

A repeated bespoke build of the same element class across ≥2 surfaces is
decision-debt: file it (`surface-decision-debt` skill) — that is the signal the
class is ready to become a row here, or to be pulled forward into #112.
