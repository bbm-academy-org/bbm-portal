# `src/ui` — the BBM workspace UI kit

One kit for `/p/*` and the cabinet: **any module may import it, it imports no
module.** That is spec 311 EARS-458 / consolidation
[`§10`](../../docs/superpowers/specs/2026-08-04-platform-consolidation-design.md),
enforced by the dependency-cruiser rule `ui-kit-must-not-import-src`
(`pnpm boundaries`) — the to-set is ALL of `src/` with `src/ui/` excepted, so the
kit has no caller it is allowed to know about.

## What the kit is

**The default neutral theme of shadcn/ui, as published through Refine's official
integration.** Owner Stage-A decision, Антон, 2026-08-26, on #360; consolidation
spec §3 decision 9 / §6 / §10, revision `2026-08-26-g`; the provenance row is the
`system:` line in [`design-source/README.md`](../../design-source/README.md) at
`fidelity: visual`.

The delivery model is **copy-paste, and that is the reason it was chosen**: the
components are added to this repo's own source (`npx shadcn add …`), so there is
no UI component library in `package.json` to pin us to someone's release train,
and §10 stays intact because the copied files live inside the kit like any other
kit file. What IS in `package.json` is the small runtime the copied source
imports — `radix-ui`, `lucide-react`, `class-variance-authority`, `clsx`,
`tailwind-merge`, `tw-animate-css` — plus Tailwind and the `shadcn` CLI as dev
dependencies. Those are pinned exactly.

| File                                                                                       | What it is                                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `theme.css`                                                                                | the theme entry — the ONE place a colour value is written. Imported by `src/app/(platform)/p/layout.tsx` |
| `utils.ts`                                                                                 | `cn()` — the `clsx` + `tailwind-merge` helper every copied component imports                             |
| `button.tsx` `card.tsx` `badge.tsx` `avatar.tsx` `separator.tsx` `dropdown-menu.tsx`       | the launcher and shell primitives                                                                        |
| `input.tsx` `label.tsx` `textarea.tsx` `select.tsx` `table.tsx` `alert.tsx` `skeleton.tsx` | the member cabinet CRUD and explicit loading/error/form states (#316)                                    |

**Why this set.** The first six are the set the frozen `/p` launcher (PR #354)
actually renders: a tile per app (card), the external marker (badge), the admin
flag (badge), the top bar's avatar and its rule (avatar, separator), and the app
switcher's trigger and menu (button, dropdown-menu). The second row arrived with
the first editable cabinet tenant (#316): its searchable table, profile and alias
forms, plus explicit loading, validation and read/save failure states. The kit
grows by the same rule — a component is copied in when a surface needs it, not in
anticipation.

## Adding to the kit

```bash
npx shadcn@latest add <component>                          # a base shadcn primitive
npx shadcn@latest add https://ui.refine.dev/r/<item>.json  # a Refine-specific wrapper or block
```

`components.json` is configured so **everything** the CLI generates lands here —
`components`, `ui`, `lib` and `hooks` all alias into `@/ui`, and `utils` into
`@/ui/utils`. Do not accept a generated file under `src/lib` or `src/components`:
that is the §10 boundary leaking, and `pnpm boundaries` will say so on the next
import.

**One caveat for the Refine registry specifically.** Refine's own items
(`views`, `layout-01`, `data-table`, `theme-provider`, …) carry a hardcoded
`target` in their registry JSON, e.g. `src/components/refine-ui/views/…`, and a
`target` overrides the aliases. Adding one therefore needs a follow-up move into
`src/ui` plus an import rewrite. Refine republishes no base primitives — those
come from the plain shadcn registry, which honours the aliases — so this only
bites when the admin shell (#315) starts pulling the CRUD wrappers.

Copied files are Prettier-formatted on the way in (`pnpm format:check` is a gate
and the vendored style differs). That is a formatting pass and nothing else: no
component's markup or variants are edited on arrival.

## The base layer is armed, and it is scoped

Read [`theme.css`](./theme.css)'s header before touching it. A stock shadcn setup
installs Tailwind's **preflight** reset and an `@layer base` block painting
`html` / `body` / `*` in the theme. Neither may land here in that form: this file
is imported by `src/app/(platform)/p/layout.tsx`, so it is loaded on `/p/okr` and
`/p/hours` too, and spec 311 EARS-429 keeps those two page bodies unreskinned
until each surface's own first substantive touch.

So the re-skin slice of #360 armed the base layer **scoped to a `[data-bbm-ui]`
subtree**. A surface opts in by putting the attribute on its root — the shared
top bar and the launcher's `<main>` do today — and a page body that does not is
untouched by every rule in the file. `tests/unit/ui-kit.spec.ts` asserts that
property directly: every selector in the `@layer base` block must begin with
`[data-bbm-ui]`, and no document-level selector may appear anywhere in the file.

Two consequences worth knowing before adding a component:

- **Anything Radix portals to `document.body` needs its own `data-bbm-ui`** —
  the portal lands outside the opted-in subtree. `AppSwitcher.tsx` puts it on
  `DropdownMenuContent` for exactly this reason.
- **When `/p/okr` and `/p/hours` are re-skinned**, the honest move is to drop the
  prefix and go back to stock preflight rather than to keep growing the subset.

## The guard

`pnpm lint:ui-tokens` (`tools/lint/ui-tokens-lint.mjs`, WARN — register:
[`docs/ci-guardrails.md`](../../docs/ci-guardrails.md) §5) holds the one rule
that makes a theme a theme: **a colour literal appears nowhere under `src/ui/**`
except `theme.css`** — in `.tsx` as much as in `.css`, because under Tailwind a
value escapes through `className="bg-[#fafafa]"`, not through a stylesheet. It
also flags a `var(--…)` in a kit stylesheet that `theme.css` does not declare.
While there is no `theme.css` it reports «the UI kit is not present, nothing to
check» rather than PASS: a guard that lost its subject must not look clean.

## What was here before, and why it is gone

The first contents of this directory (#312) were **derived from
`design-source/p-launcher.html` and `design-source/p-admin-shell.html`, which are
`fidelity: wireframe` sources** — they fix layout, not a visual language
(`design-source/README.md` → «The fidelity axis»; the gate is
`pnpm lint:design-fidelity`, #359). Building a token palette and eight components
out of wireframe greys produced a stand the owner rejected on 2026-08-26. The
remedy chosen was not a repaint but a professionally built foundation, so
`tokens.css` / `tokens.ts`, the eight components, the `classNames` helper, the
barrel and the `/p/ui-kit` showcase were deleted (PR-1a of #360) rather than
patched.
