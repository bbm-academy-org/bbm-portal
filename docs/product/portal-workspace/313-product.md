---
status: Draft
epic: portal-workspace (#112) — see ./brief.md
surface: backend-only # no designed visual surface: the denial is bare (owner, 2026-08-24)
updated: 2026-08-24
---

# Workspace access and roles (#313)

## Feature summary

Two starting roles in Zitadel decide the workspace (owner decision 5):

- **`platform-user`** — required to enter `/p` **at all**. Workspace membership
  becomes a managed fact: being authenticated by Zitadel is no longer the same
  as being a member of BBM's internal workspace.
- **`platform-admin`** — gates the whole of `/p/admin`, and **implies**
  `platform-user` (owner-approved 2026-08-24: the implication lives in the gate
  code, so granting one role to an admin is enough).

Finer per-module roles are added during operation through the contract's
required-claim field (owner, 2026-08-24), not designed up front. The
`HOURS_ADMIN_EMAILS` env allowlist is retired in favour of the admin claim.

Assignment is manual at first and automated later by Access Sync (epic #113).

**No guest contour.** The owner ruled (2026-08-24): «Никаких гостей. Если нет
логина, значит нет и роли.» Every Zitadel account in the org is expected to
carry a role, so an authenticated session without `platform-user` is an anomaly,
not a user state to design for. It gets a bare access denial — no explanatory
page, no contact block, no onboarding path.

## Design pick (Stage A)

This feature owns **no** designed visual surface: the denial is bare by owner
decision, so there is nothing for Stage A to lay out here. Stage A runs for the
launcher and the admin shell in #311.

## User stories

- **US-1** — As the owner, I grant a person `platform-user` and they can enter
  the workspace; until I do, they cannot, even with a valid BBM Zitadel account.
  _(owner decision 5)_
- **US-2** — As a member with `platform-user`, I reach every regular app in the
  workspace without any further grant. _(owner decision 3)_
- **US-3** — As an authenticated person without `platform-user`, I get a bare
  access denial: no workspace content, no explanatory page, no contact block —
  the state is an anomaly to be fixed by granting the role, not an experience to
  be designed. _(owner-approved 2026-08-24: «Никаких гостей»)_
- **US-4** — As a member with `platform-admin`, I open `/p/admin` and administer
  every module registered there, and I reach the rest of the workspace with that
  same single role. _(owner decisions 4, 5; owner-approved 2026-08-24:
  `platform-admin` implies `platform-user`)_
- **US-5** — As a member without `platform-admin`, I see no trace of the admin
  surface in the launcher or the app switcher. _(owner decision 3)_
- **US-6** — As a member without `platform-admin` who navigates to an admin URL
  directly, or calls its endpoint, I am refused by the server — the missing tile
  was a convenience, not the boundary. _(owner decision 3; consolidation spec
  §5)_
- **US-7** — As the owner, hours administration is governed by the same admin
  role as everything else, so there is no second, invisible list of privileged
  emails in a deploy variable. _(owner decision 5)_
- **US-8** — As the owner, I add a new role later without a redesign: a module
  names its required claim in its declaration and the frame respects it.
  _(owner, 2026-08-24: roles grow during operation)_
- **US-9** — As a member, signing out ends my workspace session from wherever I
  am. _(owner decision 2 puts sign-out in the top bar; the session semantics are
  today's Zitadel behaviour)_

## Flows

**Entering the workspace (happy path).**
Person opens `portal.bbm.academy/p` → Zitadel sign-in → session carries
`platform-user` → workspace home renders with the apps they may see.

**Authenticated, not a member.**
Session lacks `platform-user` → no workspace surface renders → bare access
denial, and that is the whole flow. _(owner-approved 2026-08-24 — there is no
guest branch to design)_

**A role revoked mid-session.**
The next request re-evaluates the session's roles and lands in the flow above —
the bare denial. No designed interruption, no forced sign-out screen.
_(`lead-decided`)_

**Admin entry.**
Member opens `/p/admin` → session carries `platform-admin` → the shell renders.
Without the claim, the surface refuses at the server, regardless of how the URL
was reached.

**Hours administration after the retirement.**
Hours admin actions are authorized by `platform-admin`. The old
`/p/hours/admin` surface — including its export route and the Mattermost-publish
panel — moves **entirely** into `/p/admin`, and the old URL returns **404**:
explicitly no redirect. _(owner-approved 2026-08-24, overriding the redirect
recommendation)_

**Granting a role.**
Today: the owner grants the role in Zitadel by hand. Later: Access Sync (#113)
projects membership from `core` into Zitadel, and the manual step disappears
without the product rule changing.

## Product acceptance criteria

- A person with a valid Zitadel account but no `platform-user` cannot see any
  workspace content.
- That person gets a bare denial — no explanatory page and no login loop.
- A member with `platform-user` can open every regular app in the workspace.
- A person holding only `platform-admin` can enter the workspace as well as the
  cabinet — no second grant is needed.
- A member without `platform-admin` sees no admin entry anywhere in the frame.
- A member without `platform-admin` is refused when requesting an admin URL
  directly.
- A member without `platform-admin` is refused when calling an admin endpoint
  directly.
- A member with `platform-admin` can perform every hours administration action
  that was previously available through the email allowlist.
- No environment variable grants administrative access after this feature ships.
- The old `/p/hours/admin` URL and its export route return 404 — no redirect and
  no reachable leftover.
- A member whose role is revoked is denied on their next request.
- Granting a role to a person takes effect for them without a redeploy.
- Adding a further role later requires no change to the frame's own screens.

## Out of scope

- Provisioning the roles in dev and prod Zitadel and the gate implementation —
  the work of #313 itself, downstream of this PRD.
- Automatic role assignment from the member registry — epic #113.
- Per-module fine-grained roles — added during operation.
- Federation with the Doctor.School contour — ADR-002 §5, unchanged here.

## Settled during the 2026-08-24 confirmation round

- No guest contour: a session without `platform-user` gets a bare denial
  (owner-approved).
- `platform-admin` implies `platform-user` (owner-approved).
- Mid-session revocation: the next request denies; no further UX
  (`lead-decided`).
- Old `/p/hours/admin` returns 404, explicitly not a redirect (owner-approved).

## Open questions

None outstanding at the product layer. The HTTP shape of the bare denial (status
code, whether middleware or the layout answers) is an implementation choice for
the feature spec.
