---
status: Draft
issue: 201
updated: 2026-08-19
---

# Universal edit audit for `core` tables — spec (issue #201)

- **Issues:** #201 (this task), #111 (epic «ядро core»), #117 (epic 7 — the guard
  canon this wires into). Adjacent: `docs/specs/124-hours-on-core.md` (declares
  this work out of its own scope), #125 (the migration pipeline it lands on),
  #113 (the domain `event_log` — a different thing, see «Out of scope»).
- **Donor.** ds-platform spec 010 «Universal edit audit».
  **Artifact passport:** `C:\Users\sidor\repos\ds-platform\apps\docs\content\specs\features\010-universal-edit-audit\`
  (`010-requirements.md`, `010-design.md`, `010-scenarios.feature`) plus its
  migrations `apps/api/drizzle/0003_audit_ledger_partitioning.sql`,
  `0004_audit_ledger_partman.sql`, `0013_universal_edit_audit.sql`, the wrapper
  `packages/db/src/audit-context.ts`, the registry `packages/db/src/audit.ts` and
  the guard `tools/lint/audit-coverage-lint.ts` — owner **ds-platform** (a
  separate estate; ADR-002 §2), type **original source** (the specs and code as
  authored there, not an export or a build), shipped 2026-07-17 (ds PR #1093,
  release-2026.07.18-1). All read in full for this spec; **nothing in that repo
  was modified.**
- **Owner ruling (2026-08-11, recorded on #201 and in spec 124):** adopt those
  mechanics, do not reinvent them. This spec is therefore a **port with named
  deviations** (§«Deviations from the donor»), not an independent design.

## Why

The owner wants field-level change history for the `core` tables: «чтобы было
всегда видно, что менялось, когда и как по каждому полю» (session 2026-08-11).
Postgres has no switch for that.

`/p/hours` has written real relational data since 2026-08-18 (spec 124), the
shared `core.member` registry is edited from the hours admin — a rename there
propagates to every future reader — and the only supported way to delete a
participant or change an email is an owner-run `psql` escape hatch that spec 124
deliberately institutionalised (EARS-9, EARS-19). Today neither door leaves a
trace of what a row looked like before.

The estate already has a production-proven answer: **one generic PL/pgSQL
row-level AFTER trigger** writing into **one append-only, partitioned ledger**,
with the actor carried on transaction-scoped GUCs. Capture sits in the database,
so it covers every door — app, script, migration, `psql` — instead of depending
on every caller remembering a wrapper.

## Prior decisions

- **ADR-004 §3** — the audit objects live in database `platform`, schema `core`,
  and appear only through `src/lib/platform/db/migrations` applied by
  `pnpm platform:migrate`. `PLATFORM_DATABASE_URL` has no fallback to
  `DATABASE_URL`, so nothing in this spec can reach Payload's `cms`.
- **ADR-004 §4** — every schema-creating statement is idempotent. This spec
  extends that posture to the object classes it introduces (functions, triggers,
  partitions), for the same reason: a partially-applied run and a
  restore-from-dump present the same already-there object.
- **ADR-004 §6** — a module imports only its own table directory, and nothing
  under `src/app/` imports a table file. The ledger belongs to **no** module: it
  is platform infrastructure, defined in SQL only, with no drizzle table file
  (§«How it lands in our pipeline»), so it adds no boundary edge to enforce.
- **ADR-004 §7** — the production migration runs inside the deploy's fail-closed
  `checkpoint` window: a fresh dump is taken and pinned under a per-deploy key
  **before** anything migrates.
- **ADR-002 §3** — modular monolith. This adds no deployable, no runtime
  component, no Postgres extension.
- **ADR-003 §1** — no new surface. The read path is SQL run by an agent; no
  route, no host, no middleware entry.
- **Spec 124, EARS-10** — every hours mutation already runs as **one**
  transaction that takes the module advisory lock first. That existing guarantee
  is what makes the GUC contract viable: there is exactly one transaction per
  mutation to attach the actor to, and no network I/O inside it.
- **Spec 124, EARS-2 / EARS-17** — `core.member.email` is stored normalized
  (`lower(btrim(…))`, DB-enforced by CHECK). The audit actor is therefore an
  email in that same normalized form and joins to `member` by equality.
- **Consolidation spec §4 (D-025)**
  (`docs/superpowers/specs/2026-08-04-platform-consolidation-design.md`) —
  `event_log` is the **domain** journal (Contribution structure, hash chain
  later), epic #113. This ledger is low-level DB audit. Two tables, two names, on
  purpose: one records «какая колонка какой строки изменилась», the other «что
  произошло в бизнесе». Explicitly out of scope here.
- **`docs/ci-guardrails.md` §3, §5, §8** — a new CI guard lands **WARN** unless a
  §3 mandate is recorded; it lives at `tools/lint/<name>-lint.mjs` with a paired
  `tools/lint/guard-tests/<name>-lint.spec.ts`, exits 0 clean / 1 on findings,
  and gets a row in the §5 register naming its promotion condition.
- **`DEBT.md`, line `2026-08-11-8fcb3c6ffc`** — the consolidation spec §11
  deferred an `audit-coverage` guard because #125's migration created the schema
  and no tables, leaving the guard nothing to have an opinion about. Its return
  condition («the first product table lands in `core`») fired with spec 124.
  EARS-19..22 are what discharge that line; it closes when the guard lands, not
  when this spec is accepted.
- **`docs/runbooks/migrations-expand-contract.md`** — a release may only expand.
  This migration is pure expand, so `pnpm deploy:prod --rollback <sha>` stays an
  honest button (§«How it lands in our pipeline»).

## Requirements

### Capture

- **EARS-1.** The platform shall capture every INSERT, UPDATE and DELETE on an
  audited `core` table — through **any** write path (the app, a repo script, a
  migration, a direct `psql` session) — as ledger rows written by **one generic
  PL/pgSQL row-level AFTER trigger function** `core.audit_row_change()`, attached
  per table by migration, inside the **same transaction** as the mutation. The
  function shall be table-agnostic (`TG_TABLE_NAME`, `TG_RELID`,
  `to_jsonb(OLD/NEW)`), so covering a new table costs exactly one
  `CREATE TRIGGER` line, and a new column on an already audited table is covered
  with no code change at all.
- **EARS-2.** WHEN the trigger records a mutation, the platform shall store a
  JSONB diff computed as: for UPDATE — **only** the fields whose value actually
  changed (`IS DISTINCT FROM`), each as `{"field": {"old": …, "new": …}}`, with
  the bookkeeping column `updated_at` and the registered per-table excluded
  columns (EARS-18) removed; for INSERT — the whole new row as
  `{"field": {"new": …}}`; for DELETE — the whole old row as
  `{"field": {"old": …}}`.
- **EARS-3.** IF an UPDATE's diff is empty after those exclusions, THEN the
  platform shall write **no** ledger row — the trail records changes, not
  touches.
- **EARS-4.** The trigger shall resolve the mutated row's primary key from the
  **system catalog** (`pg_index` joined to `pg_attribute` on `TG_RELID`, filtered
  to `indisprimary`) into a JSONB object, so a composite primary key is carried
  with no per-table code. No `core` table has a composite PK today — two
  (`hours_participant`, `hours_publication`) carry an FK-as-PK, and the epic-#113
  tables are not designed yet; catalog resolution is what keeps this clause true
  for tables that do not exist yet.
- **EARS-5.** Every audited row shall carry `event_type` equal to
  `data.<table>.<insert|update|delete>` — lower-cased operation, unqualified
  table name — matching the donor's taxonomy so the two estates read the same
  way.

### Attribution

- **EARS-6.** WHEN an authenticated mutation runs from the application, it shall
  execute inside a transaction whose **first** statements set the
  transaction-scoped settings `app.actor_email` (the session's normalized email)
  and `app.source`, and the trigger shall read both with
  `nullif(current_setting(<name>, true), '')` and record them on the ledger row.
  Because `SET LOCAL` accepts no bind parameter, the settings are issued as
  `SELECT set_config(<name>, <value>, true)` — the transaction-local form —
  never as a session-level `SET`, which would leak the actor across the pooled
  connections of `src/lib/platform/db/client.ts`.
- **EARS-7.** `app.source` shall come from the closed set
  `portal | cli:<name> | migration | manual-dba`, where `portal` is any
  authenticated application request, `cli:<name>` a repo-owned script (e.g.
  `cli:member-seed`), `migration` a data-bearing migration, and `manual-dba` an
  announced operator session that sets it by hand. `db-direct` is the trigger's
  own fallback (EARS-8) and shall NOT be a value any caller can set.
- **EARS-8.** IF a mutation reaches an audited table with no audit context set,
  THEN the platform shall still append the ledger row, with
  `source = 'db-direct'` and a NULL actor; the absence of context shall never
  fail the domain write, and the trigger shall never fabricate an actor.
- **EARS-9.** Every application mutation entrypoint shall carry the actor
  **explicitly**: the audit context is a required argument of the platform
  transaction helper, so omitting it is a TypeScript compile error rather than a
  silent `db-direct` row. A ledger row originating from an authenticated request
  and reading `db-direct` is a defect, and the integration tier shall assert
  against it for every hours mutation entrypoint.
- **EARS-10.** WHILE the ledger INSERT is part of the mutating transaction, a
  failure to append shall roll the domain write back — an unaudited commit shall
  be impossible. Degradation is permitted for **attribution** only (EARS-8),
  never for the append. Named consequence, stated rather than implied: an
  unwritable ledger blocks `core` writes. That is the intended trade for an
  ~11-person, admin-rate estate where an unaudited write is the worse failure,
  and the DEFAULT partition (EARS-13) removes its one routine cause.

### The ledger

- **EARS-11.** The platform shall store audit rows in a new table
  `core.audit_event`, created by migration, with first-class columns:
  `created_at timestamptz NOT NULL DEFAULT now()` (the mutation time and the
  partition key), `id bigint` identity, `event_type text NOT NULL`,
  `table_name text NOT NULL`, `actor_email text` (nullable),
  `source text NOT NULL`, `pk jsonb NOT NULL`, `diff jsonb NOT NULL`,
  `txid text NOT NULL` (`txid_current()`, grouping every row of one
  transaction); primary key `(created_at, id)`. It shall carry btree indexes on
  `(table_name, created_at DESC)` and `(actor_email, created_at DESC)` — the two
  questions the owner actually asks: «что менялось в этой таблице» and «что делал
  этот человек».
- **EARS-12.** `core.audit_event` shall be **append-only, enforced by the
  database**: a `BEFORE UPDATE OR DELETE FOR EACH ROW` trigger on the partitioned
  parent shall raise an exception naming the operation, so a correction is a
  compensating record and never an edit. **Known residual, closed elsewhere:**
  `TRUNCATE` is not reachable by a row-level trigger; it is closed by privileges
  (the application role holds no `TRUNCATE` on the table), and this spec names
  that rather than letting the trigger imply a coverage it does not have.
- **EARS-13.** `core.audit_event` shall be declared
  `PARTITION BY RANGE (created_at)` with **monthly** partitions and a **DEFAULT**
  partition. The DEFAULT partition is the correctness net, not the storage plan:
  it exists so that a missing month can never fail a domain write (EARS-10).
- **EARS-14.** The platform shall provide
  `core.audit_ensure_partitions(months_ahead integer)` — idempotent, creating
  every missing monthly partition from the current month forward — and shall run
  it as part of `pnpm platform:migrate`, so each deploy extends the horizon and
  the estate needs neither `pg_cron` nor `pg_partman` (neither is present in the
  `postgres:17-alpine` image this estate runs in prod, on the dev stand and in
  CI). IF the DEFAULT partition already holds rows for a month whose partition is
  being created, THEN the function shall refuse that month and report it rather
  than let the `ATTACH` fail obscurely — reaching that state means the horizon
  was exhausted, and the remedy is a named manual move.
- **EARS-15.** No capture trigger shall be attached to `core.audit_event` itself
  (recursion) nor to `core.__drizzle_migrations` (drizzle's own bookkeeping, not
  domain truth).

### Personal data

- **EARS-16.** WHERE a column is listed in the platform's PD-column registry,
  the trigger shall emit it in the diff as `{"field": {"masked": true}}` — with
  no `old` and no `new` key at all, so the fact of the change is recorded and the
  values never are. No plaintext value of a registered PD column shall reach
  `core.audit_event`. The registry shall be **data, not code**: a table
  `core.audit_column_policy (table_name, column_name, policy)` seeded by
  migration, so extending it is a reviewable one-row diff, the coverage guard can
  read it, and there is no SQL⇄TypeScript copy to keep in parity.
- **EARS-17.** The initial PD registry shall contain `member_alias.value` and
  `member_alias.note` — a person's phone, personal email, Telegram/Instagram
  handles and the free-text context around them (spec 124 EARS-17).
  `member.email`, `member.name` and `member.slug` shall be recorded in
  plaintext: they are the corporate identity of an ~11-person team,
  `member.email` is already the ledger's own actor column, and masking them would
  make «кто и на что переименовал человека» — the exact question this feature
  exists to answer — unanswerable. Owner question **Q2** below can reverse this.
- **EARS-18.** The same registry shall carry a per-table **excluded-column**
  policy, initially holding `hours_publication.messages`: the spec-100 delivery
  loop rewrites that jsonb array once per message, so auditing it would store the
  entire batch N times per publication to record a per-message `delivery` flag
  the column itself already carries. The publication's status transitions stay
  audited. Owner question **Q3**.

### Coverage

- **EARS-19.** The platform shall provide a CI guard
  `tools/lint/audit-coverage-lint.mjs` (alias `pnpm lint:audit-coverage`) that
  enumerates every `core` table declared under
  `src/lib/platform/db/schema/**/*.ts`, scans the migration chain for
  `CREATE [OR REPLACE] TRIGGER … EXECUTE FUNCTION core.audit_row_change()`
  attachments minus later `DROP TRIGGER`s, and fails when a table is neither
  attached nor present on an in-script allowlist carrying a **mandatory rationale
  string**. A bare or empty rationale shall itself be a finding. The guard shall
  follow the `docs/ci-guardrails.md` §8 contract exactly: flat layout, a paired
  spec under `tools/lint/guard-tests/`, `LINT_FIXTURE_ROOT` as the test seam,
  exit 0 clean / exit 1 with one line per finding on stderr, fail-closed on an
  exception.
- **EARS-20.** The guard shall land as **WARN** per `docs/ci-guardrails.md` §3 —
  no day-0 BLOCK mandate is claimed, because it matches regexes over SQL text and
  therefore has a real false-positive class to soak — registered in the §5
  inventory with its §4 promotion condition, and wired as a step carrying
  `continue-on-error: true` plus the §8 batch-job outcome aggregation.
- **EARS-21.** The truth-level counterpart shall be an integration assertion
  under `tests/int/platform/` that reads `pg_trigger` against the **really
  migrated** database and fails when an audited table has lost its trigger. It
  runs in the `platform-int` job, which is BLOCK, so the database-state half of
  coverage blocks from day 0 while the allowlist-discipline half (EARS-19)
  soaks. The two check different things on purpose: the guard sees the allowlist
  and its written rationale, the test sees reality.
- **EARS-22.** The audited set at delivery shall be exactly the `core` domain
  tables that exist today — `member`, `member_alias`, `hours_period`,
  `hours_participant`, `hours_assessment`, `hours_publication` — with
  `audit_event`, `audit_column_policy` and `__drizzle_migrations` allowlisted
  (recursion; the registry is configuration whose changes are visible in the
  migration diff; drizzle bookkeeping).

### Reading it

- **EARS-23.** WHILE no UI over the ledger exists, the read path shall be SQL run
  by an agent against the platform database, with the result pasted into the
  issue — the shape spec 124 (EARS-19, scenario 7) already established for alias
  resolution. No page, no route, no host change.

## How it lands in our pipeline

**One migration, hand-written SQL.** drizzle-orm 0.45 can express none of
`PARTITION BY`, a PL/pgSQL function, or a trigger, so the migration is pure SQL:
`pnpm platform:migrate:generate --custom --name=universal_edit_audit` emits the
empty migration file together with its `meta/_journal.json` entry and snapshot,
and the SQL is written into it by hand. This is already the established shape
here — `0002_hours.sql` carries a hand-written tail (the two cross-module foreign
keys) under a comment block explaining why drizzle cannot own them, with the
constraints read back out of `information_schema` by an integration test. The
same convention applies: the comment explains, the test proves.

**No drizzle table file for the ledger.** `drizzle-kit generate` diffs the TS
schema against its **own snapshot**, never against the live database, so an
object that never entered a snapshot is invisible to it and is never dropped —
which is precisely why the hand-written FKs of `0002` are safe. A
`pgTable('audit_event')` stub would break that property: drizzle would then
believe it owns a table it cannot describe (no partitioning) and emit a duplicate
`CREATE TABLE` on the next generate. Reads therefore use the `sql` template on
the platform handle, exactly as `tests/int/platform/*.int.spec.ts` already do.

**Idempotency.** `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
`CREATE OR REPLACE TRIGGER` (PG14+; this estate runs `postgres:17-alpine` in
prod, on the dev stand and as the CI service container). ADR-004 §4's rule,
extended to the object classes this migration introduces.

**Order inside the migration.** Ledger + partitions → the column-policy registry
→ `core.audit_row_change()` and its helpers → the append-only trigger → the
per-table attach lines **last**. Nothing is retro-backfilled: the trail starts at
the attach, and the migration itself therefore produces no ledger rows.

**Expand/contract.** Pure expand — one new table, its partitions, a registry
table, three functions, one trigger per audited table. The previous app image
keeps writing into the audited tables perfectly well after this migration; its
rows simply land as `source = 'db-direct'` with a NULL actor (EARS-8), which is
the honest record of a build that does not set the context. `pnpm deploy:prod
--rollback <sha>` therefore stays a real button.

**Production.** `pnpm deploy:prod` (skill
`.claude/skills/run-prod-deploy/SKILL.md`): the fail-closed `checkpoint` stage
runs the box's backup script and pins the dump under a per-deploy S3 key
**before** `platform:migrate` runs, per ADR-004 §7 — so the recovery point for
this DDL exists by construction rather than by remembering. `--hold-before-up` is
available if the owner wants the ledger inspected before traffic moves.

**The tests need a real database, and one already exists.** The `platform-int`
job of `.github/workflows/ci.yml` runs `postgres:17-alpine` as a service, applies
`pnpm platform:migrate`, then runs `tests/int/platform` — and it sits in the `ci`
meta-job's needs-list, i.e. BLOCK. Diff semantics, no-op suppression,
append-only refusal, `db-direct` degradation, masking and trigger coverage are
all asserted there against real Postgres. None of this is testable against a
mock: a mock would assert our opinion of what Postgres does.

## Deviations from the donor (ds-platform spec 010)

Recorded the way `docs/ci-guardrails.md` §7 records the guard family's
deviations — a port is judged by whether its differences are named.

| Donor                                                                                                       | Here                                                                      | Why                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuses an existing `audit_ledger`, packing `{table, pk, diff, source, txid}` into a `metadata` jsonb blob   | New `core.audit_event` with those as **first-class columns**              | The blob was a constraint of reusing a table the feature did not own. We create the table, so a queryable, indexable shape is free.                                                                                   |
| Actor = Zitadel `sub` (`app.actor_sub`)                                                                     | Actor = normalized email (`app.actor_email`)                              | This estate keys on email end to end — `HOURS_ADMIN_EMAILS`, `sessionEmail()`, spec 124 EARS-2's DB-enforced normalization. A `sub` would need a join to be readable, and we have no table mapping it.                |
| `pg_partman` 5.4.3 + the `pg_partman_bgw` background worker                                                 | `core.audit_ensure_partitions()` called by `pnpm platform:migrate`        | The extension is absent from our image and adding one is a new ops surface on a single-VPS estate. Deploys are frequent enough to keep the horizon ahead of `now()`, and the DEFAULT partition is the net either way. |
| PD registry = a SQL function with a hardcoded `CASE`, mirrored by a TS constant, parity held by an e2e test | PD/exclusion registry = the table `core.audit_column_policy`              | One source instead of two plus a parity test. It also lets EARS-18's exclusion policy share the mechanism instead of being a second hardcoded list.                                                                   |
| ADR-0009 retention: 5 years + crypto-shred at term (mechanism itself deferred to ds #383)                   | **Open question Q1**                                                      | No such contract exists in this repo. Inventing a retention term silently would be an agent taking a data-policy decision the estate has never taken.                                                                 |
| `event_id` uuid + a partition-scoped dedup unique                                                           | Dropped                                                                   | It serves idempotent-replay semantics the donor's ledger needs for its other event families (`auth.*`). Trigger rows are distinct facts; porting it here would be dead columns.                                       |
| `source` set `admin-ui \| portal-api \| system:<job> \| migration \| manual-dba`                            | `portal \| cli:<name> \| migration \| manual-dba`                         | One app, one portal host (ADR-003 §1) — `admin-ui` vs `portal-api` has no referent here; `cli:` names our own scripts.                                                                                                |
| Attribution enforced by convention plus a unit seam; a runtime interceptor named as a future option         | Attribution is a **required argument** of the transaction helper (EARS-9) | TypeScript gives compile-time fail-closed for free. The donor's NestJS shape did not offer that, so it needed a test to stand in for the type system.                                                                 |
| Three files (`requirements` / `design` / `scenarios.feature`)                                               | One EARS spec                                                             | `docs/specs/README.md` is this repo's format; `author-feature-spec` already records the same deviation for the skill it was ported from.                                                                              |
| Coverage guard is the only coverage check                                                                   | Guard (WARN) **plus** a catalog assertion in the BLOCK `platform-int` job | A text scan of migration files cannot see the database. We have a real Postgres in CI and no reason to leave the stronger check unwritten.                                                                            |

## Acceptance scenarios

These are the issue's acceptance criteria, made performable. Scenarios 1–4 map
one-to-one onto the four AC checkboxes of #201; 5–10 cover the clauses those four
do not reach.

1. **Attributed edit from the live stand.** The owner opens `/p/hours/admin` on a
   live stand and edits a participant's role. An agent then queries the platform
   database and pastes the resulting `core.audit_event` row into the issue: it
   shows `event_type = data.member.update`, a `diff` naming exactly the changed
   column with its old and new value, `actor_email` = the owner's address, and
   `created_at` = the moment of the edit. (EARS-1, EARS-2, EARS-5, EARS-6,
   EARS-9, EARS-11)
2. **Direct `psql` write, still honest.** An agent runs
   `UPDATE core.member SET role = … WHERE id = …` in `psql` with no context set.
   The ledger gains a row with `source = 'db-direct'` and `actor_email` NULL —
   the write is not blocked, and no actor is invented. (EARS-1, EARS-8)
3. **The ledger cannot be rewritten.** An agent attempts
   `UPDATE core.audit_event SET diff = '{}'::jsonb` and
   `DELETE FROM core.audit_event` on the stand; both are refused by the database
   with the enforcement trigger's message, pasted as evidence. (EARS-12)
4. **A new table cannot opt out silently.** On a branch, an agent adds a table
   under `src/lib/platform/db/schema/` with no trigger attach.
   `pnpm lint:audit-coverage` names it and exits 1; allowlisting it **without** a
   rationale still exits 1; attaching the trigger turns it green. (EARS-19,
   EARS-20, EARS-22)
5. **A touch is not a change.** Saving an admin form without altering any value
   leaves the ledger unchanged; changing one field writes exactly one row naming
   that one field. (EARS-2, EARS-3)
6. **A deletion keeps the whole row.** Deleting a period that has no assessments
   — the one delete `/p/hours/admin` supports (spec 081 §16) — writes a row whose
   diff carries **every** column of the removed row under `old`, so the deleted
   record is reconstructable, together with its primary key read from the
   catalog. (EARS-2, EARS-4)
7. **Personal data never lands in plaintext.** An agent changes a
   `member_alias.value` (a phone number) and a `member.name` in one SQL
   transaction. The ledger records the alias column as `{"masked": true}` with
   the number appearing nowhere in the row, and the name change in plaintext.
   (EARS-16, EARS-17)
8. **The horizon and the net.** After `pnpm platform:migrate` on the stand, an
   agent lists `core.audit_event`'s partitions: the current month and the months
   ahead exist, plus the DEFAULT. Running migrate again changes nothing.
   (EARS-13, EARS-14)
9. **Coverage against reality.** The `platform-int` job is green with every
   audited table's trigger present in `pg_trigger`; dropping one trigger locally
   turns that job red, and `core.audit_event` itself carries no capture trigger.
   (EARS-15, EARS-21, EARS-22)
10. **Reading it at all.** The owner asks «что менялось по этому человеку за
    неделю». An agent answers with one query over `core.audit_event` filtered by
    `actor_email` and `table_name`, and pastes the rows into the issue. No UI is
    involved. (EARS-11, EARS-23)

## Open questions for the owner

Each carries the lead's recommended default. These are the product / policy
forks; the technical ones (table shape, trigger mechanics, where the guard is
wired) are settled above and do not need the owner's attention.

- **Q1 — Retention.** How long do audit rows live? **Recommended default: keep
  them indefinitely for now.** ~11 people at admin write rates produce a
  trivially small ledger, and the monthly partitions mean adopting a policy later
  is a `DROP PARTITION` and nothing else. The donor's five-year + crypto-shred
  rule comes from ds-platform's ADR-0009 (a medical-data compliance contract);
  no such contract exists here, and inventing a term would be an agent taking a
  data-policy decision on the owner's behalf.
- **Q2 — What counts as personal data in the diff.** **Recommended default: mask
  only `member_alias.value` and `member_alias.note`** — phone, personal email,
  Telegram/Instagram handles, free-text notes — and keep `member.email`,
  `member.name`, `member.slug` in plaintext, because they are the corporate
  identity of the team, `member.email` is already the ledger's actor column, and
  masking them makes the audit unable to answer the question it was built for.
  The alternative (mask names and emails too) is one row per column in
  `core.audit_column_policy`.
- **Q3 — `hours_publication.messages`.** **Recommended default: exclude it from
  diffs.** The spec-100 delivery loop rewrites that jsonb array once per message;
  auditing it would store the whole batch N times per publication to record a
  flag the column already carries. Status transitions of the publication stay
  audited either way.
- **Q4 — Payload's `cms` database.** **Recommended default: out of scope,
  confirmed.** ADR-004 §1/§3 make `cms` Payload's end to end and our pipeline
  structurally unable to reach it; Payload already keeps its own version history
  for collections with drafts; and putting our triggers on its tables would turn
  every Payload upgrade into a platform-migration problem. If CMS edit history is
  ever wanted, it is a separate task against Payload's own mechanics.
- **Q5 — Partition maintenance.** **Recommended default: no cron, no
  extension** — `core.audit_ensure_partitions(12)` runs as part of every
  `pnpm platform:migrate`, i.e. every deploy, with the DEFAULT partition as the
  correctness net. The alternative (`pg_cron` / `pg_partman`) adds an extension
  and an ops surface to a single-VPS estate for a table gaining a few hundred
  rows a month.
- **Q6 — How wide the audited set is.** **Recommended default: all six `core`
  domain tables that exist today** (EARS-22), `hours_assessment` included — so
  every self-assessment save writes a row. If the owner would rather keep the
  trail to the shared registry and the periods only, the difference is two
  `CREATE TRIGGER` lines and two allowlist rationales.

## Out of scope

- **The domain `event_log` (D-025, epic #113).** A different table for a
  different purpose: the business journal of what happened, not the column-level
  record of what a row looked like before. Neither replaces the other, and this
  spec creates no part of it.
- **Any UI over the ledger.** The read path is SQL run by an agent until a real
  need appears (EARS-23) — no route, no page, no host change.
- **Payload's `cms` database** — Q4.
- **Retro-backfill.** The trail starts when the triggers attach; nothing
  reconstructs history from before that moment. What came before is already
  recorded elsewhere: spec 124's cutover import verdict and the frozen
  `hours.json` archive.
- **Encryption of masked PD values.** The donor names per-subject-key encryption
  as a tracked follow-up; here it would need a key-management story this estate
  does not have. Masked stays masked — the values are omitted, which is the safer
  of the two incomplete states.
- **Promoting the coverage guard to BLOCK.** A `docs/ci-guardrails.md` §4
  promotion, earliest four weeks after the guard lands, done as its own
  three-edit PR.
- **Implementation.** This spec is the subject of the owner's stage-2 «go». The
  migration, the transaction helper, the guard and the tests are follow-up tasks
  opened from it with `spec-issue-graph` after acceptance, and their numbers are
  written back here.
