---
status: Draft
epic: portal-workspace (#112) — see ./brief.md
surface: user-facing
updated: 2026-08-24
---

# Workspace home: `/p` launcher + shared top bar (#314)

## Feature summary

The first screen after signing in, and the chrome that follows the member
everywhere.

- **`/p` — catalog + pulse** (owner decision 1): tiles for the internal apps
  plus entries for the external tools BBM works in (Plane, Mattermost, KB). A
  tile may carry a live status line supplied by its module — "period open until
  the 1st" — so the home says what needs attention today, not only what exists.
- **A thin shared top bar on every `/p/*` page** (owner decision 2): home and
  the current app's name on the left, member identity and sign-out on the right,
  an app switcher fed by the same registry as the launcher. It lives in the
  shared `(platform)` layout, so an app gets it by existing rather than by
  adding it.

Both renderings read the module registry of feature #311; neither holds its own
list of apps.

**Scope note (`lead-decided`, ratified at the spec go):** issue #314's written
scope names only the launcher; the shared top bar ships with it as one piece.
They feed from the same registry, and splitting them creates a dependency knot
(a top bar with no catalogue to switch through, or a catalogue with no chrome
around it).

## Design pick (Stage A)

Stage A (task-cycle 1b) has not run. Two to three layout options for the
launcher and the top bar go to the owner in issue #311; the pick is vendored
into `design-source/` with a provenance row before any markup.

> Pick: _pending_.

## User stories

- **US-1** — As a member, after signing in I land on a screen that shows me
  every internal app I have access to, so I never need to know a URL. _(owner
  decision 1)_
- **US-2** — As a member, that same screen shows me the external tools we work
  in — Plane, Mattermost, the knowledge base — so the workspace is the one place
  I start my day. _(owner decision 1)_
- **US-3** — As a member, a tile can tell me the one thing that matters in that
  app right now, so I know whether to open it. _(owner decision 1)_
- **US-4** — As a member, I see only the apps I may use; claim-gated surfaces
  are simply absent rather than shown-and-refused. _(owner decision 3)_
- **US-5** — As a member inside any app, I can return to the workspace home in
  one click. _(owner decision 2)_
- **US-6** — As a member inside any app, I can see which app I am in without
  reading the URL. _(owner decision 2)_
- **US-7** — As a member inside any app, I can switch to another app without
  going home first. _(owner decision 2)_
- **US-8** — As a member, I can see which account I am signed in as, and sign
  out, from any page of the workspace. _(owner decision 2)_
- **US-9** — As a member, the workspace home stays readable as the portfolio
  grows from three apps to a dozen: v1 is a **flat grid** — no grouping, no
  search, no pinning — because the target portfolio of roughly ten entries fits
  one screen. _(`lead-decided`; the requirement that the IA be designed against
  the full portfolio is owner-set, spec §4 revision -f)_
- **US-10** — As a member on a narrow screen, the home and the top bar remain
  usable: basic responsiveness only, with the app switcher collapsing into a
  menu. _(`lead-decided`)_
- **US-11** — As a member, an app whose status line is unavailable still shows
  me a working tile I can open, and the home never waits on it. _(`lead-decided`)_
- **US-12** — As a member on `/p` itself, the top bar shows me its home state and
  names no current app. _(`lead-decided`)_

## Flows

**Sign in → home (happy path).**
Member opens the portal → Zitadel sign-in → `/p` renders: top bar with home,
identity and switcher; the tile catalog with the apps and links visible to this
member; status lines where modules supply them.

**Home → app → home.**
Member opens a tile → the app renders with the same top bar, now naming that app
→ home in one click, or the switcher straight to another app.

**A claim-gated surface.**
An admin opens `/p` and sees the admin entry among the apps; a regular member's
home has no admin tile and no admin entry in the switcher. Absence is the whole
treatment — no greyed-out tile, no "you don't have access" placeholder. _(owner
decision 3; the "no greyed tile" reading is `lead-decided`)_

**An external link.**
Member opens the Plane / Mattermost / KB entry → it is visibly marked as
external and opens in a new tab, so the workspace stays where it was.
_(`lead-decided`)_

**A status line that cannot be produced.**
The tile renders in its static form; the rest of the home is unaffected and does
not block on the module's pulse. _(`lead-decided`)_

**A member with no apps.**
Cannot occur in practice: every member sees hours, OKR and the external links,
and a session with no role never reaches the home at all (#313, bare denial).
_(`lead-decided`: no designed empty state)_

## Product acceptance criteria

- A member who signs in arrives at a screen listing the internal apps available
  to them.
- The same screen lists the external tools BBM works in, marked as external and
  opening in a new tab.
- A member can open any listed app from that screen without typing a URL.
- A tile whose module supplies a status line shows that line.
- A tile whose module supplies none is complete and openable.
- An app requiring a claim the member lacks does not appear on the screen.
- Every `/p/*` page shows the shared top bar.
- From any `/p/*` page a member can reach the workspace home in one action.
- From any `/p/*` page a member can tell which app they are in.
- From any `/p/*` page a member can switch to another app they may use.
- From any `/p/*` page a member can see who they are signed in as.
- From any `/p/*` page a member can sign out.
- The app switcher and the launcher never disagree about which apps exist.
- A status line that fails does not prevent the rest of the home from rendering.
- The home remains readable as a flat grid with the full target portfolio
  present, not only with the apps that exist today.
- On `/p` itself the top bar shows its home state and names no current app.
- On a narrow screen the top bar stays usable, with the switcher reachable from
  a menu.

## Out of scope

- The tokens and base components the screens are built from — #312.
- The `/p/admin` shell's own internals — #315.
- **Restyling the existing `/p/okr` and `/p/hours` bodies** — they gain the
  shared top bar and nothing else in this epic; the full reskin happens on the
  first substantive touch of each surface. _(owner-approved 2026-08-24)_
- Serving decks under `/p/decks` — epic #118.
- Grouping, search, pinning and personalised ordering on the home
  (`lead-decided`: v1 is a flat grid).
- Notifications and global search in the top bar (`lead-decided`: not in v1).
- Any dashboard beyond one status line per tile: the home is a catalog with a
  pulse, not an analytics screen. _(owner decision 1, by its wording)_

## Settled during the 2026-08-24 confirmation round

- Top bar ships with the launcher as one piece (`lead-decided`).
- External entries: same registry, marked external, new tab (`lead-decided`).
- Claim-gated apps are absent, never greyed out (`lead-decided`).
- Flat grid in v1; no grouping, search or pinning (`lead-decided`).
- Basic responsiveness; switcher collapses into a menu (`lead-decided`).
- On `/p` the bar shows home state, no app name (`lead-decided`).
- Existing app bodies are not re-based on the kit in this epic
  (owner-approved).

## Open questions

None outstanding at the product layer. The remaining decisions are the Stage-A
layout picks for the launcher and the top bar, recorded in issue #311.
