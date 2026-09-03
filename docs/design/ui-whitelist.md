# UI whitelist registry — what may be reused instead of built

This is the second rung of the reuse ladder that every UI task in this repo
climbs (`.claude/rules/design-process.md`):

> **reuse from `design-source/` → adopt from this whitelist → bespoke, with a
> written justification → Stage A/B per task-cycle.**

A whitelist **entry** answers one question: _for this element class, is there
something already settled that a new surface must reuse instead of inventing?_

**The kit is populated and the registry has its first three rows since #434.** `src/ui` landed with #312 (tokens derived from the `design-source/`
wireframes, eight base components, a lint `pnpm lint:ui-tokens`, and a
`/p/ui-kit` showcase), and those contents were **deleted again on #360**
(PR #373): they were derived from `fidelity: wireframe` sources, which fix
layout and no visual language, and the owner rejected the stand. The Stage-A
decision (Антон, 2026-08-26) puts the visual language of `/p/*` on the default
theme of Refine's official shadcn/ui integration; the replacement components
were copied into `src/ui` on the same issue (PR #376) — its README says what
the kit holds. The directory and its boundary rule never moved.

So the ladder today resolves `design-source/` → **`src/ui` (rung 2 by import,
populated with the copied shadcn/ui components since #360, and with the form,
list and feedback BLOCKS since #434)** → bespoke with a justification. In
practice that means: a UI task **imports from `@/ui` and does not invent** —
that obligation comes from EARS-430 and consolidation §10, not from this file.

Keeping the table honest in the meantime is the point. A row here asserts that a
look was accepted by the owner on a real screen; a row added on the strength of
the code existing would make this registry a list of what was written rather
than of what was agreed.

## Entries

| Element class                                       | Settled implementation                                                                                                                                                                                                                                                                                                                                                                                                                                        | Approved at (issue/PR)                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Form** — any screen that collects or edits fields | shadcn **`form`** block — `@/ui/form` (`Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`) over `react-hook-form` `7.87.0` + `zod` `4.4.3` through `@hookform/resolvers` `5.9.1`. Registry `ui.shadcn.com`, style `new-york-v4` (the `radix-nova` style ships an empty `form.json` — it supersedes `form` with `field` — and `new-york-v4` is the variant importing the unified `radix-ui` package this repo pins) | #434 — first shipped on the member profile and alias forms | Field state is the form's, never `useState` per input. Validation lives in ONE zod schema per form and each message renders in that field's `FormMessage`, not in a summary Alert. A `Select` is wrapped by `FormControl` so the label points at the trigger; anything Radix portals also carries `data-bbm-ui`. States: default / hover / focus-visible (ring) / disabled (`pending`) / read-only (`readOnly` mode) / per-field error / submit-failure Alert                                                  |
| **List** — any register of records with paging      | Refine **`data-table`** block — `@/ui/refine-ui/data-table/data-table` + `data-table-pagination`, driven by `useTable` from `@refinedev/react-table` `6.0.1` over `@tanstack/react-table` `8.21.3`. Registry `ui.refine.dev` (item `data-table`)                                                                                                                                                                                                              | #434 — first shipped on the members register               | The block owns head, rows, loading skeleton, empty state and pager; the screen owns only its `ColumnDef[]`. Empty copy is per-resource through `emptyTitle` / `emptyDescription`. The upstream pager's English chrome is localised in the kit — see `src/ui/README.md`. `data-table-filter.tsx` of the same registry item is NOT vendored: it does not typecheck against `@refinedev/core` 5.x                                                                                                                 |
| **Feedback** — the outcome of any act               | **Toasts through Refine's notification provider** — `useNotificationProvider` (`@/ui/refine-ui/notification/use-notification-provider`, registry `ui.refine.dev`) wired into `<Refine>` in `CabinetShell`, rendering into the shadcn **`sonner`** `Toaster` (`@/ui/sonner`, `sonner` `2.0.8`)                                                                                                                                                                 | #434 — first shipped across the whole `/p/admin` cabinet   | ONE channel: every mutation reports success and failure in the same place, in the same shape. A screen names its own Russian `successNotification` / `errorNotification` (Refine's defaults are English). A component that does not go through Refine raises `toast.*` from `sonner` directly. An inline Alert is still correct for a state the reader must KEEP looking at — a record that would not load, a save that failed while the form is still on screen — and never as a duplicate of a transient one |

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
2. **`src/ui`** — present since #312, repopulated on #360 with the copied
   shadcn/ui components. Import it before looking further; its README says what
   the kit currently holds and what it deliberately does not cover yet.
3. **Upstream component registries**, MIT/permissive only, adopted **as owned
   code** (copied in, re-skinned to our own styles — never a runtime UI-kit
   dependency): shadcn/ui (Radix) · Origin UI · Intent UI / JollyUI (React-Aria)
   · Kibo UI. This repo is `UNLICENSED` (proprietary) — paid/proprietary
   registries are **pattern-only**, their code is never committed here.

An adoption is a **decision**, so it lands in a PR that names what was searched,
what was found, and the license — and adds a row above once the class is settled.

## Bespoke — the last resort, and what "justification" means

Bespoke is legitimate today (empty registry) but never silent — check the kit
first. The PR
body of a bespoke UI diff states, in one line:

> `bespoke — whitelist empty for <element class>; searched <sources>; not
adopted because <reason>` (e.g. "no kit in repo; a Radix dependency is not
> justified for one non-interactive table").

A repeated bespoke build of the same element class across ≥2 surfaces is
decision-debt: file it (`surface-decision-debt` skill) — that is the signal the
class is ready to become a row here, or to be pulled forward into #112.
