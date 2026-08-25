# Prior-art inventory — BBM portal workspace (issue #311, epic #112)

Collected read-only from `bbm-portal` (this repo), `bbm/outputs` (sibling, owner Anton's
research repo), and `bbm-platform-prd` (sibling, unified-PRD repo). All repo paths below
are relative to the repo named in the passport unless given absolute.

## Live surfaces

**Passport:** `src/app/(platform)/**` — bbm-portal repo (this repo) — original (live source).

Route group `(platform)` under `src/app` is the whole platform surface, gated by a single
root layout:

- `src/app/(platform)/layout.tsx` — the ONLY OIDC gate (Zitadel via Auth.js `auth()`); every
  child page inherits it. Renders its own `<html>/<body>` (no `src/app/layout.tsx` above it).
  `dynamic = 'force-dynamic'` on every page so nothing is served from cache to an
  anonymous caller.
- `src/app/(platform)/p/okr/page.tsx` — thin mount of `src/modules/okr/view` (`OkrLayout` +
  `OkrView`), reads live data from Plane per request.
- `src/app/(platform)/p/hours/page.tsx` — hours self-assessment calculator; mounts
  `src/modules/hours/view/*`. Reads a JSON document via `@/lib/hours`, resolves the
  participant from the session email, renders participants table / calculator /
  summary / timeline explainer.
- `src/app/(platform)/p/hours/admin/page.tsx` + `.../admin/export/route.ts` — hours admin
  (period open/close, rate/grade edits, JSON export, Mattermost-publish panel). Gated by a
  separate `HOURS_ADMIN_EMAILS` allowlist checked in `isHoursAdmin`, fail-closed.
- `src/app/(platform)/api/auth/[...nextauth]/route.ts` — Auth.js/NextAuth route (Zitadel
  provider).
- `src/app/(platform)/platform.css` — the ONLY shared stylesheet of the group (UA reset only,
  see Modules/styling below).
