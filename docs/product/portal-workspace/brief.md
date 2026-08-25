---
status: Draft
epic: 112
features:
  - 311 — Module plug-in contract (backend-only)
  - 313 — Workspace access and roles
  - 314 — Workspace home: `/p` launcher + shared top bar
  - 315 — `/p/admin` shell
updated: 2026-08-24
---

# Portal workspace — epic brief (#112)

The reader is the owner. This brief is deliberately thin: it says what the
workspace is for and how its surfaces compose. Stories, flows and acceptance
criteria live in the per-feature PRDs listed above.

## Problem

BBM's internal apps exist, but the workspace around them does not.

- A member reaches an app only by knowing its URL. `/p/okr` and `/p/hours` are
  live; nothing anywhere enumerates "the apps" (prior art: no `/p` route, no
  launcher component in `src/`).
- Nothing tells a member where they are or who they are signed in as. Each app
  paints its own page; there is no shared chrome, no sign-out, no way to move
  between apps without editing the address bar.
- Administration is per-app and ad hoc: hours admin lives inside the hours app
  behind an email allowlist env var (`HOURS_ADMIN_EMAILS`). A second admin
  surface would repeat that from scratch.
- There is no answer to "who is a member of this workspace" — entry to `/p` is
  today "anyone Zitadel authenticates".

The target portfolio (consolidation spec §4, revision -f) is hours, OKR,
finance/accounting, internal decks, CRM, task management, team search, project
launch, calculators and internal-communication tie-ins. A frame designed against
the two apps that exist today breaks on the third. This epic builds the **frame**
— launcher, top bar, admin shell, the module plug-in contract and the starting
roles — with `members` and `hours` as its first tenants.

## Jobs-to-be-done

`lead-drafted — ratified at spec go` as a formulation; each job is derived from
the owner-approved discovery decisions and the target portfolio.

- **J1 — "Show me the workspace."** As a member, after signing in I want to see
  everything BBM has for me — internal apps and the external tools we use — in
  one place, so I do not have to remember URLs or ask a colleague.
- **J2 — "Tell me what needs me today."** As a member, I want the workspace home
  to surface the one live fact per app that might require action (an open hours
  period, a closing OKR window), so opening every app in turn is unnecessary.
- **J3 — "Let me move without losing my place."** As a member, I want to jump
  from any app to any other app, and to sign out, from wherever I am.
- **J4 — "Administer everything in one cabinet."** As a platform admin, I want
  one admin surface covering every module's back-office data, instead of one
  bespoke admin screen per app.
- **J5 — "Membership is a managed fact."** As the owner, I want entering the
  workspace to require deliberate granting, and admin rights to be a role rather
  than a list of emails in a deploy variable.
- **J6 — "Adding the tenth app costs the same as the third."** As a module
  author (an agent or a developer building the next app), I want one declared
  contract that puts my app in the launcher, the top bar and the admin
  navigation, without editing the frame.

## Information architecture

How the epic's surfaces compose into one cabinet:

```
portal.bbm.academy  (Zitadel OIDC gate over /p/*, ADR-003 §3)
└── shared top bar on every /p/* page          ← feature 314
    ├── /p            workspace home: app tiles + external links + pulse   ← 314
    ├── /p/okr        OKR dashboard            (existing tenant)
    ├── /p/hours      hours self-assessment    (existing tenant)
    ├── /p/<future>   CRM, finance, decks, team search, …  (portfolio, out of scope)
    └── /p/admin      Refine shell, module-grouped navigation              ← 315
        ├── members   first tenant (#316)
        └── hours     first tenant (#317)

one registry feeds the launcher tiles, the top-bar app switcher and the
admin navigation                                             ← contract, 311
access: platform-user to enter /p at all · platform-admin for /p/admin  ← 313
```

Four structural facts:

1. **One registry, three renderings.** The launcher tiles, the top-bar app
   switcher and the admin navigation are three views of the same module
   registry. A module that registers once appears in all three (owner decisions
   2 and 4).
2. **The frame is shared, the app is not.** The top bar lives in the shared
   `(platform)` layout; each app keeps its own body and its own styling as
   today. **The existing `/p/okr` and `/p/hours` bodies are NOT re-based on the
   UI kit in this epic** (owner-approved 2026-08-24) — they gain the shared top
   bar and nothing else; a full reskin happens on the first substantive touch of
   each surface, per the back-fill rule in `.claude/rules/design-process.md`.
