# Payload collections spec — target model (1:1 with the site contract)

**Date:** 2026-06-12
**Status:** implementation reference for **BBMP-28** (model collections/globals in Payload).
**SSOT it mirrors:** `../bbm-public-website/src/content/schemas.ts` + the seed files in `../bbm-public-website/src/content/`. The schemas + seeds are the spec; this doc is their projection onto Payload field types. When the two disagree, **`schemas.ts` wins** — re-read it.

> This is not "design a CMS from scratch." Payload's REST/GraphQL per surface must return JSON that passes the site's existing `schema.parse(...)` (same as `../bbm-public-website/tests/unit/content.test.ts`: read seed → parse). If the response shape equals the fixture shape, the consumer-side loader swap (`bbm-public-website#61`) is near-mechanical.

## Surfaces — 6 total

| Site (Zod)       | Payload kind           | Endpoint shape                | Seed fixtures                                                        |
| ---------------- | ---------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `publicProjects` | **Collection**         | array of entries, `id` = slug | `publicProjects/*.json` (6, id = filename)                           |
| `team`           | **Collection**         | array of entries              | `team/team.json` (array, id per member)                              |
| `pages`          | **Collection**         | array of entries, `id` = slug | `pages/*.json` (6: home/projects/about/contacts/privacy/participate) |
| `philosophy`     | **Global** (singleton) | one entry                     | `philosophy/philosophy.json`                                         |
| `contact`        | **Global** (singleton) | one entry                     | `siteSettings/contact.json`                                          |
| `siteChrome`     | **Global** (singleton) | one entry                     | `siteSettings/siteChrome.json`                                       |

## Cross-cutting invariants (apply to every surface)

1. **entry id = human-readable slug** (`home`, `doctor-school`), NOT Payload's uuid/numeric id. Add a `slug` text field (unique, indexed) and serve it as the identity consumers key on; map references to it.
2. **`locale`** in every schema (default `ru`, enum `['ru','en']`). Map to Payload localization OR carry an explicit `locale` select field returning `'ru'`. v1 only ever emits `ru`.
3. **Plain text for the typographer.** prose fields are stored/returned WITHOUT ёлочки/nbsp — the **site** applies RU micro-typography at its schema boundary. So mirrored prose fields are Payload `text` / `textarea`, **never** `richText` (Lexical-AST). **Single verbatim exception:** `contact.legalEntity` keeps official ёлочки.
4. **Exact enum-string parity** — see the enum tables per surface. Use Payload `select` with exactly these `value` strings.
5. **Verbatim tokens stay plain** (`name`, `code`, `icon`, every `href`, `socials.*`, `metrics.value`, `trust.stats.value`, `nav[].label`, `copyright`). These are identifiers/figures, not copy — never typographed on the site, so store them raw.
6. **Optional means omit, not null.** thin/soon projects and page-specific blocks validate by ABSENCE (no fabricated data). A field with no seed value must be omitted from the response, not returned as `null`/`""`.

---

## Collection: `publicProjects`

`id` = slug. Source: `projectSchema` (schemas.ts:128).

| Field         | Payload type                              | Notes                                                             |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `name`        | text (required)                           | VERBATIM (brand name)                                             |
| `tagline`     | text (required)                           | prose (plain)                                                     |
| `direction`   | text (required)                           | prose (plain)                                                     |
| `status`      | select (required)                         | enum: `active` / `launching` / `exploring` / `soon`               |
| `maturity`    | select (required)                         | enum: `rich` / `thin` / `soon` — independent axis from status     |
| `description` | textarea (optional)                       | prose                                                             |
| `disclaimer`  | textarea (optional)                       | prose                                                             |
| `metrics`     | array (optional)                          | each `{ label: text(prose), value: text(VERBATIM) }`              |
| `team`        | relationship → `team`, hasMany (optional) | **serialize to team slug-id**, not Payload internal id            |
| `media`       | group (optional)                          | `{ logo: text(optional) }` — string path for now (see Decision A) |
| `nextStep`    | group (optional)                          | `{ label: text(prose), href: text(VERBATIM, optional) }`          |
| `related`     | array of text (optional)                  | project slugs                                                     |
| `visibility`  | select, default `public`                  | enum: `public` / `restricted`                                     |
| `locale`      | select, default `ru`                      | enum: `ru` / `en`                                                 |

## Collection: `team`

Source: `teamSchema` (schemas.ts:201). Each member has its own id.

