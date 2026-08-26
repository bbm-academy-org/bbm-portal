# UI whitelist registry — what may be reused instead of built

This is the second rung of the reuse ladder that every UI task in this repo
climbs (`.claude/rules/design-process.md`):

> **reuse from `design-source/` → adopt from this whitelist → bespoke, with a
> written justification → Stage A/B per task-cycle.**

A whitelist **entry** answers one question: _for this element class, is there
something already settled that a new surface must reuse instead of inventing?_

**The kit now exists; the registry is still empty, and both facts are correct.**
`src/ui` landed with #312 — tokens derived from `design-source/`, eight base
components, a lint (`pnpm lint:ui-tokens`) and the `/p/ui-kit` showcase. What it
has NOT yet got is the third condition a row requires below: no surface built
from it has passed **Stage B** on a live stand. The kit's acceptance is batched
at #314 (the `/p` launcher), agreed with the owner on 2026-08-26.

So the ladder today resolves `design-source/` → **`src/ui` (rung 2 by import,
not yet by row)** → bespoke with a justification. In practice that means: a UI
task **imports from `@/ui` and does not invent** — that obligation comes from
EARS-430 and consolidation §10, not from this file — and this table starts
filling the moment #314 is accepted, in the PR that carries the acceptance.

Keeping the table honest in the meantime is the point. A row here asserts that a
look was accepted by the owner on a real screen; a row added on the strength of
the code existing would make this registry a list of what was written rather
than of what was agreed.

## Entries

| Element class | Settled implementation | Approved at (issue/PR) | Notes |
| ------------- | ---------------------- | ---------------------- | ----- |

_No entries yet._ The candidates are the eight exports of `src/ui`
(`src/ui/README.md` lists each with the `design-source/` selector it came from);
they become rows when #314 passes Stage B.

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
2. **`src/ui`** — present since #312. Import it before looking further; its
   README names what each component was built from and what it deliberately does
   not cover yet.
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
