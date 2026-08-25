---
status: Draft
issue: 311
updated: 2026-08-25
---

# Portal workspace — `/p` launcher, `/p/admin` shell, module plug-in contract — spec (issue #311)

- **Issues:** #311 (this spec), #112 (epic), #313 (access & roles), #314 (`/p`
  launcher + shared top bar), #315 (`/p/admin` shell), #312 (UI kit `src/ui`),
  #316 (`members` resources), #317 (`hours` resources).
- **Product layer (the source this spec is written FROM, never restated here):**
  `docs/product/portal-workspace/brief.md`, `311-product.md`, `313-product.md`,
  `314-product.md`, `315-product.md`, `prior-art.md`.
- **Stage A (task-cycle 1b) — picked and vendored.** Launcher: option
  **`launcher-a`** («Единая сетка», flat uniform grid) →
  `design-source/p-launcher.html`. Cabinet: option **`admin-a`** («Левый сайдбар
  с группами модулей») → `design-source/p-admin-shell.html`. Both picked by
  Антон on 2026-08-25; the picks are recorded as comments on #314 and #315 and
  as provenance rows in `design-source/README.md`. The admin pick carries two
  owner amendments, written into the file's header comment: sub-section nesting
  must be visually explicit, and OKR **does** get a cabinet section. Where this
  spec's prose and a vendored file disagree, the file wins
  (`.claude/rules/design-process.md` §1) — the two places where the launcher file
  shows more than the prose did are settled explicitly by EARS-67 and EARS-68.
- **Donor & benchmark pass:** run 2026-08-25 against three donors — Refine's
  own resource/menu model (`@refinedev/core` `resources[]` with `meta.parent`
  multi-level menus, adopted for the grouped navigation and for nothing else:
  its auth and data packages are deliberately not used, per consolidation spec
  §6); `ds-platform`'s EARS↔test traceability mechanics (adopted wholesale, they
  are already this repo's canon per `docs/specs/README.md`); and the existing
  `/p/hours/admin` screen as the behavioural benchmark the cabinet must match
  (its behaviour is inherited, its env-allowlist gate is deleted rather than
  ported — see EARS-21 and EARS-51). No constraint was carried across that could
  not be justified for this domain, and the pass produced no owner question.
- **Independent review, 2026-08-25 — reworked.** This revision answers a
  full independent review of commit `358d350` (2 BLOCKER, 4 MAJOR, 20 MINOR,
  4 NIT): the `/api/p/*` host topology (EARS-63…65, D-11), the OKR section's
  buildability (EARS-75/76), the member-vs-admin authorization split
  (EARS-61/62, D-12), the launcher's ghost and admin tiles (EARS-67/68, D-13),
  the donor-spec revisions (Follow-up tasks), and scenario coverage for the
  clauses no scenario exercised. Seven clause ids were **retired** by splits or
  as duplicates and are never reused — they are listed in place.

## Why

BBM's internal apps exist; the workspace around them does not. A member reaches
an app only by knowing its URL, nothing tells them where they are or who they
are signed in as, administration is a bespoke screen per app behind an env-var
email allowlist, and "member of this workspace" is not a fact anyone can grant
or revoke. This spec fixes the **frame** of the workspace — the launcher, the
shared chrome, the admin cabinet, the roles that gate them, and above all the
**contract by which a module plugs into all three** — designed against the full
target app portfolio and verified on the first two tenants (`members`, `hours`)
plus the OKR cabinet section.

## Prior decisions

- **ADR-002 §3** (modular monolith, Citadel) — the workspace frame is not a new
  deployable. A module is a route plus an isolated library that exposes a public
  API through its `index.ts` and never imports another module's internals. The
  plug-in contract is therefore an in-process TypeScript contract, not an RPC or
  a plugin runtime.