- **No `/p/admin` route exists yet** — referenced only as a forward pointer in
  `src/lib/member/index.ts` ("Алиасов UI в этом цикле нет... Форма появится с `/p/admin`
  (эпик #112)").

**The `/p` launcher does not exist today.** There is no `src/app/(platform)/p/page.tsx`
(confirmed by full listing of the route group — only `p/okr`, `p/hours`,
`p/hours/admin` exist) and no launcher/app-list component anywhere in `src/` (grep for
`launcher`/`apps` across `src` returns nothing but incidental matches — CSS class names,
`hostAllowlist.ts` prose, `README.md`). Each app is reached today only by knowing its
direct URL (`/p/okr`, `/p/hours`); nothing enumerates "the apps" as data. There is
consequently no verbatim app-entry snippet to quote — **this is a gap, not a hidden
config**: issue #311 / epic #112 is presumably the first task to introduce that launcher,
and it starts from zero prior art, not from a list to migrate.

## Modules

**Passport:** `src/modules/*`, `src/lib/*` — bbm-portal repo — original (live source).

`src/modules/*` = view layer (React components + module-scoped CSS), `src/lib/*` = domain
logic + the DB layer. Module boundaries are machine-enforced by dependency-cruiser
(`pnpm boundaries`, BLOCK in CI) — a module's public interface is its `index.ts` only.

| Module                                           | Purpose                                                                                                 | Public interface                                                                                                                                                                                                         | UI                                                                                                | Routes                                                             | DB                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/okr` (`src/modules/okr/view`)           | OKR dashboard fed by Plane                                                                              | `getOkrTree`, `OkrUnavailableError`, `GRACE_DAYS`/`OKR_PERIOD`/`TEAM`, `expectedShare`/`inGracePeriod`, types                                                                                                            | Yes (`OkrLayout`, `OkrView`, `okr.css`)                                                           | none of its own (mounted at `/p/okr`)                              | none — reads Plane API live via `planeClient.ts`                                                                                   |
| `src/lib/hours` (`src/modules/hours/view`)       | Hours self-assessment / payout calculator (spec 081)                                                    | calendar helpers, `readHoursDocument`, `findParticipant`/`findOpenPeriod`/`findAssessment`, `effectiveHourlyRate`/`maxDeclarableHours`, `HoursDataError`, `sessionEmail`, `isHoursAdmin`, `buildMattermostPreview`, etc. | Yes (`HoursLayout`, `Calculator`, `AdminForms`, `ParticipantsTable`, `PeriodSelect`, `hours.css`) | `p/hours`, `p/hours/admin`, `p/hours/admin/export` (route handler) | JSON document on a volume (NOT the `platform` DB — explicit MVP decision, see owner brief below)                                   |
| `src/lib/member`                                 | Member registry (`core.member`/`core.member_alias`) — the single door other modules must use            | `upsertMemberWithAliases` and friends (per `src/lib/member/index.ts` docstring: "ЭТО ЕДИНСТВЕННАЯ ДВЕРЬ")                                                                                                                | No                                                                                                | No                                                                 | Yes — Postgres, schema `core`, table `member`/`member_alias`                                                                       |
| `src/lib/platform/db`                            | Platform Postgres persistence foundation (ADR-004, #125/#278)                                           | `client.ts`, `config.ts`, drizzle schema (`schema/core.ts`), migrations, `transaction.ts`                                                                                                                                | No                                                                                                | No                                                                 | Yes — owns schema `core`; two DB roles since #278 (`PLATFORM_DATABASE_URL` app role, `PLATFORM_MIGRATE_DATABASE_URL` migrate role) |
| `src/lib/platform/authGate.ts`                   | Pure gate-decision logic for the `(platform)` layout                                                    | `resolvePlatformGate`, `requiresSignIn`, `signInRedirect`                                                                                                                                                                | No                                                                                                | No                                                                 | No                                                                                                                                 |
| `src/lib/platform/hostAllowlist.ts`              | Host→surface allowlist (ADR-003) — default-deny across every host/path, enforced in `src/middleware.ts` | `evaluateRequest` (per docstring)                                                                                                                                                                                        | No                                                                                                | No                                                                 | No                                                                                                                                 |
| `src/lib/platform/health.ts`                     | Build-identity/health reporting (deploy truthful-success gate, #137)                                    | build sha reporting                                                                                                                                                                                                      | No                                                                                                | `(payload)/api/health/route.ts` uses it                            | No                                                                                                                                 |
| `src/lib/siteDispatch.ts`, `src/lib/siteSync.ts` | Cross-repo dispatch to `bbm-public-website` (site rebuild trigger / content sync)                       | not read in detail this pass                                                                                                                                                                                             | No (backend only)                                                                                 | Payload-side hooks (not under `(platform)`)                        | No                                                                                                                                 |

**`src/ui` does not exist.** No shared design-system/component-kit directory under `src/`.

**Styling approach today is ad-hoc CSS, not Tailwind.** No `tailwind.config.*` anywhere in
the repo root and no `tailwind` dependency in `package.json`. Each surface owns its own
plain CSS file: `src/app/(platform)/platform.css` (UA reset only, shared), plus
per-module `okr.css` and `hours.css` that each paint their own page background via
`body:has(.okr-root)` / `body:has(.hours-root)` selectors — a deliberate anti-bleed
pattern documented in `platform.css`'s own comment (spec 081 req.29: "no future surface
silently inherits the OKR palette... each module keeps its own copy of its own tokens").
There is no shared token file or component library across modules today.

## Owner briefs

**Passport:** `C:\Users\sidor\repos\bbm\outputs\*` — bbm repo (Anton's private research
repo, sibling) — original (Anton's own working notes/decisions), except where a file is
itself a stub pointing elsewhere (noted below).

Directory listing (full, ~90 entries) was enumerated; only files plausibly relevant to
the portal workspace / internal-apps portfolio were opened and summarized:

- **`2026-07-29-bbm-portal-hours-calculator-brief.md`** — the approved spec (ТЗ) behind
  the `/p/hours` module. States: hourly-pay mechanic (monthly rate ÷ weekdays×8), a
  1st/2nd/3rd-of-month cycle (self-assessment → Mattermost peer 👍/👎 → payout), storage
  is deliberately "no DB — a plain JSON document" for MVP, explicitly names bbm-portal as
  the implementation repo, and references a static HTML prototype
  (`bbm/outputs/2026-07-29-bbm-hours-calculator/index.html`) as the UI reference. Directly
  explains why `/p/hours` reads a JSON file rather than Postgres.
- **`2026-07-29-bbm-payout-mechanics.md`** — the canon for the payout/hours cycle that the
  hours-calculator brief implements; also references the finmodel (4x investor / 2x
  author / 1x team-pool split) and the "Three Paths" deck. Relevant as the business-rule
  source-of-truth behind `/p/hours`, not itself a UI/portal-scope document.
- **`2026-08-18-requirements-discovery-process/README.md`** — a draft process
  recommendation (BBMB-42, "discovery for AI-assisted development") diagnosing that AI
  sped up "build" but not "decide what to build"; relevant as process context for how this
  epic's discovery should be run, not as portfolio content.
- **`2026-08-20-ds-wireframe/`** (`screens.md`, `wireframe.html`) — belongs to the
  Doctor.School (`doctor-school/ds-platform`) discovery track (see next item), not the BBM
  portal; opened only to confirm scope, not summarized as portal prior art.
- **`2026-08-18-discovery-ds-academy-vs-doctors/`** — this whole directory is now a
  **stub**: its `requirements.md` states the master copy moved 2026-08-22 to the
  `doctor-school/ds-platform` repo (`apps/docs/content/specs/product/two-site-ia/
requirements-ru.md`); the historical version in `bbm/outputs` is retrievable only via
  `git show 38487fd:...`. Not portal-workspace scope — Doctor.School two-site IA — flagged
  here only to save a future pass from re-opening it.
- Not opened in this pass (present in the listing, plausibly adjacent but lower-priority
  given the epic's stated portfolio: hours/OKR/finance/CRM/team/projects/tools/
  communication): `2026-07-24-bbm-finmodel/`, `2026-07-27-bbm-three-paths/`,
  `2026-07-22-okr-dashboard/`, `2026-08-01-bbm-role-map-salary-ranges*.md`,
  `2026-08-03-bbm-utm-links/`, `2026-06-03-telegram-mattermost-import-feasibility.md`. A
  follow-up pass should open these if the discovery needs finance/team/comms detail beyond
  what the hours/payout briefs already carry.

## Platform PRD

**Passport:** `C:\Users\sidor\repos\bbm-platform-prd\output\bbm-platform-unified-prd.md`
— bbm-platform-prd repo (sibling; org-level PRD authored through that repo's own
interview/synthesis process) — original.

**Passport:** `C:\Users\sidor\repos\bbm-platform-prd\docs\superpowers\specs\
2026-04-07-bbm-platform-decision-log.md` — same repo — original.

### §4 Product vision (`bbm-platform-unified-prd.md` lines 58–90)

BBM Platform should become a modular system with two linked contours:

- **public contour** — introduction, registration, project showcase, managed entry;
- **internal contour** — knowledge, documents, projects, methodologies, internal content,
  authorship and contribution recording.

Target state: a single ecosystem where a project can exist as an initiative card before a
team forms, every project has a mandatory author and a managed history, authorship/
contribution/share-basis are recorded in the product contour, documents and methodologies
become part of BBM's shared memory, users can walk the full path from entry to
participation to project creation, and critical entities stay portable toward a future
Web3-grade provability model.

### Decision log D-001..D-029 (full list, no D-030+ found)

D-001 general system approach · D-002 architecture model · D-003 org model · D-004 first
stage (by May 2026) · D-005 contribution/Web3 recording · D-006 AI strategy · D-007 AI
orchestration · D-008 frontend _(superseded by D-026)_ · D-009 identity/SSO (Zitadel +
BBM↔DS federation) · D-010 messenger · D-011 file storage · D-012 video · D-013 hosting
(initial) · D-014 versioning · D-015 SSOT + docs-as-code · D-016 unified knowledge gateway
(RAG+graph) · D-017 CMS/admin platform · D-018 hosting — two-zone (152-FZ) · D-019 AI data
isolation · D-020 authorization layer (ReBAC, OpenFGA/SpiceDB) · D-021 search
(Manticore) · D-022 task tracker (Plane, self-hosted) · D-023 video conferencing (Zoom +
YouTube Live) · D-024 file storage (MinIO + Seafile) · D-025 event log/proof (PG hash
chain → blockchain) · D-026 frontend revisit (Astro + Next.js primary) · D-027
observability & security cross-cutting layer · D-028 access sync/provisioning · D-029
knowledge boundary (Seafile via allowlist).

### Portfolio overlap with the portal workspace (§8 scope, §9.3/9.4/9.7/9.8/9.9)

No section of this PRD is literally titled "Phase 8"/"Phase 9" — the closest structural
match is the in-scope functional list (§8.1) and its detailed requirements (§9), which is
where the "projects / contributions / marketplace" material the task asked about lives:

- **§9.3 Project as base entity** — a project must exist as a minimal initiative card:
  mandatory author, can exist before a team forms, has a public representation, and keeps
  continuous identity across stage transitions.
- **§9.4 Project showcase** — a public "marketplace of projects" (PRD's own wording,
  `output/bbm-platform-workstreams.md` "Направление 3. Витрина проектов" also names it
  "маркетплейс проектов как публичную витрину") — default-public unless moderation/
  sensitivity says otherwise.
- **§9.7 Authorship** — required at minimum for project, document, significant artifact;
  first-stage priority is project + document authorship, decisions/contributions come
  later.
- **§9.8 Contributions** — managed recording of participant contributions: describable,
  collectively confirmable/disputable, linked to participant+project+artifact, transparent
  basis for later share calculation. This is the PRD-level generalization of the
  hours-calculator's `/p/hours` split mechanic (owner brief above) — same shape (self-
  declare → peer-verify), broader scope (any contribution, not just hours).
- **§9.9 Primary share calculation** — explicitly "simple, transitional, partly manual" is
  acceptable for stage one; must be traceable and not block a later, more mature model.
  D-005 makes the same call for contributions generally: fix contribution+shares in the
  knowledge base now, leave room for a blockchain/Web3 layer later without a migration.
- **§8.2 explicitly out of scope**: no stack/DB/CMS/blockchain vendor pick, no full ERP on
  day one, no full legal share-rights model, no full on-chain authorship/contributions in
  v1, no in-house messenger/video/full toolset, not all modules required simultaneously,
  no final complex share formula.

**Read scope note:** only §4 and §8/§9 (scope + functional requirements touching projects/
authorship/contributions/shares) and the full decision-log headers were read this pass;
§§10–15 (scenarios, NFRs, acceptance criteria, open questions) were not opened and may
carry additional portfolio-relevant detail for a deeper pass.
