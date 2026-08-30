---
status: In dev
issue: 124
updated: 2026-08-30
---

# /p/hours on the `core` schema — data model & migration off JSON — spec (issue #124)

- **Issues:** #124 (spec task), #111 (epic), #255 (implementation), #256 (cutover); #201 (edit audit, adjacent).
- **Owner acceptance:** Anton, session 2026-08-17 (recorded on #124).

**Cabinet amendment, issue #317 (owner GO 2026-08-30).** Storage and domain
semantics below do not change. Their administrative surface moves to
`/p/admin/hours/*` under claim-gated `/api/p/hours/admin/*` handlers. EARS-19
and EARS-32 are superseded as stated inline; the old `/p/hours/admin` routes
are deleted per spec 311 EARS-452.

## Why

`/p/hours` runs on a single JSON document on a Docker volume — an MVP stopgap
(spec 081 §12–18). The platform now has a real persistence layer (#125: database
`platform`, schema `core`, own migration pipeline), and the consolidation spec
makes `core` the master of operational data. This spec designs the hours data
model on `core`, the shared `member` entity it references, and the one-time
migration off JSON — **with no product change**: the owner's decision in session
2026-08-11 is «тот же продукт на core», extensions are separate tasks later.

## Prior decisions

- **ADR-002 §3** — hours stays a module of the monolith; it owns its data and
  exposes a public API; no new deployable.
- **ADR-003 §1, §3(a)** — the surface stays `portal.bbm.academy/p/hours` behind
  the Zitadel gate; topology and middleware unchanged.
- **ADR-004 §3, §6** (PR #190, review-approved; merge pending CI infra) — tables
  appear only through `pnpm platform:migrate:generate` into
  `src/lib/platform/db/schema/<module>/`; a module may import only its own
  table directory; routes import no tables at all; `PLATFORM_DATABASE_URL` has
  no fallback to `DATABASE_URL`.
- **Consolidation spec §4** (`docs/superpowers/specs/2026-08-04-platform-consolidation-design.md`)
  — `member` shape (surrogate PK, unique `@bbm.academy` email as attribute,
  slug, name, role, status, timezone); hours tables reference `member` by FK;
  `hours.json` becomes a frozen archive after migration.
- **Spec 081** (+ revisions #83, #85) and **spec 100** — the behavioral canon of
  the surface: formulas, access rules, forms, publication flow. This spec does
  not restate them and does not change them.
- **Owner decisions, session 2026-08-11** (recorded on issue #124): same product
  on core; `member` is seeded once, by hand, with consolidated data from the
  existing systems (~11 people ± 2) — no automated merge machinery (this
  supersedes consolidation §4's «наполняется разовой миграцией» wording); the
  fate of `team.yaml` after mastership moves to `core.member` is deferred
  (trigger: epic #113); `member` carries a list of **aliases** — the person's
  accounts and ids in external systems (phone, Telegram, Instagram, Mattermost
  id/email, Zoom id, personal email, …) for recognition cases such as meeting
  transcripts («dobroyar» → Игорь Пирогов); field-level **edit audit** is wanted
  but lands as a separate task (#201) adopting the ds-platform spec-010
  mechanics, out of this spec's scope.

## Requirements

### Data model — schema `core`

- **EARS-1.** The platform shall store hours data in `core` tables owned by the
  hours module (`src/lib/platform/db/schema/hours/`: `hours_participant`,
  `hours_period`, `hours_assessment`, `hours_publication`) and the shared
  `member` + `member_alias` tables owned by a new member module (tables in
  `src/lib/platform/db/schema/member/`, module code in `src/lib/member/`), all
  created exclusively through `pnpm platform:migrate:generate` migrations.
- **EARS-2.** The `member` table shall carry: surrogate integer PK, `slug`
  (unique), `email` (unique; normalization enforced at DB level:
  `CHECK (email = lower(btrim(email)))` — the SQL escape hatch must not be able
  to detach a person from their rate the way a hand-typed
  `Anton@BBM.Academy` could), `name`, `role` (nullable), `status`
  (`active | inactive`), `timezone` (IANA), timestamps. Money attributes shall
  NOT live on `member`.
- **EARS-3.** The hours money attributes — `fork_min`, `fork_max` (₽/month),
  `grade` (`I | II | III`), all nullable — shall live on `hours_participant`,
  whose PK is the FK to `member`. A member without a `hours_participant` row is
  not an hours participant (today's «тебя нет в списке участников» mode).
- **EARS-4.** `hours_assessment` shall keep one row per (`period`, `member`)
  (unique constraint; saves are upserts on that key) with today's value domains
  preserved exactly: `hours`, `weekend_hours`, `method`, `split_percent`, and
  the frozen snapshots (`monthly_rate` nullable, `hourly_rate` unrounded float,
  `accrual`, `cash_amount`, `invest_amount`, `weekday_count`), plus `saved_at`.
  Snapshots remain fixed numbers — spec 081 §15 semantics are unchanged.
- **EARS-5.** `hours_period` shall carry `id` (text PK — today's ids are
  preserved so migrated history keeps its identifiers), `label`, `date_from`,
  `date_to`, `status` (`open | closed`); the database shall enforce «at most
  one open period» (partial unique index on `status = 'open'`), replacing the
  JSON-level check with a structural guarantee.
- **EARS-6.** `hours_publication` shall carry the spec-100 publication record —
  `period` (FK, **UNIQUE**: at most one batch per period, today enforced even
  by the file reader), `status`, `started_at`, `published_at`,
  `preview_fingerprint` — with the message batch as a `jsonb` array column.
  The batch is **not** write-once: per spec 100 delivery updates it up to N
  times (per-message `delivery` + `sent_at`, by index, strictly sequential),
  so the array's element order and length shall be stable across updates. A
  `sending` batch surviving a crash still blocks a new batch and still locks
  period mutations (spec 100 req. 12/15). `jsonb` is deliberate: the batch is a
  delivery protocol artifact, never queried relationally.
  **Amended 2026-08-20 (#281, spec 201 EARS-31 step 4):** the `jsonb` array
  column is GONE — `core.hours_publication` now carries `period_id`, `status`,
  `started_at`, `published_at`, `preview_fingerprint` and nothing else. The
  messages are rows of `core.hours_publication_message`, keyed
  `(period_id, position)`, since the expand of #274; this release is the
  contract half that dropped the column
  (`src/lib/platform/db/migrations/0005_hours_publication_drop_messages.sql`,
  run as a separate release per `docs/runbooks/migrations-expand-contract.md`).
  **The reason «`jsonb` is deliberate» was overturned rather than forgotten:**
  the sentence above is right that the batch is a delivery-protocol artifact
  never queried relationally, and that argument simply lost to a bigger one.
  Under the audit ledger of spec 201 a column rewritten WHOLE on every delivery
  step produces an audited diff saying «everything changed» once per message,
  carrying frozen message texts and per-member delivery data into an
  append-only ledger nothing can redact (EARS-31, EARS-33). Normalised, a
  delivery step updates ONE row and the ledger records one small diff naming
  `{"period_id": …, "position": …}`.
  Everything else in this clause stands unchanged: still at most one batch per
  period (now the parent's PK), still not write-once, still per-message
  `delivery` + `sent_at` applied strictly sequentially, still stable order and
  length across updates — the element order EARS-21 speaks of is now the stored
  `position` rather than an array index, and a `sending` batch that survives a
  crash still blocks a new batch and still locks period mutations.
- **EARS-17.** The member module shall own a `member_alias` table
  (`schema/member/`): surrogate PK, FK to `member` (`ON DELETE CASCADE`),
  `kind` (open-set text; documented vocabulary in the module, stored
  lower-snake: `phone`, `telegram`, `instagram`, `mattermost_id`,
  `mattermost_email`, `zoom_id`, `email_personal`, …), `value`, optional
  `note`. Uniqueness shall be enforced at DB level on the **normalized
  expression** (`kind`, `lower(btrim(value))`) so the SQL-only write path of
  this cycle cannot bypass normalization; a duplicate normalized value under
  the same kind is refused — a handle that maps to two people has no useful
  answer. A member may hold several aliases of the same kind. The canonical
  `@bbm.academy` email stays on `member` and is not duplicated as an alias.
- **EARS-18.** The member module's public API shall resolve a member by
  (`kind`, `value`) across `member_alias` **and** by the canonical
  `@bbm.academy` email on `member` (virtual kind `email`), normalizing the
  lookup input the same way the unique index normalizes storage
  (`lower(btrim(value))` — «Dobroyar» finds `dobroyar`), and shall list a
  member's aliases — the recognition contract for consumers such as
  meeting-transcript processing («dobroyar» → the member's name).
- **EARS-19 (superseded by spec 311 EARS-444, #316).** The temporary SQL-only
  alias maintenance ended when the member cabinet shipped create/update/delete
  alias controls. The manual seed remains valid historical bootstrap data.

#### Column types (the digit-for-digit contract lives here)

| Column                                                          | Type                                 | Why                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hours_period.date_from`, `date_to`                             | `text` (ISO `YYYY-MM-DD`)            | `calendar.ts` is built to NEVER parse `Date` (081 §1: timezone-shift bug); node-postgres returns a `date` column as local-midnight JS `Date` — a one-day weekday shift moves every rate and accrual. Lexical ISO ordering also feeds `date_from ≤ date_to` and overlap checks. |
| `hours`, `weekend_hours`                                        | `double precision`                   | fractional by construction: `round1()` steps, weekend slider `step 0.5`, week tab multiplies by `weekdays/5`.                                                                                                                                                                  |
| `hourly_rate` (snapshot)                                        | `double precision`                   | the UNROUNDED effective rate (e.g. `400000/344 = 1163.0465116279069`); `numeric` re-serializes differently and breaks the export diff and recompute parity.                                                                                                                    |
| `split_percent`                                                 | `double precision`                   | server accepts fractional 0–100 even though the slider steps by 1.                                                                                                                                                                                                             |
| `monthly_rate` (snapshot)                                       | `integer`, nullable                  | `Math.round` output; null = «только часы» mode.                                                                                                                                                                                                                                |
| `accrual`, `cash_amount`, `invest_amount`                       | `integer`                            | `Math.round` outputs (081 §6 rounding order).                                                                                                                                                                                                                                  |
| `weekday_count`                                                 | `integer`                            | count.                                                                                                                                                                                                                                                                         |
| `fork_min`, `fork_max`                                          | `integer`, nullable                  | ₽/month integers.                                                                                                                                                                                                                                                              |
| `saved_at`, `started_at`, `published_at`, per-message `sent_at` | `text` (ISO-8601 as `toISOString()`) | appear verbatim in the export and in delivery records; text keeps the export byte-stable.                                                                                                                                                                                      |
| `hours_period.id`, `hours_assessment.method`, `status` columns  | `text`                               | ids are `randomUUID()` strings today; enums stay text with CHECKs.                                                                                                                                                                                                             |

### Module behavior

- **EARS-7.** The `/p/hours` surface and the hours cabinet resources shall keep the
  spec 081 (rev. #83/#85) and spec 100 behavior with **no domain change** —
  umbrella parity clause, exercised by keeping the existing unit/E2E suites
  green plus one E2E smoke named for this clause. The parity points the storage
  swap specifically touches are broken out as EARS-28..32 below.
- **EARS-8.** The hours module shall reach `member` data only through the
  member module's public API (`src/lib/member/index.ts`) — never by importing
  `schema/member/` tables (ADR-004 §6) **and never by importing member module
  internals**: this cycle adds the dependency-cruiser rule pair for the member
  module (hours may import only the member public API; CMS and OKR may not
  import member internals at all), since ADR-004 §6 alone only guards table
  files.
- **EARS-9.** WHEN the admin participant form is saved with an email that has
  no `member`, the member module shall create one (slug derived from the email
  local part; on slug collision the module appends a numeric suffix — the save
  never surfaces a raw constraint error; `status: active`, timezone
  `Europe/Moscow`); WHEN the email matches an existing `member`, saving shall
  update its `name` **and `role`** through the member API (the form has always
  edited both — 081 §23) and touch hours attributes otherwise. IF the email
  equals an existing alias value belonging to another member, THEN the save
  shall be refused with a readable message naming that member. Email stays the
  form's read-only key in edit mode; participant deletion and email change stay
  unsupported in UI (081 §16 — now an owner-run SQL escape hatch instead of a
  JSON edit). **Named consequence:** the hours admin now edits the shared
  registry — a rename here propagates to every future reader of `core.member`.
- **EARS-10.** WHEN any hours mutation runs, it shall execute inside a single
  database transaction that FIRST takes the module-wide advisory lock
  (`pg_advisory_xact_lock` on one fixed hours key) — the direct analogue of
  today's in-process mutex (081 §13): full mutual exclusion of hours mutations,
  so the shipped read-validate-write logic keeps its guarantees (no double
  publish batch, no date-edit recompute racing a save, no lost upsert). The
  lock is **per mutation**, and network I/O stays outside any transaction: the
  spec-100 delivery loop remains N+1 separate mutations with the Mattermost
  call between them — never one transaction holding the module lock across
  HTTP. The uniqueness constraints of EARS-4/5/6 remain as the structural
  backstop beneath the lock.
- **EARS-20.** IF a database constraint fires (open-period uniqueness,
  assessment key, publication uniqueness, member email/slug, alias
  uniqueness), THEN the user shall receive the same readable refusal message
  the JSON validation produces today (e.g. «Уже открыт период „X" — сначала
  закрой его.») — never a raw constraint error or a 500. The
  constraint→message mapping is part of the implementation's test surface.
- **EARS-21.** Every list the module renders or publishes shall carry an
  explicit `ORDER BY` reproducing today's insertion order. `hours_period` and
  `hours_participant` get an explicit integer `sort_key` column (their PKs
  cannot carry order: period ids are preserved uuids, and participant PKs
  follow the member seed, not the JSON array), populated from the JSON array
  position by the import; `hours_assessment` orders by its identity PK
  assigned in array order; new rows append after the current maximum. This
  covers the participants table (081 §19), the summary, and the publication
  preview/delivery order (spec 100 req. 2/10 — delivery addresses a message **by
  its `position`**, so order is a correctness property, not cosmetics).
  **Amended 2026-08-19 (#274, spec 201 EARS-31):** that clause used to read «by
  index», the index into the `jsonb` array `core.hours_publication.messages`. The
  messages are now rows of `core.hours_publication_message` keyed
  `(period_id, position)`, and `position` is the explicit, stored form of exactly
  that index — 0-based and contiguous, asserted when
  `src/lib/hours/core/load.ts` rebuilds the legacy array. Nothing about the
  ordering guarantee moved: the same messages go to the same people in the same
  order, and what changed is that a delivery step now updates ONE row, so the
  audit ledger of spec 201 records one small diff instead of «the whole array
  changed».
- **EARS-22.** The `preview_fingerprint` digest input shall be pinned to
  exactly today's serialized shape (`{period, rows}` with the legacy
  participant fields: `email`, `name`, `role`, `fork_min`, `fork_max`,
  `grade`, plus the assessment fields as today) assembled from the database —
  member-only columns (`id`, `status`, `timezone`, timestamps) are excluded,
  so an unrelated member touch does not invalidate a correct preview and the
  identity drift spec 100 req. 9 guards is still covered.
- **EARS-11.** For internal migration/cutover verification only, the tooling
  shall reconstitute exactly the legacy document: top-level keys
  `participants`, `periods`, `assessments`, `publications` in that order,
  participant shape of `types.ts`, serialized as `JSON.stringify(doc, null, 2)`
  — no member-only columns, no members who are not hours participants, and the
  legacy `participant.monthly_rate` field stays dropped (081 §14). The former
  admin «Скачать данные (JSON)» action is retired by spec 311 EARS-449; this
  clause shall not expose a page, button or module API handler.
- **EARS-12.** IF `PLATFORM_DATABASE_URL` is unset or the database is
  unreachable, THEN pages shall say the data is unavailable (081 §17 semantics)
  and mutations shall refuse loudly; the module shall never fall back to the
  JSON file after cutover.

### Parity points the swap touches (decomposed from EARS-7)

- **EARS-28.** A logged-in non-participant, and a participant without
  fork+grade, shall get the «только часы» money-null modes exactly as today
  (081 §9, §21): `monthly_rate` snapshot null, money snapshots zero.
- **EARS-29.** WHILE a period is closed, assessment saves into it shall be
  refused; reopening shall be allowed only while no other period is open
  (081 §24).
- **EARS-30.** WHEN a period's dates change, the module shall recompute the
  derived fields of ALL its assessments from each assessment's **stored**
  `monthly_rate` snapshot (never the participant's current fork/grade), with
  the 081 §6 rounding order, returning both warnings (recomputed count; hours
  above the new ceiling) — 081 §24 unchanged.
- **EARS-31.** WHILE a publication batch is `sending`, and permanently once
  `published`, period label/date edits and reopening shall be refused
  (spec 100 req. 12); this lock survives a crash of the delivering process
  (req. 15).
- **EARS-32 (superseded by spec 311 EARS-451, #317).** Every admin mutation now
  re-checks the Zitadel `platform-admin` claim in its
  `/api/p/hours/admin/*` handler. The temporary module email allowlist is removed.

### Migration & cutover

- **EARS-13.** The cutover import shall run as ONE database transaction,
  **inside the maintenance window and before the new image serves traffic**
  (ordering: pre-migrate checkpoint (ADR-004 §7) → `platform:migrate` → manual
  seed → import + verification → only then traffic). It shall carry every
  period, assessment and publication from the production `hours.json` verbatim
  — snapshot numbers digit-for-digit, ids, timestamps and array order
  preserved (EARS-21 sort keys) — matching participants to `member` rows by
  normalized email, and shall abort with nothing written on any email that has
  no `member` row. It shall refuse non-empty **`hours_*` tables** (the member
  seed legitimately runs first); re-run = documented truncate-and-retry of the
  hours+member tables, valid only inside the window.
- **EARS-14.** `member` shall be seeded once, before the import, from a
  consolidated dataset (~11 people) prepared by hand with the owner from the
  existing systems (`team.yaml`, `hours.json` participants, Zitadel accounts),
  including the known aliases per person (EARS-17). The dataset shall NOT be
  committed to the repository (personal + salary adjacency); it is applied on
  the box at cutover.
- **EARS-26.** The full cutover sequence (seed → import → export diff) shall be
  rehearsed on a dev stand against a copy of the production `hours.json`
  BEFORE the production window — a seed/import mismatch is discovered in the
  rehearsal, not inside the window. The rehearsal is a precondition of the
  cutover task.
- **EARS-27.** The cutover tooling shall print its own verification verdict:
  pre-cutover export → import → post-cutover export → semantic diff, with the
  result (identical / differing paths) in the deploy log — the owner reads the
  verdict rather than eyeballing two JSON files.
- **EARS-15.** WHEN the cutover completes and the owner accepts the stand, the
  production `hours.json` shall be archived in place (renamed with a date
  suffix, kept on the volume and in backups), `HOURS_DATA_FILE` and the JSON
  store code path removed, and spec 081's «Хранение (без БД)» section revised
  to point at this spec (same PR). Until acceptance the file stays untouched
  under its original name — the rollback path stays warm through the risky
  window.
- **EARS-16.** The import shall never mutate the source `hours.json`.
- **EARS-25.** Rollback is offered **until the owner's acceptance**: redeploy
  the previous image — it reads the untouched JSON (EARS-15/16), and any rows
  written into `core` during the window are consciously dropped (the window is
  a maintenance window; writes in it are the operator's own). After
  acceptance: forward-fix only. The rollback procedure (image + name
  restoration if the archive rename already happened) is written into the
  cutover task's runbook.

### CRUD check (task-cycle stage 1a — forms unchanged, storage semantics restated)

| Form                     | Create                                                        | Read                                       | Update                                                                                                                                | Delete                                                     |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Participant (admin)      | upsert by email; unknown email also creates `member` (EARS-9) | table on `/p/hours` (member ∪ hours attrs) | «Изменить» pre-fills; email read-only; edits `name`/`role` on the shared registry                                                     | **not supported** (deliberate, 081 §16) — SQL escape hatch |
| Period (admin)           | label + dates; ≥1 weekday                                     | list with status                           | label/dates with recompute (081 §24) **unless publication-locked** (spec 100 req. 12; EARS-31); open/close/reopen under the same lock | only while no assessments (081 §16)                        |
| Assessment (participant) | self-only save in open period                                 | summary table, all logged-in               | re-save while open re-freezes snapshots (upsert, EARS-4)                                                                              | **not supported** (deliberate — history is the product)    |
| Publication (admin)      | preview → publish per spec 100; one batch per period (EARS-6) | panel state                                | delivery updates the batch per spec 100                                                                                               | **not supported** (delivery record)                        |
| Alias (member cabinet)   | kind + value (+ note), spec 311 EARS-444                      | member cabinet + member API (EARS-18)      | yes                                                                                                                                   | yes                                                        |

## Acceptance scenarios

1. **Parity, participant.** After cutover the owner opens
   `https://portal.bbm.academy/p/hours`, sees the same page as before (name
   hero, participants table in the same order, open period, calculator), saves
   a self-assessment, sees it in the summary. (EARS-1, EARS-7, EARS-10,
   EARS-21)
2. **Parity, admin.** In `/p/admin/hours/participants` and `/p/admin/hours/periods`
   the owner creates a participant with
   a brand-new email + name only (dash-filled row appears; a `member` now
   exists for it), adds fork + grade (computed rate appears), edits the role
   (it saves — shared registry), edits a period's dates over existing
   assessments (recompute warning with count), closes and reopens a period.
   (EARS-3, EARS-7, EARS-9, EARS-30)
3. **History integrity.** The cutover log shows the EARS-27 verdict line:
   pre-export vs post-import export — identical; old periods render the same
   summary numbers on the page. The owner reads the verdict in the log, not a
   manual diff. (EARS-11, EARS-13, EARS-27)
4. **Seed integrity.** The participants table lists the same people with the
   same forks/grades/computed rates as before cutover; the member registry
   holds the consolidated team (~11) even where only some are hours
   participants. (EARS-2, EARS-3, EARS-14)
5. **Cutover evidence.** The deploy log shows the pre-migrate checkpoint dump
   line, the maintenance-window ordering (migrate → seed → import → traffic)
   and the import summary (rows per table); the volume holds the
   date-suffixed `hours.json` archive only after acceptance; the app no longer
   reads it. (EARS-13, EARS-15, EARS-25)
6. **Failure honesty.** With `PLATFORM_DATABASE_URL` deliberately broken on a
   dev stand, `/p/hours` says data is unavailable instead of rendering zeros or
   falling back to JSON. (EARS-12)
7. **Alias resolution.** In the member cabinet the owner creates or edits a
   known external handle (e.g. the Mattermost login «dobroyar»); the member
   module lookup resolves it to the same person, and canonical email lookup
   resolves too. (EARS-14, EARS-17, EARS-18; spec 311 EARS-444)

## Out of scope

- Any UI or behavior change: approval flows, edit journals, post-publication
  locking beyond what spec 100 already ships — separate tasks if ever (owner,
  2026-08-11).
- Further hours-cabinet redesign beyond the behavior-preserving move in #317.
- `membership`, `event_log`, `outbox` tables and any propagation — epics #111
  tail / #113; this spec creates only `member` (+ `member_alias`) and the hours
  tables.
- Field-level edit audit of `core` tables — separate task **#201** (owner,
  2026-08-11): adopt the ds-platform spec-010 «Universal edit audit» mechanics
  (generic PL/pgSQL trigger + append-only partitioned ledger + `SET LOCAL`
  actor GUCs + PD masking + CI coverage lint) rather than reinventing them.
- The fate of `team.yaml` after `core.member` becomes the operational master —
  deferred, trigger: epic #113.
- Executing the implementation and the cutover — follow-up tasks opened from
  this spec (numbers written back below).

## Follow-up tasks

Opened via `spec-issue-graph` after the owner's acceptance (2026-08-17), both
native sub-issues of epic #111:

1. **#255** — implement hours-on-core: member module + hours tables + repository
   swap behind the existing module API, TDD from the EARS clauses above (owns
   EARS-1..12, 17..22, 28..32). Takeable.
2. **#256** — production cutover: manual member seed, JSON import, freeze +
   archive; owns EARS-13..16, 25..27; **preconditions:** the EARS-26 dev
   rehearsal and #125 in production; blocked by #255.
