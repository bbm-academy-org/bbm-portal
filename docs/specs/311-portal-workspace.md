---
status: In dev
issue: 311
updated: 2026-08-29
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
  Антон on 2026-08-25 in the option round run under **#311** (this issue's scope
  puts the Stage-A options to the owner); the picks are recorded as comments on
  #314 and #315 and as provenance rows in `design-source/README.md`. The admin pick carries two
  owner amendments, written into the file's header comment: sub-section nesting
  must be visually explicit, and OKR **does** get a cabinet section. Where this
  spec's prose and a vendored file disagree, the file wins **on layout and
  coverage** — both files are `fidelity: wireframe`, and per
  `.claude/rules/design-process.md` §1 (fidelity clause, #359) a wireframe fixes
  where things sit, never how they look; the visual language comes from the
  standard-system decision of #360, not from these files. The two places where
  the launcher file shows more than the prose did are settled explicitly by
  EARS-468 (the four tile forms) and EARS-477/EARS-478 (the portfolio
  placeholder tiles).
- **Owner «go» (task-cycle stage 2) — Антон, 2026-08-25.** The spec is approved
  and its status moves `Draft` → `In dev`; from here it is the frozen scope of
  #312…#317. The go carries **one owner decision that overrides a lead call**:
  the launcher **does** render the greyed «портфель, позже» placeholder tiles for
  the target-portfolio apps that are not live yet, exactly as the vendored
  `design-source/p-launcher.html` draws them. D-13 below is rewritten to record
  that decision, EARS-467 (which excluded them) is retired, and EARS-477/EARS-478
  are the clauses that replace it. The vendored file wins **on that inventory
  question** — which tiles exist at all is a layout/coverage decision, which is
  exactly what a `fidelity: wireframe` source is allowed to settle
  (`.claude/rules/design-process.md` §1, fidelity clause, #359). How those tiles
  LOOK is not settled by the file.
- **Consolidation revision 2026-08-26-g (#360) — citations reconciled.** The
  owner decided the visual language of `/p/*` is the standard neutral theme of
  Refine's official shadcn integration; the consolidation spec's §3 decision 9,
  §6 and §10 were revised accordingly, and the quotes of §6/§10 in "Prior
  decisions" below carry the revised wording. The kit still lives at `src/ui`
  behind the same boundary, so EARS-458 and every "built from `src/ui`" clause
  stand as written.
- **Kit contents cleared (#360, PR-1a).** The first `src/ui` contents (#312 —
  `tokens.css`/`tokens.ts` derived from the two wireframes, eight components,
  the `classNames` helper, the barrel) and the `/p/ui-kit` showcase route were
  **deleted**, together with the unit suites that asserted the wireframe
  derivation (`tests/unit/ui-tokens.spec.ts`, `ui-showcase.spec.ts`,
  `ui-design-fidelity.spec.ts`, `ui-markup.spec.ts`). Authority: the owner's
  Stage-A decision on #360 (Антон, 2026-08-26). The directory, the
  dependency-cruiser rule `ui-kit-must-not-import-src` and EARS-458 are
  untouched; the replacement contents (Tailwind + the copied Refine shadcn
  components) land in the next PR on #360. EARS-430 («built from `src/ui`»)
  therefore refers to the kit as it will be repopulated, not to the deleted
  wireframe-derived one.
- **Kit repopulated (#360, PR-1b).** Tailwind v4 and the shadcn/ui neutral theme
  landed in `src/ui`: the theme entry `src/ui/theme.css` and six copied
  primitives (`button`, `card`, `badge`, `avatar`, `separator`,
  `dropdown-menu`), with `components.json` aliases pointing every generated path
  into the kit so EARS-458 and `ui-kit-must-not-import-src` stay green. The
  visual source is the new `system:` row in `design-source/README.md` at
  `fidelity: visual`. **Three clauses of §C were amended by that landing**, all
  in one direction — stripping VISUAL prescriptions that had been read off a
  `fidelity: wireframe` file, while leaving the layout and inventory decisions
  the file legitimately settles: EARS-430 (which source licenses which half),
  EARS-468 (the four tile forms are an inventory, not a look) and EARS-478 (the
  placeholder is muted the way the theme expresses muted, not «dashed border and
  greys per the file»). No clause was retired and none changed what the launcher
  must DO, so their #314 deferral entry in `tools/lint/ears-test-lint.mjs`
  stands: the tests that would cover them are the launcher's, and the launcher
  is the re-skin slice. What PR-1b deliberately did NOT settle: EARS-430 still
  has no machine-checkable assertion, and choosing between retiring it and
  giving it one is a product call for the re-skin slice, not a mechanical
  rewrite this one could make.
- **Launcher re-skinned onto the adopted kit (#360, PR-2 — PR #354).** The
  frozen `/p` launcher branch was rebuilt on the repopulated kit: the tile is
  `Card` + `Badge`, the shared top bar is a surface-local composition of
  `Avatar` / `Separator` / `Button` (the kit publishes primitives, not
  application chrome), the app switcher is the kit's `DropdownMenu` — which
  **retired the one bespoke element of this epic**, the hand-written open menu
  and its stylesheet — and the branding is the text logo «Платформа BBM» per the
  Stage-A decision. `src/ui/theme.css`'s base layer was **armed and scoped to a
  `[data-bbm-ui]` subtree**: the document-level form the shadcn CLI generates
  would have restyled `/p/okr` and `/p/hours` the moment the theme entry was
  imported, which is EARS-429, so the arming and that clause are reconciled by
  the scoping rather than by deferring one of them.

  **EARS-430 left the deferral list here.** PR-1b recorded that choosing between
  retiring it and giving it a machine-checkable assertion was this slice's call.
  It is **not retired**: it is the clause the 2026-08-26 incident violated, and
  «a reviewer will notice» is precisely what did not happen. It is asserted
  instead, in `tests/unit/launcher-kit-adoption.spec.ts` — the surface ships no
  stylesheet, writes no colour and no inline style, and imports its element
  classes from `@/ui`. The cabinet screens are also subjects of the clause and
  do not exist yet (#315); the suite scans the surface files that DO exist and
  grows with them, which is why nothing is owed back to the deferral list.

- **Donor & benchmark pass:** run 2026-08-25 against three donors — Refine's
  own resource/menu model (`@refinedev/core` `resources[]` with `meta.parent`
  multi-level menus, adopted for the grouped navigation and for nothing else:
  its auth and data packages are deliberately not used, per consolidation spec
  §6); `ds-platform`'s EARS↔test traceability mechanics (adopted wholesale, they
  are already this repo's canon per `docs/specs/README.md`); and the existing
  `/p/hours/admin` screen as the behavioural benchmark the cabinet must match
  (its behaviour is inherited, its env-allowlist gate is deleted rather than
  ported — see EARS-421 and EARS-451). No constraint was carried across that could
  not be justified for this domain, and the pass produced no owner question.
- **Independent review, 2026-08-25 — reworked.** This revision answers a
  full independent review of commit `358d350` (2 BLOCKER, 4 MAJOR, 20 MINOR,
  4 NIT): the `/api/p/*` host topology (EARS-463…EARS-465, D-11), the OKR section's
  buildability (EARS-475/EARS-476), the member-vs-admin authorization split
  (EARS-461/EARS-462, D-12), the launcher's placeholder and admin tiles (EARS-468, D-13),
  the donor-spec revisions (Follow-up tasks), and scenario coverage for the
  clauses no scenario exercised. Seven clause ids were **retired** by splits or
  as duplicates and are never reused — they are listed in place. An eighth was
  retired at the go by the owner decision recorded above.
- **Clause ids were moved to a non-colliding range before merge (2026-08-25).**
  `pnpm lint:ears-test` resolves EARS ids in ONE FLAT namespace across the whole
  spec corpus (`tools/lint/ears-test-lint.mjs`, "Id keyspace"), so this spec's
  original `EARS-1…78` were read as already covered by spec 124's and spec 201's
  tests, which cite those same low ids. Every clause of this spec was therefore
  renumbered `+400` into **EARS-401…EARS-478** — relative order unchanged, the
  retired-id list moved with it — while this spec is still unmerged and no test
  cites it, so nothing dangles. References to OTHER specs' clauses (spec 124's
  EARS-2, EARS-9, EARS-10, EARS-11, EARS-17, EARS-19, EARS-20, EARS-30, EARS-31,
  EARS-32) keep their own numbers and are never this spec's declarations.

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
  `cms.bbm.academy`**. Both halves are wrong and both are fixed here: EARS-463
  admits the prefix on the portal, EARS-464 carves it out of the CMS `/api/*`
  clause exactly as `/api/auth/*` is already carved out, EARS-465 extends the
  Host-matrix test. D-11 records why the API keeps that URL shape.
- **ADR-003 §3(a)** — the platform surface is expressed as **self-maintaining
  prefix entries**, not per-module ones. After EARS-463 there are two: `/p/*`
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
  boundary rules for the registry (EARS-456, EARS-457, EARS-458).
- **ADR-004 A1** — every write to `core` runs through `platformTransaction(ctx, …)`
  with an audit context, and a write with no context is refused. Cabinet edits
  are therefore attributable by construction, provided each handler passes the
  signed-in admin (EARS-439).
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
    `HOURS_ADMIN_EMAILS` dropped. Its UI layer (revision 2026-08-26-g) is
    Refine's **official shadcn integration**: components are copied into
    `src/ui` from the `ui.refine.dev` registry, no UI npm dependency is added,
    the theme is standard shadcn (CSS variables) with a text logo «Платформа
    BBM», and the `@refinedev/antd` path is rejected.
  - **§10** — one unified UI kit for `/p/*` and the cabinet, living as `src/ui`
    in the monolith; the kit = the copied shadcn components of Refine's
    integration on the standard theme (revision 2026-08-26-g), tokens being that
    theme's CSS variables, with Tailwind in the build; new screens are built
    from the kit and hand-rolled styles are a review stop-factor; any module may
    import `src/ui`, `src/ui` imports no module.
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
  it, and EARS-444 does. Spec 124 is `Shipped`, so retiring its clauses from the
  outside is only half the job — spec 124 itself is amended, once, in the PR
  named in Follow-up tasks → "Donor spec revisions" (both of its retired clauses
  in one edit, so no second PR reverts the first one's status ladder).
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
  EARS-403 rather than by discipline. `311-product.md`'s criterion «by editing
  only files inside that module» is amended by this decision to «plus one import
  and one array element in the composition root»; the amendment is recorded here
  **and is already carried into the PRD by this PR** — the criterion there reads
  the amended text, so no future PR owes the correction.
- **D-3 — the contract type and the registry are two files, and modules may
  import only the first.** `src/lib/workspace/contract.ts` holds the types;
  `src/lib/workspace/registry.ts` holds the composition root. A module importing
  the registry would create an import cycle and let a module read its
  neighbours; a dependency-cruiser rule forbids it (EARS-456).
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
- **D-10 — `internal`, `external`, `planned` and `cabinet` are a discriminated
  union.** An external link has no admin section and no status provider; a
  planned entry has no target or module; and a cabinet-only module has
  `slug`, `name` and `admin` but no launcher target, status or claim. Each
  invalid combination is a type error rather than a runtime validation with a
  message nobody reads. **Buildability correction (2026-08-29, #316):** the
  earlier three-variant wording made the first admin-only tenant expressible
  only as an `internal` entry with a fake `href`, which would create an
  unapproved second launcher tile. The `cabinet` variant records the already
  required cabinet tenant without changing product scope or special-casing the
  shell.
- **D-11 — the module API keeps the `/api/p/<slug>/*` shape and the allowlist
  changes to meet it.** The alternative — moving module APIs under `/p/api/…` so
  the existing `/p/*` entry covers them with no allowlist edit — was rejected:
  consolidation §5 fixes the `/api/p/<module>/*` shape as the platform's HTTP
  contract, `/api/*` is where every other API in this process lives (Payload,
  Auth.js), and an `/p/api/` path would read as a page route to every reader and
  every tool. The cost is honest and bounded: **one additional prefix pair**
  (admit on the portal, exclude on the CMS), still O(1) in modules, still
  self-maintaining. It is a change to a boundary ADR-003 calls load-bearing, so
  it is specced (EARS-463…EARS-465) rather than left to an implementer.
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
  (EARS-461). The segment `admin` is therefore **reserved** inside a module's API
  namespace: no module may name a resource `admin`, because
  `/api/p/<slug>/admin/<resource>` would then be ambiguous with
  `/api/p/<slug>/<resource>`.
- **D-13 — the launcher's «портфель, позже» placeholder tiles are built
  (owner decision, Антон, 2026-08-25).** The pre-go draft carried the opposite
  lead call — that the six greyed tiles of `design-source/p-launcher.html`
  (Финансы, Колоды, CRM, Поиск команды, Запуск проекта, Калькуляторы) were a
  wireframe device showing how the grid reads at full portfolio size, and were
  not to be rendered in v1. **The owner overruled that call at the go**: the
  launcher renders them. The file wins on **which tiles exist** — a layout and
  coverage question, the kind a `fidelity: wireframe` source is allowed to settle
  (`.claude/rules/design-process.md` §1, fidelity clause) — not on how they look,
  which #360 settles. The product reason is the owner's:
  the portfolio is a promise the workspace makes to its members, and a member who
  sees only two apps cannot tell a small workspace from a young one. The clauses
  are EARS-477 (they are rendered, one per not-yet-live portfolio app) and
  EARS-478 (how: greyed, non-interactive, no status line, no claim logic). The
  lead call's one real worry — that a greyed tile teaches «exists but not for
  you» and so blunts EARS-404's «absence is the whole treatment» — is answered by
  EARS-478 keeping the two treatments visually and behaviourally distinct: a
  placeholder is captioned «портфель, позже» and is not a link at all, while a
  claim-gated entry is absent from the response body entirely (D-7). The
  **admin tile's** distinct treatment is likewise built (EARS-468) — it is a real
  entry with a real target.
- **D-13a — a placeholder is the `planned` variant of the registry entry, not a
  second list.** The mechanism for EARS-477 is a `planned` member of the same
  discriminated union: `kind: 'planned'` carrying a display `name`, a short
  `description` and nothing else — no `href`, no `url`, no `slug`, no
  `requiredClaim`, no `status` provider, no `admin` section. Three alternatives
  were rejected: a hard-coded list in the launcher (it would put app names back
  into the frame's own markup, which is exactly the property D-2 buys), a
  separate `plannedApps` array (a second list for the app switcher and the
  cabinet to disagree with, against EARS-402/EARS-427), and a `planned: true` flag
  on an `internal` entry (it would make `href` optional on the variant that is
  defined by having one, dissolving the type-level guarantee of D-10).
  **D-10 stays intact:** «an external link has an admin section or status
  provider» remains a type error, and so does «a planned app has a target».
  **D-2 stays intact and is not excepted:** placeholders are registry content
  listed in the composition root, so the launcher, the top bar and the cabinet
  still hold **zero** lines naming an app — promoting a placeholder to a live
  app is an edit to its own entry in the composition root and nowhere else. The
  entries are content, not code, and they are exempt from EARS-403 by
  construction: EARS-403 keys on a module under `src/lib/*` or `src/modules/*`
  exporting a declaration, and a planned app has no module to export one.

## Requirements

Eight ids from earlier revisions of this spec are **retired** and never reused —
they are listed, with what replaced them, in "Retired clause ids" below. The list lives
outside this section deliberately: an id named here is a live clause owing a
test (`pnpm lint:ears-test`), and a retirement note is not a requirement.

### A. The module plug-in contract (the centerpiece)

- **EARS-401.** The platform shall define the workspace contract in
  `src/lib/workspace/contract.ts` as a discriminated union on `kind`:
  an `internal` entry carrying `slug`, display `name`, short `description`,
  `href` under `/p/`, an icon reference, an optional `requiredClaim`, an
  optional `status` provider and an optional `admin` section; an `external`
  entry carrying `slug`, `name`, `description`, an absolute `url` and an
  optional `requiredClaim`, and **no** `status` and **no** `admin` field
  (D-10); a `cabinet` entry carrying `slug`, `name` and a required `admin`
  section, and **no** `href`, **no** `url`, **no** `description`, **no** icon,
  **no** `requiredClaim` and **no** `status`; and a `planned` entry carrying a display `name` and a short
  `description` and **no** `href`, **no** `url`, **no** `slug`, **no**
  `requiredClaim`, **no** `status` and **no** `admin` field (D-13a). A module
  shall declare at most one `internal`, `external` or `cabinet` entry and shall export it
  from its public API (`src/lib/<module>/index.ts`), per ADR-002 §3; a `planned`
  entry has no module and is written directly in the composition root (EARS-402).
- **EARS-402.** The platform shall hold exactly one composition root,
  `src/lib/workspace/registry.ts`, listing every declared entry in display
  order; the `/p` launcher, the top-bar app switcher and the `/p/admin`
  navigation shall each derive their contents from that one list and shall hold
  no list of their own (D-2).
- **EARS-403.** IF a module under `src/lib/*` **or** `src/modules/*` exports a
  workspace declaration that the composition root does not list, THEN the test
  suite shall fail naming that module — the one-line registration of D-2 is
  enforced mechanically, not by memory. Both roots are scanned because this repo
  has two (`src/lib/{hours,member,okr,platform}` and `src/modules/{hours,okr}`)
  and ADR-004 §6's own enforcement keys on `src/(lib|modules)/<module>/`; a
  declaration exported from either root must be registered or fail.
- **EARS-404.** WHERE an entry declares a `requiredClaim`, the frame shall omit
  that entry from the launcher grid and from the app switcher for a session
  whose roles do not include the claim, and the omission shall happen while the
  server builds the view model, so the entry is absent from the response body
  entirely — never rendered greyed out, disabled or as a placeholder (D-7).
- **EARS-405.** The platform shall never treat the absence of an entry as the
  authorization boundary: the module's own server-side handlers shall refuse a
  request from a session lacking the claim regardless of how the URL was
  reached (consolidation §5).
- **EARS-406.** WHERE an `internal` entry declares a `status` provider, the
  launcher shall invoke every declared provider concurrently when rendering `/p`,
  each with a 1-second deadline, and shall render the returned line on that
  entry's tile (D-6).
- **EARS-407.** IF a `status` provider rejects, throws or exceeds its deadline,
  THEN the launcher shall render that tile in its static form and shall render
  the remainder of the home unaffected — a module's pulse shall never fail or
  block the workspace home.
- **EARS-408.** The launcher shall render an entry that declares no `status`
  provider as a complete, openable tile — the normal case, not a degraded one.
- **EARS-409.** WHERE an `internal` or `cabinet` entry declares an `admin` section, the cabinet
  shall render that section as a navigation group carrying the declared
  resources, mounted at `/p/admin/<slug>/<resource>` (D-9), without any edit to
  the shell.
- **EARS-410.** WHERE an entry declares no `admin` section, the cabinet shall
  give that module no presence anywhere under `/p/admin` — no group, no item, no
  route. A `cabinet` entry has no presence in the launcher or app switcher by
  type, while its declared admin section is composed normally in the cabinet.
- **EARS-412.** WHEN a module's declaration is removed, the module shall
  disappear from every surface in which its variant participates with no other
  file edited: openable entries from launcher, switcher and cabinet; a
  cabinet-only entry from the cabinet.
- **EARS-413.** The contract shall accommodate every app of the target portfolio
  (consolidation spec §4, revision -f: hours, OKR, finance, decks, CRM, task
  management, team search & recruiting, project launch, calculators, Mattermost
  integration) without a new frame concept per app. The evidence is a
  **type-level test** that constructs one declaration per portfolio app —
  including a `decks`-shaped entry whose `href` is a section root and a
  Mattermost-shaped `external` entry, plus an admin-only `cabinet` fixture with
  no launcher target — and compiles; the "Portfolio walk" table
  below is the discovery record behind it, not the proof.

### B. Workspace access and roles

- **EARS-414.** The workspace shall be gated by exactly two starting Zitadel
  project roles: **`platform-user`** and **`platform-admin`**. No other role
  shall be introduced by this spec.
- **EARS-415.** The gate shall read those roles from the session's Zitadel roles
  claim (`urn:zitadel:iam:org:project:roles`), surfaced on the NextAuth session
  by `src/auth.ts`; provisioning the roles and asserting the claim in the dev
  and prod Zitadel (`infra/dev-stand/idp/provision.sh`) is part of #313's
  implementation and shall not be assumed already done by any other task.
- **EARS-416.** WHILE a session lacks `platform-user`, every path under `/p` shall
  be refused — the gate lives in the `(platform)` layout (ADR-003 §3(b)), so a
  new page inherits it by existing.
- **EARS-417.** The gate shall treat `platform-admin` as implying
  `platform-user`: a session carrying only `platform-admin` shall enter the
  workspace and the cabinet with that single grant.
- **EARS-418.** IF a session is authenticated but carries neither role, THEN the
  response shall be a bare HTTP 403 with no layout, no top bar, no explanatory
  copy and no contact block (D-5) — there is no guest contour to design.
- **EARS-421.** `HOURS_ADMIN_EMAILS` shall not exist in the shipped code, and no
  environment variable shall grant administrative access to any surface. Gone
  means gone from: `src/lib/hours/access.ts` (`isHoursAdmin`,
  `parseAdminEmails`), `src/modules/hours/actions.ts`, the deleted routes
  `src/app/(platform)/p/hours/admin/page.tsx` and
  `src/app/(platform)/p/hours/admin/export/route.ts` (EARS-452), `.env.example`,
  `deploy/.env.prod.example`, and the five unit specs that assert the old gate —
  `tests/unit/hours-access.spec.ts`, `hours-actions.spec.ts`,
  `hours-page-render.spec.ts`, `hours-publication-actions.spec.ts`,
  `hours-publication-view.spec.ts` — each of which is rewritten onto
  `platform-admin` or retired with its subject.
- **EARS-459.** WHEN a role is revoked, the next request from that session shall
  land in EARS-418 — no designed interruption, no forced sign-out screen.
- **EARS-460.** WHEN a role is granted, the grant shall take effect for that
  member on their next session without a redeploy of the platform.
- **EARS-461.** Every member-facing module handler under `/api/p/<slug>/<resource>`
  shall re-check `platform-user` **and** the entry's declared `requiredClaim`
  fail-closed, independently of any UI (consolidation §5, D-12). A handler that
  relies on the launcher having omitted the tile is a defect.
- **EARS-462.** Every handler under `/api/p/<slug>/admin/*` and every server
  action behind the cabinet shall re-check `platform-admin` fail-closed,
  independently of the shell (D-12). A handler that relies on the shell having
  checked is a defect.
- **EARS-463.** The host allowlist shall admit `/api/p/*` on the platform surface:
  `isPlatformSurfacePath` in `src/lib/platform/hostAllowlist.ts` shall pass
  `/api/p` and anything under `/api/p/` alongside `/p`, `/p/*` and `/api/auth/*`
  (ADR-003 §3(a), D-11). Without this every module API in this spec is 404 on
  `portal.bbm.academy`.
- **EARS-464.** The host allowlist shall refuse `/api/p/*` on the CMS surface:
  `isCmsSurfacePath` shall carve `/api/p/*` out of its generic `/api/*` clause
  exactly as it already carves out `/api/auth/*` — the more specific rule wins —
  so no module API answers on `cms.bbm.academy` (ADR-003 §1, the leak class the
  default-deny does not self-maintain because `/api` is an allowlisted CMS
  prefix).
- **EARS-465.** The Host-matrix test shall carry rows for `/api/p/<slug>/…` on
  every host of the matrix: pass on `portal.bbm.academy`, 404 on
  `cms.bbm.academy` and on the internal `app` host, pass on the dev origin in
  development mode and 404 there in production mode.
- **EARS-466.** A further claim introduced later shall require no change to the
  frame's own screens: it is declared as an entry's `requiredClaim` and enforced
  in that module's handlers (EARS-461), with no edit to the launcher, the top bar
  or the cabinet shell (`313-product.md`).

### C. The `/p` launcher and the shared top bar

- **EARS-422.** The platform shall serve a workspace home at `/p`, rendering the
  registry entries visible to the session as a **flat grid in registry order** —
  no grouping, no search, no pinning, no personalised ordering — per the
  vendored `design-source/p-launcher.html` (option `launcher-a`). Registry order
  is one order over all entries, placeholders included, and it places the
  placeholder entries of EARS-477 last, where the vendored file draws them. The
  tile variants that grid carries are
  exactly the four forms of EARS-468, which are exactly the four the vendored
  file draws.
- **EARS-423.** The launcher shall mark an `external` entry as external and shall
  open it in a new tab (`target="_blank"` with `rel="noopener noreferrer"`), so
  the member does not lose the workspace.
- **EARS-425.** The platform shall render a thin shared top bar on **every**
  `/p/*` page from the `(platform)` layout, carrying: a link to the workspace
  home, the current app's name, an app switcher fed by the registry, the
  signed-in member's identity and sign-out.
- **EARS-427.** The app switcher and the launcher shall never disagree about
  which apps are **open to the session**. _(Both read EARS-402's single list; that
  is the mechanism, and the test asserts the two renderings against one registry
  fixture. The switcher is a navigation control, so it carries the openable
  entries only — the `planned` placeholders the launcher draws have no target to
  switch to (EARS-478), which is a difference in what each surface is for, not a
  disagreement about the inventory.)_
- **EARS-428.** WHILE the viewport is narrow, the home and the top bar shall stay
  usable, with the app switcher reachable from a collapsed menu. Basic
  responsiveness only; no separate mobile design.
- **EARS-429.** The existing `/p/okr` and `/p/hours` page bodies shall gain the
  shared top bar and **nothing else** — no restyling onto `src/ui` in this epic;
  the reskin happens on each surface's first substantive touch, per the
  back-fill rule of `.claude/rules/design-process.md` §1.
- **EARS-430.** Every new screen this spec introduces (`/p`, the top bar, the
  cabinet shell and its resource screens) shall be built from `src/ui` (#360 —
  the kit as repopulated: Tailwind plus the copied shadcn/ui components on the
  adopted neutral theme) and shall take its LAYOUT from the vendored Stage-A
  sources; hand-rolled styles are a review stop-factor (consolidation §10). The
  two halves come from different rows of `design-source/README.md` and it
  matters which: layout from the `fidelity: wireframe` file for the surface, the
  visual language from the `system:` row at `fidelity: visual`. _(Asserted
  since #360's re-skin slice: `tests/unit/launcher-kit-adoption.spec.ts`.)_
- **EARS-468.** The grid shall carry exactly four tile forms, as the vendored
  file draws them: the standard `internal` tile; the shorter `external` tile
  marked «↗ внешний» (EARS-423); the admin entry's tile with its «только
  администратор» flag; and the `planned` placeholder tile of EARS-477/EARS-478.
  No other per-entry visual variation exists in v1. The vendored file settles
  WHICH four forms exist and what distinguishes them — an inventory question,
  which is what a `fidelity: wireframe` source is allowed to settle. It does not
  settle how each form LOOKS: the admin tile's dashed border and the greys the
  file draws them in are wireframe scaffolding, and the rendering comes from the
  kit's own components on the adopted theme (#360).
- **EARS-477.** The launcher shall render one placeholder tile per not-yet-live
  app of the target portfolio (consolidation spec §4, revision -f) **that no
  entry of the registry already represents**, as the entries the composition
  root declares with `kind: 'planned'` (D-13a). §4 lists ten apps; hours and OKR
  are live `internal` entries and Mattermost is a live `external` one, which
  leaves seven not yet live — and **управление задачами is served today by the
  external Plane entry, so it carries no placeholder**. That is exactly the six
  the vendored `design-source/p-launcher.html` draws: Финансы, Колоды, CRM,
  Поиск команды, Запуск проекта, Калькуляторы. The portfolio list is the source
  and the wireframe's six tiles are its illustration; the two agree here by the
  exclusion just stated, and a test asserting six tiles asserts that exclusion,
  not a hard-coded count. WHEN such an app ships, its `planned` entry shall be
  replaced by that module's own `internal` entry, and the placeholder shall
  disappear by that one edit alone; WHEN управление задачами finishes its own
  discovery, it becomes an `internal` entry replacing the Plane `external` one,
  and it never passes through a placeholder.
- **EARS-478.** The launcher shall render a `planned` entry as a visibly
  de-emphasised, **non-interactive** tile captioned «портфель, позже» — muted
  against the live tiles in whatever way the kit's own theme expresses «muted»
  (the vendored file's dashed border and greys are wireframe scaffolding, not
  the visual decision, #360), no link and no click target, not reachable by
  keyboard focus, with **no status line** (a `planned` entry declares no
  provider, and the vendored file's empty `pulse` slot is a wireframe
  placeholder, not content to render) and **no claim logic**: a placeholder
  carries no `requiredClaim`, is never filtered per session, and is shown
  identically to every session that reaches `/p`. A placeholder shall appear
  nowhere else — not in the top-bar app switcher (EARS-425), not under `/p/admin`
  (EARS-410), and it shall contribute no route and no handler.
- **EARS-469.** The top bar shall resolve the current app by matching the request
  pathname against registry `href` values, longest prefix wins.
- **EARS-470.** WHILE the member is on `/p` itself, the top bar shall show its
  home state and shall name no current app.
- **EARS-471.** The home shall stay readable as one flat grid at the full target
  portfolio size — the ten apps of consolidation §4 plus the external entries
  and the admin entry — evidenced by rendering the launcher against a
  full-portfolio registry fixture at desktop and narrow widths
  (`314-product.md`).

### D. The `/p/admin` cabinet shell

- **EARS-431.** The cabinet shall be a Refine shell using **`@refinedev/core` and
  a router binding only** — Refine's auth and data packages shall not be
  installed — with a hand-written data provider over the
  `/api/p/<slug>/admin/*` handlers of §5 (consolidation §6, D-12).
- **EARS-432.** The cabinet navigation shall be a persistent left sidebar grouped
  by module, per the vendored `design-source/p-admin-shell.html` (option
  `admin-a`), whose groups and items come from the registry's `admin` sections.
- **EARS-433.** The nesting of a resource under its module group shall be
  **visually explicit** — a real parent node with indented children, expressed
  through Refine's native multi-level menu model (a parent resource plus
  `meta.parent`), not through a flat list with a heading (owner amendment (a),
  2026-08-25). _(The owner's recorded expectation names `ThemedLayoutV2` as the
  example of that behaviour. That component ships in Refine's UI packages, which
  EARS-431 excludes; the amendment is met by taking the **menu tree** from
  `useMenu()` — the same `meta.parent` model — and rendering it with `src/ui`
  components. The behaviour is what was accepted, the package is not.)_
- **EARS-434.** WHEN an admin opens `/p/admin`, the cabinet shall render a
  **minimal index** listing the sections available to them — not a dashboard,
  and not a jump into the first resource.
- **EARS-435.** Every cabinet screen shall show which module's data is being
  edited, via a breadcrumb of the shape `Админка / <module> / <resource>`.
- **EARS-436.** The data provider and each handler shall validate against **the
  module's own zod schemas**, one schema typing the client and validating the
  handler input (consolidation §5).
- **EARS-437.** The cabinet shall omit an operation a resource does not support
  from the screen entirely — no control that fails on click.
- **EARS-439.** Every cabinet write shall run through `platformTransaction` with
  the signed-in admin as `actorEmail` and a cabinet `source`, so the edit is
  attributable in `core.audit_event` (ADR-004 A1; spec 201).
- **EARS-440.** The cabinet shall carry the same shared top bar as the rest of
  the workspace (EARS-425).
- **EARS-472.** WHEN an admin saves, the cabinet shall answer unambiguously: a
  visible confirmation, or a failure naming the reason.
- **EARS-473.** IF a database constraint fires on a cabinet write, THEN the
  message shall be the readable refusal the module already produces (spec 124
  EARS-20), never a raw constraint error and never a 500.
- **EARS-474.** The cabinet navigation shall stay usable when ten modules declare
  admin sections, evidenced by rendering the sidebar against a full-portfolio
  registry fixture (`315-product.md`).

### E. `members` — the first tenant (#316)

- **EARS-441.** The member module shall export `memberWorkspaceEntry` as a
  cabinet-only declaration with `kind: 'cabinet'`, `slug: 'member'` and one
  admin resource named `members`. The cabinet shall expose it at
  `/p/admin/member/members` over `/api/p/member/admin/members`: a searchable
  list (name, email, role, status), a record
  view, a create form and an edit form, reaching `core.member` only through the
  member module's public API (`src/lib/member/index.ts`, ADR-004 §6). That
  public API does not yet carry every operation this needs — today it exports
  `listMembers`, `findMemberByEmail`, `getMembersByIds`, `resolveMember`,
  `updateMemberProfile`, `listAliases`, `upsertMemberWithAliases`,
  `findMemberOwningAliasValue` and `ensureMemberByEmail`, with **no plain member
  create, no alias update and no alias delete** — so extending it (inside the
  module, behind the same door) is part of #316 and is not a licence for the
  cabinet to reach past it.
- **EARS-442.** Deletion of a member shall be **unsupported**: the cabinet shall
  offer **deactivation** (`status → inactive`) and no destructive delete
  anywhere. _(`member` is FK-referenced by `hours_participant` and
  `hours_assessment` and will be referenced by every future module; deleting a
  person deletes the history that is the product.)_
- **EARS-443.** WHILE editing an existing member, `email` shall be read-only: it
  is the identity join key with Zitadel and with the hours history (spec 124
  EARS-2/EARS-9). Correcting an email stays the owner-run SQL escape hatch. The
  member form shall expose `timezone` as a labelled selector over a stable,
  curated reference of relevant IANA zones (including `Europe/Moscow`,
  `Asia/Novosibirsk`, `Asia/Bangkok` and `Asia/Tbilisi`), with
  `Europe/Moscow` as the create default. Storage remains open: IF an existing
  member carries an unlisted zone, THEN the selector shall show and preserve it
  as a saved option until the administrator deliberately chooses another zone.
- **EARS-444.** The cabinet shall expose the member's **aliases**
  (`core.member_alias`) as a nested resource supporting create, read, update and
  delete, retiring spec 124's EARS-19 («WHILE no admin UI exists (until
  `/p/admin`, epic #112)»). Delete is supported here, unlike for a member: an
  alias is a lookup row, not history. IF an alias duplicates a normalized
  `(kind, value)` already held by another member, THEN the save shall be refused
  with a message naming that member (spec 124 EARS-17/EARS-20). The alias update
  and delete operations do not exist on `src/lib/member`'s public API today and
  are added there by #316 (EARS-441). In the cabinet, alias `kind` shall be a
  labelled selector over the member module's documented vocabulary (`phone`,
  `telegram`, `instagram`, `mattermost_id`, `mattermost_email`, `zoom_id`,
  `email_personal`) with Russian user labels, never free text. The storage and
  integration API vocabulary remains open: IF an existing alias carries an
  unlisted kind, THEN the selector shall show and preserve it as a saved option
  until the administrator deliberately chooses another kind.
- **EARS-445.** Deactivating a member shall change `status` and nothing else in
  this spec — no cascading effect on hours participation, no role revocation in
  Zitadel. Projecting membership into Zitadel is Access Sync, epic #113.

### F. `hours` — the second tenant (#317)

- **EARS-446.** The cabinet shall expose the hours module's admin section
  carrying four items, matching the vendored sidebar: **Периоды**, **Ставки и
  грейды** (participants), **Экспорт** and **Публикация в Mattermost**.
- **EARS-447.** The hours cabinet resources shall reproduce the behaviour of the
  retiring `/p/hours/admin` screen exactly, per specs 081 (rev. #83/#85), 100
  and 124 — participant upsert by email with implicit `member` creation
  (124 EARS-9), period create/edit with date-change recompute and its warnings
  (124 EARS-30), open/close/reopen under the module advisory lock (124 EARS-10),
  and the publication lock (124 EARS-31). This spec **moves** that behaviour; it
  does not redesign it.
- **EARS-448.** Assessments shall be **read-only** in the cabinet: they are
  created and re-saved by the participant on `/p/hours` (spec 081), and the old
  admin screen never edited them either.
- **EARS-449.** The JSON export shall be an **action**, not a CRUD resource: a
  download producing byte-identical output to spec 124 EARS-11, served from a
  handler at `/api/p/hours/admin/export` that re-checks `platform-admin`
  (EARS-462).
- **EARS-450.** The Mattermost publication panel shall move into the cabinet in
  full, keeping the spec 100 flow (preview → publish, one batch per period,
  sequential per-message delivery) unchanged.
- **EARS-451.** Every hours administrative action shall be authorized by
  `platform-admin`, replacing the `HOURS_ADMIN_EMAILS` re-check of spec 124
  EARS-32, which is hereby superseded.
- **EARS-452.** `/p/hours/admin` **and** its export route
  (`/p/hours/admin/export`) shall return **404** with **no redirect** in the
  shipped code (D-8), pinned by a regression test; `/p/hours` itself is
  untouched.

### G. The OKR cabinet section

- **EARS-453.** The OKR module shall declare an `admin` section (owner amendment
  (b), 2026-08-25, reversing the earlier exclusion), carrying exactly one
  resource in v1: **«Источник и параметры»** — a read-only settings page, not a
  list.
- **EARS-455.** Create, update and delete shall all be **unsupported** on that
  resource, with the reason stated on the screen in one line: the OKR records
  are mastered in Plane, and these parameters are deploy-time configuration with
  no settings store in `core` to write to. Making them editable requires such a
  store and is deferred to the OKR module's own product cycle.
- **EARS-475.** That page shall show the OKR module's **effective configuration**
  — the Plane workspace and the projects the dashboard reads, the period it
  currently displays, and the project → mission/order mapping it applies —
  obtained through a **named extension of `src/lib/okr`'s public API**: today
  `src/lib/okr/index.ts` exports `OKR_PERIOD` and `TEAM` but not
  `OKR_WORKSPACE`, not `OKR_PROJECTS` and not the Plane web base URL, so #315
  adds a single read-only accessor (`getOkrParameters()`) over the existing
  `src/lib/okr/config.ts` values and exports it from `index.ts`. Nothing else in
  the OKR module changes, and no caller reaches past `index.ts`.
- **EARS-476.** WHEN an admin opens that page, the cabinet shall call
  `getOkrTree()` and shall show **the module's current read state and when it was
  obtained**: success with that moment, or, IF the call fails or raises
  `OkrUnavailableError`, THEN the error it reports. The result is not stored
  anywhere — which is why no read-health store is needed. It is **not** a
  guaranteed fresh round-trip to Plane: `getOkrTree` is served through
  `src/lib/okr/cache.ts` and a hit inside `cacheTtlMs()` returns the cached read,
  so the page shows exactly the freshness the `/p/okr` dashboard itself is
  running on. That is the honest thing to show — the question the admin is asking
  is "what is the OKR module seeing right now", not "is Plane up this second" —
  and no cache bypass is added.

### H. Boundaries (`pnpm boundaries`)

- **EARS-456.** `pnpm boundaries` shall forbid a module from importing
  `src/lib/workspace/registry` while allowing it to import
  `src/lib/workspace/contract` (D-3).
- **EARS-457.** `pnpm boundaries` shall forbid anything outside
  `src/lib/workspace` and `src/app/(platform)` from importing the registry.
- **EARS-458.** `pnpm boundaries` shall forbid `src/ui` from importing any
  module, while any module may import `src/ui` (consolidation §10).

## Retired clause ids

Canon: `docs/specs/README.md` — «a split retires the old id and adds new ones,
so a reference never dangles». Seven were retired on 2026-08-25 by the
independent review of commit `358d350`; the eighth on the same day by the
owner's go decision on the placeholder tiles (D-13). None is ever reused.

| Retired  | Replaced by                  | Why                                                                                                                                    |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| EARS-411 | EARS-456, EARS-457, EARS-458 | bundled three independently testable boundary rules under one id, so a partial pass would look green                                   |
| EARS-419 | EARS-459, EARS-460           | bundled the revocation event with the "a grant needs no redeploy" property, which is not that event's consequence                      |
| EARS-420 | EARS-461, EARS-462           | required `platform-admin` on **every** `/api/p/*` handler, which locks plain members out of the member-facing half (consolidation §5)  |
| EARS-424 | EARS-404                     | duplicated EARS-404's treatment with a different subject; two ids for one rule drift apart                                             |
| EARS-426 | EARS-469, EARS-470           | bundled a ubiquitous rule (longest-prefix resolution) with a WHILE state (the `/p` home state)                                         |
| EARS-438 | EARS-472, EARS-473           | bundled a WHEN clause (the save answer) with an IF/THEN clause (the constraint refusal)                                                |
| EARS-454 | EARS-475, EARS-476           | required persisted read-health state that EARS-455 and Out of scope forbid, and configuration `src/lib/okr` does not export            |
| EARS-467 | EARS-477, EARS-478           | excluded the «портфель, позже» placeholder tiles; the owner ruled at the go (2026-08-25) that they ARE rendered, per the vendored file |

## Portfolio walk (discovery record behind EARS-413)

Each target app of consolidation spec §4 (revision -f) against the contract, as
walked during discovery. It is the reasoning that produced the contract; the
**proof** that the contract accommodates the portfolio is EARS-413's type-level
test, which compiles or does not. The hedges below («likely», «optional») are
honest about apps whose own product cycle has not run — none of them needs a
frame concept the contract does not already carry.

| Portfolio app                | Entry kind             | `status` provider         | `requiredClaim`  | `admin` section                   |
| ---------------------------- | ---------------------- | ------------------------- | ---------------- | --------------------------------- |
| Hours (`/p/hours`)           | internal               | yes — open period         | —                | yes — 4 items (EARS-446)          |
| OKR (`/p/okr`)               | internal               | yes — cycle progress      | —                | yes — 1 read-only item (EARS-453) |
| Finance (`/p/finance`, #115) | internal               | likely — unclosed month   | likely, later    | yes, its own spec                 |
| Decks (`/p/decks`, #118)     | internal, section root | optional                  | —                | likely — deck registry            |
| CRM                          | internal               | optional                  | likely, later    | yes                               |
| Task management              | internal or external   | optional                  | —                | depends on its discovery          |
| Team search & recruiting     | internal               | optional — open vacancies | likely, later    | yes                               |
| Project launch               | internal               | optional                  | —                | yes                               |
| Calculators & work tools     | internal               | no                        | —                | probably none                     |
| Mattermost integration       | external (today)       | n/a by type (EARS-401)    | —                | n/a by type                       |
| **Frame's own:** `/p/admin`  | internal (D-4)         | no                        | `platform-admin` | n/a (it _is_ the cabinet)         |
| **Frame's own:** Plane, KB   | external               | n/a by type               | —                | n/a by type                       |

The kinds in the table are what each app declares **once it exists**. Until it
does, six of them — Финансы, Колоды, CRM, Поиск команды, Запуск проекта,
Калькуляторы — are present on the home as `planned` placeholders (EARS-477).
Task management is the seventh not-yet-live row and is the one exception: the
external Plane entry already represents it on the home, so it carries no
placeholder (EARS-477). Shipping any of them is a swap of its own entry in the
composition root (D-13a).

Two contract limits are named rather than hidden. A module wanting a **family**
of tiles (calculators is the likely first) gets one entry in v1 and raises the
family question in its own product cycle — `311-product.md` settled this. And
module-controlled **grouping or ordering** of launcher tiles does not exist in
v1: order is registry order (EARS-422).

## CRUD check (task-cycle stage 1a)

Every form the cabinet renders, with the operations deliberately unsupported and
why. "Not supported" means absent from the screen (EARS-437), not present and
failing.

| Form                          | Create                                                       | Read                           | Update                                                             | Delete                                                                                      |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Member** (`members`)        | yes — name, email, role, timezone                            | list + record                  | yes — name, role, timezone, status; **email read-only** (EARS-443) | **not supported** — deactivate instead (EARS-442): FKs from hours history make delete a lie |
| **Member alias** (nested)     | yes — kind + value (+ note)                                  | list under the member          | yes                                                                | **yes** — an alias is a lookup row, not history (EARS-444)                                  |
| **Hours participant** (rates) | yes — upsert by email; unknown email creates a `member`      | list on `/p/hours` and cabinet | yes — fork, grade, name, role; email is the read-only key          | **not supported** — deliberate since spec 081 item 16; SQL escape hatch                     |
| **Hours period**              | yes — label + dates, ≥1 weekday                              | list with status               | yes — label/dates with recompute; refused while publication-locked | only while the period has no assessments (spec 081 item 16)                                 |
| **Hours assessment**          | **not supported** — the participant creates it on `/p/hours` | read-only summary              | **not supported** — re-saving is the participant's act (081)       | **not supported** — history is the product (124)                                            |
| **Hours publication**         | yes — preview then publish, one batch per period             | panel state                    | delivery updates the batch per spec 100                            | **not supported** — it is a delivery record                                                 |
| **Hours export**              | n/a — an action, not a resource (EARS-449)                   | the download itself            | n/a                                                                | n/a                                                                                         |
| **OKR source & parameters**   | **not supported** — no settings store in `core`              | yes — read-only page           | **not supported** — deploy-time configuration (EARS-455)           | **not supported** — nothing to delete                                                       |

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
   knowledge base. Below them, greyed and dashed, sit the six «портфель, позже»
   placeholders — Финансы, Колоды, CRM, Поиск команды, Запуск проекта,
   Калькуляторы — which carry no status line, do not respond to a click and
   cannot be reached by Tab. Clicking Plane opens a new tab and leaves `/p`
   where it was. No admin tile appears anywhere on the page and «View source»
   contains no mention of `/p/admin`. (EARS-402, EARS-404, EARS-422, EARS-423,
   EARS-468, EARS-477, EARS-478)
2. **The pulse.** _(agent, dev stand.)_ The Часы tile carries a live line naming
   the open period; the OKR tile carries its own. With the hours provider
   deliberately broken, the Часы tile still renders and still opens, the OKR
   line is unaffected, and the page does not hang. (EARS-406, EARS-407, EARS-408)
3. **Chrome everywhere.** From `/p` the member opens Часы: the same top bar now
   names Часы, offers the switcher, shows their own name and a sign-out. They
   switch straight to OKR without going home, then return home in one click; on
   `/p` the bar names no app. The switcher lists the apps they can open and no
   «портфель, позже» placeholder. Sign-out ends the session. (EARS-425, EARS-427,
   EARS-429, EARS-469, EARS-470, EARS-478)
4. **Membership is granted, not assumed.** The owner revokes `platform-user`
   from a test account in Zitadel. That account's next request to `/p` gets a
   bare refusal — no page, no explanation, no login loop. The owner grants the
   role back; the member enters, with no redeploy. (EARS-414, EARS-415, EARS-416,
   EARS-418, EARS-459, EARS-460)
5. **One grant for an admin.** An account holding **only** `platform-admin`
   opens `/p`, sees the Админка tile alongside the apps — dashed, flagged
   «только администратор» — and enters the cabinet. The six placeholders look
   exactly as they do for a plain member: a placeholder is not claim-gated.
   (EARS-404, EARS-417, EARS-468, EARS-478)
6. **The cabinet's shape.** `/p/admin` opens on an index of sections, not a
   dashboard, under the same top bar as the rest of the workspace. The left
   sidebar shows Участники, Часы and OKR as parent groups with their items
   visibly nested underneath; opening Периоды shows the breadcrumb
   `Админка / Часы / Периоды`. (EARS-431, EARS-432, EARS-433, EARS-434, EARS-435,
   EARS-440)
7. **The boundary is the server, and the host.** A member holding only
   `platform-user` types `https://portal.bbm.academy/p/admin` and is refused;
   they call `https://portal.bbm.academy/api/p/hours/admin/periods` directly and
   are refused as well, while `https://portal.bbm.academy/api/p/hours/periods`
   (a member-facing route) answers for them. The same admin URL asked of
   `https://cms.bbm.academy/api/p/hours/admin/periods` returns 404. (EARS-405,
   EARS-418, EARS-461, EARS-462, EARS-463, EARS-464)
8. **Members administration.** In the cabinet the admin finds a member by name,
   corrects their role, saves, and sees an explicit confirmation. No delete
   control exists anywhere on the screen — nor any other control that would fail
   on click; the admin deactivates the member instead, sees the status change,
   and sees that the member's hours participation is untouched. They add a
   Mattermost alias to that member, then try to add the same alias to a second
   member and get a refusal naming the first. The `email` field is not editable.
   (EARS-437, EARS-441, EARS-442, EARS-443, EARS-444, EARS-445, EARS-472,
   EARS-473)
9. **Attribution.** _(agent, database read.)_ After scenario 8, an agent reads
   `core.audit_event` for the owner; the rows for those edits name the admin's
   email and a cabinet source. (EARS-439)
10. **Hours administration moved, not rebuilt.** From the cabinet the admin
    creates a participant with a new email, sets fork and grade and sees the
    computed rate; edits a period's dates over existing assessments and gets the
    same recompute warning as before; opens a period's assessments and finds
    them readable but with no edit or delete control; downloads the JSON export
    and finds it identical in shape to yesterday's; opens the Mattermost panel
    and sees the preview. (EARS-446, EARS-447, EARS-448, EARS-449, EARS-450,
    EARS-451)
11. **The old admin is gone.** `https://portal.bbm.academy/p/hours/admin` and
    `https://portal.bbm.academy/p/hours/admin/export` both return 404, and
    neither redirects anywhere. `/p/hours` itself works unchanged. Neither
    `.env.example` nor `deploy/.env.prod.example` mentions `HOURS_ADMIN_EMAILS`,
    and the value still sitting in the live `deploy/.env.prod` grants nothing
    because no code reads it. (EARS-421, EARS-452)
12. **OKR has a cabinet section.** The sidebar's OKR group opens a single
    read-only page naming the Plane workspace and projects the dashboard reads,
    the period it displays and the mission/order mapping it applies, plus the
    module's current read state and the moment it was obtained (the same read the
    `/p/okr` dashboard is running on, cache included). There is no save button
    and no delete control, and the page states in one line why. (EARS-437,
    EARS-453, EARS-455, EARS-475, EARS-476)
13. **The tenth app costs what the third did.** _(agent, throwaway diff.)_ An
    agent adds a throwaway module declaring a tile, a required claim and an
    admin section with one resource, and shows the diff: only that module's own
    files plus one import and one array element in
    `src/lib/workspace/registry.ts` — zero lines changed in the launcher, the
    top bar or the cabinet shell. A second throwaway module declaring **no**
    admin section appears on the home and nowhere under `/p/admin`. Removing a
    declaration removes it from all three renderings. Deleting only the array
    element while leaving the module's declaration in place makes the test suite
    fail by name. The claim the first throwaway module declares is one that did
    not exist before, and the diff shows it cost no edit to the launcher, the top
    bar or the cabinet shell either — a new claim is registry data, not frame
    code. (EARS-401, EARS-402, EARS-403, EARS-409, EARS-410, EARS-412, EARS-466)
14. **Existing surfaces were not restyled.** `/p/okr` and `/p/hours` look as
    they did, apart from the new top bar above them. (EARS-429)
15. **Narrow viewport.** The member opens `/p` on a phone width: the grid
    reflows, every tile stays readable — the greyed placeholders included, still
    below the live apps — and the app switcher is reachable from a collapsed
    menu. (EARS-428, EARS-477)
16. **A full portfolio still reads.** On a stand seeded with a full-portfolio
    registry fixture — the ten apps of consolidation §4 as live `internal`
    entries, so no placeholder is left, plus the external entries and the
    cabinet — the home is still one readable flat grid at desktop and at narrow
    width, and the cabinet sidebar is still navigable with ten module groups.
    The same fixture is the evidence that promoting a placeholder costs one
    edit: the six «портфель, позже» tiles of scenario 1 are gone, and the
    launcher's own files are unchanged between the two fixtures. (EARS-471,
    EARS-474, EARS-477)

### Verified by CI, not by the owner

Seven clauses are machine-level by nature: there is no screen on which a
non-developer can observe them. They are named here so that "no scenario
exercises it" never means "nothing checks it" — each is covered by a test whose
title carries its id, per `docs/specs/README.md`. One of the seven (EARS-430) is
the exception the table states in its own row.

| Clause                       | Verified by                                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EARS-413                     | a type-level test constructing one declaration per portfolio app and compiling                                                                                                                                                               |
| EARS-456, EARS-457, EARS-458 | `pnpm boundaries` — three dependency-cruiser rules, one test each asserting the rule fires                                                                                                                                                   |
| EARS-465                     | the Host-matrix unit test over `evaluateRequest`, rows for `/api/p/*` × every host × mode                                                                                                                                                    |
| EARS-436                     | a handler/provider unit test on the shared zod schema                                                                                                                                                                                        |
| EARS-430                     | **nothing machine-checkable — the only clause in this spec with no automated assertion.** It is enforced by the review gate of `.claude/rules/design-process.md`: hand-rolled styles are a review stop-factor, which is a reviewer's verdict |

## Out of scope

- Provisioning the two roles in the dev and prod Zitadel, and assigning them to
  people — the operational half of #313; automatic assignment from `core` is
  Access Sync, epic #113.
- Any per-module role beyond the two starting ones. Finer claims arrive during
  operation through EARS-401's `requiredClaim` field, with no frame change
  (EARS-466; owner, 2026-08-24). `cms-editor` and the Payload SSO half of
  consolidation §14 item 3 stay open and belong to epic 4.
- Restyling the `/p/okr` and `/p/hours` bodies onto `src/ui` (EARS-429).
- The tokens and base components themselves — #312.
- Grouping, search, pinning, personalised ordering, notifications and global
  search on the home; any dashboard beyond one status line per tile.
- Anything a «портфель, позже» placeholder could grow into beyond a name and a
  caption (D-13a, EARS-478): no target, no route, no waitlist, no "notify me", no
  per-app copy, no ordering control. Which apps carry a placeholder is registry
  content, and a placeholder is retired by the app shipping (EARS-477).
- Caching or streaming of status lines (D-6 names the deferral).
- Editing OKR parameters or OKR records (EARS-455); a settings store in `core`;
  any persisted OKR read-health history (EARS-476 probes live instead).
- Any change to the OKR module beyond the one read-only accessor EARS-475 names.
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

**Opened while §B was built:** **#333** — the revocation half of EARS-459. #313
landed every other clause of §B and stopped there deliberately: the roles are
read once, at sign-in, and then ride the Auth.js JWT session cookie, so a revoke
performed in Zitadel is invisible to the platform until that session ends. The
grant direction (EARS-460) holds exactly as specced. «The next request from that
session» is not something a claim carried in a cookie can promise, and the fix is
a choice between a per-request IdP round trip, a bounded staleness window and an
amendment to the clause — an owner's call, not an implementer's. #333 carries it.

### Frame-level work that must be budgeted inside those issues

Named here because each is a change to a file outside the issue's obvious
surface, and an implementer who does not read this list discovers it mid-build.

| Work                                                                                                                                                                     | Issue    | Why it is not optional                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/platform/hostAllowlist.ts` — admit `/api/p/*` on the platform surface, exclude it from the CMS `/api/*` clause, extend the Host-matrix test (EARS-463…EARS-465) | **#315** | it is a prerequisite for the **first** `/api/p/*` handler to answer at all; #316/#317 inherit it. **#313** (access & roles) is the equally defensible home and takes it if #313 is planned first — whichever is planned first owns it, and this row is corrected then |
| `src/lib/okr/index.ts` — export one read-only `getOkrParameters()` accessor over `src/lib/okr/config.ts` (EARS-475)                                                      | **#315** | §G cannot be built from today's OKR public API                                                                                                                                                                                                                        |
| `src/lib/member/index.ts` — add member create, alias update and alias delete to the module's public API (EARS-441, EARS-444)                                             | **#316** | the cabinet must not reach past the module door to get them                                                                                                                                                                                                           |
| Rewrite or retire the five `HOURS_ADMIN_EMAILS` unit specs listed in EARS-421                                                                                            | **#317** | they assert the gate this spec deletes                                                                                                                                                                                                                                |

### Donor spec revisions (on touch — one donor file, one PR)

This spec retires clauses that live in **other** specs describing production.
`docs/specs/README.md` → Status model: changing a shipped behaviour **updates
the existing spec** in the same PR; leaving the donor untouched creates two
contradicting sources of truth, and the copy nobody edited is the one that
drifts. Each row is a required part of its PR, not a follow-up wish.

**One donor file, one amending PR.** Each row below names exactly one file and
exactly one issue, so no two PRs edit the same donor spec and there is no second
PR that could revert the first one's status-ladder change. Spec 124 loses two
clauses to two different issues, and both amendments are therefore taken **once,
in #317** — the later of the two — rather than split across #316 and #317: an
amendment is a single edit to one file's status ladder, and splitting it is what
creates the revert. **#317 therefore lands after #316**, which is the order the
epic already runs in (§E is the first tenant, §F the second); if that order ever
changes, this row moves with it rather than splitting.

| Donor spec                                       | What this spec changes in it                                                                                                                                                                                                                                                    | Landed by |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `docs/specs/124-hours-on-core.md`                | **both** clause retirements in one amendment: EARS-19 (SQL escape hatch until `/p/admin`) is retired by EARS-444 (behaviour lands in #316), and EARS-32 (`HOURS_ADMIN_EMAILS` re-check) is superseded by EARS-451 — amend both clauses and set the file's status per the ladder | **#317**  |
| `docs/specs/081-hours-calculator.md` (+#83/#85)  | the admin screen it describes is deleted (EARS-452); its administrative behaviour now lives in the cabinet — amend the affected sections to point at this spec                                                                                                                  | **#317**  |
| `docs/specs/100-hours-mattermost-publication.md` | the publication panel moves into the cabinet (EARS-450) — amend the surface it names                                                                                                                                                                                            | **#317**  |

</content>
