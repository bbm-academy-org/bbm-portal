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
  mutation to attach the actor to, and no network I/O inside it. That clause's
  «first» is not disturbed here: the lock keeps the first position and the audit
  context follows it, inside the one helper both now go through (EARS-6,
  EARS-24).
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
  `CREATE TRIGGER` line and no per-table code. A new column of an already
  audited table is _captured_ by that same trigger without touching it, but it is
  **not** thereby covered: under default-deny (EARS-27) its values are masked
  until the migration that adds the column also adds its policy row, and until
  one lands the completeness check (EARS-29, EARS-21) reports it. The trigger
  costs no code change; the column registry does.
- **EARS-2.** WHEN the trigger records a mutation, the platform shall store a
  JSONB diff computed as: for UPDATE — **only** the fields whose value actually
  changed, each as `{"field": {"old": …, "new": …}}`; for INSERT — the whole new
  row as `{"field": {"new": …}}`; for DELETE — the whole old row as
  `{"field": {"old": …}}`. The registered per-table excluded columns (EARS-18)
  shall be removed from the diff of **all three** operations, not only UPDATE, so
  an excluded column's value cannot enter the ledger through an insert or a
  delete. The bookkeeping column `updated_at` shall be excluded the same way,
  wherever it exists — today that is `core.member` alone; the other five audited
  tables carry no such column, so the rule is a standing convention for tables
  that will, not a description of the six that exist.
- **EARS-3.** IF an UPDATE's diff is empty after those exclusions, THEN the
  platform shall write **no** ledger row — the trail records changes, not
  touches.
- **EARS-4.** The trigger shall record the mutated row's primary key — read from
  the database's own catalog rather than from a per-table list, so a composite
  primary key is carried with no per-table code (the catalog query itself is in
  §«How it lands in our pipeline»). No `core` table has a composite PK today — two
  (`hours_participant`, `hours_publication`) carry an FK-as-PK, and the epic-#113
  tables are not designed yet; catalog resolution is what keeps this clause true
  for tables that do not exist yet.
- **EARS-5.** Every audited row shall carry `event_type` equal to
  `data.<table>.<insert|update|delete>` — lower-cased operation, unqualified
  table name — matching the donor's taxonomy so the two estates read the same
  way.

### Attribution