- **ADR-002 §4** — no workspace conversion is triggered here. `src/ui` (#312)
  stays a directory inside the single app; extracting it into a package is a
  later trigger, not this spec's business.
- **ADR-002 §5** — the portal surface is gated by Zitadel OIDC from day one;
  Payload native auth is admin-only and is not the workspace's identity. The
  roles this spec defines are **Zitadel project roles**, not Payload roles.
- **ADR-003 §1, §2** — host allowlist, default-deny **per host**. This spec adds
  no per-route _deny_ rule, but it does change both positive allowlists once.
  The modules' HTTP surface is `/api/p/<slug>/*` (consolidation §5), which is
  **not** under `/p/`: in `src/lib/platform/hostAllowlist.ts` today
  `isPlatformSurfacePath` admits `/p`, `/p/*` and `/api/auth/*` only, so
  `/api/p/hours/periods` **404s on `portal.bbm.academy`**, while
  `isCmsSurfacePath`'s generic `/api/*` clause **allows it on
  `cms.bbm.academy`**. Both halves are wrong and both are fixed here: EARS-63
  admits the prefix on the portal, EARS-64 carves it out of the CMS `/api/*`
  clause exactly as `/api/auth/*` is already carved out, EARS-65 extends the
  Host-matrix test. D-11 records why the API keeps that URL shape.
- **ADR-003 §3(a)** — the platform surface is expressed as **self-maintaining
  prefix entries**, not per-module ones. After EARS-63 there are two: `/p/*`
  (pages) and `/api/p/*` (module APIs). Both stay O(1) as modules are added — a
  new module needs no allowlist change, which is the property the ADR bought;
  what this spec fixes is that the second prefix was never registered at all.
- **ADR-003 §3(b)** — the `(platform)` route group is a **code** boundary
  hosting the shared layout. That is where the top bar and the claim gate go —
  a page gets both by existing, not by wiring.
- **ADR-004 §6** — table ownership is machine-enforced per module, and
  `route-layer-must-not-import-tables` already forbids anything under `src/app/`
  from holding a table handle. The launcher, the top bar and the admin shell
  read modules through their public APIs only; this spec adds the analogous
  boundary rules for the registry (EARS-56, EARS-57, EARS-58).
- **ADR-004 A1** — every write to `core` runs through `platformTransaction(ctx, …)`
  with an audit context, and a write with no context is refused. Cabinet edits
  are therefore attributable by construction, provided each handler passes the
  signed-in admin (EARS-39).
- **Consolidation spec** `docs/superpowers/specs/2026-08-04-platform-consolidation-design.md`:
  - **§4** (`### Целевой портфель приложений`, revision 2026-08-24-f) — the ten
    target apps the frame is designed against, and the explicit requirement that
    the IA and the module-connection contract come from that portfolio and not
    from the first two resources. That paragraph names #311 as its subject.
  - **§5** — each module owns its data layer and exposes a typed interface; the
    HTTP surface `/api/p/<module>/*` exists only where a client-side consumer
    does; contracts are the module's zod schemas, shared by handler and client;
    **authorization lives in every handler**, and UI-level restriction is
    convenience, never a trust boundary.
  - **§6** — `/p/admin` is Refine as a thin CRUD scaffold: `@refinedev/core` +
    router only, a hand-written data provider over the §5 handlers, the same
    Zitadel gate plus an admin claim, first resources `members` and `hours`,
    `HOURS_ADMIN_EMAILS` dropped.
  - **§10** — one unified UI kit for `/p/*` and the cabinet, living as `src/ui`
    in the monolith; new screens are built from the kit and hand-rolled styles
    are a review stop-factor; any module may import `src/ui`, `src/ui` imports
    no module.
  - **§14 item 3** — _«Состав ролей в Zitadel для claim-гейтов (`platform-admin`,
    `cms-editor`, …) — финализируется в эпике 2/4»_. This is an **open question**
    in that spec, not a decision; the task brief refers to it as §14.3, but §14
    is a flat list with no such sub-heading. This spec closes the epic-2 half of
    it: §B below is the starting role set. `cms-editor` (the Payload SSO half)
    stays open and belongs to epic 4.
- **Spec `docs/specs/124-hours-on-core.md`** — the behavioural and storage canon
  of hours. Its CRUD table is inherited verbatim by §F here; its EARS-19
  («WHILE no admin UI exists (until `/p/admin`, epic #112), aliases shall be
  populated by the SQL escape hatch») names this spec as the thing that retires
  it, and EARS-44 does. Spec 124 is `Shipped`, so retiring one of its clauses
  from the outside is only half the job — the **same PR** that lands the
  behaviour amends spec 124 itself (Follow-up tasks → "Donor spec revisions").
- **Specs 081 (+#83/#85) and 100** — the behaviour of the hours admin screen the
  cabinet must reproduce. Not restated here; the cabinet is a move, not a
  redesign. They too are amended on touch, in the PR that moves the surface.
- **Spec `docs/specs/201-universal-edit-audit.md`** — `core.audit_event` is the
  live attribution ledger. The domain `event_log` of consolidation §4 does not
  exist and is epic #113; nothing here depends on it.
- **Owner discovery decisions 1–9** (issue #311, 2026-08-24 and the 2026-08-24
  confirmation round) and the two Stage-A amendments (2026-08-25). These are
  binding inputs, recorded in the PRDs; this spec turns them into an engineering
  contract and does not re-open them.

## Engineering decisions taken at lead level

Recorded here rather than asked, per `author-feature-spec` («technical,
architectural and sequencing calls are the lead's own»). Each is a fork the
recorded owner decisions do not settle.

- **D-1 — the registry is typed TypeScript, not a config file.** A module's
  declaration is a `const` of type `WorkspaceModule` exported from the module's
  public API (`src/lib/<module>/index.ts`). A JSON/YAML manifest was rejected on
  three counts: it cannot carry the status-line provider, which is a function;
  it would need a hand-kept parallel type declaration, i.e. a second source of
  truth; and it is invisible to `tsc` and to `pnpm boundaries`, so the
  ADR-004 §6 enforcement that already keys on `src/(lib|modules)/<module>/`
  would not see it. Typed TS makes a malformed registration a build failure.
- **D-2 — discovery is an explicit composition root, not filesystem globbing.**
  `src/lib/workspace/registry.ts` imports each module's declaration and lists
  them in one array, in display order. Runtime globbing (`require.context`,
  `fs.readdir` over `src/lib/*`) was rejected: it is webpack-specific, defeats
  the Next server bundle's static analysis, and makes the registry contents
  unknowable to a reviewer. **The product promise survives intact in the sense
  that matters:** adding an app touches that module's own files plus **one
  import and one array element** in the composition root, and **zero lines** in
  the launcher, the top bar or the admin shell — the three renderings hold no
  list of apps at all. The residual one-line gap is closed mechanically by
  EARS-3 rather than by discipline. `311-product.md`'s criterion «by editing
  only files inside that module» is amended by this decision to «plus one import
  and one array element in the composition root»; the amendment is recorded here
  and carried back into the PRD by #314's PR.
- **D-3 — the contract type and the registry are two files, and modules may
  import only the first.** `src/lib/workspace/contract.ts` holds the types;
  `src/lib/workspace/registry.ts` holds the composition root. A module importing
  the registry would create an import cycle and let a module read its
  neighbours; a dependency-cruiser rule forbids it (EARS-56).
- **D-4 — the admin surface is itself a registry entry**, not a special case in
  the launcher: kind `internal`, `href: '/p/admin'`, `requiredClaim:
'platform-admin'`, no status provider. This is what the vendored launcher
  wireframe shows, and it means the hybrid-visibility rule is exercised by the
  frame's own surface on day one.
- **D-5 — the bare denial is HTTP 403 with no chrome, not 404.** The owner ruled
  the denial is bare; the status code was not part of that ruling. 403 is
  chosen over 404 because the path genuinely exists and the cause is a missing
  role grant: a 404 would be indistinguishable from an ADR-003 topology refusal
  and would make "why can't Пётр get in" undiagnosable. Bare means bare — a
  plain response with no layout, no top bar, no explanation and no contact
  block.
- **D-6 — status-line providers run concurrently with a per-provider deadline of
  1 second, and are not cached in v1.** A provider that rejects or exceeds the
  deadline yields no line and the tile renders in its static form. Streaming the
  lines in per-tile via Suspense is a better end state and is deferred: it is a
  rendering optimisation over the same contract, and the whole home is a handful
  of tiles.
- **D-7 — claim filtering happens server-side while building the view model**,
  before any markup exists. A claim-gated entry is absent from the rendered
  HTML and from the client payload, not hidden by CSS — otherwise "absence is
  the whole treatment" would leak the workspace inventory to view-source.
- **D-8 — retiring `/p/hours/admin` is a deletion, not a rule.** The route files
  are removed; the path then has no route, and Next answers an unrouted path
  with a 404 — the middleware allowlist is not what produces it (it _allows_
  everything under `/p/`), so no deny rule is added anywhere and none is needed
  (ADR-003 §2). A regression test pins the 404.
- **D-9 — the module slug is one identifier, used three times.** The registry
  entry's `slug` is the module directory name, the admin route segment
  (`/p/admin/<slug>/<resource>`) and the API namespace (`/api/p/<slug>/*`).
  Three spellings of one thing is how they drift.
- **D-10 — `internal` and `external` are a discriminated union**, so "an
  external link has no admin section and no status provider" is a type error
  rather than a runtime validation with a message nobody reads.
- **D-11 — the module API keeps the `/api/p/<slug>/*` shape and the allowlist
  changes to meet it.** The alternative — moving module APIs under `/p/api/…` so
  the existing `/p/*` entry covers them with no allowlist edit — was rejected:
  consolidation §5 fixes the `/api/p/<module>/*` shape as the platform's HTTP
  contract, `/api/*` is where every other API in this process lives (Payload,
  Auth.js), and an `/p/api/` path would read as a page route to every reader and
  every tool. The cost is honest and bounded: **one additional prefix pair**
  (admit on the portal, exclude on the CMS), still O(1) in modules, still
  self-maintaining. It is a change to a boundary ADR-003 calls load-bearing, so
  it is specced (EARS-63…65) rather than left to an implementer.
- **D-12 — the API namespace is split member-facing vs cabinet.** A module's
  member-facing handlers live at `/api/p/<slug>/<resource>`; everything the
  cabinet's data provider calls lives one segment deeper, at
  `/api/p/<slug>/admin/<resource>`. Without the split, "every module API
  re-checks `platform-admin`" would lock plain members out of their own apps
  (consolidation §5 makes `/api/p/*` the surface for _any_ client consumer,
  `/p/hours` self-assessment included), and "every module API re-checks
  `platform-user` only" would leave the cabinet's writes guarded by the shell
  alone. The path prefix makes the required claim readable from the URL and
  greppable in review; the per-entry `requiredClaim` still applies on top of it
  (EARS-61).
- **D-13 — the launcher's «портфель, позже» ghost tiles are a wireframe device,
  not a feature.** `design-source/p-launcher.html` renders six greyed tiles
  (Финансы, Колоды, CRM, Поиск команды, Запуск проекта, Калькуляторы) captioned
  «портфель, позже» with an empty pulse. Their job in the Stage-A canvas is to
  show the owner how the grid reads at full portfolio size — which is a real
  requirement (EARS-71) — not to promise six disabled tiles in v1. Rendering
  them would contradict the owner's own «absence is the whole treatment» ruling
  (EARS-4) by teaching members to read a greyed tile as "exists but not for
  you". A `planned` entry state in the contract was rejected for the same reason
  plus a second: it would put unbuilt apps in the registry, where EARS-3 and the
  type-level test would then have to special-case them. The **admin tile's**
  distinct treatment, by contrast, IS built (EARS-68) — it is a real entry with
  a real target.

## Requirements

Seven ids from the pre-review draft are **retired** and never reused — they are
listed, with what replaced them, in "Retired clause ids" below. The list lives
outside this section deliberately: an id named here is a live clause owing a
test (`pnpm lint:ears-test`), and a retirement note is not a requirement.

### A. The module plug-in contract (the centerpiece)

- **EARS-1.** The platform shall define the workspace contract in
  `src/lib/workspace/contract.ts` as a discriminated union on `kind`:
  an `internal` entry carrying `slug`, display `name`, short `description`,
  `href` under `/p/`, an icon reference, an optional `requiredClaim`, an
  optional `status` provider and an optional `admin` section; an `external`
  entry carrying `slug`, `name`, `description`, an absolute `url` and an
  optional `requiredClaim`, and **no** `status` and **no** `admin` field
  (D-10). A module shall declare at most one entry and shall export it from its
  public API (`src/lib/<module>/index.ts`), per ADR-002 §3.
- **EARS-2.** The platform shall hold exactly one composition root,
  `src/lib/workspace/registry.ts`, listing every declared entry in display
  order; the `/p` launcher, the top-bar app switcher and the `/p/admin`
  navigation shall each derive their contents from that one list and shall hold
  no list of their own (D-2).
- **EARS-3.** IF a module under `src/lib/*` exports a workspace declaration that
  the composition root does not list, THEN the test suite shall fail naming that
  module — the one-line registration of D-2 is enforced mechanically, not by
  memory.
- **EARS-4.** WHERE an entry declares a `requiredClaim`, the frame shall omit
  that entry from the launcher grid and from the app switcher for a session
  whose roles do not include the claim, and the omission shall happen while the
  server builds the view model, so the entry is absent from the response body
  entirely — never rendered greyed out, disabled or as a placeholder (D-7).
- **EARS-5.** The platform shall never treat the absence of an entry as the
  authorization boundary: the module's own server-side handlers shall refuse a
  request from a session lacking the claim regardless of how the URL was
  reached (consolidation §5).
- **EARS-6.** WHERE an `internal` entry declares a `status` provider, the
  launcher shall invoke every declared provider concurrently when rendering `/p`,
  each with a 1-second deadline, and shall render the returned line on that
  entry's tile (D-6).
- **EARS-7.** IF a `status` provider rejects, throws or exceeds its deadline,
  THEN the launcher shall render that tile in its static form and shall render
  the remainder of the home unaffected — a module's pulse shall never fail or
  block the workspace home.
- **EARS-8.** The launcher shall render an entry that declares no `status`
  provider as a complete, openable tile — the normal case, not a degraded one.
- **EARS-9.** WHERE an `internal` entry declares an `admin` section, the cabinet
  shall render that section as a navigation group carrying the declared
  resources, mounted at `/p/admin/<slug>/<resource>` (D-9), without any edit to
  the shell.
- **EARS-10.** WHERE an entry declares no `admin` section, the cabinet shall
  give that module no presence anywhere under `/p/admin` — no group, no item, no
  route.
- **EARS-12.** WHEN a module's declaration is removed, the module shall
  disappear from the launcher, the app switcher and the cabinet navigation with
  no other file edited.
- **EARS-13.** The contract shall accommodate every app of the target portfolio
  (consolidation spec §4, revision -f: hours, OKR, finance, decks, CRM, task
  management, team search & recruiting, project launch, calculators, Mattermost
  integration) without a new frame concept per app. The evidence is a
  **type-level test** that constructs one declaration per portfolio app —
  including a `decks`-shaped entry whose `href` is a section root and a
  Mattermost-shaped `external` entry — and compiles; the "Portfolio walk" table
  below is the discovery record behind it, not the proof.

### B. Workspace access and roles

- **EARS-14.** The workspace shall be gated by exactly two starting Zitadel
  project roles: **`platform-user`** and **`platform-admin`**. No other role
  shall be introduced by this spec.
- **EARS-15.** The gate shall read those roles from the session's Zitadel roles
  claim (`urn:zitadel:iam:org:project:roles`), surfaced on the NextAuth session
  by `src/auth.ts`; provisioning the roles and asserting the claim in the dev
  and prod Zitadel (`infra/dev-stand/idp/provision.sh`) is part of #313's
  implementation and shall not be assumed already done by any other task.
- **EARS-16.** WHILE a session lacks `platform-user`, every path under `/p` shall
  be refused — the gate lives in the `(platform)` layout (ADR-003 §3(b)), so a
  new page inherits it by existing.
- **EARS-17.** The gate shall treat `platform-admin` as implying
  `platform-user`: a session carrying only `platform-admin` shall enter the
  workspace and the cabinet with that single grant.
- **EARS-18.** IF a session is authenticated but carries neither role, THEN the
  response shall be a bare HTTP 403 with no layout, no top bar, no explanatory
  copy and no contact block (D-5) — there is no guest contour to design.
- **EARS-21.** `HOURS_ADMIN_EMAILS` shall not exist in the shipped code, and no
  environment variable shall grant administrative access to any surface. Gone
  means gone from: `src/lib/hours/access.ts` (`isHoursAdmin`,
  `parseAdminEmails`), `src/modules/hours/actions.ts`, the deleted routes
  `src/app/(platform)/p/hours/admin/page.tsx` and
  `src/app/(platform)/p/hours/admin/export/route.ts` (EARS-52), `.env.example`,
  `deploy/.env.prod.example`, and the five unit specs that assert the old gate —
  `tests/unit/hours-access.spec.ts`, `hours-actions.spec.ts`,
  `hours-page-render.spec.ts`, `hours-publication-actions.spec.ts`,
  `hours-publication-view.spec.ts` — each of which is rewritten onto
  `platform-admin` or retired with its subject.
- **EARS-59.** WHEN a role is revoked, the next request from that session shall
  land in EARS-18 — no designed interruption, no forced sign-out screen.
- **EARS-60.** WHEN a role is granted, the grant shall take effect for that
  member on their next session without a redeploy of the platform.
- **EARS-61.** Every member-facing module handler under `/api/p/<slug>/<resource>`
  shall re-check `platform-user` **and** the entry's declared `requiredClaim`
  fail-closed, independently of any UI (consolidation §5, D-12). A handler that
  relies on the launcher having omitted the tile is a defect.
- **EARS-62.** Every handler under `/api/p/<slug>/admin/*` and every server
  action behind the cabinet shall re-check `platform-admin` fail-closed,
  independently of the shell (D-12). A handler that relies on the shell having
  checked is a defect.
- **EARS-63.** The host allowlist shall admit `/api/p/*` on the platform surface:
  `isPlatformSurfacePath` in `src/lib/platform/hostAllowlist.ts` shall pass
  `/api/p` and anything under `/api/p/` alongside `/p`, `/p/*` and `/api/auth/*`
  (ADR-003 §3(a), D-11). Without this every module API in this spec is 404 on
  `portal.bbm.academy`.
- **EARS-64.** The host allowlist shall refuse `/api/p/*` on the CMS surface:
  `isCmsSurfacePath` shall carve `/api/p/*` out of its generic `/api/*` clause
  exactly as it already carves out `/api/auth/*` — the more specific rule wins —
  so no module API answers on `cms.bbm.academy` (ADR-003 §1, the leak class the
  default-deny does not self-maintain because `/api` is an allowlisted CMS
  prefix).
- **EARS-65.** The Host-matrix test shall carry rows for `/api/p/<slug>/…` on
  every host of the matrix: pass on `portal.bbm.academy`, 404 on
  `cms.bbm.academy` and on the internal `app` host, pass on the dev origin in
  development mode and 404 there in production mode.
- **EARS-66.** A further claim introduced later shall require no change to the
  frame's own screens: it is declared as an entry's `requiredClaim` and enforced
  in that module's handlers (EARS-61), with no edit to the launcher, the top bar
  or the cabinet shell (`313-product.md`).

### C. The `/p` launcher and the shared top bar

- **EARS-22.** The platform shall serve a workspace home at `/p`, rendering the
  registry entries visible to the session as a **flat grid in registry order** —
  no grouping, no search, no pinning, no personalised ordering — per the
  vendored `design-source/p-launcher.html` (option `launcher-a`). The tile
  variants that grid carries are exactly the ones the vendored file draws
  (EARS-68).
- **EARS-23.** The launcher shall mark an `external` entry as external and shall
  open it in a new tab (`target="_blank"` with `rel="noopener noreferrer"`), so
  the member does not lose the workspace.
- **EARS-25.** The platform shall render a thin shared top bar on **every**
  `/p/*` page from the `(platform)` layout, carrying: a link to the workspace
  home, the current app's name, an app switcher fed by the registry, the
  signed-in member's identity and sign-out.
- **EARS-27.** The app switcher and the launcher shall never disagree about
  which apps exist. _(Both read EARS-2's single list; that is the mechanism, and
  the test asserts the two renderings against one registry fixture.)_
- **EARS-28.** WHILE the viewport is narrow, the home and the top bar shall stay
  usable, with the app switcher reachable from a collapsed menu. Basic
  responsiveness only; no separate mobile design.
- **EARS-29.** The existing `/p/okr` and `/p/hours` page bodies shall gain the
  shared top bar and **nothing else** — no restyling onto `src/ui` in this epic;
  the reskin happens on each surface's first substantive touch, per the
  back-fill rule of `.claude/rules/design-process.md` §1.
- **EARS-30.** Every new screen this spec introduces (`/p`, the top bar, the
  cabinet shell and its resource screens) shall be built from `src/ui` (#312)
  and from the vendored Stage-A sources; hand-rolled styles are a review
  stop-factor (consolidation §10).
- **EARS-67.** The launcher shall render exactly the registry entries visible to
  the session and nothing else; the six «портфель, позже» ghost tiles of
  `design-source/p-launcher.html` are a full-portfolio wireframe device and
  shall not be rendered in v1 (D-13). The requirement they illustrate — that the
  grid still reads at full portfolio size — is EARS-71.
- **EARS-68.** The grid shall carry exactly three tile forms, as the vendored
  file draws them: the standard `internal` tile; the shorter `external` tile
  marked «↗ внешний» (EARS-23); and the admin entry's tile with its dashed
  border and its «только администратор» flag. No other per-entry visual
  variation exists in v1.
- **EARS-69.** The top bar shall resolve the current app by matching the request
  pathname against registry `href` values, longest prefix wins.
- **EARS-70.** WHILE the member is on `/p` itself, the top bar shall show its
  home state and shall name no current app.
- **EARS-71.** The home shall stay readable as one flat grid at the full target
  portfolio size — the ten apps of consolidation §4 plus the external entries
  and the admin entry — evidenced by rendering the launcher against a
  full-portfolio registry fixture at desktop and narrow widths
  (`314-product.md`).

### D. The `/p/admin` cabinet shell

- **EARS-31.** The cabinet shall be a Refine shell using **`@refinedev/core` and
  a router binding only** — Refine's auth and data packages shall not be
  installed — with a hand-written data provider over the
  `/api/p/<slug>/admin/*` handlers of §5 (consolidation §6, D-12).
- **EARS-32.** The cabinet navigation shall be a persistent left sidebar grouped
  by module, per the vendored `design-source/p-admin-shell.html` (option
  `admin-a`), whose groups and items come from the registry's `admin` sections.
- **EARS-33.** The nesting of a resource under its module group shall be
  **visually explicit** — a real parent node with indented children, expressed
  through Refine's native multi-level menu model (a parent resource plus
  `meta.parent`), not through a flat list with a heading (owner amendment (a),
  2026-08-25). _(The owner's recorded expectation names `ThemedLayoutV2` as the
  example of that behaviour. That component ships in Refine's UI packages, which
  EARS-31 excludes; the amendment is met by taking the **menu tree** from
  `useMenu()` — the same `meta.parent` model — and rendering it with `src/ui`
  components. The behaviour is what was accepted, the package is not.)_
- **EARS-34.** WHEN an admin opens `/p/admin`, the cabinet shall render a
  **minimal index** listing the sections available to them — not a dashboard,
  and not a jump into the first resource.
- **EARS-35.** Every cabinet screen shall show which module's data is being
  edited, via a breadcrumb of the shape `Админка / <module> / <resource>`.
- **EARS-36.** The data provider and each handler shall validate against **the
  module's own zod schemas**, one schema typing the client and validating the
  handler input (consolidation §5).
- **EARS-37.** The cabinet shall omit an operation a resource does not support
  from the screen entirely — no control that fails on click.
- **EARS-39.** Every cabinet write shall run through `platformTransaction` with
  the signed-in admin as `actorEmail` and a cabinet `source`, so the edit is
  attributable in `core.audit_event` (ADR-004 A1; spec 201).
- **EARS-40.** The cabinet shall carry the same shared top bar as the rest of
  the workspace (EARS-25).
- **EARS-72.** WHEN an admin saves, the cabinet shall answer unambiguously: a
  visible confirmation, or a failure naming the reason.
- **EARS-73.** IF a database constraint fires on a cabinet write, THEN the
  message shall be the readable refusal the module already produces (spec 124
  EARS-20), never a raw constraint error and never a 500.
- **EARS-74.** The cabinet navigation shall stay usable when ten modules declare
  admin sections, evidenced by rendering the sidebar against a full-portfolio
  registry fixture (`315-product.md`).

### E. `members` — the first tenant (#316)

- **EARS-41.** The cabinet shall expose a `members` resource under the member
  module's section: a searchable list (name, email, role, status), a record
  view, a create form and an edit form, reaching `core.member` only through the
  member module's public API (`src/lib/member/index.ts`, ADR-004 §6). That
  public API does not yet carry every operation this needs — today it exports
  `listMembers`, `findMemberByEmail`, `getMembersByIds`, `resolveMember`,
  `updateMemberProfile`, `listAliases`, `upsertMemberWithAliases`,
  `findMemberOwningAliasValue` and `ensureMemberByEmail`, with **no plain member
  create, no alias update and no alias delete** — so extending it (inside the
  module, behind the same door) is part of #316 and is not a licence for the
  cabinet to reach past it.
- **EARS-42.** Deletion of a member shall be **unsupported**: the cabinet shall
  offer **deactivation** (`status → inactive`) and no destructive delete
  anywhere. _(`member` is FK-referenced by `hours_participant` and
  `hours_assessment` and will be referenced by every future module; deleting a
  person deletes the history that is the product.)_
- **EARS-43.** WHILE editing an existing member, `email` shall be read-only: it
  is the identity join key with Zitadel and with the hours history (spec 124
  EARS-2/EARS-9). Correcting an email stays the owner-run SQL escape hatch.
- **EARS-44.** The cabinet shall expose the member's **aliases**
  (`core.member_alias`) as a nested resource supporting create, read, update and
  delete, retiring spec 124's EARS-19 («WHILE no admin UI exists (until
  `/p/admin`, epic #112)»). Delete is supported here, unlike for a member: an
  alias is a lookup row, not history. IF an alias duplicates a normalized
  `(kind, value)` already held by another member, THEN the save shall be refused
  with a message naming that member (spec 124 EARS-17/EARS-20). The alias update
  and delete operations do not exist on `src/lib/member`'s public API today and
  are added there by #316 (EARS-41).
- **EARS-45.** Deactivating a member shall change `status` and nothing else in
  this spec — no cascading effect on hours participation, no role revocation in
  Zitadel. Projecting membership into Zitadel is Access Sync, epic #113.

### F. `hours` — the second tenant (#317)

- **EARS-46.** The cabinet shall expose the hours module's admin section
  carrying four items, matching the vendored sidebar: **Периоды**, **Ставки и
  грейды** (participants), **Экспорт** and **Публикация в Mattermost**.
- **EARS-47.** The hours cabinet resources shall reproduce the behaviour of the
  retiring `/p/hours/admin` screen exactly, per specs 081 (rev. #83/#85), 100
  and 124 — participant upsert by email with implicit `member` creation
  (124 EARS-9), period create/edit with date-change recompute and its warnings
  (124 EARS-30), open/close/reopen under the module advisory lock (124 EARS-10),
  and the publication lock (124 EARS-31). This spec **moves** that behaviour; it
  does not redesign it.
- **EARS-48.** Assessments shall be **read-only** in the cabinet: they are
  created and re-saved by the participant on `/p/hours` (spec 081), and the old
  admin screen never edited them either.
- **EARS-49.** The JSON export shall be an **action**, not a CRUD resource: a
  download producing byte-identical output to spec 124 EARS-11, served from a
  handler at `/api/p/hours/admin/export` that re-checks `platform-admin`
  (EARS-62).
- **EARS-50.** The Mattermost publication panel shall move into the cabinet in
  full, keeping the spec 100 flow (preview → publish, one batch per period,
  sequential per-message delivery) unchanged.
- **EARS-51.** Every hours administrative action shall be authorized by
  `platform-admin`, replacing the `HOURS_ADMIN_EMAILS` re-check of spec 124
  EARS-32, which is hereby superseded.
- **EARS-52.** `/p/hours/admin` **and** its export route
  (`/p/hours/admin/export`) shall return **404** with **no redirect** in the
  shipped code (D-8), pinned by a regression test; `/p/hours` itself is
  untouched.

### G. The OKR cabinet section

- **EARS-53.** The OKR module shall declare an `admin` section (owner amendment
  (b), 2026-08-25, reversing the earlier exclusion), carrying exactly one
  resource in v1: **«Источник и параметры»** — a read-only settings page, not a
  list.
- **EARS-55.** Create, update and delete shall all be **unsupported** on that
  resource, with the reason stated on the screen in one line: the OKR records
  are mastered in Plane, and these parameters are deploy-time configuration with
  no settings store in `core` to write to. Making them editable requires such a
  store and is deferred to the OKR module's own product cycle.
- **EARS-75.** That page shall show the OKR module's **effective configuration**
  — the Plane workspace and the projects the dashboard reads, the period it
  currently displays, and the project → mission/order mapping it applies —
  obtained through a **named extension of `src/lib/okr`'s public API**: today
  `src/lib/okr/index.ts` exports `OKR_PERIOD` and `TEAM` but not
  `OKR_WORKSPACE`, not `OKR_PROJECTS` and not the Plane web base URL, so #315
  adds a single read-only accessor (`getOkrParameters()`) over the existing
  `src/lib/okr/config.ts` values and exports it from `index.ts`. Nothing else in
  the OKR module changes, and no caller reaches past `index.ts`.
- **EARS-76.** WHEN an admin opens that page, the cabinet shall perform a **live
  read probe** against Plane through `getOkrTree()` and shall show its outcome
  on the page: success with the moment of that read, or, IF the read fails or
  raises `OkrUnavailableError`, THEN the error it reports. The probe is
  performed on open and its result is not stored anywhere — the page states what
  is true when it is looked at, which is why no read-health store is needed.

### H. Boundaries (`pnpm boundaries`)

- **EARS-56.** `pnpm boundaries` shall forbid a module from importing
  `src/lib/workspace/registry` while allowing it to import
  `src/lib/workspace/contract` (D-3).
- **EARS-57.** `pnpm boundaries` shall forbid anything outside
  `src/lib/workspace` and `src/app/(platform)` from importing the registry.
- **EARS-58.** `pnpm boundaries` shall forbid `src/ui` from importing any
  module, while any module may import `src/ui` (consolidation §10).

## Retired clause ids

Canon: `docs/specs/README.md` — «a split retires the old id and adds new ones,
so a reference never dangles». All seven were retired on 2026-08-25 by the
independent review of commit `358d350`; none is ever reused.

| Retired | Replaced by               | Why                                                                                                                                   |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| EARS-11 | EARS-56, EARS-57, EARS-58 | bundled three independently testable boundary rules under one id, so a partial pass would look green                                  |
| EARS-19 | EARS-59, EARS-60          | bundled the revocation event with the "a grant needs no redeploy" property, which is not that event's consequence                     |
| EARS-20 | EARS-61, EARS-62          | required `platform-admin` on **every** `/api/p/*` handler, which locks plain members out of the member-facing half (consolidation §5) |
| EARS-24 | EARS-4                    | duplicated EARS-4's treatment with a different subject; two ids for one rule drift apart                                              |
| EARS-26 | EARS-69, EARS-70          | bundled a ubiquitous rule (longest-prefix resolution) with a WHILE state (the `/p` home state)                                        |
| EARS-38 | EARS-72, EARS-73          | bundled a WHEN clause (the save answer) with an IF/THEN clause (the constraint refusal)                                               |
| EARS-54 | EARS-75, EARS-76          | required persisted read-health state that EARS-55 and Out of scope forbid, and configuration `src/lib/okr` does not export            |

## Portfolio walk (discovery record behind EARS-13)

Each target app of consolidation spec §4 (revision -f) against the contract, as
walked during discovery. It is the reasoning that produced the contract; the
**proof** that the contract accommodates the portfolio is EARS-13's type-level
test, which compiles or does not. The hedges below («likely», «optional») are
honest about apps whose own product cycle has not run — none of them needs a
frame concept the contract does not already carry.

| Portfolio app                | Entry kind             | `status` provider         | `requiredClaim`  | `admin` section                  |
| ---------------------------- | ---------------------- | ------------------------- | ---------------- | -------------------------------- |
| Hours (`/p/hours`)           | internal               | yes — open period         | —                | yes — 4 items (EARS-46)          |
| OKR (`/p/okr`)               | internal               | yes — cycle progress      | —                | yes — 1 read-only item (EARS-53) |
| Finance (`/p/finance`, #115) | internal               | likely — unclosed month   | likely, later    | yes, its own spec                |
| Decks (`/p/decks`, #118)     | internal, section root | optional                  | —                | likely — deck registry           |
| CRM                          | internal               | optional                  | likely, later    | yes                              |
| Task management              | internal or external   | optional                  | —                | depends on its discovery         |
| Team search & recruiting     | internal               | optional — open vacancies | likely, later    | yes                              |
| Project launch               | internal               | optional                  | —                | yes                              |
| Calculators & work tools     | internal               | no                        | —                | probably none                    |
| Mattermost integration       | external (today)       | n/a by type (EARS-1)      | —                | n/a by type                      |
| **Frame's own:** `/p/admin`  | internal (D-4)         | no                        | `platform-admin` | n/a (it _is_ the cabinet)        |
| **Frame's own:** Plane, KB   | external               | n/a by type               | —                | n/a by type                      |

Two contract limits are named rather than hidden. A module wanting a **family**
of tiles (calculators is the likely first) gets one entry in v1 and raises the
family question in its own product cycle — `311-product.md` settled this. And
module-controlled **grouping or ordering** of launcher tiles does not exist in
v1: order is registry order (EARS-22).

## CRUD check (task-cycle stage 1a)

Every form the cabinet renders, with the operations deliberately unsupported and
why. "Not supported" means absent from the screen (EARS-37), not present and
failing.

| Form                          | Create                                                       | Read                           | Update                                                             | Delete                                                                                     |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **Member** (`members`)        | yes — name, email, role, timezone                            | list + record                  | yes — name, role, timezone, status; **email read-only** (EARS-43)  | **not supported** — deactivate instead (EARS-42): FKs from hours history make delete a lie |
| **Member alias** (nested)     | yes — kind + value (+ note)                                  | list under the member          | yes                                                                | **yes** — an alias is a lookup row, not history (EARS-44)                                  |
| **Hours participant** (rates) | yes — upsert by email; unknown email creates a `member`      | list on `/p/hours` and cabinet | yes — fork, grade, name, role; email is the read-only key          | **not supported** — deliberate since spec 081 item 16; SQL escape hatch                    |
| **Hours period**              | yes — label + dates, ≥1 weekday                              | list with status               | yes — label/dates with recompute; refused while publication-locked | only while the period has no assessments (spec 081 item 16)                                |
| **Hours assessment**          | **not supported** — the participant creates it on `/p/hours` | read-only summary              | **not supported** — re-saving is the participant's act (081)       | **not supported** — history is the product (124)                                           |
| **Hours publication**         | yes — preview then publish, one batch per period             | panel state                    | delivery updates the batch per spec 100                            | **not supported** — it is a delivery record                                                |
| **Hours export**              | n/a — an action, not a resource (EARS-49)                    | the download itself            | n/a                                                                | n/a                                                                                        |
| **OKR source & parameters**   | **not supported** — no settings store in `core`              | yes — read-only page           | **not supported** — deploy-time configuration (EARS-55)            | **not supported** — nothing to delete                                                      |

## Acceptance scenarios

Performed on real URLs against a live stand. The owner performs them himself, or
an agent performs them for him through Playwright and hands him the evidence —
this repo's canon for acceptance. Three of them (2, 9, 13) need a dev stand, a
database read or a throwaway diff and are **agent-performed by construction**;
they are marked. Each names the clauses it exercises; these double as the TDD
scenarios (task-cycle stage 3) and the stage-5 acceptance script.

1. **The workspace exists.** A member with `platform-user` opens
   `https://portal.bbm.academy/p` and sees one flat grid: tiles for Часы and
   OKR, plus shorter marked external tiles for Plane, Mattermost and the
   knowledge base. Clicking Plane opens a new tab and leaves `/p` where it was.
   No admin tile appears anywhere on the page, «View source» contains no mention
   of `/p/admin`, and there are no greyed «портфель, позже» tiles. (EARS-2,
   EARS-4, EARS-22, EARS-23, EARS-67, EARS-68)
2. **The pulse.** _(agent, dev stand.)_ The Часы tile carries a live line naming
   the open period; the OKR tile carries its own. With the hours provider
   deliberately broken, the Часы tile still renders and still opens, the OKR
   line is unaffected, and the page does not hang. (EARS-6, EARS-7, EARS-8)
3. **Chrome everywhere.** From `/p` the member opens Часы: the same top bar now
   names Часы, offers the switcher, shows their own name and a sign-out. They
   switch straight to OKR without going home, then return home in one click; on
   `/p` the bar names no app. Sign-out ends the session. (EARS-25, EARS-27,
   EARS-29, EARS-69, EARS-70)
4. **Membership is granted, not assumed.** The owner revokes `platform-user`
   from a test account in Zitadel. That account's next request to `/p` gets a
   bare refusal — no page, no explanation, no login loop. The owner grants the
   role back; the member enters, with no redeploy. (EARS-14, EARS-15, EARS-16,
   EARS-18, EARS-59, EARS-60)
5. **One grant for an admin.** An account holding **only** `platform-admin`
   opens `/p`, sees the Админка tile alongside the apps — dashed, flagged
   «только администратор» — and enters the cabinet. (EARS-4, EARS-17, EARS-68)
6. **The cabinet's shape.** `/p/admin` opens on an index of sections, not a
   dashboard, under the same top bar as the rest of the workspace. The left
   sidebar shows Участники, Часы and OKR as parent groups with their items
   visibly nested underneath; opening Периоды shows the breadcrumb
   `Админка / Часы / Периоды`. (EARS-31, EARS-32, EARS-33, EARS-34, EARS-35,
   EARS-40)
7. **The boundary is the server, and the host.** A member holding only
   `platform-user` types `https://portal.bbm.academy/p/admin` and is refused;
   they call `https://portal.bbm.academy/api/p/hours/admin/periods` directly and
   are refused as well, while `https://portal.bbm.academy/api/p/hours/periods`
   (a member-facing route) answers for them. The same admin URL asked of
   `https://cms.bbm.academy/api/p/hours/admin/periods` returns 404. (EARS-5,
   EARS-18, EARS-61, EARS-62, EARS-63, EARS-64)
8. **Members administration.** In the cabinet the admin finds a member by name,
   corrects their role, saves, and sees an explicit confirmation. No delete
   control exists anywhere on the screen — nor any other control that would fail
   on click; the admin deactivates the member instead, sees the status change,
   and sees that the member's hours participation is untouched. They add a
   Mattermost alias to that member, then try to add the same alias to a second
   member and get a refusal naming the first. The `email` field is not editable.
   (EARS-37, EARS-41, EARS-42, EARS-43, EARS-44, EARS-45, EARS-72,
   EARS-73)
9. **Attribution.** _(agent, database read.)_ After scenario 8, an agent reads
   `core.audit_event` for the owner; the rows for those edits name the admin's
   email and a cabinet source. (EARS-39)
10. **Hours administration moved, not rebuilt.** From the cabinet the admin
    creates a participant with a new email, sets fork and grade and sees the
    computed rate; edits a period's dates over existing assessments and gets the
    same recompute warning as before; opens a period's assessments and finds
    them readable but with no edit or delete control; downloads the JSON export
    and finds it identical in shape to yesterday's; opens the Mattermost panel
    and sees the preview. (EARS-46, EARS-47, EARS-48, EARS-49, EARS-50,
    EARS-51)
11. **The old admin is gone.** `https://portal.bbm.academy/p/hours/admin` and
    `https://portal.bbm.academy/p/hours/admin/export` both return 404, and
    neither redirects anywhere. `/p/hours` itself works unchanged. Neither
    `.env.example` nor `deploy/.env.prod.example` mentions `HOURS_ADMIN_EMAILS`,
    and the value still sitting in the live `deploy/.env.prod` grants nothing
    because no code reads it. (EARS-21, EARS-52)
12. **OKR has a cabinet section.** The sidebar's OKR group opens a single
    read-only page naming the Plane workspace and projects the dashboard reads,
    the period it displays and the mission/order mapping it applies, plus the
    result of the read it just performed against Plane. There is no save button
    and no delete control, and the page states in one line why. (EARS-37,
    EARS-53, EARS-55, EARS-75, EARS-76)
13. **The tenth app costs what the third did.** _(agent, throwaway diff.)_ An
    agent adds a throwaway module declaring a tile, a required claim and an
    admin section with one resource, and shows the diff: only that module's own
    files plus one import and one array element in
    `src/lib/workspace/registry.ts` — zero lines changed in the launcher, the
    top bar or the cabinet shell. A second throwaway module declaring **no**
    admin section appears on the home and nowhere under `/p/admin`. Removing a
    declaration removes it from all three renderings. Deleting only the array
    element while leaving the module's declaration in place makes the test suite
    fail by name. (EARS-1, EARS-2, EARS-3, EARS-9, EARS-10, EARS-12)
14. **Existing surfaces were not restyled.** `/p/okr` and `/p/hours` look as
    they did, apart from the new top bar above them. (EARS-29)
15. **Narrow viewport, and a full portfolio.** The member opens `/p` on a phone
    width: the grid reflows, every tile stays readable and the app switcher is
    reachable from a collapsed menu. On a stand seeded with a full-portfolio
    registry fixture — ten apps plus the external entries and the cabinet — the
    home is still one readable grid and the cabinet sidebar is still navigable.
    (EARS-28, EARS-71, EARS-74)

### Verified by CI, not by the owner

Four clauses are machine-level by nature: there is no screen on which a
non-developer can observe them. They are named here so that "no scenario
exercises it" never means "nothing checks it" — each is covered by a test whose
title carries its id, per `docs/specs/README.md`.

| Clause                    | Verified by                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EARS-13                   | a type-level test constructing one declaration per portfolio app and compiling                                                                                                                                                         |
| EARS-56, EARS-57, EARS-58 | `pnpm boundaries` — three dependency-cruiser rules, one test each asserting the rule fires                                                                                                                                             |
| EARS-65                   | the Host-matrix unit test over `evaluateRequest`, rows for `/api/p/*` × every host × mode                                                                                                                                              |
| EARS-30, EARS-36          | EARS-36 by a handler/provider unit test on the shared zod schema; EARS-30 additionally by the review gate of `.claude/rules/design-process.md` (hand-rolled styles are a stop-factor, which is a reviewer's verdict, not an assertion) |

## Out of scope

- Provisioning the two roles in the dev and prod Zitadel, and assigning them to
  people — the operational half of #313; automatic assignment from `core` is
  Access Sync, epic #113.
- Any per-module role beyond the two starting ones. Finer claims arrive during
  operation through EARS-1's `requiredClaim` field, with no frame change
  (EARS-66; owner, 2026-08-24). `cms-editor` and the Payload SSO half of
  consolidation §14 item 3 stay open and belong to epic 4.
- Restyling the `/p/okr` and `/p/hours` bodies onto `src/ui` (EARS-29).
- The tokens and base components themselves — #312.
- Grouping, search, pinning, personalised ordering, notifications and global
  search on the home; any dashboard beyond one status line per tile.
- Ghost / "coming later" tiles for unbuilt portfolio apps (D-13, EARS-67).
- Caching or streaming of status lines (D-6 names the deferral).
- Editing OKR parameters or OKR records (EARS-55); a settings store in `core`;
  any persisted OKR read-health history (EARS-76 probes live instead).
- Any change to the OKR module beyond the one read-only accessor EARS-75 names.
- Product design of any portfolio app other than the two first tenants — each
  runs its own product cycle.
- Propagation of any edit made in the cabinet to external systems — epic #113.
- Changing hours behaviour: the cabinet is a move of specs 081/100/124, not a
  redesign.

## Follow-up tasks

Already open as sub-issues of epic #112 and governed by this spec: **#312** (UI
kit `src/ui`), **#313** (access & roles, §B), **#314** (`/p` launcher + shared
top bar, §C), **#315** (`/p/admin` shell, §D and §G), **#316** (`members`
resources, §E), **#317** (`hours` resources and the retirement, §F). The module
plug-in contract itself (§A) has no separate implementation issue: it is the
first deliverable of #314, which is the first consumer to need it, and #315
verifies it on the admin half.

### Frame-level work that must be budgeted inside those issues

Named here because each is a change to a file outside the issue's obvious
surface, and an implementer who does not read this list discovers it mid-build.

| Work                                                                                                                                                              | Issue    | Why it is not optional                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `src/lib/platform/hostAllowlist.ts` — admit `/api/p/*` on the platform surface, exclude it from the CMS `/api/*` clause, extend the Host-matrix test (EARS-63…65) | **#315** | it is a prerequisite for the **first** `/api/p/*` handler to answer at all; #316/#317 inherit it |
| `src/lib/okr/index.ts` — export one read-only `getOkrParameters()` accessor over `src/lib/okr/config.ts` (EARS-75)                                                | **#315** | §G cannot be built from today's OKR public API                                                   |
| `src/lib/member/index.ts` — add member create, alias update and alias delete to the module's public API (EARS-41, EARS-44)                                        | **#316** | the cabinet must not reach past the module door to get them                                      |
| Rewrite or retire the five `HOURS_ADMIN_EMAILS` unit specs listed in EARS-21                                                                                      | **#317** | they assert the gate this spec deletes                                                           |

### Donor spec revisions (on-touch, same PR as the behaviour)

This spec retires clauses that live in **other** specs describing production.
`docs/specs/README.md` → Status model: changing a shipped behaviour **updates
the existing spec** in the same PR; leaving the donor untouched creates two
contradicting sources of truth, and the copy nobody edited is the one that
drifts. Each row is a required part of its PR, not a follow-up wish.

| Donor spec                                       | What this spec changes in it                                                                                                                                  | Landed by |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `docs/specs/124-hours-on-core.md`                | EARS-19 (SQL escape hatch until `/p/admin`) is retired by EARS-44 — amend the clause in 124 and set the file's status per the ladder                          | **#316**  |
| `docs/specs/124-hours-on-core.md`                | EARS-32 (`HOURS_ADMIN_EMAILS` re-check) is superseded by EARS-51 — amend it to name `platform-admin`                                                          | **#317**  |
| `docs/specs/081-hours-calculator.md` (+#83/#85)  | the admin screen it describes is deleted (EARS-52); its administrative behaviour now lives in the cabinet — amend the affected sections to point at this spec | **#317**  |
| `docs/specs/100-hours-mattermost-publication.md` | the publication panel moves into the cabinet (EARS-50) — amend the surface it names                                                                           | **#317**  |

</content>
