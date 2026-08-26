# UI whitelist registry — what may be reused instead of built

This is the second rung of the reuse ladder that every UI task in this repo
climbs (`.claude/rules/design-process.md`):

> **reuse from `design-source/` → adopt from this whitelist → bespoke, with a
> written justification → Stage A/B per task-cycle.**

A whitelist **entry** answers one question: _for this element class, is there
something already settled that a new surface must reuse instead of inventing?_

**The kit landed with #312** — tokens derived from `design-source/`, eight base
components, a lint (`pnpm lint:ui-tokens`) and the `/p/ui-kit` showcase. The one
condition it could not satisfy on its own is the second below: a kit is not
«settled» because it was written, but because a surface built from it was
accepted by the owner. That acceptance was batched at #314 (the `/p` launcher),
agreed with the owner on 2026-08-26, and #314 is the PR that fills this table.

So the ladder resolves `design-source/` → **`src/ui`** → bespoke with a
justification. A UI task **imports from `@/ui` and does not invent** — that
obligation comes from EARS-430 and consolidation §10, not from this file; what
the rows below add is the record of WHICH classes are settled and on which
screen, so a later surface can point at a decision rather than re-argue it.

Keeping the table honest in the meantime is the point. A row here asserts that a
look was accepted by the owner on a real screen; a row added on the strength of
the code existing would make this registry a list of what was written rather
than of what was agreed.

## Entries

**Status of this table: filled by #314, pending that issue's Stage-B GO.** Every
row below satisfies conditions (1) and (3) of "Adding a row" today — one
importable implementation, and its states written down — and satisfies (2)'s
Stage-A half (Антон, 2026-08-25). The Stage-B half is the `/p` launcher's own
acceptance on a live stand, which is what these eight classes shipped on. Until
the owner says «принято» the rows are **provisional**: the PR that carries the
acceptance replaces the pending marker with the GO line, and a refusal at Stage B
takes the rows back out rather than leaving a registry that asserts an approval
nobody gave.

| Element class                           | Settled implementation   | Approved at (issue/PR)                | Notes                                                                                                                       |
| --------------------------------------- | ------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Workspace top bar                       | `TopBar` from `@/ui`     | #314 · PR #354 — _pending Stage-B GO_ | `.bar` of both vendored sources. Switcher and sign-out are SLOTS — the bar never reaches the registry. Wraps while narrow.  |
| App tile (launcher entry)               | `AppTile` from `@/ui`    | #314 · PR #354 — _pending Stage-B GO_ | Four forms and only four (EARS-468): internal · external · admin · planned. A `planned` tile is inert BY ELEMENT TYPE.      |
| Tile grid                               | `TileGrid` from `@/ui`   | #314 · PR #354 — _pending Stage-B GO_ | `auto-fill` at `--bbm-size-tile-min-width`, not a fixed four — four columns at the launcher's own measure, reflowing below. |
| Page header (title + subtitle)          | `PageHeader` from `@/ui` | #314 · PR #354 — _pending Stage-B GO_ | Always an `h1`; two sizes, the launcher's `lg` and the cabinet's `md`.                                                      |
| Content measure                         | `Container` from `@/ui`  | #314 · PR #354 — _pending Stage-B GO_ | The 1160px measure of `.bar-in` / `main`. Vertical rhythm belongs to what it holds, never to the container.                 |
| Button (chrome control, toolbar, plain) | `Button` from `@/ui`     | #314 · PR #354 — _pending Stage-B GO_ | A button, never a link; `type="button"` by default. Navigation is an `<a>`, and that is not negotiable per surface.         |
| Tag / marker                            | `Tag` from `@/ui`        | #314 · PR #354 — _pending Stage-B GO_ | One element class, two forms: the cabinet's filled tag and the launcher's `mark` («↗ внешний»).                             |
| Eyebrow (small caps label)              | `Eyebrow` from `@/ui`    | #314 · PR #354 — _pending Stage-B GO_ | A `<span>`, never a heading — an eyebrow must not enter the document outline.                                               |

**States, for condition (3):** default / hover / focus-visible / active /
disabled are in the kit itself and derived from the palette rather than invented
(`src/ui/README.md` §3 records the derivation, and the two vendored sources'
headers record that they draw none of them). Loading / empty / error are not
component states in this kit — no component fetches anything — so they are
answered per surface; `/p`'s answers are written at the top of
`src/app/(platform)/p/page.tsx`.

**Not a row:** the app switcher's OPEN menu
(`src/app/(platform)/p/AppSwitcher.tsx` + `app-switcher.css`). The vendored file
draws the control closed only, so the panel is bespoke-with-justification
(rung 3), local to the surface, and becomes a candidate for the kit when a menu
is designed rather than a settled element class today.

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