- **EARS-6.** WHEN an authenticated mutation runs from the application, it shall
  execute inside a transaction that sets the transaction-scoped settings
  `app.actor_email` (the session's normalized email) and `app.source` **before
  its first statement that reads or mutates an audited table**, and the trigger
  shall read both and record them on the ledger row. The settings are
  transaction-scoped and die at COMMIT, so nothing leaks across the pooled
  connections of `src/lib/platform/db/client.ts` (the exact SQL form, and why a
  session-level `SET` would be wrong, are in §«How it lands in our pipeline»).
  **Ordering against spec 124 EARS-10:** that clause requires the module advisory
  lock to be the transaction's **first** statement, and it keeps that position —
  `pg_advisory_xact_lock` and `set_config(…, true)` are both transaction-scoped,
  so their relative order changes nothing in either guarantee, and the tie is
  broken in favour of the lock because «first» is load-bearing there (no read may
  precede mutual exclusion) while the context only has to precede the first
  audited write. The order inside the helper is therefore: BEGIN → advisory lock
  (when the caller names one) → audit context → the caller's work.
- **EARS-7.** `app.source` shall come from the closed set
  `portal | system:<job> | cli:<name> | migration | manual-dba`, where `portal`
  is any authenticated application request (a human is behind it),
  `system:<job>` a write the application itself initiates with **no** user — an
  outbox drain, a scheduled job, the shapes epic #113 already draws —
  `cli:<name>` a repo-owned script (e.g. `cli:member-seed`), `migration` a
  data-bearing migration, and `manual-dba` an announced operator session that
  sets it by hand. `db-direct` is the trigger's own fallback (EARS-8) and shall
  NOT be a value any caller can set. **The actor is required only where a human
  exists:** `actor_email` shall be non-NULL for `portal` and is legitimately
  NULL for `system:<job>`, `cli:<name>` and `migration`. `system:<job>` is
  carried rather than dropped precisely because of EARS-26: on the marked pool
  an app-initiated write with no user would otherwise have no legal value at
  all, and the first scheduled writer would be refused.
- **EARS-8.** IF a mutation reaches an audited table with no audit context set
  **from outside the application** — a `psql` session, the migration runner, a
  restore — THEN the platform shall still append the ledger row, with
  `source = 'db-direct'` and a NULL actor; the absence of context shall never
  fail such a write, and the trigger shall never fabricate an actor. The
  application's own connections are covered by EARS-26 instead, which refuses
  them: `db-direct` means «somebody worked on the database directly», and letting
  an app write borrow that value would make the ledger lie about the door it came
  through.
- **EARS-9.** Every application mutation entrypoint shall carry the actor
  **explicitly**. A ledger row originating from an authenticated request and
  reading `db-direct`, or carrying a NULL actor, is a defect, and the integration
  tier shall assert against it for every hours mutation entrypoint. This clause
  states the property; EARS-24..26 are the three mechanisms that hold it, and
  they are named because the helper's required argument **on its own** is not
  fail-closed — a required argument only binds callers who already chose the
  helper.
- **EARS-10.** WHILE the ledger INSERT is part of the mutating transaction, a
  failure to append shall roll the domain write back — an unaudited commit shall
  be impossible. Degradation is permitted for **attribution** only (EARS-8),
  never for the append. Named consequence, stated rather than implied: an
  unwritable ledger blocks `core` writes. That is the intended trade for an
  ~11-person, admin-rate estate where an unaudited write is the worse failure,
  and the DEFAULT partition (EARS-13) removes its one routine cause.

- **EARS-24.** The platform shall expose exactly **one** way for application code
  to open a write transaction against `platform`: a helper
  `platformTransaction(ctx, fn, options?)` in `src/lib/platform/db/`, taking the
  audit context (`actorEmail`, `source`) as a **required** first argument and an
  optional advisory-lock key, and running BEGIN → lock → context → `fn` (EARS-6).
  Two mechanisms shall keep it the only way, because a required argument alone
  binds only the callers who already chose the helper:
  1. **The type system.** `getPlatformDb()` shall stop handing out a handle that
     carries `.transaction(…)`: the exported type omits it, so opening a raw
     transaction outside `src/lib/platform/db/` is a compile error rather than a
     style violation. This is the only part of the fail-closed story TypeScript
     can actually give, and it is claimed for that part only.
  2. **A lint.** An `eslint` `no-restricted-syntax` rule (in the repo's flat
     config, therefore inside `pnpm lint`, therefore BLOCK on every PR) shall
     forbid, outside `src/lib/platform/db/`, both a `.transaction(` call on a
     platform handle and a hand-written `set_config('app.…')` / `SET LOCAL app.…`
     — the second because a call-site that sets the GUCs by hand re-creates the
     convention this clause exists to abolish. `.dependency-cruiser.cjs` is the
     wrong instrument here and is deliberately not used: it reasons about module
     imports, and `.transaction()` is a method call on an imported value.
     **Named asymmetry:** `.transaction(` is a pure AST selector, while the
     `set_config('app.…')` / `SET LOCAL app.…` half matches SQL **text** inside a
     `Literal` / `TemplateElement` — the same string-matching brittleness EARS-20
     cites to keep our own guard at WARN, landing here inside a BLOCK lint. It is
     accepted for two reasons stated rather than assumed: this is the auxiliary
     half of an auxiliary mechanism (the load-bearing one is EARS-26, on the
     database side), and its false-positive class is one-sided — the only thing
     it can flag is a hand-written `app.*` GUC write, which outside
     `src/lib/platform/db/` is exactly what the clause forbids.
     Both mechanisms shall be registered in the guard canon
     (`docs/ci-guardrails.md` §5) alongside EARS-19/20, so «what enforces this» is
     answerable from the register rather than from this spec.
- **EARS-25.** `mutateHoursDocument` shall take the audit context as a required
  argument and open its transaction through the helper of EARS-24, and every
  hours mutation entrypoint in `src/modules/hours/actions.ts` shall pass the
  session's email (`sessionEmail(session)`, already resolved there by the
  `requireEmail` / `requireAdmin` gate) with `source = 'portal'`. Without this
  change the actor exists one storey above the write and never reaches the
  database, and issue #201's second acceptance criterion is unreachable.