| Field      | Payload type                                        | Notes                                                  |
| ---------- | --------------------------------------------------- | ------------------------------------------------------ |
| `name`     | text (required)                                     | VERBATIM                                               |
| `initials` | text (optional)                                     | VERBATIM (glyph token)                                 |
| `role`     | text (optional)                                     | prose                                                  |
| `bio`      | textarea (optional)                                 | prose                                                  |
| `photo`    | text (optional)                                     | path string (see Decision A)                           |
| `projects` | relationship → `publicProjects`, hasMany (optional) | **serialize to project slug**                          |
| `socials`  | array (optional)                                    | each `{ label: text(VERBATIM), href: text(VERBATIM) }` |
| `locale`   | select, default `ru`                                | —                                                      |

## Collection: `pages`

`id` = slug. Source: `pageSchema` (schemas.ts:410). **Generic** fields + many **optional page-specific blocks**.

> **Modeling rule (resolution of the "nested Pages" open decision):** each page-specific block is a **named optional `group` field** (`hero`, `about`, `trust`, …) — **NOT** a polymorphic `blocks`/`layout` array. The consumer reads `data.hero`, `data.about` by key; a `blocks` array would emit `layout: [{ blockType }]` and fail `schema.parse`. Preserve the exact nesting the Zod schema reads.

**Generic fields (all pages):**

| Field       | Payload type         | Notes                                                            |
| ----------- | -------------------- | ---------------------------------------------------------------- |
| `title`     | text (required)      | prose                                                            |
| `body`      | textarea (optional)  | prose                                                            |
| `seo`       | group (optional)     | `{ title: text(prose, opt), description: textarea(prose, opt) }` |
| `faq`       | array (optional)     | each `{ question, answer }` (prose)                              |
| `pathSteps` | array (optional)     | each `{ title, body }` (prose)                                   |
| `locale`    | select, default `ru` | —                                                                |

**Page-specific optional groups** (each present only on the pages that use it; omit elsewhere):

