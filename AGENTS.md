# BBM Portal (Payload CMS) — Agent Context

> **Language rule:** All chat dialogue with the user MUST be in Russian. Code, code comments, commit messages, PR titles/descriptions, and this file are in English for universal agent compatibility. Product/content values are Russian.

## Project overview

This repository hosts **`bbm-portal`** — the **Payload CMS** (v3, native inside Next.js) that serves as the **headless content backend** for the BBM Academy public website (`bbm-public-website`, a separate Astro repo). It is also the **seed of the future BBM portal**: auth / personal cabinet (ЛК) and a blog/articles surface grow inside this same Next.js app later.

**Owner:** Anton Sidorov (founder, system architect, non-developer — works through AI agents).
**Hard legal constraint:** 152-FZ — any PII (e.g. future form leads) is stored/processed on Russian territory (Zone RF, Timeweb Cloud). The content this CMS serves today is non-PII editorial content.

The public website is a **consumer**: at build time it fetches collections via Payload's REST/GraphQL and emits static HTML. This repo owns the Payload install, admin UI, and database; the site does not. **Work that belongs to `bbm-public-website` is filed as an epic-linked GitHub issue from a bbm-portal session and implemented in a separate session run from that repo — do not start building it here** (see CLAUDE.md → "Cross-repo boundary").

## Accepted setup decisions (brainstorming kickoff, 2026-06-12)

Full rationale: `../bbm/docs/superpowers/plans/2026-06-11-bbm-portal-payload-setup.md`.

1. **Repo layout — single Next.js app at root.** Payload v3 is native inside Next.js; auth/ЛК/blog grow as routes/collections in this same app. Refactor to a monorepo only if a genuine second deployable appears (YAGNI).
2. **Postgres — dedicated `cms` database + own role; own container at start** (`@payloadcms/db-postgres`). Logical isolation is non-negotiable (Payload owns its schema/migrations). Physical consolidation into a shared cluster is a later cost-driven move; CMS stays in its own DB regardless.
3. **Media — `@payloadcms/storage-s3` + Timeweb Object Storage** (endpoint override + `forcePathStyle: true`, account-level S3 keys). Code lands in **BBMP-27**; do not use the local disk in production.
4. **Content model — structured/plain now, Markdown-rich for blog/articles later.** See _Content contract_ below.

## Content contract (the reason this CMS exists)

**The contract is fixed by code, not prose.** The job is: make Payload's REST/GraphQL output per collection/global **valid against the existing Zod schemas of the site**.

**Source of truth, by decreasing concreteness:**

1. **Golden fixtures — seed files** in `../bbm-public-website/src/content/` (real, validation-passing payloads; emit per-entry JSON of the same shape, field-for-field):
   - Collections: `publicProjects/*.json` (6, `id` = filename slug), `team/team.json` (array), `pages/*.json` (6: home/projects/about/contacts/privacy/participate).
   - Globals (singletons): `philosophy/philosophy.json`, `siteSettings/contact.json`, `siteSettings/siteChrome.json`.
2. **Schemas — exact type contract:** `../bbm-public-website/src/content/schemas.ts` + `content.config.ts`. Every per-field decision (enums, references, verbatim-vs-prose, nesting) lives here.
3. **PRD §7.2** — original field contract (background).