- **EARS-26.** The application's connection pool shall mark itself at the
  connection level — a session-scoped setting carried in the pool's connection
  options, so every connection the app opens announces «I am the app» before any
  statement runs — and the trigger shall use that mark to tell two unattributed
  writes apart: **IF** a mutation on an audited table arrives on an app-marked
  connection with **no** audit context — meaning `app.source` is unset or
  empty; a NULL `app.actor_email` is not itself missing context, since EARS-7
  makes it legal for the actor-less sources — THEN the trigger shall RAISE and
  the write shall fail; on an unmarked connection (`psql`, the migration runner, a
  restore) it degrades to `db-direct` as EARS-8 says. This is what «fail-closed»
  means in this spec, and it is deliberately narrow: the donor degrades in both
  cases, which would have recorded an app write that skipped the helper as
  `db-direct` — a false statement about which door the change came through, in a
  ledger whose whole value is that it is believed. **Named consequence:** a
  call-site that escapes both EARS-24 mechanisms turns into a visible failed save
  rather than a silent lie. That is the intended trade, it is the same trade
  EARS-10 already makes for the append, and it surfaces on the first such write
  in dev or CI rather than in production.

### The ledger

- **EARS-11.** The platform shall store audit rows in a new table
  `core.audit_event`, created by migration, with first-class columns:
  `created_at timestamptz NOT NULL DEFAULT now()` (the mutation time and the
  partition key), `id bigint` identity, `event_type text NOT NULL`,
  `table_name text NOT NULL`, `actor_email text` (nullable),
  `source text NOT NULL`, `pk jsonb NOT NULL`, `diff jsonb NOT NULL`,
  `txid text NOT NULL` — the database's own transaction id, so every row written
  by one save is grouped; primary key `(created_at, id)`. It shall carry indexes on
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
  CI). Adding that call **changes the `platform:migrate` script**: today it is
  the two steps ADR-004 §5 describes (`tools/platform/ensure-database.mjs`, then
  `drizzle-kit migrate`); this makes it three, the new one running last. IF the
  DEFAULT partition already holds rows for a month whose partition is being
  created, THEN the function shall refuse that month and report it in plain
  words, rather than let the underlying `CREATE TABLE … PARTITION OF` fail
  obscurely — Postgres validates such a creation by scanning the DEFAULT
  partition under an `ACCESS EXCLUSIVE` lock and aborts if it holds a row of that
  range. (That scan is also what the routine case costs: every deploy takes a
  brief exclusive lock on an all-but-empty DEFAULT partition, per month created.)
  Reaching the refusal state means the horizon was exhausted, and the remedy is a
  named manual move of those rows.
- **EARS-15.** No capture trigger shall be attached to `core.audit_event` itself
  (recursion) nor to `core.__drizzle_migrations` (drizzle's own bookkeeping, not
  domain truth).

### Personal data

- **EARS-16.** WHERE a column's policy in the platform's column registry is
  `masked`, the trigger shall emit it in the diff as `{"field": {"masked": true}}`
  — with no `old` and no `new` key at all, so the fact of the change is recorded
  and the values never are. No plaintext value of a masked column shall reach
  `core.audit_event`. The registry shall be **data, not code**: a table
  `core.audit_column_policy (table_name, column_name, policy)` — `plaintext` /
  `masked` / `excluded` — written **only by migration**, so extending it is a
  reviewable one-row diff, the coverage guard can read it, and there is no
  SQL⇄TypeScript copy to keep in parity. The application role shall hold no
  write privilege on it: a registry a data operation can edit is a masking policy
  a data operation can switch off.
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

