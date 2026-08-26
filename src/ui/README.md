# `src/ui` — the BBM workspace UI kit (contents being replaced, #360)

**This directory is deliberately empty of components right now.** The directory
itself and its dependency-cruiser boundary
(`ui-kit-must-not-import-src`, spec 311 EARS-458, consolidation
[`§10`](../../docs/superpowers/specs/2026-08-04-platform-consolidation-design.md))
stay exactly as they were: one kit for `/p/*` and the cabinet, modules import it,
it imports no module.

## What was removed and why

The first contents of this directory (#312) were **derived from
`design-source/p-launcher.html` and `design-source/p-admin-shell.html`, which are
`fidelity: wireframe` sources** — they fix layout, not a visual language
(`design-source/README.md` → "The fidelity axis"; the gate is
`pnpm lint:design-fidelity`, #359). Building a token palette and eight
components out of wireframe greys produced a stand the owner rejected on
2026-08-26.

**Stage-A decision (owner, Антон, 2026-08-26, on #360):** the visual language of
`/p/*` is the **default neutral theme of Refine's official shadcn/ui
integration**. Consolidation spec §3 decision 9 / §6 / §10, revision
`2026-08-26-g`. So the wireframe-derived tokens (`tokens.css` / `tokens.ts`), the
eight components, the `classNames` helper, the barrel and the `/p/ui-kit`
showcase route were deleted rather than patched: the frame was built from the
wrong source, and the remedy is a professionally built foundation, not a repaint.

## What lands here next

Tailwind is added to the build and the components are **copied into this
directory** from the Refine registry
(`npx shadcn add https://ui.refine.dev/r/<component>.json`, registry
`ui.refine.dev`) — copy-paste by design, so no UI npm dependency is added and
§10 stays intact. That is the next PR on #360; this one only clears the ground.

`pnpm lint:ui-tokens` reports «the UI kit is not present, nothing to check» while
this directory has no `tokens.css`, by construction — a guard that lost its
subject must not report success on a rule it never evaluated.