**Critical invariants** (violation → the site's `pnpm build` fails on Zod):

- **3 globals** (`philosophy`, `contact`, `siteChrome`) → Payload **globals**; `publicProjects`/`team`/`pages` → **collections**.
- **entry id = human-readable slug** (`home`, `doctor-school`), NOT Payload's uuid/numeric id.
- **references by slug-id:** `publicProjects.team → team.id`, `team.projects → project slug`.
- **Plain text for the typographer:** prose fields are stored/returned WITHOUT ёлочки/nbsp — the **site** applies RU micro-typography at its schema boundary (`prose()` / `typographize.ts`). The typographer and formatting are orthogonal; Payload holds plain strings. **Single exception:** `contact.legalEntity` is verbatim official ёлочки.
- **Exact enum-string parity:** `status`(active/launching/exploring/soon), `maturity`(rich/thin/soon), form `type`(text/email/tel/select/textarea), `visibility`, `locale`; verbatim tokens (`metrics.value`, role `code`, `icon`, every `href`, `socials`).
- **`locale`** in every schema (default `ru`) → map to Payload localization.

**Why "plain text" — and how the model evolves.** Formatting in today's model is expressed by **structure** (arrays of `{title, body}`, sections, faq), not inline rich text — so mirrored fields are plain `text`/`textarea`, and a Lexical-AST richText field would break the site's `z.string()` contract. **Blog/articles are a different, future collection** (own milestone): rich body carried as a **Markdown string** (NOT Lexical-AST → the field stays a valid string, the swap stays mechanical), Payload's richText editor in markdown mode, and the site renders markdown→HTML with the typographer running over text-nodes. Do not introduce Lexical-AST into the mirrored surfaces.

**Definition of done (portal-side):** hit each collection/global and get JSON that passes `schema.parse(...)` — exactly as `../bbm-public-website/tests/unit/content.test.ts` does (read seed → `schema.parse`). If the response shape equals the fixture shape, the consumer-side loader swap (`bbm-public-website#61`) is near-mechanical.

### Out of scope now: `leads` (form submissions → PII) — receiver DECIDED

Leads are **not** a content mirror — they are a **runtime PII receiver** (write-at-runtime, opposite data direction; never part of the build-time loader swap). 152-FZ applies: the site stores no PII and posts form JSON to an RF-hosted receiver (`PUBLIC_SUBMIT_LEAD_URL`, site seam #23). **Receiver = a `Leads` collection in THIS Payload app — already DECIDED** (ADR-001, `bbm-public-website#77`, 2026-06-12): public create-endpoint, storage in Payload's DB (contour PG cluster, db-per-service), notification `afterChange(create)` → **Mattermost webhook** to `chat.bbm.academy` (in-contour RF; hermes kz-1 and Resend US excluded for PII). A `leads` collection = public-write + access-control + anti-spam/rate-limit + retention. Built in its **own milestone** (`bbm-public-website#23`, depends on Payload-live), not in BBMP-25..32.

## Architectural authority

Framework/infra choices are fixed by the BBM Platform architecture spec — do not swap:

- **ADR-002 (`docs/adr/002-repository-and-module-strategy.md`, 2026-07-24)** — repository & module strategy: this repo is THE platform code repo (all custom BBM Platform modules live here; future rename `bbm-platform` at workspace conversion). New modules default to a route + isolated lib (modular monolith, machine-enforced boundaries); a separate deployable must be earned via explicit criteria. Portal end-user auth = **Zitadel `id.bbm.academy` (OIDC) from day one**; Payload native auth stays admin-only.
- **D-026** — Astro for the public site, **Next.js for the portal, Payload CMS as the headless content source.**
- **D-018** — dual-zone hosting; the portal (this repo, with PII surfaces later) runs in **Zone RF (Timeweb Cloud)**.
- **Hosting (2026-06-12):** BBMP-30 deploys to a **dedicated `portal-prod-tw` VPS — NOT co-located on `tools-prod-tw`** (internal tools host: Mattermost/Outline). Public PII service is isolated from internal tooling, per the estate's per-service failure-domain pattern. Terraform (`../bbm/infra/timeweb/terraform/portal.tf`) is written/applied by the agent — not a user-action.
  - **The agent owns host-ops on `portal-prod-tw`** (SSH alias `portal-prod-tw`, key `~/.ssh/portal-prod-tw`; see `deploy/README.md`): run deploys, migrations, and Caddy reloads/restarts **yourself** — do not hand the owner a checklist. Hand off a single step **only** when it provably requires GitHub/org/registry permissions the agent lacks (e.g. changing org package-visibility policy). "I don't have access" is a last resort, not a default — first restore the SSH config / fix key perms.
  - **Never repurpose a read-scoped service credential for a privileged prod write.** The `preview` service's Users API-key is full-admin but exists to _read drafts_; do not use it (or any service token) to drive `POST`/mutate endpoints as a shortcut. If a real bug makes the UI path fail, fix the bug — don't poke prod with a borrowed credential.
- `../bbm-public-website/docs/infrastructure-decisions.md` §6a (Payload/portal hosting), §6.
- `../bbm-platform-prd/docs/superpowers/specs/2026-04-07-bbm-platform-design.md` (D-026, D-018).

If a task seems to require a framework/content-source/infra change, stop and consult the authority first.

**Severity-gate before escalating a "security finding" to the owner.** The owner is a non-developer and cannot adjudicate an engineering tradeoff — a fake either/or just creates confusion. Before you write a finding up as a "gate" or fire an `AskUserQuestion`, classify the data at risk: **non-PII editorial/CMS content** (page drafts, copy, preview URLs) is **low** — state the industry-standard baseline (e.g. a public preview origin behind `noindex` + CSP `frame-ancestors` is normal) and **pick the architecturally-correct default yourself**. Escalate to the owner **only** when the data is PII/secret/embargoed, or there is a genuine either/or with no correct default.

## OKR module (`/okr`) — first dynamic platform module

**Anchor (BBMP-129 milestone):** PRD `../bbm/outputs/2026-07-22-okr-dashboard/2026-07-23-prd-plane-integration.md` · progress model §3 + Plane taxonomy §4 `../bbm/outputs/2026-07-22-okr-dashboard/okr-structure.md` · Plane structure cut `../bbm/outputs/2026-07-22-okr-dashboard/2026-07-23-update/plane-cut-spec.md` · tracking: GH #58 (P1 core, `BBMP-130`) → #59 (Zitadel OIDC gate, `BBMP-131`) → #60 (prod + Vercel retire, `BBMP-132`). Code: `src/lib/okr` + `src/app/(frontend)/okr` — reads self-hosted Plane (workspace `doctor-school`, projects DSG1–DSG5) read-only with a TTL cache; SSOT stays in Plane, the only module-owned facts are manual metric values (`metrics.yaml`). Module discipline per ADR-002: no imports from the CMS side (collections/globals/endpoints/payload config), enforced by dependency-cruiser in CI.

## Where to look first

1. `../bbm/docs/superpowers/plans/2026-06-11-bbm-portal-payload-setup.md` — the setup plan + accepted decisions + phase/session map.
2. `docs/payload-collections-spec.md` — target Payload model, 1:1 with the site contract (the implementation reference for BBMP-28).
3. `../bbm-public-website/src/content/schemas.ts` + the seed files — the SSOT of the contract.
4. `../bbm-public-website/AGENTS.md` — the consumer side (loader-swap invariant, typographer seam).
5. `node_modules/next/dist/docs/` — Next's own docs, shipped inside the installed package and therefore matching the version this repo actually runs. Read them before writing Next code: this repo is on Next 16, where APIs and conventions differ from what most training data contains. (Next offers to write this pointer into the file itself; that is switched off in `next.config.ts` — see the comment there for why.)

## Task management

**Two trackers, split by domain — do not default to one.** **Code/dev work for this repo lives in GitHub Issues** (`bbm-academy-org/bbm-portal`; `gh issue list/view`) — see CLAUDE.md, which is authoritative on tracker choice. **Plane holds organizational / strategic / cross-project tracking** (prefixes `BBMP-*`): workspace **`bbm`**, project **BBM Platform** (`e550afb5-ec05-4973-8456-49a74379ba2f`), module 🌐 Сайт/Портал/CMS, milestone **BBMP-24**. Use the `pp-plane` CLI / skill for Plane.

- CLI: target the bbm workspace with `--workspace bbm` on every command. **Gotcha:** the `relations` group ignores `--workspace` (1.0.0 bug) → use `PLANE_SLUG=bbm plane-pp-cli relations …` for bbm relations.
- Task workflow: on start → `In Progress`; on close → `Done` + a results comment (artifacts / what was done / what is unblocked).
- Phases & session map are in the setup plan. **This repo is the home for Phase 2 (BBMP-26..30) and the blog milestone.** Phase 1 (BBMP-25) was bootstrapped from the `bbm` repo session.

## Per-task workflow — task-cycle regulation (mandatory)

Every tracked task follows **`.claude/skills/task-cycle/SKILL.md`** (agreed in
issue #65): issue → session plan → **owner's explicit "go"** (handoff / task
text / config ≠ go) → implementation → independent review (`VERDICT:` on the
PR) → live-stand acceptance for owner-visible changes (**blocks merge**) →
autonomous merge (squash, delete branch) → close with a results comment +
deviations line. Key sub-rules the skill carries:

- **TDD — hard rule for platform-module code:** no production module code
  without a failing test first (the CMS mirror stays covered by the site's
  contract test).
- **Spec gate:** a new platform module / new user-facing behavior needs a
  light spec in `docs/specs/` approved by the owner BEFORE code — the "go" is
  given on the spec.
- Minor convention deviations land in `DEBT.md` (significant ones → issue).

## Code style

- **TypeScript strict** — no `any` without a written justification.
- Payload collections/globals live in `src/collections/` and `src/globals/`; keep one collection/global per file.
- Mirror the contract field-for-field — when unsure about a field, read the seed JSON and `schemas.ts`, do not invent.
- Conventional Commits, imperative mood; reference the GitHub issue (`(#N)` in the subject or `Refs #N` — the PR carries `Closes #N`). `Refs BBMP-N` only when the task genuinely is a Plane item.
- No comments narrating WHAT; comments only for non-obvious WHY.

## Dev quickstart

```bash
cp .env.example .env          # set PAYLOAD_SECRET (openssl rand -hex 32), point DATABASE_URL at the dev DB
pnpm install
pnpm migrate                  # apply migrations — `push: false`, so run this before dev
pnpm dev                      # admin at http://localhost:3000/admin
```

- **Node 22** (LTS) — pinned by `.nvmrc` / Dockerfile / CI. Payload's migrate CLI
  uses a tsx ESM loader that breaks on Node 23/24 (`node:crypto?tsx-namespace`
  ENOENT). `next dev` tolerates 24, but migrations need 22 — stay on 22.
- **Postgres `cms`** is a dedicated DB + `payload` role (decision #2). Migrations
  are the schema SSOT (`push: false`); where the container runs is a per-machine
  recipe (remote TrueNAS-over-SSH or local Docker) — see README → Database. After
  any collection/global change: `pnpm migrate:create <name>` → commit `src/migrations/*`.
- **pre-commit hook — install once, from the main checkout.** `simple-git-hooks`
  (via the `prepare` script) writes the hook to `<repo>/.git/hooks/pre-commit`,
  so `pnpm install` (or `pnpm exec simple-git-hooks` on its own) must run from
  the **main checkout** (`C:\Users\sidor\repos\bbm-portal`, the owner's), not
  from a session worktree (`.claude/worktrees/<N>`). Reason: a linked worktree's
  `.git` is a _file_, not a directory — `simple-git-hooks` tries to `mkdir` a
  `hooks/` folder under it and fails with `ENOTDIR`; `pnpm install` still exits
  0 (the error is caught, not rethrown), so this fails silently. Once installed
  in the main checkout, the hook **is** shared across every worktree (git
  resolves hooks through `commondir`, common to the whole repo) — one install
  covers all parallel dev-stand sessions; re-running `pnpm install` from a
  worktree afterwards is a harmless no-op, not a reset.