- **EARS-27.** The registry shall be **default-deny**: a column of an audited
  table for which the registry holds **no** row shall be treated as `masked`.
  Plaintext is therefore something a migration grants explicitly, one column at a
  time, and never something the absence of a row grants silently. Named
  consequence, and the reason this is the chosen shape: if the registry is empty,
  emptied, or restored out of order, the ledger degrades to «we know what changed
  but not to what» — a useless audit — instead of writing personal data in the
  clear into an append-only table nothing can redact (EARS-28). The two failure
  modes are not symmetric, and this clause picks the recoverable one.
- **EARS-28.** Masking shall be understood as **prospective only**: it is applied
  at write time, the ledger is append-only (EARS-12), and retention is indefinite
  by default (Q1) — so widening the mask later protects future rows and changes
  nothing about rows already written. IF plaintext personal data has reached the
  ledger, THEN the platform shall offer no redaction path at delivery: the only
  available instrument is dropping a whole monthly partition, which destroys that
  month's audit for every table and every person rather than redacting one
  person's data, and a per-person erasure request cannot be satisfied by it at
  all. This clause exists so the property is decided rather than discovered: the
  owner's answer to **Q7** below either accepts it, replaces it with a retention
  term, or commissions a sanctioned redaction procedure as its own clause.
  Factual note, not legal advice: 152-ФЗ places obligations on an operator of
  personal data regarding deletion and rectification on the subject's request;
  whether this ledger falls under them, and what that requires, is the owner's
  call with his own counsel — no agent decides it here.

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

- **EARS-29.** The coverage guard shall also assert the **completeness of the
  column registry**: for every audited table, every column declared under
  `src/lib/platform/db/schema/**/*.ts` shall have exactly one policy row in the
  migration-seeded `core.audit_column_policy`, and a column with none shall be a
  finding. The integration counterpart (EARS-21) shall make the same assertion
  against the really-migrated database, comparing the registry to
  `information_schema.columns`. Default-deny (EARS-27) is what makes a missing
  row safe; this clause is what makes it **visible**, so «everything is masked
  because the registry was never seeded» cannot pass for a working audit.

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

**The mechanics the clauses deliberately do not carry.** Four implementation
details, kept out of the requirements so they stay readable, named here so they
are still decided:

- **Primary key from the catalog (EARS-4):** `pg_index` joined to `pg_attribute`
  on `TG_RELID`, filtered to `indisprimary`, assembled into a JSONB object.
- **The audit context (EARS-6):** issued as
  `SELECT set_config('app.actor_email', <value>, true)` — the transaction-local,
  parameterizable form, because `SET LOCAL` accepts no bind parameter — and read
  back in the trigger with `nullif(current_setting(<name>, true), '')`. A
  session-level `SET` is forbidden: it would outlive the transaction and stamp
  the next borrower of that pooled connection with the previous actor.
- **The app-connection mark (EARS-26):** a session GUC set once per physical
  connection through the pool's libpq `options` (`-c app.connection=app`) in
  `src/lib/platform/db/client.ts`, not per transaction — so it is a property of
  «who opened this socket», which is exactly the distinction the trigger needs
  and exactly what a `psql` session or the drizzle-kit migration runner does not
  carry. **The mark lives in code and never in `PLATFORM_DATABASE_URL`:** `pg`
  merges the parsed connection string **over** the explicit config
  (`pg/lib/connection-parameters.js`), so an `options=` parameter in the URL
  would both overwrite the code's mark and stamp drizzle-kit's own runner as the
  app — after which a data-bearing migration (`source = 'migration'`) would be
  refused by EARS-26. The environment variable carries no `options=`.
