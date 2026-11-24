---
paths:
  - 'src/collections/**'
  - 'src/globals/**'
  - 'src/fields/**'
  - 'src/endpoints/**'
  - 'src/hooks/**'
  - 'src/migrations/**'
  - 'src/seed/**'
  - 'src/payload.config.ts'
  - 'src/lib/siteSync.ts'
  - 'src/lib/siteDispatch.ts'
  - 'docs/payload-collections-spec.md'
---

<!-- READ-ON-DEMAND (`paths:` frontmatter, so not always-on). The frontmatter must stay the first bytes of the file. Indexed in AGENTS.md §0. -->

# CMS content contract — the reason this CMS exists

Payload v3 serves the public website (`bbm-public-website`, Astro) as its
headless content backend. Read this before touching any collection, global,
field, endpoint, hook or migration on the CMS side.

## Accepted setup decisions (brainstorming kickoff, 2026-06-12)

Full rationale: `../bbm/docs/superpowers/plans/2026-06-11-bbm-portal-payload-setup.md`.

1. **Repo layout — single Next.js app at root.** Payload v3 is native inside Next.js; auth/ЛК/blog grow as routes/collections in this same app. Refactor to a monorepo only if a genuine second deployable appears (YAGNI).
2. **Postgres — dedicated `cms` database + own role; own container at start** (`@payloadcms/db-postgres`). Logical isolation is non-negotiable (Payload owns its schema/migrations). Physical consolidation into a shared cluster is a later cost-driven move; CMS stays in its own DB regardless.
3. **Media — `@payloadcms/storage-s3` + Timeweb Object Storage** (endpoint override + `forcePathStyle: true`, account-level S3 keys). Do not use the local disk in production.
4. **Content model — structured/plain now, Markdown-rich for blog/articles later.** See below.

## The contract is fixed by code, not prose

The job: make Payload's REST/GraphQL output per collection/global **valid against the existing Zod schemas of the site**.

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
- **Plain text for the typographer:** prose fields are stored/returned WITHOUT ёлочки/nbsp — the **site** applies RU micro-typography at its schema boundary (`prose()` / `typographize.ts`). Payload holds plain strings. **Single exception:** `contact.legalEntity` is verbatim official ёлочки.
- **Exact enum-string parity:** `status`(active/launching/exploring/soon), `maturity`(rich/thin/soon), form `type`(text/email/tel/select/textarea), `visibility`, `locale`; verbatim tokens (`metrics.value`, role `code`, `icon`, every `href`, `socials`).
- **`locale`** in every schema (default `ru`) → map to Payload localization.

**Why plain text — and how the model evolves.** Formatting today is expressed by **structure** (arrays of `{title, body}`, sections, faq), not inline rich text, so mirrored fields are plain `text`/`textarea`; a Lexical-AST richText field would break the site's `z.string()` contract. **Blog/articles are a different, future collection** (own milestone): rich body carried as a **Markdown string** (not Lexical-AST, so the field stays a valid string and the swap stays mechanical), Payload's richText editor in markdown mode, and the site renders markdown→HTML with the typographer running over text nodes. Do not introduce Lexical-AST into the mirrored surfaces.

**Definition of done (portal side):** hit each collection/global and get JSON that passes `schema.parse(...)` — exactly as `../bbm-public-website/tests/unit/content.test.ts` does (read seed → `schema.parse`). If the response shape equals the fixture shape, the consumer-side loader swap (`bbm-public-website#61`) is near-mechanical.

Code style for this side: one collection/global per file in `src/collections/` and `src/globals/`; mirror the contract field-for-field — when unsure about a field, read the seed JSON and `schemas.ts`, do not invent. After any collection/global change: `pnpm migrate:create <name>` → commit `src/migrations/*` (migrations are the schema SSOT, `push: false`).

## `leads` (form submissions → PII) — receiver DECIDED

Leads are **not** a content mirror — they are a **runtime PII receiver** (write-at-runtime, opposite data direction; never part of the build-time loader swap). 152-FZ applies: the site stores no PII and posts form JSON to an RF-hosted receiver (`PUBLIC_SUBMIT_LEAD_URL`, site seam #23). **Receiver = a `Leads` collection in THIS Payload app** (ADR-001, `bbm-public-website#77`, 2026-06-12): public create-endpoint, storage in Payload's DB (contour PG cluster, db-per-service), notification `afterChange(create)` → **Mattermost webhook** to `chat.bbm.academy` (in-contour RF; hermes kz-1 and Resend US excluded for PII). A `leads` collection = public-write + access-control + anti-spam/rate-limit + retention.

## Where to look first

1. `../bbm/docs/superpowers/plans/2026-06-11-bbm-portal-payload-setup.md` — the setup plan + accepted decisions + phase/session map.
2. `docs/payload-collections-spec.md` — target Payload model, 1:1 with the site contract.
3. `../bbm-public-website/src/content/schemas.ts` + the seed files — the SSOT of the contract.
4. `../bbm-public-website/AGENTS.md` — the consumer side (loader-swap invariant, typographer seam).
