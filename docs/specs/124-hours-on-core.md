---
status: Draft
issue: 124
updated: 2026-08-11
---

# /p/hours on the `core` schema — data model & migration off JSON — spec (issue #124)

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
  existing systems (~11 people ± 2) — no automated merge machinery; the fate of
  `team.yaml` after mastership moves to `core.member` is deferred (trigger:
  epic #113); `member` carries a list of **aliases** — the person's accounts and
  ids in external systems (phone, Telegram, Instagram, Mattermost id/email,
  Zoom id, personal email, …) for recognition cases such as meeting transcripts
  («dobroyar» → Игорь Пирогов); field-level **edit audit** is wanted but lands
  as a separate task adopting the ds-platform spec-010 mechanics, out of this
  spec's scope.

## Requirements

### Data model — schema `core`

- **EARS-1.** The platform shall store hours data in `core` tables owned by the
  hours module (`src/lib/platform/db/schema/hours/`: `hours_participant`,
  `hours_period`, `hours_assessment`, `hours_publication`) and the shared
  `member` table owned by a new member module
  (`src/lib/platform/db/schema/member/`), all created exclusively through
  `pnpm platform:migrate:generate` migrations.
- **EARS-2.** The `member` table shall carry: surrogate integer PK, `slug`
  (unique), `email` (unique, stored normalized lowercase), `name`, `role`
  (nullable), `status` (`active | inactive`), `timezone` (IANA), timestamps.
  Money attributes shall NOT live on `member`.
- **EARS-3.** The hours money attributes — `fork_min`, `fork_max` (₽/month),
  `grade` (`I | II | III`), all nullable — shall live on `hours_participant`,
  whose PK is the FK to `member`. A member without a `hours_participant` row is
  not an hours participant (today's «тебя нет в списке участников» mode).
- **EARS-4.** `hours_assessment` shall keep one row per (`period`, `member`)
  (unique constraint) with today's value domains preserved exactly: `hours`,
  `weekend_hours`, `method`, `split_percent`, and the frozen snapshots
  (`monthly_rate` nullable, `hourly_rate` unrounded float, `accrual`,
  `cash_amount`, `invest_amount`, `weekday_count`), plus `saved_at`. Snapshots
  remain fixed numbers — spec 081 §15 semantics are unchanged.
- **EARS-5.** The database shall enforce «at most one open period» (partial
  unique index on `hours_period.status = 'open'`), replacing the JSON-level
  check with a structural guarantee. Period ids are preserved as text PKs so
  migrated history keeps its identifiers.
- **EARS-6.** `hours_publication` shall carry the spec-100 publication record
  (`period`, `status`, `started_at`, `published_at`, `preview_fingerprint`)
  with the per-member message batch as a `jsonb` snapshot column — the batch is
  a write-once delivery artifact, never queried relationally.
- **EARS-17.** The member module shall own a `member_alias` table
  (`schema/member/`): surrogate PK, FK to `member`, `kind` (open-set text —
  e.g. `phone`, `telegram`, `instagram`, `mattermost_id`, `mattermost_email`,
  `zoom_id`, `email_personal`), `value` (stored trimmed; lowercased for
  email-like and handle-like kinds), optional `note`; unique on
  (`kind`, `value`); a member may hold several aliases of the same kind. The
  canonical `@bbm.academy` email stays on `member` and is not duplicated as an
  alias.
- **EARS-18.** The member module's public API shall resolve a member by
  (`kind`, `value`) and list a member's aliases — the recognition contract for
  consumers such as meeting-transcript processing («dobroyar» → the member's
  name).
- **EARS-19.** WHERE no admin UI exists yet (until `/p/admin`, epic #112),
  aliases shall be populated by the manual seed and maintained through the
  owner-run SQL escape hatch; this cycle adds no alias UI.

### Module behavior

- **EARS-7.** The `/p/hours` and `/p/hours/admin` surfaces shall behave per
  spec 081 (rev. #83/#85) and spec 100 with **no UI change**: formulas,
  rounding order, access rules, admin allowlist (`HOURS_ADMIN_EMAILS`,
  fail-closed), freeze of closed periods, and date-edit recompute (081 §24) all
  carry over. Existing unit/E2E tests keep passing.
- **EARS-8.** The hours module shall reach `member` data only through the member
  module's public API — never by importing `schema/member/` tables directly
  (enforced by the ADR-004 §6 dependency-cruiser rules).
- **EARS-9.** WHEN the admin participant form is saved with an email that has no
  `member`, the member module shall create one (slug derived from the email
  local part, `status: active`, timezone `Europe/Moscow`, role empty); WHEN the
  email matches an existing `member`, saving shall update its `name` and only
  touch hours attributes otherwise. Email stays the form's read-only key in
  edit mode; participant deletion and email change stay unsupported in UI
  (081 §16 — now an owner-run SQL escape hatch instead of a JSON edit).
- **EARS-10.** WHEN each mutation runs, it shall execute inside a single
  database transaction, preserving the lost-update guarantee the in-process
  mutex gives today (081 §13); the mutex and tmp-file/rename machinery are
  retired with the JSON store.
- **EARS-11.** The admin «Скачать данные (JSON)» export shall assemble the
  document from the database in a shape compatible with today's export
  (081 §25, spec-100 fields included), so the owner's verification workflow
  survives the storage swap.
- **EARS-12.** IF `PLATFORM_DATABASE_URL` is unset or the database is
  unreachable, THEN pages shall say the data is unavailable (081 §17 semantics)
  and mutations shall refuse loudly; the module shall never fall back to the
  JSON file after cutover.

### Migration & cutover

- **EARS-13.** The cutover import shall carry every period, assessment and
  publication from the production `hours.json` verbatim — snapshot numbers
  digit-for-digit, ids and timestamps preserved — matching participants to
  `member` rows by normalized email, and shall fail loudly (import aborted,
  nothing written) on any email that has no `member` row.
- **EARS-14.** `member` shall be seeded once, before the import, from a
  consolidated dataset (~11 people) prepared by hand with the owner from the
  existing systems (`team.yaml`, `hours.json` participants, Zitadel accounts),
  including the known aliases per person (EARS-17).
  The dataset shall NOT be committed to the repository (personal + salary
  adjacency); it is applied on the box at cutover. Fork/grade values come from
  production `hours.json` automatically during the import, not from the manual
  dataset.
- **EARS-15.** WHEN the cutover completes and the owner accepts the stand, the
  production `hours.json` shall be archived in place (renamed with a date
  suffix, kept on the volume and in backups), `HOURS_DATA_FILE` and the JSON
  store code path removed, and spec 081's «Хранение (без БД)» section revised
  to point at this spec (same PR).
- **EARS-16.** WHILE the archived JSON remains untouched, rolling back shall be:
  redeploy the previous image (it reads the JSON file restored to its original
  name). The import shall never mutate the source file.

### CRUD check (task-cycle stage 1a — forms unchanged, storage semantics restated)

| Form                       | Create                                                        | Read                                       | Update                                                          | Delete                                                     |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Participant (admin)        | upsert by email; unknown email also creates `member` (EARS-9) | table on `/p/hours` (member ∪ hours attrs) | «Изменить» pre-fills; email read-only                           | **not supported** (deliberate, 081 §16) — SQL escape hatch |
| Period (admin)             | label + dates; ≥1 weekday                                     | list with status                           | label/dates always, with recompute (081 §24); open/close/reopen | only while no assessments (081 §16)                        |
| Assessment (participant)   | self-only save in open period                                 | summary table, all logged-in               | re-save while open re-freezes snapshots                         | **not supported** (deliberate — history is the product)    |
| Publication (admin)        | preview → publish per spec 100                                | panel state                                | re-publish per spec 100 rules                                   | **not supported** (delivery record)                        |
| Alias (no form this cycle) | seed / SQL escape hatch (EARS-19)                             | member module API (EARS-18)                | SQL escape hatch                                                | SQL escape hatch                                           |

## Acceptance scenarios

1. **Parity, participant.** After cutover the owner opens
   `https://portal.bbm.academy/p/hours`, sees the same page as before (name
   hero, participants table, open period, calculator), saves a self-assessment,
   sees it in the summary. (EARS-1, EARS-7, EARS-10)
2. **Parity, admin.** On `/p/hours/admin` the owner creates a participant with
   a brand-new email + name only (dash-filled row appears; a `member` now
   exists for it), adds fork + grade (computed rate appears), edits a period's
   dates over existing assessments (recompute warning with count), closes and
   reopens a period. (EARS-3, EARS-7, EARS-9)
3. **History integrity.** Before cutover the owner downloads the JSON export;
   after cutover downloads it again — periods, assessments and their snapshot
   numbers are identical digit-for-digit; old periods render the same summary
   numbers on the page. (EARS-11, EARS-13)
4. **Seed integrity.** The participants table lists the same people with the
   same forks/grades/computed rates as before cutover; the member registry
   holds the consolidated team (~11) even where only some are hours
   participants. (EARS-2, EARS-3, EARS-14)
5. **Cutover evidence.** The deploy log shows the pre-migrate checkpoint dump
   line and the import summary (rows per table); the volume holds the
   date-suffixed `hours.json` archive; the app no longer reads it. (EARS-15)
6. **Failure honesty.** With `PLATFORM_DATABASE_URL` deliberately broken on a
   dev stand, `/p/hours` says data is unavailable instead of rendering zeros or
   falling back to JSON. (EARS-12)
7. **Alias resolution.** The owner names a known external handle (e.g. the
   Mattermost login «dobroyar»); the agent runs the member-module lookup
   against the production database and returns the right person's name — the
   recognition contract works on seeded data. (EARS-14, EARS-17, EARS-18)

## Out of scope

- Any UI or behavior change: approval flows, edit journals, post-publication
  locking — separate tasks if ever (owner, 2026-08-11).
- `/p/admin` and replacing `HOURS_ADMIN_EMAILS` with a claim gate — epic #112.
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

Opened via `spec-issue-graph` once this spec has the owner's go:

1. _TBD_ — implement hours-on-core: member module + hours tables + repository
   swap behind the existing module API, TDD from the EARS clauses above.
2. _TBD_ — production cutover: manual member seed, JSON import, freeze +
   archive, rollback plan rehearsed; blocked by task 1 and by #125 reaching
   production.