3. **Visibility is a hint; authorization is server-side.** The hybrid rule
   (owner decision 3) decides what a member _sees_ listed. What a member may
   _do_ is decided in server handlers, per consolidation spec §5.
4. **Admin is a surface of the workspace, not a separate product.** `/p/admin`
   sits behind the same Zitadel gate as everything else, plus the admin claim.

## Feature decomposition

| Feature | PRD              | Surface      | What it settles                                                                         |
| ------- | ---------------- | ------------ | --------------------------------------------------------------------------------------- |
| #311    | `311-product.md` | backend-only | the module plug-in contract — one declaration, three renderings                         |
| #313    | `313-product.md` | backend-only | who may enter the workspace and who may administer it; denial is bare, no guest contour |
| #314    | `314-product.md` | user-facing  | the workspace home (`/p`) and the shared top bar on every `/p/*` page                   |
| #315    | `315-product.md` | user-facing  | the `/p/admin` shell and its module-grouped navigation                                  |

Not PRD'd here, deliberately:

- **#312 (UI kit `src/ui`)** — a build-layer dependency of 314/315 with no
  product surface of its own.
- **#316 `members` / #317 `hours` resources** — the first _tenants_, present to
  prove the contract. Their per-resource product design (which of C/R/U/D each
  form supports, and why) belongs to the feature spec and, for hours, to the
  `/p/hours` product cycle (#124).
- **The rest of the portfolio** (CRM, finance, team search, project launch,
  calculators, task management, decks) — contract _inputs_ only. Each runs its
  own product cycle when its epic starts.

## Success metrics

`lead-drafted — ratified at spec go` — the owner has not set numeric targets.

- A member who signs in reaches any app they are entitled to in at most two
  clicks from `/p`, without typing a URL.
- Adding a new app to the workspace touches only that module's own registration
  — zero edits to launcher, top bar or admin-shell code. Measured on the first
  app after the frame ships.
- No app ships a bespoke admin gate: after this epic, `HOURS_ADMIN_EMAILS` is
  gone and no env-var allowlist governs any admin surface.
- Every member of the team can enter `/p`, and everyone who cannot is a
  deliberate omission rather than a forgotten role grant.

## Prior art — what exists today

Reference material only. It is a functional reference, never a template to
reproduce. Full inventory with passports: `prior-art.md` in this directory.

| Source                                                                            | Passport                                                            | What it contributes                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/app/(platform)/**`                                                           | bbm-portal (this repo) — original (live source)                     | the single OIDC gate, the two live tenants, and the confirmed absence of any launcher               |
| `src/modules/*`, `src/lib/*`                                                      | bbm-portal — original (live source)                                 | today's module shape: `index.ts` as the only public interface, boundaries enforced in CI            |
| `src/lib/hours/access.ts` (`isHoursAdmin`)                                        | bbm-portal — original (live source)                                 | the env-allowlist admin gate this epic retires                                                      |
| `docs/superpowers/specs/2026-08-04-platform-consolidation-design.md` §4/§5/§6/§10 | bbm-portal — original (accepted spec)                               | the target portfolio (revision -f), the API-layer contract shape, Refine admin, the UI kit          |
| `docs/adr/002-repository-and-module-strategy.md` §3                               | bbm-portal — original (accepted ADR)                                | modular monolith: a module is a route + isolated library, never importing another's internals       |
| `docs/adr/003-domain-topology-cms-vs-portal.md` §3                                | bbm-portal — original (accepted ADR)                                | the `/p/*` prefix as a single self-maintaining allowlist entry; `(platform)` as the layout boundary |
| `bbm-platform-prd/output/bbm-platform-unified-prd.md` §4/§9                       | bbm-platform-prd (sibling) — original                               | the internal-contour vision the portfolio serves; projects/authorship/contributions stay in the PRD |
| `bbm/outputs/2026-07-29-bbm-portal-hours-calculator-brief.md`                     | bbm (Anton's research repo, sibling) — original (owner's own brief) | why `/p/hours` reads a JSON document, and what its admin surface does today                         |

**No prior-art launcher exists.** There is nothing to migrate — the workspace
home starts from zero, which is why the discovery ran before the build.

## Design gate

Stage A (task-cycle 1b) for the `/p` launcher and the `/p/admin` shell **has not
run yet**. Layout options and the owner's pick are recorded in issue #311 and
vendored into `design-source/` before any markup; the per-feature PRDs carry an
empty slot for the pick.