- **`search_path` on the new functions.** The donor pins neither `search_path`
  nor `SECURITY DEFINER`, and this port adds something the donor did not have —
  a **table read inside the trigger** (the column registry), which makes name
  resolution a live question rather than an inherited one. So
  `core.audit_row_change()` and its helpers are created with
  `SET search_path = pg_catalog, core` and stay `SECURITY INVOKER`: the registry
  it consults is then always ours, whatever the calling session's `search_path`
  says, and no function in this migration runs with elevated rights.

**What the connection mark pulls into the delivery (EARS-26's real scope).**
`getPlatformDb()` is the only pool, so once it is marked, **everything** writing
through it must carry a context or be refused: the `cli:*` scripts
(`cli:<name>`), the seeding and fixture helpers under `tests/int/platform/`, and
any future scheduled writer (`system:<job>`). None of these is a new mechanism —
each passes a context to the same EARS-24 helper — but they sit inside the
implementation task's scope rather than a follow-up: a delivery that marks the
pool without converting them turns its own test seeds into failed writes.

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

| Donor                                                                                                       | Here                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuses an existing `audit_ledger`, packing `{table, pk, diff, source, txid}` into a `metadata` jsonb blob   | New `core.audit_event` with those as **first-class columns**                                                                                                                        | The blob was a constraint of reusing a table the feature did not own. We create the table, so a queryable, indexable shape is free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Actor = Zitadel `sub` (`app.actor_sub`)                                                                     | Actor = normalized email (`app.actor_email`)                                                                                                                                        | This estate keys on email end to end — `HOURS_ADMIN_EMAILS`, `sessionEmail()`, spec 124 EARS-2's DB-enforced normalization. A `sub` would need a join to be readable, and we have no table mapping it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pg_partman` 5.4.3 + the `pg_partman_bgw` background worker                                                 | `core.audit_ensure_partitions()` called by `pnpm platform:migrate`                                                                                                                  | The extension is absent from our image and adding one is a new ops surface on a single-VPS estate. Deploys are frequent enough to keep the horizon ahead of `now()`, and the DEFAULT partition is the net either way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| PD registry = a SQL function with a hardcoded `CASE`, mirrored by a TS constant, parity held by an e2e test | PD/exclusion registry = the table `core.audit_column_policy`, **default-deny**, migration-written only, completeness checked by the guard (EARS-16, EARS-27, EARS-29)               | One source instead of two plus a parity test, and EARS-18's exclusion policy shares the mechanism instead of becoming a second hardcoded list. **The property the donor's `CASE` had and a table does not:** the list cannot be emptied by a data operation — only by a reviewed migration. That is not recovered by the table shape, so it is recovered three other ways: the app role holds no write grant on the registry, an unknown column is masked rather than plaintext, and a registry that has lost rows turns CI red. The residual cost is named too: a new column on an audited table now needs its policy row in the same migration, or its values are masked until one lands. |
| ADR-0009 retention: 5 years + crypto-shred at term (mechanism itself deferred to ds #383)                   | **Open question Q1**                                                                                                                                                                | No such contract exists in this repo. Inventing a retention term silently would be an agent taking a data-policy decision the estate has never taken.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `event_id` uuid + a partition-scoped dedup unique                                                           | Dropped                                                                                                                                                                             | It serves idempotent-replay semantics the donor's ledger needs for its other event families (`auth.*`). Trigger rows are distinct facts; porting it here would be dead columns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `source` set `admin-ui \| portal-api \| system:<job> \| migration \| manual-dba`                            | `portal \| system:<job> \| cli:<name> \| migration \| manual-dba`                                                                                                                   | One app, one portal host (ADR-003 §1) — `admin-ui` vs `portal-api` has no referent here; `cli:` names our own scripts. `system:<job>` is **kept**: under EARS-26 the marked pool refuses a context-less write, so an app-initiated write with no user (outbox drain, scheduled job) needs a legal value, and this is it.                                                                                                                                                                                                                                                                                                                                                                    |
| Attribution enforced by convention plus a unit seam; a runtime interceptor named as a future option         | Attribution is a required helper argument **plus** a handle type with no `.transaction`, **plus** an eslint rule, **plus** a database-side refusal on app connections (EARS-24..26) | A required argument alone is the donor's own convention wearing a type annotation: it binds only callers who already chose the helper. The three additions are what make it fail-closed; the last one is the only mechanism that also covers code we have not written yet.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The trigger degrades to `db-direct` for **every** context-less write, app included                          | Degrades only for connections that are not the app's; an app connection with no context is **refused** (EARS-26)                                                                    | The donor's uniform degradation would record an app write that skipped the wrapper as `db-direct` — a false statement about the door, in the one table whose value is that it is believed. Cost, named: a missed call-site is a failed save instead of a wrong row.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Three files (`requirements` / `design` / `scenarios.feature`)                                               | One EARS spec                                                                                                                                                                       | `docs/specs/README.md` is this repo's format; `author-feature-spec` already records the same deviation for the skill it was ported from.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Coverage guard is the only coverage check                                                                   | Guard (WARN) **plus** a catalog assertion in the BLOCK `platform-int` job                                                                                                           | A text scan of migration files cannot see the database. We have a real Postgres in CI and no reason to leave the stronger check unwritten.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Rejected alternatives

Recorded so the next session does not re-decide them from scratch.

- **pgaudit** (the extension the question «зачем вообще триггеры» always reaches
  for). Rejected in the donor and re-rejected here on the same four grounds, all
  of which are stated in #201's Context: it writes **statements into the server
  log**, so the trail is not queryable from the database and lands outside our
  backup story; it records the statement text, not a resolved **old→new** value
  per column; it has no structured actor — the connection user is `postgres` for
  every door we have; and it is a server extension absent from
  `postgres:17-alpine`, i.e. the same new ops surface `pg_partman` was rejected
  for.
- **Application-level audit** (write the ledger row from TypeScript next to each
  mutation). Rejected because it only covers doors that remember to call it — and
  spec 124 deliberately institutionalised a `psql` escape hatch (EARS-9, EARS-19)
  as a supported door. Capture in the database is what makes «every write path»
  in EARS-1 true rather than aspirational.
- **Payload's own version history as the mechanism.** It exists, it works, and it
  covers `cms` collections with drafts — a different database, a different
  lifecycle, and nothing at all for `core`. Q4 keeps `cms` out of scope; this is
  the reason that is not a gap.

## Acceptance scenarios

These are the issue's acceptance criteria, made performable. Scenarios 1–4 map
one-to-one onto the four AC checkboxes of #201; 5–12 cover the clauses those four
do not reach.

1. **Attributed edit from the live stand.** The owner opens `/p/hours/admin` on a
   live stand and edits a participant's role — a column of `core.member`, the shared registry the hours admin writes through (spec 124 EARS-9), not of `core.hours_participant`. An agent then queries the platform
   database and pastes the resulting `core.audit_event` row into the issue: it
   shows `event_type = data.member.update`, a `diff` naming exactly the changed
   column with its old and new value, `actor_email` = the owner's address, and
   `created_at` = the moment of the edit. (EARS-1, EARS-2, EARS-5, EARS-6,
   EARS-9, EARS-11, EARS-24, EARS-25)
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
11. **An app write cannot go unattributed.** On a stand, an agent runs a build in
    which one hours mutation deliberately bypasses the helper (a throwaway patch,
    not merged). The save fails with the trigger's message naming the missing
    audit context, and no ledger row claiming `db-direct` appears; reverting the
    patch makes the same save succeed and produce an attributed row. The eslint
    rule flags the same patch before it is ever run. (EARS-24, EARS-26)
12. **An empty registry hides data instead of leaking it.** On a stand, an agent
    deletes every row of `core.audit_column_policy` as a superuser and edits a
    `member.name`. The ledger row records the column as `{"masked": true}` —
    default-deny — rather than the name in the clear. Detection is credited to
    the check that can actually see a **database-level** deletion: the EARS-21
    integration assertion, which compares the registry in the really-migrated
    database against `information_schema.columns`, turns red.
    `pnpm lint:audit-coverage` stays green here on purpose — it reads migration
    **text**, and the migrations still seed those rows. Its half of the same
    property is performed separately: on a branch, an agent removes a seeded
    policy row (or adds a column without one) **in the migration chain**, and
    then `lint:audit-coverage` names the column and exits 1. Restoring both
    returns the plaintext behaviour Q2 chose.
    (EARS-16, EARS-21, EARS-27, EARS-29)

## Open questions for the owner

Each carries the lead's recommended default. These are the product / policy
forks; the technical ones (table shape, trigger mechanics, where the guard is
wired) are settled above and do not need the owner's attention.

- **Q1 — Retention, and the fact that it is one-way.** How long do audit rows
  live? **Recommended default: keep them indefinitely for now** — ~11 people at
  admin write rates produce a trivially small ledger. But the honest version of
  «decide later» is this: the ledger is append-only (EARS-12) and the only
  deletion instrument is dropping a whole monthly partition, which erases that
  month's audit **for every table and every person**. It is a retention
  instrument, not a redaction instrument, and there is no per-person erasure path
  at delivery (EARS-28). So the choice is between three real shapes:
  **(a)** keep everything indefinitely and accept that; **(b)** adopt a retention
  term now — «drop partitions older than N months», one line in the deploy path,
  and the audit simply does not reach back further; **(c)** commission a
  sanctioned redaction procedure — a privileged function that rewrites the `diff`
  of named rows, which **breaks the append-only invariant on purpose** and would
  therefore be its own clause, its own privilege grant, and would itself write a
  ledger row recording that a redaction happened, by whom and why. My
  recommendation is **(a) now with a named trigger for (c)**: with Q2's answer and
  the default-deny registry, declared personal data does not enter the ledger in
  the first place, so (c) buys little today — and the moment it is needed (the
  mask is widened, or a person asks for erasure) it is a task, not a rewrite of
  this design. Factual note, not legal advice: 152-ФЗ places obligations on an
  operator of personal data around deletion and rectification on the subject's
  request; whether this ledger falls under them is your call with counsel, and no
  agent will make it for you.
- **Q2 — What counts as personal data in the diff — and it is decided at write
  time.** **Recommended default: mask only `member_alias.value` and
  `member_alias.note`** — phone, personal email, Telegram/Instagram handles,
  free-text notes — and keep `member.email`, `member.name`, `member.slug` in
  plaintext, because they are the corporate identity of the team, `member.email`
  is already the ledger's actor column, and masking them makes the audit unable to
  answer the question it was built for. **What the earlier version of this
  question got wrong:** widening the mask later is _not_ «one row in
  `core.audit_column_policy` and nothing else». Masking is applied at the moment
  the row is written (EARS-28), so a later widening protects only future rows —
  everything already recorded in the clear stays in the clear, in a table nothing
  can edit, for as long as Q1's answer keeps it. Narrowing the mask later is the
  cheap direction; widening it is the one-way one. Answer Q2 as if it were
  permanent for the rows written between now and any future change, because it
  is.
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

- **Q7 — The remediation path for personal data that is already in the ledger.**
  This is Q1's second half, split out because it is a data-protection decision
  rather than a storage one, and it is the one this spec cannot take on your
  behalf. Today the answer the design ships with is **«there isn't one»**: append
  only, indefinite retention, and `DROP PARTITION` as a blunt month-wide instrument
  (EARS-28). The three ways out are the (a)/(b)/(c) of Q1 — accept it, bound it
  with a retention term, or build the sanctioned redaction procedure. **Recommended
  default: (a) accept, with (c) filed as a follow-up whose trigger is named** —
  the first widening of the mask set, or the first erasure request from a person,
  whichever comes first. Saying «(a)» here is a decision, not a deferral; what
  makes it safe to say today is that Q2 keeps declared personal data out of the
  ledger by construction.

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
