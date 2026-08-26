# `src/ui` — the BBM workspace UI kit

One kit for `/p/*` and the cabinet: design tokens plus the base components both
surfaces are built from (consolidation spec
[`§10`](../../docs/superpowers/specs/2026-08-04-platform-consolidation-design.md),
issue #312). It ships with a lint (`pnpm lint:ui-tokens`) and a showcase
(`/p/ui-kit`) — the deferred §11 trigger «UI-линты и showcase», whose one
condition was the start of this directory.

## Where the values come from

Two files, and nothing else:

| Source                             | What it settles                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `design-source/p-launcher.html`    | the `/p` home — top bar, page header, the tile grid and its four tile forms  |
| `design-source/p-admin-shell.html` | the cabinet — the same top bar full-bleed, headings, buttons, tags, eyebrows |

Both are owner picks recorded at Stage A (Антон, 2026-08-25; #314 and #315).
`.claude/rules/design-process.md` §1 governs: **build to the file, not to
issue-body prose; where the two disagree, the file wins.**

That is not left as a promise. `tests/unit/ui-tokens.spec.ts` re-reads both
vendored files on every run and fails if a colour they paint has no token, if a
token carries a colour they never used, or if two tokens share one value. The
palette therefore cannot drift from the design by editing `tokens.css` — only
by editing the design.

That check is blind in one direction: it proves a value is IN the palette, not
that the component reached for the RIGHT one. A token derived from a sidebar
group of the cabinet is a perfectly valid token to paint a launcher tile
caption with, and the palette check sees nothing. So the other direction is
asserted too — `tests/unit/ui-design-fidelity.spec.ts` resolves what a
component actually paints through the token layer and compares it, property by
property, with the declarations the vendored file carries for the same element
(the planned caption, the external marker, the cabinet tag, the empty status
line). Both blockers of the #353 review were exactly that gap.

**The palette is all grey, and that is the design's own statement**: 22 greys, no
hue, no accent, no border-radius except the avatar's circle. A brand colour, when
the owner picks one, arrives as a new token group from a new Stage A — never
from a component.

## What is in here

| Export       | Built from                                             | Notes                                                                              |
| ------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `tokens.css` | every value in both sources                            | the `:root` layer; each token names the selector it was read from                  |
| `tokens.ts`  | —                                                      | the token NAMES, grouped for the showcase. Names only; drift is caught by the lint |
| `TopBar`     | `.bar` of both sources                                 | EARS-425/440. Switcher and sign-out are SLOTS — the registry never reaches the kit |
| `AppTile`    | `.tile` and its `.ext` / `.admin` / `.ghost` modifiers | the four forms of EARS-468; the `planned` form is inert by element type (EARS-478) |
| ↳ status     | `.pulse` and `.pulse.none`                             | a live status line, or `emptyStatus` — the foot rule stating there is none         |
| `TileGrid`   | `.grid`                                                | `auto-fill` at a min column width, not `repeat(4, 1fr)` — see below                |
| `PageHeader` | `h1` + `.sub` / `.hint`                                | always an `h1`; two sizes, the launcher's and the cabinet's                        |
| `Button`     | `.bar-switch` / `.btn` / `.bar-out`                    | a button, never a link; `type="button"` by default                                 |
| `Tag`        | `.tag` and `.ext-mark`                                 | one element class, TWO forms: the cabinet's filled tag and the launcher's `mark`   |
| `Eyebrow`    | `.side-title` / `.grp-name` / `th` / `.admin-flag`     | a `<span>`, never a heading: an eyebrow must not enter the document outline        |
| `Container`  | `.bar-in` / `main`                                     | the 1160px measure; vertical rhythm belongs to what it holds                       |
| `cx`         | —                                                      | the kit's one utility, three lines, so the kit adds no runtime dependency          |

Everything is presentation. No data fetching, no auth gating, no registry, no
routing — and that is machine-enforced, not asked for: the boundary rule
`ui-kit-must-not-import-src` (spec 311 EARS-458) forbids `src/ui` every import
from `src/` except `src/ui` itself, while every module, route and even the CMS
side may import the kit. `pnpm boundaries`; demonstrated by four fixtures in
`tests/unit/platform-boundaries.spec.ts`.

## Three places the kit is not a transcription

All three are cases where the vendored file could not answer — a width it never
draws, a state it never shows — and all three are recorded rather than silently
decided. Where the file DOES answer, it wins and there is nothing to record:
the launcher's «↗ внешний» marker was a fourth entry here until the #353 review,
and the fix was to paint it as `p-launcher.html` draws it, not to justify the
difference.

1. **The grid's column count.** The wireframe says `repeat(4, 1fr)` at one
   desktop width — the only width a static mockup has, and its own header lists
   `narrow/mobile` under NOT SHOWN. EARS-428 requires the home to stay usable
   while narrow, so the grid is expressed as a minimum column width
   (`--bbm-size-tile-min-width: 260px`) rather than a fixed four. At the
   launcher's own measure this is not an approximation of the design, it IS the
   design: 1160 − 48 padding − 3 × 16 gap = 266px per column, so `auto-fill`
   lays out exactly four until the viewport is narrower than the wireframe's.

2. **The top bar wrapping.** `.bar-in` is a single 52px-high flex row in both
   wireframes, at the one desktop width they draw. `TopBar` adds
   `flex-wrap: wrap` for the same reason the grid is not a fixed four —
   EARS-428 requires the workspace to stay usable while narrow, and an
   unwrapped bar overflows the page instead. At the wireframes' own width
   nothing wraps, so the drawn layout is unchanged.

3. **Hover, focus-visible, active and disabled.** Neither source draws them —
   both list the states they omit in their own headers. They are derived from
   the palette rather than invented: hover borrows the neighbouring surface
   step, focus reuses the sidebar's accent rail width, disabled drops to the
   disabled text token. The design has no colour to signal with, so nothing here
   signals with colour.

## What is deliberately NOT here yet

The cabinet's own furniture — sidebar navigation, the resource table, the
breadcrumb, the toolbar, the pager. Those belong to #315, which builds the shell
against `p-admin-shell.html`; the tokens they need are already in `tokens.css`
(the file is derived from BOTH sources, not only the launcher's), so #315 adds
components, not values.

Also not here: an `Avatar` export. The bar's avatar is an empty swatch in both
wireframes — there is no member photo anywhere in this workspace — so it lives
inside `TopBar` as decoration rather than becoming a public component with
nothing to show.

## Using it

```tsx
import { AppTile, Container, PageHeader, TileGrid, TopBar } from '@/ui'
```

`@/ui` is the only door: nothing imports past the barrel into a component file.
Importing the barrel also pulls in `tokens.css`, so a consumer cannot get the
components without the palette.

**The kit is for code that a bundler compiles.** Because the barrel imports a
stylesheet, `@/ui` must not be imported from a module that Node executes
directly with no CSS loader — a Payload collection, `payload.config.ts`, a
`tools/` script, an instrumentation hook. The boundary rule
`ui-kit-must-not-import-src` says the CMS side MAY import the kit, and that is
a statement about dependency direction, not an invitation: a Payload collection
that pulled in `@/ui` would execute `import './tokens.css'` inside the tsx
config loader and fail there, not at build time. Shared VALUES a Node context
needs (token names) live in `src/ui/tokens.ts`, which imports no CSS.

## Adding to it

1. The surface's design source is vendored in `design-source/` first, or there
   is nothing to build to (`.claude/rules/design-process.md` §1).
2. New values go in `tokens.css` with the selector they came from; a value
   written into a component stylesheet is a `hardcoded-color` finding.
3. A new token is listed in `tokens.ts` in the same edit — the lint fails on
   drift in either direction, and the showcase renders from that list.
4. The component gets a section in `/p/ui-kit` and a clause in
   `tests/unit/ui-markup.spec.ts`; `tests/unit/ui-showcase.spec.ts` fails if the
   showcase stops being complete.
5. When an element class settles, it gets a row in
   [`docs/design/ui-whitelist.md`](../../docs/design/ui-whitelist.md) — in that
   PR, not a follow-up.
