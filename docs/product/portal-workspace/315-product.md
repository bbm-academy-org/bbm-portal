---
status: Draft
epic: portal-workspace (#112) — see ./brief.md
surface: user-facing
updated: 2026-08-24
---

# `/p/admin` shell (#315)

## Feature summary

One administrative cabinet for the whole workspace: a Refine shell whose
navigation is **grouped by module** (owner decision 4). A module registers its
admin section and its resources through the same declaration that puts its tile
in the launcher (feature #311) — so a new app's back office appears in the
cabinet without the shell being edited.

With two tenants (`members`, `hours`) the grouping degenerates to a near-flat
list at zero cost; it is chosen because the portfolio (consolidation spec §4,
revision -f) makes flat navigation break by the fourth or fifth app, not because
two resources need groups.

Entry is the workspace gate plus `platform-admin` (feature #313). The cabinet
replaces the per-app admin screens: hours administration moves here and
`HOURS_ADMIN_EMAILS` retires.

## Design pick (Stage A)

Stage A (task-cycle 1b) ran on 2026-08-25 under the discovery issue **#311**,
whose scope puts the Stage-A options to the owner: three layout options for the
admin shell went to him there, the **pick** is recorded as a comment on #315
(the issue that will build the shell), and the picked file is vendored into
`design-source/` with a provenance row in `design-source/README.md`.

> Pick: **`admin-a`** («Левый сайдбар с группами модулей») →
> `design-source/p-admin-shell.html`, picked by Антон on 2026-08-25, with two
> recorded amendments written into the file's header comment: sub-section
> nesting must be visually explicit, and OKR **does** get a cabinet section —
> the reversal this document already carries below.

## User stories

- **US-1** — As a platform admin, I open one cabinet and administer every
  module, instead of hunting for a bespoke admin screen inside each app. _(owner
  decision 4)_
- **US-2** — As a platform admin, the navigation is grouped by module, so I find
  a resource by knowing which app it belongs to. _(owner decision 4)_
- **US-3** — As a platform admin, I can tell at a glance which module's data I
  am currently editing. _(`lead-decided`)_
- **US-4** — As a platform admin, I administer members here: I can find a
  member, see their record, correct it, and **deactivate** rather than delete —
  destructive delete is unsupported by design and feeds the spec's CRUD check.
  _(`lead-decided`; spec §6 names `members` as a first resource)_
- **US-5** — As a platform admin, I administer hours periods and member hours
  here — everything the old `/p/hours/admin` screen let me do, including the
  export and the Mattermost-publish panel, which move here in full.
  _(owner-approved 2026-08-24; spec §6, owner decision 5)_
- **US-6** — As a platform admin, a form tells me plainly when an operation is
  not supported here rather than offering a control that fails. _(`lead-decided`
  — the issue asks for an explicit CRUD check per form; this is its
  member-facing consequence)_
- **US-7** — As a platform admin, when I save something I get an unambiguous
  answer — it saved, or it did not and why. _(`lead-decided`)_
- **US-8** — As the owner, an edit made in the cabinet is recorded with who made
  it, so "who changed this member" is answerable later. _(`lead-decided` at the
  product level; the mechanism exists — see "How attribution works" below)_
- **US-9** — As a module author, adding my module's admin section costs one
  declaration and no shell change. _(owner decision 4; the module-author view of
  US-5 in #311)_
- **US-10** — As a platform admin, I move between the cabinet and the rest of
  the workspace through the same top bar as everywhere else. _(owner decision 2)_
- **US-11** — As a member who is not a platform admin, the cabinet does not
  exist for me — not in the launcher, not in the switcher, and not by URL.
  _(owner decisions 3, 5 — the enforcement is #313; here it is the shell's
  behaviour)_

## How attribution works (verified against the tree, not invented)

The mechanism is **live today**: `core.audit_event` — the append-only ledger
created by spec [`201-universal-edit-audit.md`](../../specs/201-universal-edit-audit.md)
(#273), carrying `{table, pk, diff, source, actor}` as first-class columns. Every
write to a `core` table goes through `platformTransaction(ctx, …)`
(`src/lib/platform/db/transaction.ts`), whose FIRST argument is the audit context
(`actorEmail`, `source`); a statement with no context is **refused, not
degraded** (`src/lib/platform/db/README.md` → "Every write is attributed"). So the
cabinet's admin edits are attributable by construction, provided each handler
passes the signed-in admin as the actor.

Not to be confused with the **domain** `event_log` of consolidation spec §4
(Contribution structure, D-025) — that table does not exist yet and belongs to
epic #113.

## Flows

**Entering the cabinet.**
Admin opens the admin entry from the launcher or the switcher → the shell opens
on a minimal index listing the available sections → picks a module's section →
picks a resource → list. _(`lead-decided`: an index, not a dashboard and not a
jump straight into the first resource)_

**Administering a resource.**
List → find the record → open it → change what the form supports → save →
explicit confirmation. Operations a resource does not support are absent from
the screen with a stated reason in the spec, not present-and-broken.

**A module with no admin section.**
Does not appear in the cabinet's navigation at all. _(owner-decided 2026-08-25:
OKR is NOT this case — it gets a cabinet section too; reading its data from
Plane is no argument for keeping it outside the cabinet. The section's content
is defined by the spec. This reverses the earlier `lead-decided` exclusion.)_

**Hours administration after the move.**
Admin performs period open/close, rate and grade edits, the export and the
Mattermost publication from the cabinet. The old `/p/hours/admin` surface and its
export route are gone: those URLs return 404, with no redirect.
_(owner-approved 2026-08-24)_

**A non-admin reaching an admin URL.**
Refused by the server (#313). The shell never renders a partial cabinet.

## Product acceptance criteria

- A platform admin can reach the administration of every module that declares an
  admin section from one screen.
- The cabinet's navigation is organised by module.
- A module that declares no admin section is absent from the cabinet.
- A newly registered module's section appears without any change to the shell.
- A platform admin can find and correct a member record.
- A platform admin can deactivate a member; no screen offers a destructive
  delete.
- A platform admin can perform every hours administration operation that the old
  `/p/hours/admin` screen supported, including the export and the Mattermost
  publication.
- The cabinet opens on an index of the sections available to the admin.
- Nothing in `/p/admin` is reachable by a member holding only `platform-user`.
- Every form makes clear which operations it supports; unsupported operations
  are not offered.
- A save either succeeds visibly or fails with a stated reason.
- An edit made in the cabinet is attributable to the admin who made it, in
  `core.audit_event`.
- A member without the admin claim cannot reach the cabinet by any route.
- The cabinet carries the same top bar as the rest of the workspace.
- The cabinet's navigation stays usable when the target portfolio's modules are
  present, not only the first two.

## Out of scope

- The `members` and `hours` resource screens themselves — #316 and #317; this
  feature owns the shell they mount into.
- The claim gate and role provisioning — #313.
- The UI kit — #312.
- The HTTP contract shape (`/api/p/<module>/*`, zod schemas, the hand-written
  data provider) — implementation detail of #315, governed by consolidation spec
  §5.
- Propagating admin edits to external systems — epic #113.

## Settled during the 2026-08-24 confirmation round

- The hours export and the Mattermost-publish panel move into the cabinet in
  full; the old URLs 404 (owner-approved).
- The cabinet is admin-only — nothing in it is available to a plain
  `platform-user` (`lead-decided`).
- The cabinet opens on a minimal index of sections (`lead-decided`).
- `members` supports deactivation, not delete — D of CRUD unsupported by design
  (`lead-decided`, feeds the spec's CRUD check).
- OKR has a cabinet section like every other portfolio module (owner-decided
  2026-08-25, reversing the earlier `lead-decided` exclusion); its content is
  defined by the spec.
- Attribution rides on the existing `core.audit_event` ledger (spec 201), not on
  the not-yet-existing domain `event_log` (`lead-decided`).

## Open questions

None outstanding at the product layer. The last one — the Stage-A layout pick
for the shell — was made by the owner on 2026-08-25 in the option round run
under #311; see "Design pick (Stage A)" above.