| Group         | Shape (all copy = prose/plain; tokens VERBATIM)                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hero`        | `eyebrow`, `sticker?`, `titleLead`, `titleMark?`, `titleTrail?`, `lead`, `primaryCta`, `secondaryCta?`, `chips?[]`, `proofLabel`, `proofItems[]{ icon(VERBATIM), title, body }` |
| `whatIs`      | `eyebrow`, `title`, `paragraphs[]`                                                                                                                                              |
| `showcase`    | `eyebrow`, `title`, `lead?`, `allLink?(cta)`                                                                                                                                    |
| `intro`       | `eyebrow`, `title`, `lead?`, `actions?[](cta)`                                                                                                                                  |
| `filters`     | `label`, `allLabel`                                                                                                                                                             |
| `about`       | `whatIs(secIntro + paragraphs?)`, `goal`, `values`, `principles`, `approach`, `roles` (each secIntro), `goalKicker`, `missionKicker`, `approachNote?{title,body}`               |
| `pathIntro`   | `eyebrow`, `title`, `lead?`                                                                                                                                                     |
| `trust`       | `eyebrow`, `title`, `lead?`, `stats[]{ value(VERBATIM), label, sub?, tone?(enum default/teal/empty) }`                                                                          |
| `contour`     | `eyebrow`, `title`, `public{kicker,title,items[]}`, `internal{kicker,title,items[]}`, `boundary`                                                                                |
| `faqIntro`    | `eyebrow`, `title`                                                                                                                                                              |
| `contacts`    | `eyebrow`, `title`, `lead?`, `boundary?{icon(VERBATIM),label,value}`, `note?`                                                                                                   |
| `team`        | `eyebrow`, `title`, `lead?`                                                                                                                                                     |
| `participate` | `roles?{id(slug),eyebrow,title,lead?}`, `noScript{message,linkText,contactsLinkText}`, `forms[]` (see lead-form shape)                                                          |
| `privacy`     | `draftNote{label,body}`, `sections[]{id(slug),heading,paragraphs[]}`, `operator{id(slug),heading,paragraphs[]}`, `consent{anchor(slug),label,text[]}`                           |
| `cta`         | `title`, `lead?`, `primaryCta`, `secondaryCta?`                                                                                                                                 |

Shared sub-shapes:

- **`cta`** = `{ label: text(prose), href: text(VERBATIM, optional) }`.
- **`secIntro`** = `{ eyebrow, title, lead? }` (prose).
- **`slug`** fields (`participate.roles.id`, `privacy.sections[].id`, `privacy.operator.id`, `privacy.consent.anchor`, lead-form `id`) — anchor-safe kebab `^[a-z][a-z0-9-]*$`, VERBATIM link targets. Enforce the regex.
- **lead form** (`leadFormSchema`, schemas.ts:354): `id(slug)`, `scenario(VERBATIM)`, `eyebrow`, `title`, `lead?`, `fields[]`, `consentLabelLead`, `consentLinkText`, `consentValidationMessage`, `submitLabel`, `states{success,error,unavailable each {title,body}}`, `note?`.
- **form field** (`formFieldSchema`, schemas.ts:326): `name(VERBATIM)`, `type(enum text/email/tel/select/textarea)`, `label`, `placeholder?`, `hint?`, `required?`, `full?`, `autocomplete?(VERBATIM)`, `validationMessage?`, `options?[]{value(VERBATIM),label}`, `placeholderOption?`.

---

## Global: `philosophy`

Source: `philosophySchema` (schemas.ts:173).

| Field              | Payload type         | Notes                                                                                          |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| `evolutionaryGoal` | textarea             | prose                                                                                          |
| `mission`          | textarea             | prose                                                                                          |
| `values`           | array                | each `{ title, body, icon(VERBATIM) }`                                                         |
| `principles`       | array                | each `{ title, body }`                                                                         |
| `tealPillars`      | array                | each `{ title, body, icon(VERBATIM) }`                                                         |
| `roles`            | array                | each `{ code(VERBATIM), icon(VERBATIM), share(prose), extra(prose), body(prose), hot?(bool) }` |
| `locale`           | select, default `ru` | —                                                                                              |

## Global: `contact`

Source: `contactSchema` (schemas.ts:232). **No prose fields** — all VERBATIM.

| Field         | Payload type         | Notes                                                               |
| ------------- | -------------------- | ------------------------------------------------------------------- |
| `email`       | text (required)      | VERBATIM                                                            |
| `phone`       | text (optional)      | VERBATIM                                                            |
| `socials`     | array (optional)     | each `{ label, href }` VERBATIM                                     |
| `legalEntity` | text (optional)      | **VERBATIM with official ёлочки** — the one place ёлочки are stored |
| `domain`      | text (optional)      | VERBATIM                                                            |
| `locale`      | select, default `ru` | —                                                                   |

## Global: `siteChrome`

Source: `siteChromeSchema` (schemas.ts:278).

| Field           | Payload type         | Notes                                                              |
| --------------- | -------------------- | ------------------------------------------------------------------ |
| `nav`           | array                | each `{ label(VERBATIM — active-state key), href(VERBATIM) }`      |
| `loginLabel`    | text                 | prose                                                              |
| `loginHref`     | text                 | VERBATIM                                                           |
| `ctaLabel`      | text                 | prose                                                              |
| `ctaHref`       | text                 | VERBATIM                                                           |
| `footerTagline` | text                 | prose                                                              |
| `footerColumns` | array                | each `{ heading(prose), links[]{ label(prose), href(VERBATIM) } }` |
| `copyright`     | text                 | VERBATIM (brand/legal line)                                        |
| `locale`        | select, default `ru` | —                                                                  |

> Note: the footer contact-email mailto is **not** stored in `siteChrome` — the site injects it at runtime from `contact` (single source, site #70). Do not duplicate it into this global's seed.

---

## Two decisions to take explicitly during BBMP-28

**Decision A — media pipeline.** `media.logo`, `team.photo`, avatars are currently **optional path strings, with no seeds** (no logo/photo assets exist yet). Options: keep them as plain string paths now (zero-risk, matches today's contract) vs. switch to a Payload `upload`/Media relationship returning a URL. **Recommendation:** keep plain string paths for the swap (the site's Zod expects `z.string()`); revisit a Media-upload pipeline when real logo/photo assets land — that's also where `@payloadcms/storage-s3` (BBMP-27) becomes load-bearing.

**Decision B — nested Pages modeling.** Resolved above: **named optional `group` fields**, not a polymorphic `blocks` array, to preserve the exact `data.<key>` shape `schema.parse` reads. Slug fields enforce the anchor-safe regex.

## Definition of done (BBMP-28)

For each of the 6 surfaces, fetch it and confirm the JSON passes the corresponding `schemas.ts` validator with the real seed values — ideally a small parity test that reads a seed fixture, posts/seeds it, fetches it back, and runs `schema.parse`. Mechanical loader swap on the site side is the acceptance signal.
