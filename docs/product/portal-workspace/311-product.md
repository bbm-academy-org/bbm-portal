---
status: Draft
epic: portal-workspace (#112) — see ./brief.md
surface: backend-only
updated: 2026-08-24
---

# Module plug-in contract (#311)

## Feature summary

One declaration per module, three renderings: a tile in the `/p` launcher, an
entry in the top-bar app switcher, and a section with its resources in the
`/p/admin` navigation (owner decisions 1, 2, 4). A module author writes that
declaration inside their own module and touches no frame code.

The contract is designed against the **full target portfolio** (consolidation
spec §4, revision -f: hours, OKR, finance, decks, CRM, task management, team
search, project launch, calculators, communication tie-ins), and verified on the
first two tenants (`members`, `hours`). It is backend-only: it has no screen of
its own, but every screen in this epic is a rendering of it.

The actor here is the **module author** — the person or agent building the next
internal app. The contract's product promise is that they never edit the frame.

## User stories

- **US-1** — As a module author, I declare my app once inside my own module and
  it appears in the launcher, the app switcher and (if it has one) the admin
  navigation, without editing any frame file. _(owner decisions 1, 2, 4)_
- **US-2** — As a module author, I can attach an optional live status line to my
  tile ("period open until the 1st"), so the workspace home shows what needs
  attention today. _(owner decision 1)_
- **US-3** — As a module author whose app is not for everyone, I name one
  required claim in my declaration, and the frame stops listing my app for
  members who do not carry it. _(owner decision 3)_
- **US-4** — As a module author, I register the external tools my part of the
  work lives in (Plane, Mattermost, KB) the same way I register an internal app,
  so the workspace home is one catalogue rather than a list plus a footer of
  links. _(owner decision 1 fixed that external links appear in the launcher;
  `lead-decided`: they go through the SAME registry as an entry of kind
  `external`, rather than a separate static list)_
- **US-5** — As a module author, I declare my admin section and its resources in
  the same declaration as my launcher tile, so a module has one registration,
  not two. _(owner decision 4)_
- **US-6** — As the owner, I can see the full list of what is registered in the
  workspace by opening `/p`: the launcher IS the inventory. _(`lead-decided`: no
  separate registry inventory view in v1)_
- **US-7** — As a module author, a broken or slow status line degrades my tile
  to its static form without breaking or blocking the workspace home for anyone.
  _(`lead-decided`)_

## Flows

**Registering an app (happy path).**
Module author adds the declaration to their module → the frame discovers it →
the app appears as a tile on `/p`, as an entry in the app switcher, and, when a
section was declared, as a group in `/p/admin` navigation → no frame file
changed, no launcher list edited.

**Registering with a required claim.**
Declaration names a required claim → members carrying the claim see the tile and
the switcher entry → members without it see a workspace with no trace of the app
→ a member who reaches the URL directly is stopped by the module's own
server-side authorization, not by the absence of a tile. _(owner decision 3)_

**Status line.**
The frame asks each registered module for its status line when rendering `/p` →
modules that provide one render a live line under the tile → modules that do not
render a tile with no line, which is the normal case, not a degraded one. A
provider that fails or is slow yields the tile in its static form; the rest of the
home renders and never blocks on a module's pulse. _(the provider is
owner-approved and optional; the failure behaviour is `lead-decided`)_

**External link entry.**
An entry of kind `external` declares where it points and carries no admin section
and no status line; it is visually marked as external and opens in a new tab, so
the member does not lose the workspace. _(`lead-decided`)_

**Retiring an app.**
Removing the declaration removes the app from all three renderings at once; the
registry is the single source, so no frame cleanup is needed. _(`lead-decided`)_

## Product acceptance criteria

Outcome language; the feature spec restates these as EARS clauses.

- A module author can add a new app to the workspace by editing that module's
  own files plus exactly one import and one array element in the composition
  root `src/lib/workspace/registry.ts` — and zero lines in the launcher, the top
  bar or the admin shell, none of which holds a list of apps. _(Amended
  2026-08-25 by D-2 of `docs/specs/311-portal-workspace.md`: discovery is an
  explicit composition root, not filesystem globbing, so "only files inside that
  module" was never buildable as written.)_
- An app registered once is listed in the launcher and in the top-bar app
  switcher without a second registration.
- A module that declares an admin section has that section and its resources in
  the `/p/admin` navigation from the same declaration.
- A module that declares no admin section has no presence in `/p/admin`.
- An app with a required claim is absent from the launcher and the app switcher
  for a member whose session lacks that claim.
- A member whose session lacks the claim cannot reach the app's data by
  navigating to its URL directly.
- An app that supplies a status line shows it on its launcher tile.
- An app that supplies no status line renders a complete, non-broken tile.
- A status line that cannot be produced leaves the rest of the workspace home
  intact.
- The launcher lists external tools alongside internal apps, marked as external
  and opening in a new tab.
- Removing a module's declaration removes it from every rendering.
- The contract accommodates each app in the target portfolio (spec §4,
  revision -f) without a new frame concept per app — checked by walking the
  portfolio list against the contract, not only the two first tenants.

## Out of scope

- The visual design of tiles, switcher and admin navigation — features #314 and
  #315, after Stage A.
- The mechanics of the declaration (file shape, types, discovery mechanism,
  where the registry lives) — the feature spec and #314/#315.
- Per-module claim design beyond the single optional required-claim field —
  finer roles are added during operation (owner, 2026-08-24).
- Product design of any portfolio app other than the two first tenants.
- Propagation of anything to external systems — epic #113.

## Settled during the 2026-08-24 confirmation round

- External links go through the same registry, as an entry of kind `external`
  (`lead-decided`).
- No separate inventory view; the launcher is the inventory (`lead-decided`).
- No module-controlled grouping or ordering in v1 — the launcher is a flat grid
  (`lead-decided`, see #314).
- One registry entry per module by default (`lead-decided`). A module needing a
  family of tiles (calculators) raises it in its own product cycle.

## Open questions

None outstanding at the product layer. The declaration's mechanics — file shape,
types, discovery — are settled in the feature spec, not here.
