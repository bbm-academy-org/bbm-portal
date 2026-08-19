---
status: In dev
issue: 201
updated: 2026-08-19
---

# Universal edit audit for `core` tables — spec (issue #201)

- **Issues:** #201 (parent), #279 (spec), #273, #274, #275, #276, #277
  (deferred), #278 (deferred). Epics: #111 («ядро core»), #117 (epic 7 — the
  guard canon this wires into). Adjacent: `docs/specs/124-hours-on-core.md` (declares
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
- **Revision 2026-08-19 — the owner answered Q1–Q7.** The answers, and where each
  one landed, are in §«Owner decisions (2026-08-19)»; two research memos stand
  behind them (§«Research behind the 2026-08-19 revision»). Clause ids are stable
  across that revision: **EARS-13, EARS-14 and EARS-18 are removed** (monthly
  partitioning, the partition-maintenance function, the
  `hours_publication.messages` exclusion), their ids stay gaps rather than being
  reused, and the new clauses are **EARS-30..EARS-33** (EARS-33 added in the
  review round of the same day).

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
row-level AFTER trigger** writing into **one append-only ledger**,
with the actor carried on transaction-scoped GUCs. Capture sits in the database,
so it covers every door — app, script, migration, `psql` — instead of depending
on every caller remembering a wrapper.

## Prior decisions

- **ADR-004 §3** — the audit objects live in database `platform`, schema `core`,
  and appear only through `src/lib/platform/db/migrations` applied by
  `pnpm platform:migrate`. `PLATFORM_DATABASE_URL` has no fallback to
  `DATABASE_URL`, so nothing in this spec can reach Payload's `cms`.
- **ADR-004 §4** — every schema-creating statement is idempotent. This spec
  extends that posture to the object classes it introduces (functions,
  triggers), for the same reason: a partially-applied run and a
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
  audited table is _captured_ by that same trigger without touching it, but its
  **values** are not thereby recorded: under default-deny (EARS-27) the column is
  logged as `{"changed": true}` until the migration that adds it also adds it to
  the trigger's value whitelist (EARS-16), and until one lands the completeness
  check (EARS-29, EARS-21) reports it. The trigger costs no code change; the
  whitelist argument does.
- **EARS-2.** WHEN the trigger records a mutation, the platform shall store a
  JSONB diff computed as: for UPDATE — **only** the fields whose value actually
  changed, each as `{"field": {"old": …, "new": …}}`; for INSERT — the whole new
  row as `{"field": {"new": …}}`; for DELETE — the whole old row as
  `{"field": {"old": …}}`. A column that is **not** on the table's value
  whitelist (EARS-16) shall appear in the diff of **all three** operations as
  `{"field": {"changed": true}}` — never with an `old` or a `new` key — so its
  value cannot enter the ledger through an update, an insert or a delete. The
  bookkeeping column `updated_at` shall be dropped from the diff entirely,
  wherever it exists — today that is `core.member` alone; the other five audited
  tables carry no such column, so the rule is a standing convention for tables
  that will, not a description of the six that exist.
- **EARS-3.** IF an UPDATE's diff records no change after those rules, THEN the
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
- **EARS-31.** `core.hours_publication.messages` shall be **normalised into a
  child table by a prerequisite sub-task, run as a full expand/contract cycle**
  (`docs/runbooks/migrations-expand-contract.md`), before this spec's capture
  trigger reaches `core.hours_publication` (EARS-33). Why it is a prerequisite
  and not an exclusion: the column is a jsonb array rewritten **whole** on every
  delivery step, so an audited diff would say «everything changed» once per
  message and say nothing useful — and it holds frozen message texts plus
  per-member delivery data, which is exactly the content Q2 keeps out of an
  append-only ledger. The sub-task's own scope, precise enough to file with these
  as its acceptance criteria:
  1. **Expand.** Create
     `core.hours_publication_message (period_id text → core.hours_publication.period_id,
position integer NOT NULL, email text NOT NULL, text text NOT NULL,
delivery text NOT NULL, sent_at text)` with `UNIQUE (period_id, position)`
     and a CHECK on `delivery` mirroring the existing `PublicationDelivery`
     values (`src/lib/hours/types.ts`). `position` is the **explicit** form of the
     array index spec 100 req. 2/10 (and spec 124 EARS-21) already relies on.
  2. **Backfill.** Every existing `hours_publication` row's `messages` array is
     migrated element-by-element into the child table with its ordinal as
     `position` and its per-message `delivery`/`sent_at` preserved — **including
     in-flight `sending` batches**, whose partially delivered state is exactly
     what must survive: a `sending` batch blocks period mutations (spec 100
     req. 12/15), and a cutover that lost the per-message flags would either
     re-send delivered messages or strand the batch.
  3. **Switch the code.** `src/lib/hours/core/{load,persist,import}.ts` and the
     publication path in `src/modules/hours` read and write the child table, and
     delivery addresses a message by `position` instead of by array index, with
     the ordering guarantee that spec 100 req. 2/10 states preserved verbatim —
     the acceptance criterion is that the same messages go to the same people in
     the same order, proved by an integration test over a partially delivered
     batch. Spec 124's EARS-21 and spec 100's req. 2/10 are updated in the same
     PR to describe `position` rather than the index.
  4. **Contract.** In a **later release** than the expand (the runbook's two-step
     rule), `ALTER TABLE core.hours_publication DROP COLUMN messages`.

  **This spec revision changes no schema and no application code.** EARS-31
  replaces the removed EARS-18, which excluded the column instead of fixing the
  shape that made it unauditable.

- **EARS-33.** The capture trigger shall **not** be attached to
  `core.hours_publication` until EARS-31's **contract** step has dropped the
  `messages` column: this spec's migration attaches triggers to the other audited
  tables and leaves `core.hours_publication` on the coverage allowlist with the
  rationale «blocked on EARS-31 — `messages` must go first», which is EARS-22's
  own mechanism, visible in the guard's output rather than silent. The ordering,
  not merely the sequencing of two tasks, is the requirement: while the column
  exists under an attached trigger it would be audited **by value** (it is a
  column of an audited table, and EARS-17 whitelists the hours tables' columns),
  putting frozen message texts and per-member delivery data into a ledger that
  EARS-28 says nothing can redact. The allowlist entry is removed, and the
  trigger attached, by the release that follows the contract step.

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
  ~11-person, admin-rate estate where an unaudited write is the worse failure.
  The ledger is a plain table (EARS-11), so the routine cause of a failed append
  in the partitioned design — a month with nowhere to land — does not exist here
  at all.

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
  `id bigint` identity **primary key**,
  `created_at timestamptz NOT NULL DEFAULT now()` (the mutation time),
  `event_type text NOT NULL`, `table_name text NOT NULL`,
  `actor_email text` (nullable), `source text NOT NULL`, `pk jsonb NOT NULL`,
  `diff jsonb NOT NULL`, `txid text NOT NULL` — the database's own transaction
  id, taken from `pg_current_xact_id()` rather than the wrapping 32-bit
  `txid_current()`, since this column is a grouping key — so every row written by
  one save is grouped. It shall be a **plain table**:
  no partitioning, and therefore no partition key dragged into the primary key
  (§«Rejected alternatives» carries the decision and its re-add trigger). It
  shall carry a **BRIN** index on `created_at` — the cheap correct index for a
  monotonically growing timestamp — plus BTREE indexes on
  `(table_name, created_at DESC)`, `(actor_email, created_at DESC)` and
  `(table_name, pk)`: «что менялось в этой таблице», «что делал этот человек» and
  «вся история вот этой строки».
- **EARS-12.** `core.audit_event` shall be **append-only, enforced by triggers
  on the table itself** — the only append-only mechanism this spec delivers: a
  `BEFORE UPDATE OR DELETE FOR EACH ROW` trigger **and a separate**
  `BEFORE TRUNCATE FOR EACH STATEMENT` trigger, each raising an exception naming
  the operation, so a correction is a compensating record and never an edit. The
  statement-level trigger is not decoration: a row-level trigger does not fire on
  `TRUNCATE` at all, so without it the table's most destructive operation would
  be precisely the one the guard cannot see. The capture function is
  `SECURITY DEFINER` with a pinned `search_path` (§«How it lands in our
  pipeline») — free today and required by the privilege arrangement of EARS-30
  when it arrives. **What this guard does and does not cover, stated rather than
  implied:** this estate provisions exactly **one** Postgres role — the container
  superuser named by `POSTGRES_USER` in `infra/dev-stand/compose.core.yml` and
  `deploy/docker-compose.prod.yml`, shared by Payload, Zitadel and the platform,
  and used by both the app pool and `drizzle-kit` through the single
  `PLATFORM_DATABASE_URL` of ADR-004 §3. A superuser disables any trigger with
  one statement and is exempt from every `GRANT`, so **any** in-database guard is
  bypassable by the holder of that one credential. The trigger therefore protects
  against an **accidental** write — a stray `UPDATE`, a script's `DELETE`, a
  `TRUNCATE` in a reset routine — and not against a hostile superuser. Making it
  protect against the latter needs a privilege arrangement this estate cannot
  express yet, and EARS-30 files that as a follow-up instead of asserting it is
  in place.
- **EARS-13, EARS-14 — removed (2026-08-19).** They declared the monthly RANGE
  partitioning with a DEFAULT partition and the `core.audit_ensure_partitions()`
  maintenance function called from `pnpm platform:migrate`. The owner's Q5 answer
  removes partitioning entirely; the reasoning and the re-add trigger live in
  §«Rejected alternatives». The ids are retired, not reused.
- **EARS-15.** No capture trigger shall be attached to `core.audit_event` itself
  (recursion) nor to `core.__drizzle_migrations` (drizzle's own bookkeeping, not
  domain truth).

- **EARS-30.** The platform shall carry a **named follow-up** — _«least-privilege
  application role for `platform`»_ — filed with this spec's issue graph and
  **not delivered here**: a second Postgres role that is not the container
  superuser; `core.audit_event` and `core.audit_row_change()` owned by the
  migrating role; `REVOKE UPDATE, DELETE, TRUNCATE` on the ledger from the
  application role, which needs no direct `INSERT` either (the `SECURITY DEFINER`
  capture function of EARS-12 is what writes) but **keeps `SELECT`** — the read
  path of EARS-23 runs as that same role and must not lose it. This spec does not
  ship that arrangement and does not pretend to: against today's single
  superuser every `REVOKE` is a no-op (EARS-12), and delivering it is not a
  migration detail but a set of decisions outside this spec's reach — who creates
  the role (a migration running as a non-superuser can neither `CREATE ROLE` nor
  `ALTER TABLE … OWNER TO` without membership), where its credential lives in the
  dev stand, in the CI `postgres:17-alpine` service and in `deploy/.env.prod`
  (ADR-004 §7's `verifyRemoteEnv`), and whether `PLATFORM_DATABASE_URL` stops
  being the single connection string of ADR-004 §3 — which is an **ADR-004
  amendment**, not a spec-only matter. The follow-up's own acceptance is the
  scenario this spec therefore cannot perform: connecting as the application role
  and being refused `DELETE`, `TRUNCATE` and a direct `INSERT` with
  `permission denied`, before any trigger runs. Until it lands, EARS-12's trigger
  is the whole of the ledger's append-only enforcement. The donor canon says the
  same thing in one line (PostgreSQL wiki, Audit trigger 91plus): the application
  must not connect as a superuser and must not own the tables it audits — this
  estate does both today, and the clause names that rather than hiding it.

### Personal data

- **EARS-16.** The diff shall carry a column's **value** only WHERE that column
  is named on the audited table's **value whitelist**. A column that is not on it
  shall be recorded as `{"field": {"changed": true}}` — no `old`, no `new`, no
  masked or truncated rendering of the value, no hash — so the fact of the change
  is in the ledger and the value never is. The whitelist shall be **part of the
  versioned schema**, not runtime state: it is passed as the arguments of
  `CREATE TRIGGER … EXECUTE FUNCTION core.audit_row_change('col', 'col', …)` in
  the migration that attaches the trigger and read by the function from
  `TG_ARGV`. There shall be **no registry table**: a column policy living in data
  is state outside the migration chain, is one `DELETE` away from being emptied
  by a data operation, and buys nothing here — nobody needs to change the policy
  without a deploy. This is also the donor canon's own shape (`excluded_cols` as
  a trigger argument in the PostgreSQL wiki's Audit trigger 91plus), inverted
  from a blacklist to a whitelist for the reason EARS-27 states.
- **EARS-17.** The initial whitelist shall be **the corporate identity, the
  service data and the work data — everything except a person's contacts**
  (owner's Q2 matrix). Stated as the three audited groups, each column named
  individually in its trigger's `TG_ARGV` (this clause grants nothing at table
  level, and a column added later starts outside the whitelist exactly like any
  other — EARS-27):
  - **`core.member` — every column.** `id`, `slug`, `email`, `name`, `role`,
    `status`, `timezone`, `created_at`. `role`, `status` and `timezone` are
    **service data, not personal contacts**: «кто и на что это поменял» is asked
    about them more often than about anything else, and recording them by value
    is not excessive relative to the purpose of the trail (ст. 5 ч. 5 152-ФЗ).
    `updated_at` is the one column absent and not by policy: EARS-2 drops it from
    the diff entirely, so naming it would grant a value that can never be
    written. `member.email` is already the ledger's own actor column.
  - **`core.member_alias` — every column EXCEPT `value` and `note`.** Those two
    are the person's phone, personal email, Telegram/Instagram handles and the
    free-text context around them (spec 124 EARS-17) — the one class this clause
    keeps out, recorded as `{"changed": true}` and nothing else. `id`,
    `member_id` and `kind` are whitelisted: `kind` says WHICH channel changed
    without saying what it is, which is the service half of the same row.
  - **The hours tables — every column** of `hours_period`,
    `hours_participant`, `hours_assessment`, and of `hours_publication` /
    `hours_publication_message` once EARS-31 and EARS-33 let the trigger reach
    them. `hours_publication.messages` is deliberately not among them: the
    trigger does not reach that table at all until the column is gone (EARS-31,
    EARS-33).

  **Revision 2026-08-19 (lead decision, applied in #273):** the clause
  previously listed only `member.name`, `member.email` and `member.slug`, which
  contradicted acceptance scenario 1 — where the owner edits a participant's
  **role** and expects the diff to carry its old and new value. The owner's Q2
  matrix draws the line at personal contacts, not at «identity vs the rest», so
  the clause is corrected in place (the spec is `In dev`; `docs/specs/README.md`
  makes in-place correction the rule at this status) and the scenario stands as
  written.

- **EARS-18 — removed (2026-08-19).** It excluded `hours_publication.messages`
  from the diff. The owner's Q3 answer removes the exclusion and fixes the shape
  that made the column unauditable instead: EARS-31. The id is retired, not
  reused.

**Why exclusion and not masking (the owner's Q2 answer, 2026-08-19).** A partial
mask of the `a*@*.ru` kind is **not обезличивание** and removes no obligation
under 152-ФЗ. The value is not what ties an audit row to a person — the `pk` in
the same row is — so masking hides the _value_ and never the _attribution_, and
with a team of ~11 the re-identification is arithmetic rather than analysis.
Приказ Роскомнадзора № 140 (in force 2025-09-01, replacing № 996) additionally
requires the original and the depersonalised data **not** to be stored together,
which a diff sitting in the same database as the row it describes can never
satisfy. The clause that actually governs the design is **ст. 5 ч. 5 152-ФЗ**:
the content and volume of processed personal data must correspond to the declared
purpose and excess is not allowed — and the purpose «кто, когда, какое поле
изменил» is fully served by the fact of the change. The industry default has the
same shape (`excluded_cols` in Audit trigger 91plus, `exclude_fields` in
django-auditlog, `skip:` in Rails paper_trail, «do not put PII into free-form
fields in the first place» in AWS's own guidance), and OWASP's logging cheat
sheet lists **deletion first**, masking only as an alternative. Sources:
§«Research behind the 2026-08-19 revision». **[ЮР]** The legal qualification —
the basis of processing, the wording in the ЛНА, whether and how приказ № 140
applies to purely internal depersonalisation — stays with the owner and his
lawyer; this spec only builds so that the question has the smallest possible
surface.

- **EARS-27.** The whitelist shall be **default-deny for values**: a column of
  an audited table that the trigger's arguments do not name shall be recorded as
  `{"changed": true}`. Recording a value is therefore something a migration
  grants explicitly, one column at a time, and never something an omission grants
  silently. Named consequence, and the reason this is the chosen direction: a
  forgotten whitelist entry degrades the ledger to «we know what changed but not
  to what» — recoverable by a one-line migration, going forward — while a
  forgotten exclusion writes personal data in the clear into an append-only table
  that nothing can redact (EARS-28). The two failure modes are not symmetric, and
  this clause picks the recoverable one.
- **EARS-28.** Exclusion shall be understood as **prospective only**: it is
  applied at write time and the ledger is append-only (EARS-12), so widening the
  whitelist later starts recording values from that moment on, and narrowing it
  later does nothing to values already written. IF a value that should not have
  been recorded has reached the ledger, THEN the platform shall offer **no**
  redaction path at delivery; the sanctioned redaction/erasure procedure is a
  named follow-up (§«Out of scope») — **the same single follow-up that carries
  retention** (EARS-32), because purge-by-period and erasure-by-subject are one
  privileged function or they are two ways to break the same invariant twice —
  and its trigger is the first erasure request from a data subject or the first
  whitelist narrowing that must reach rows already written. This clause exists so the property is decided rather than
  discovered, and what makes it safe to ship today is EARS-17: declared personal
  data does not enter the ledger in the first place, so there is nothing to
  redact. Factual note, not legal advice: 152-ФЗ places obligations on an
  operator of personal data around deletion and rectification on the subject's
  request (ст. 21), and a system's own «append-only» is not a recognised
  exception to them — **[ЮР]**, the owner's call with his counsel.

- **EARS-32.** Retention shall be **indefinite by construction** for as long as
  this design stands: EARS-12 refuses every `DELETE` on the ledger and this spec
  ships **no** delete path at all — no scheduled purge, no partition drop, no
  privileged bypass, no disable-trigger window. The **retention period is a
  parameter of the owner's personal-data policy** — «срок хранения = <the value
  set in the PD policy by the owner and his lawyer>» — recorded there, referenced
  from here, never invented in this spec, and carried as the **input** of the
  Q7 follow-up (§«Out of scope»). That follow-up has **one** deliverable serving
  **both** purposes: a single privileged function that performs purge-by-period
  against the policy's named term and erasure-by-subject against ст. 21 152-ФЗ —
  breaking the append-only invariant on purpose, under its own grant, and writing
  its own ledger row recording what was removed, by whom and why. The pressure
  for a named term is legal and comes from two directions at once —
  **ст. 5 ч. 7 152-ФЗ** (personal data are stored no longer than the purpose
  requires and are destroyed or depersonalised once it is achieved) and
  **РСБ.1 / РСБ.3 приказа ФСТЭК России № 21** (the recorded security events **and
  their retention period** are defined, and the records are kept for that period;
  РСБ.7 additionally protects them from modification, which is what EARS-12
  implements). Both are **[ЮР]** items: the number, the legal basis and the ЛНА
  wording stay with the owner and his lawyer, and no agent fills them in. What
  this clause fixes is the honest state — the term can be **named** today and
  cannot be **executed** until the follow-up lands, which is a stated gap with an
  owner-facing trigger rather than a mechanism the ledger silently refuses.

### Coverage

- **EARS-19.** The platform shall provide a CI guard
  `tools/lint/audit-coverage-lint.mjs` (alias `pnpm lint:audit-coverage`) that
  enumerates every `core` table declared under
  `src/lib/platform/db/schema/**/*.ts`, scans the migration chain for
  `CREATE [OR REPLACE] TRIGGER … EXECUTE FUNCTION core.audit_row_change(<args>)`
  attachments — with the whitelist argument list captured, not assumed empty,
  because EARS-29 has to read it — minus later `DROP TRIGGER`s, and fails when a table is neither
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
- **EARS-22.** Coverage shall be defined **by construction, not by
  enumeration**: every platform domain table in `core` — the ones that exist
  today and every one added later — shall carry the capture trigger, and a table
  that lands without one shall turn the coverage guard (EARS-19) and the
  integration assertion (EARS-21) red. A table shall leave the audited set only
  through an **explicit allowlist entry carrying a written rationale**, reviewed
  in the diff that adds it. Today's value of that rule is exactly the six `core`
  domain tables that exist — `member`, `member_alias`, `hours_period`,
  `hours_participant`, `hours_assessment`, `hours_publication`, joined by
  `hours_publication_message` when EARS-31 lands — with `audit_event` and
  `__drizzle_migrations` allowlisted (recursion; drizzle bookkeeping). The list
  is the current value; the rule is the clause.

- **EARS-29.** The coverage guard shall also assert the **completeness of the
  value whitelist**: for every audited table, every column declared under
  `src/lib/platform/db/schema/**/*.ts` shall appear in exactly one of two places
  in the migration chain — the trigger's whitelist arguments, or a
  guard-readable excluded-columns list carrying a **mandatory rationale**
  (`member_alias.value` and `member_alias.note` carry «ПДн — ст. 5 ч. 5 152-ФЗ»
  as theirs). A column named in neither shall be a finding, and a bare or empty
  rationale shall itself be one. The integration counterpart (EARS-21) shall make
  the same assertion against the really-migrated database, comparing the trigger
  arguments read from `pg_trigger.tgargs` with `information_schema.columns`.
  Default-deny (EARS-27) is what makes an unnamed column **safe**; this clause is
  what makes it **visible**, so «no values are recorded at all because nobody
  updated the trigger arguments» cannot pass for a working audit.

### Reading it

- **EARS-23.** WHILE no UI over the ledger exists, the read path shall be SQL run
  by an agent against the platform database — as the single role of ADR-004 §3
  today, and as a role that explicitly keeps `SELECT` on the ledger after
  EARS-30's follow-up lands — with the result pasted into the
  issue — the shape spec 124 (EARS-19, scenario 7) already established for alias
  resolution. No page, no route, no host change.

## How it lands in our pipeline

**One migration, hand-written SQL.** drizzle-orm 0.45 can express neither a
PL/pgSQL function, nor a trigger, nor a grant, so the migration is pure SQL:
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
believe it owns a table whose protections it cannot describe — the two
append-only triggers of EARS-12, and the ownership split and revoked grants
EARS-30's follow-up will add on top of them — and would happily emit a duplicate
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
  back in the trigger with `nullif(current_setting(<name>, true), '')` — the
  two-argument form, which returns NULL for an unset GUC instead of erroring, so
  the trigger raises **its own** message («audit: actor context not set — call
  set_config('app.actor_email', …, true) inside the transaction») rather than
  Postgres's unreadable «unrecognized configuration parameter». A session-level
  `SET` is forbidden: it would outlive the transaction and stamp
  the next borrower of that pooled connection with the previous actor.
- **The app-connection mark (EARS-26):** a session GUC set once per physical
  connection through the pool's libpq `options` (`-c app.connection=app`) in
  `src/lib/platform/db/client.ts`, not per transaction — so it is a property of
  «who opened this socket», which is exactly the distinction the trigger needs
  and exactly what a `psql` session or the drizzle-kit migration runner does not
  carry. **Assumption, stated because it is load-bearing:** no transaction pooler
  sits between the application and Postgres — true today (the app connects to the
  database directly), and it has to stay true, because under transaction pooling
  a session-scoped GUC would be shared by whoever borrows the physical connection
  next and the mark would stop meaning «this socket is the app's». **The mark lives in code and never in `PLATFORM_DATABASE_URL`:** `pg`
  merges the parsed connection string **over** the explicit config
  (`pg/lib/connection-parameters.js`), so an `options=` parameter in the URL
  would both overwrite the code's mark and stamp drizzle-kit's own runner as the
  app — after which a data-bearing migration (`source = 'migration'`) would be
  refused by EARS-26. The environment variable carries no `options=`.
- **`search_path` and rights on the new functions.** The donor pins neither
  `search_path` nor `SECURITY DEFINER`. Here both are pinned:
  `core.audit_row_change()` is created `SECURITY DEFINER` with
  `SET search_path = pg_catalog, core` — the pinned path being what closes the
  search-path hijack `SECURITY DEFINER` otherwise opens. Under today's single
  superuser role (EARS-12) `SECURITY DEFINER` changes nothing at all; it is
  written now so that EARS-30's least-privilege follow-up is a grant change and
  not a rewrite of the function. With the column policy moved into `TG_ARGV`
  (EARS-16) the function reads no table other than the ledger it writes, which is
  what makes the pinned path sufficient.
- **The role picture today, named once so no clause has to imply it.** One
  Postgres role exists — the container superuser of
  `infra/dev-stand/compose.core.yml` and `deploy/docker-compose.prod.yml`, shared
  by Payload, Zitadel and the platform; `src/lib/platform/db/client.ts` and
  `drizzle-kit` both use the single `PLATFORM_DATABASE_URL` (ADR-004 §3). This
  migration therefore issues **no** `CREATE ROLE`, **no** `ALTER TABLE … OWNER
TO` and **no** `REVOKE`: all three would be no-ops at best and a broken deploy
  at worst. They belong to EARS-30's follow-up, together with the ADR-004 §3
  amendment a second connection string would require.

**What the connection mark pulls into the delivery (EARS-26's real scope).**
`getPlatformDb()` is the only pool, so once it is marked, **everything** writing
through it must carry a context or be refused: the `cli:*` scripts
(`cli:<name>`), the seeding and fixture helpers under `tests/int/platform/`, and
any future scheduled writer (`system:<job>`). None of these is a new mechanism —
each passes a context to the same EARS-24 helper — but they sit inside the
implementation task's scope rather than a follow-up: a delivery that marks the
pool without converting them turns its own test seeds into failed writes.

**Order inside the migration.** Ledger + its indexes → `core.audit_row_change()`
and its helpers → the ledger's own guard triggers (`BEFORE UPDATE OR DELETE` and
`BEFORE TRUNCATE`) → the per-table attach lines, carrying their value whitelists,
**last** — and `core.hours_publication` is not among them (EARS-33). No grant or
ownership statement appears: see «The role picture today» above. Nothing is retro-backfilled: the trail starts at
the attach, and the migration itself therefore produces no ledger rows.

**Expand/contract.** Pure expand — one new table with its indexes, two
functions, the ledger's own two guard triggers, one capture trigger per audited
table. (The contract step of EARS-31 belongs to its own sub-task and its own
release; nothing in **this** migration drops anything.) The previous app image
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
append-only refusal (row-level and `TRUNCATE`), `db-direct` degradation, the
value whitelist and trigger coverage are all asserted there against real
Postgres. The privilege echelon is **not** asserted there, and could not be:
there is one role (EARS-12), and the assertion arrives with EARS-30's follow-up. None of this is testable against a
mock: a mock would assert our opinion of what Postgres does.

## Deviations from the donor (ds-platform spec 010)

Recorded the way `docs/ci-guardrails.md` §7 records the guard family's
deviations — a port is judged by whether its differences are named.

| Donor                                                                                                       | Here                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuses an existing `audit_ledger`, packing `{table, pk, diff, source, txid}` into a `metadata` jsonb blob   | New `core.audit_event` with those as **first-class columns**                                                                                                                        | The blob was a constraint of reusing a table the feature did not own. We create the table, so a queryable, indexable shape is free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Actor = Zitadel `sub` (`app.actor_sub`)                                                                     | Actor = normalized email (`app.actor_email`)                                                                                                                                        | This estate keys on email end to end — `HOURS_ADMIN_EMAILS`, `sessionEmail()`, spec 124 EARS-2's DB-enforced normalization. A `sub` would need a join to be readable, and we have no table mapping it.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pg_partman` 5.4.3 + the `pg_partman_bgw` background worker                                                 | **No partitioning at all** — a plain table with a BRIN index on `created_at` (EARS-11)                                                                                              | Owner decision Q5 (2026-08-19). Not «the same idea done by hand»: partitioning itself is out. At ~500 rows a month the ledger is 3–4 orders of magnitude below PostgreSQL's own «bigger than the server's RAM» threshold, and none of the canonical trigger-audit designs partitions. §«Rejected alternatives» carries the numbers and the re-add trigger.                                                                                                                                                                                                                                              |
| PD registry = a SQL function with a hardcoded `CASE`, mirrored by a TS constant, parity held by an e2e test | A **value whitelist passed as trigger arguments** in the migration, default-deny, completeness checked by the guard (EARS-16, EARS-27, EARS-29)                                     | Owner decision Q2 (2026-08-19), and the donor canon's own shape (`excluded_cols` in Audit trigger 91plus), inverted to a whitelist. One source, inside the versioned schema, reviewed in the PR that adds a column — no TS mirror, no parity test, and no registry **table**: a policy living in data is state outside the migration chain that one `DELETE` can empty. The residual cost is named: a new column on an audited table needs its whitelist entry in the same migration, or its values are recorded as `{"changed": true}` until one lands — which is the recoverable failure, by EARS-27. |
| ADR-0009 retention: 5 years + crypto-shred at term (mechanism itself deferred to ds #383)                   | Retention is a **parameter of the owner's personal-data policy** (EARS-32); no crypto-shred mechanism here                                                                          | Owner decision Q1 (2026-08-19). No retention contract exists in this repo, and inventing a term would be an agent taking a data-policy decision the estate has never taken; the term is set in the PD policy by the owner and his lawyer (**[ЮР]**), and this spec ships **no** delete path for it at all (EARS-32): the term is the input of the single privileged purge/erasure function filed as the Q7 follow-up. Crypto-shredding is additionally the wrong bet in this jurisdiction — whether destroying a key counts as destroying the data under ст. 21 is unsettled.                           |
| `event_id` uuid + a partition-scoped dedup unique                                                           | Dropped                                                                                                                                                                             | It serves idempotent-replay semantics the donor's ledger needs for its other event families (`auth.*`). Trigger rows are distinct facts; porting it here would be dead columns.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `source` set `admin-ui \| portal-api \| system:<job> \| migration \| manual-dba`                            | `portal \| system:<job> \| cli:<name> \| migration \| manual-dba`                                                                                                                   | One app, one portal host (ADR-003 §1) — `admin-ui` vs `portal-api` has no referent here; `cli:` names our own scripts. `system:<job>` is **kept**: under EARS-26 the marked pool refuses a context-less write, so an app-initiated write with no user (outbox drain, scheduled job) needs a legal value, and this is it.                                                                                                                                                                                                                                                                                |
| Attribution enforced by convention plus a unit seam; a runtime interceptor named as a future option         | Attribution is a required helper argument **plus** a handle type with no `.transaction`, **plus** an eslint rule, **plus** a database-side refusal on app connections (EARS-24..26) | A required argument alone is the donor's own convention wearing a type annotation: it binds only callers who already chose the helper. The three additions are what make it fail-closed; the last one is the only mechanism that also covers code we have not written yet.                                                                                                                                                                                                                                                                                                                              |
| The trigger degrades to `db-direct` for **every** context-less write, app included                          | Degrades only for connections that are not the app's; an app connection with no context is **refused** (EARS-26)                                                                    | The donor's uniform degradation would record an app write that skipped the wrapper as `db-direct` — a false statement about the door, in the one table whose value is that it is believed. Cost, named: a missed call-site is a failed save instead of a wrong row.                                                                                                                                                                                                                                                                                                                                     |
| Three files (`requirements` / `design` / `scenarios.feature`)                                               | One EARS spec                                                                                                                                                                       | `docs/specs/README.md` is this repo's format; `author-feature-spec` already records the same deviation for the skill it was ported from.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Coverage guard is the only coverage check                                                                   | Guard (WARN) **plus** a catalog assertion in the BLOCK `platform-int` job                                                                                                           | A text scan of migration files cannot see the database. We have a real Postgres in CI and no reason to leave the stronger check unwritten.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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
  lifecycle, and nothing at all for `core`. The owner's Q4 answer keeps `cms` out
  of scope; this is the reason that is not a gap.
- **Partitioning the ledger** — monthly RANGE partitions, a DEFAULT partition and
  a `core.audit_ensure_partitions()` maintenance function, the shape this spec
  carried until 2026-08-19 (removed EARS-13, EARS-14). Rejected on the numbers.
  PostgreSQL's own guidance puts the threshold at «the size of the table should
  exceed the physical memory of the database server»; practitioners name
  50–100 GB or ~100M rows; this ledger is 3–4 orders of magnitude below that
  (~500 rows a month → ~60k rows and ~120 MB in ten years), and none of the
  canonical trigger-audit designs — Audit trigger 91plus, supa_audit, pgMemento —
  partitions. The machinery is also not neutral while it waits: creating a
  partition while a DEFAULT partition exists scans the DEFAULT under an
  `ACCESS EXCLUSIVE` lock; a row that lands in the DEFAULT blocks the later
  creation of its month; the partition key has to enter the primary key; and the
  typical audit query («вся история этой строки») prunes nothing, so we would pay
  planning over ~120 partitions for no pruning at all. The main prize —
  `DROP PARTITION` of old periods — is the wrong instrument for retention here
  (EARS-32) and no instrument at all for per-person erasure (EARS-28).
  **Re-add trigger, any one of:** `core.audit_event` passes ~50 GB; a
  retention-by-period rule appears that the Q7 follow-up's purge function can no
  longer serve; or
  a routine date-range query degrades past ~1 s with its index in place. The
  retrofit at that point is one evening — create the partitioned table,
  `INSERT … SELECT`, rename — which is exactly why deferring it costs nothing.

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
5. **`TRUNCATE` is refused too.** An agent runs
   `TRUNCATE core.audit_event` on the stand as the ledger's owner. It is refused
   by the `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger, with the message
   pasted as evidence — the operation a row-level trigger would have let through
   in silence. (EARS-12)
6. **A touch is not a change.** Saving an admin form without altering any value
   leaves the ledger unchanged; changing one field writes exactly one row naming
   that one field. (EARS-2, EARS-3)
7. **A deletion keeps the whole row.** Deleting a period that has no assessments
   — the one delete `/p/hours/admin` supports (spec 081 §16) — writes a row whose
   diff carries **every whitelisted** column of the removed row under `old`
   (every column of `hours_period`, by EARS-17), so the deleted record is
   reconstructable, together with its primary key read from the catalog.
   (EARS-2, EARS-4, EARS-16)
8. **Personal data never lands in the ledger, in any form.** An agent changes a
   `member_alias.value` (a phone number) and a `member.name` in one SQL
   transaction. The ledger records the alias column as `{"changed": true}` — no
   `old`, no `new`, no mask, no hash — with the number appearing nowhere in the
   row (checked by grepping the row's whole text for the digits), and the name
   change with both values in the clear. (EARS-16, EARS-17, EARS-27)
9. **A new column records nothing until it is whitelisted.** On a branch, an
   agent adds a column to an audited table in a migration **without** adding it
   to the trigger's whitelist arguments and edits it on the stand: the ledger
   row carries `{"changed": true}` for it — default-deny — rather than its
   value. `pnpm lint:audit-coverage` names the column and exits 1; naming it in
   the whitelist arguments, or in the excluded-columns list **with** a
   rationale, turns it green, and a bare rationale still exits 1. The
   integration counterpart sees the same thing from `pg_trigger.tgargs` against
   the really-migrated database. (EARS-1, EARS-27, EARS-29, EARS-21)
10. **Coverage against reality.** The `platform-int` job is green with every
    audited table's trigger present in `pg_trigger` — `core.hours_publication`
    being, until EARS-33 lifts it, an allowlisted absence with its rationale
    rather than a silent one; dropping one trigger locally turns that job red,
    and `core.audit_event` itself carries no capture trigger.
    (EARS-15, EARS-21, EARS-22, EARS-33)
11. **Reading it at all.** The owner asks «что менялось по этому человеку за
    неделю». An agent answers with one query over `core.audit_event` filtered by
    `actor_email` and `table_name`, and pastes the rows into the issue. No UI is
    involved. (EARS-11, EARS-23)
12. **An app write cannot go unattributed.** On a stand, an agent runs a build in
    which one hours mutation deliberately bypasses the helper (a throwaway patch,
    not merged). The save fails with the trigger's message naming the missing
    audit context, and no ledger row claiming `db-direct` appears; reverting the
    patch makes the same save succeed and produce an attributed row. The eslint
    rule flags the same patch before it is ever run. (EARS-24, EARS-26)

Three scenarios of the pre-revision spec are gone with their clauses: the
partition horizon (removed EARS-13, EARS-14), the emptied column registry
(replaced by scenario 9, since the registry table no longer exists), and the
privilege-echelon refusal — which is not performable in an estate with one
superuser role and now belongs to EARS-30's follow-up, where it is that
follow-up's own acceptance criterion.

Two scenarios are additionally **blocked on prerequisites and named as such**
rather than quietly assumed: anything touching `core.hours_publication` waits for
EARS-31/EARS-33, and the privilege refusal waits for EARS-30.

## Owner decisions (2026-08-19)

The owner answered Q1–Q7 on 2026-08-19, after the two research memos summarised
below. The questions survive only as the left column: the spec above is written
to the answers, not to the recommended defaults the earlier draft carried.

| Question                                            | Decision (owner, 2026-08-19)                                                                                                                                                                                                                                                                           | Where it lives now                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1 — Retention**                                  | The ledger lives as long as the product. The **term itself is a parameter of the owner's personal-data policy**, set there by the owner with his lawyer, not a number this spec invents; every **[ЮР]** item stays with them.                                                                          | EARS-32: retention is indefinite **by construction** (no delete path in this spec at all), and the policy term is the input of the Q7 follow-up. No `DROP PARTITION` anywhere — that machinery is gone with EARS-13/EARS-14. |
| **Q2 — Personal data in the diff**                  | **Exclude, do not mask.** A value reaches the diff only from an explicit whitelist of columns; everything else is recorded as `{"changed": true}`. Partial masking (`a*@*.ru`) is rejected: it is neither обезличивание nor protection.                                                                | EARS-16, EARS-17, EARS-27, EARS-28, EARS-29 (+ the «Why exclusion and not masking» note under §Personal data).                                                                                                               |
| **Q3 — `hours_publication.messages`**               | **Do not exclude it — fix the shape.** The messages are normalised into a child table `core.hours_publication_message` (one row per message, explicit `position`, per-row `delivery`/`sent_at`) as a prerequisite sub-task; a delivery step then updates one row and the audit records one small diff. | EARS-31; **EARS-18 removed**. Filed as a blocking sub-task when the spec moves to `In dev`.                                                                                                                                  |
| **Q4 — Payload's `cms` database**                   | **Out of scope, confirmed.**                                                                                                                                                                                                                                                                           | §Out of scope; §Rejected alternatives (Payload's own version history).                                                                                                                                                       |
| **Q5 — Partition maintenance**                      | **No partitioning at all** — the question dissolves with its subject. Plain table, BRIN on `created_at`, BTREE on the query columns.                                                                                                                                                                   | EARS-11; §Rejected alternatives carries the numbers and the re-add trigger; **EARS-13 and EARS-14 removed**.                                                                                                                 |
| **Q6 — How wide the audited set is**                | **Every platform domain table, present and future, by construction.** A new table without the trigger turns the coverage guard red; leaving the set needs an explicit, justified allowlist entry. The six tables of today are the current value of that rule, not the rule.                            | EARS-22, with EARS-19 and EARS-21 as the two checks.                                                                                                                                                                         |
| **Q7 — Remediation for data already in the ledger** | **Append-only stays.** The privileged redaction/erasure function becomes a **follow-up with a named trigger**: the first erasure request from a data subject, or the first whitelist narrowing that has to reach rows already written.                                                                 | EARS-28, EARS-32 and the follow-up bullet in §Out of scope — one privileged function for purge-by-period **and** erasure-by-subject; no longer an open question.                                                             |

### Research behind the 2026-08-19 revision

Two memos, both read in full before this revision. They are research notes, not
legal advice; **[ЮР]** marks what stays with the owner and his lawyer.

**Memo 1 — personal data in an immutable ledger (152-ФЗ).**

- An audit log containing personal data is **processing** of personal data, not
  a technical artifact: ст. 5, 18.1, 19, 21 152-ФЗ apply to it in full.
- **Masking is not обезличивание.** Приказ РКН № 996 lost force on 2025-09-01;
  приказ РКН № 140 (in force since then) lists four methods, none of which an
  `a*@*.ru` mask satisfies — and № 140 additionally forbids storing the original
  and the depersonalised data together, which a diff in the same database
  structurally cannot honour.
- The mask fails **structurally** before it fails legally: the audit row carries
  the subject's key, so the value is not what identifies the person. With ~11
  subjects, re-identification is trivial.
- **ст. 5 ч. 5 152-ФЗ (no excess)** is the strongest argument for exclusion: the
  purpose «кто, когда, какое поле изменил» is fully met by the fact of the
  change, so the value itself is excess data in a second copy.
- **ст. 5 ч. 7 152-ФЗ + РСБ.1/РСБ.3 приказа ФСТЭК № 21** demand a **defined
  retention period** from two sides at once; РСБ.7 demands the records be
  protected from modification and reachable only by authorised people — which is
  what EARS-12 implements (and EARS-30 completes when the estate gets a real
  application role).
- ст. 21 knows no «our log is append-only» exception (blocking, rectification,
  destruction within 3/7/10/30 days depending on the ground), so a design must
  either have nothing to delete, or own a deletion procedure. Exclusion is the
  «nothing to delete» branch, and at 11 subjects it is an order of magnitude
  cheaper than the alternatives.
- Industry does the same: `excluded_cols` (Audit trigger 91plus), `exclude_fields`
  (django-auditlog), `excluded_fields` (django-simple-history), `skip:`
  (paper_trail), `except:` (Rails `audited`); nobody ships partial masks, and
  automatic PII detection exists nowhere — the developer names the column.
- If a value is ever genuinely needed for comparison, only a **keyed HMAC with
  the secret outside the database** qualifies; a bare `sha256` of a phone number
  is reversible by brute force and is therefore still personal data.

**Memo 2 — audit-log design on Postgres 16 (market standard).**

- The core of the draft is the market standard: one generic AFTER row-level
  trigger, one ledger, jsonb diff, actor from a transaction-scoped GUC.
- **Monthly partitioning is unjustified by 3–4 orders of magnitude** — the
  documented threshold is «table bigger than the server's RAM», practitioners say
  50–100 GB, and this ledger is ~500 rows a month. None of 91plus, supa_audit or
  pgMemento partitions.
- A DEFAULT partition is an **active risk, not a neutral hedge**: attaching a new
  partition scans it under `ACCESS EXCLUSIVE`, and a stray row in it blocks the
  creation of its month.
- The retrofit later is one evening (`CREATE` partitioned, `INSERT … SELECT`,
  rename) — which is exactly why deferring costs nothing.
- What the draft actually under-specified: `REVOKE UPDATE, DELETE, TRUNCATE` as
  the **primary** append-only mechanism (the trigger is second echelon — a table
  owner disables it with one statement), a **`BEFORE TRUNCATE FOR EACH
STATEMENT`** trigger (row-level triggers do not fire on `TRUNCATE` at all), and
  `SECURITY DEFINER` on the trigger function. The last two land here; the
  `REVOKE` half has **no delivery path in this estate** — one superuser role, no
  second credential anywhere — so it is filed as EARS-30's follow-up instead of
  being written as though it were in place. The memo's judgement stands; what is
  missing is a role, not a decision.
- Actor attribution: `SET LOCAL` / `set_config(…, true)` only — a session-level
  `SET` leaks across a transaction pooler and attributes one person's change to
  another; read with `current_setting(name, true)` plus an explicit `RAISE` whose
  message a developer can act on.
- Fail-closed attribution is **stricter than the market** (Supabase degrades) and
  the memo supports keeping it: a row without an actor is worse than no row,
  because it looks like coverage.
- A jsonb array rewritten whole on every step is a **semantic** problem, not a
  size one — the fix is normalising it into a child table, which is also the
  root-cause fix rather than an exclusion.
- The column policy belongs in **trigger arguments in the migration** (91plus),
  not in a registry table: a registry is configuration living in data, outside
  the versioned schema.

Key sources (the memos carry the rest):

- 152-ФЗ ст. 21 — <https://www.consultant.ru/document/cons_doc_LAW_61801/d3fe43a7c415353b17faab255bc0de92bea127da/>
- Приказ Роскомнадзора № 140 от 19.06.2025 (обезличивание) — <https://www.consultant.ru/document/cons_doc_LAW_511184/>
- Приказ ФСТЭК России № 21 от 18.02.2013 (раздел РСБ) — <https://fstec.ru/dokumenty/vse-dokumenty/prikazy/prikaz-fstek-rossii-ot-18-fevralya-2013-g-n-21>
- OWASP Logging Cheat Sheet («data to exclude», deletion first) — <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
- PostgreSQL wiki, Audit trigger 91plus (`excluded_cols`, «your app must not own the tables it uses») — <https://wiki.postgresql.org/wiki/Audit_trigger_91plus>
- PostgreSQL 16 docs, 5.12 Table Partitioning (threshold, DEFAULT partition lock) — <https://www.postgresql.org/docs/16/ddl-partitioning.html>
- PostgreSQL docs, trigger functions (`TRUNCATE` is statement-level only) — <https://www.postgresql.org/docs/current/plpgsql-trigger.html>
- Supabase, «Postgres Auditing in 150 lines of SQL» (BRIN on the timestamp, no partitioning) — <https://supabase.com/blog/postgres-audit>
- pgEdge, session variables in Postgres (`SET LOCAL` vs `SET` under a pooler) — <https://www.pgedge.com/blog/it-depends-using-session-variables-in-postgres>

## Out of scope

- **The domain `event_log` (D-025, epic #113).** A different table for a
  different purpose: the business journal of what happened, not the column-level
  record of what a row looked like before. Neither replaces the other, and this
  spec creates no part of it.
- **Any UI over the ledger.** The read path is SQL run by an agent until a real
  need appears (EARS-23) — no route, no page, no host change.
- **Payload's `cms` database** — Q4, decided 2026-08-19.
- **Retro-backfill.** The trail starts when the triggers attach; nothing
  reconstructs history from before that moment. What came before is already
  recorded elsewhere: spec 124's cutover import verdict and the frozen
  `hours.json` archive.
- **The normalisation of `hours_publication.messages` itself (EARS-31).** It is a
  prerequisite **sub-task** against the hours module, opened with
  `spec-issue-graph` and blocking the trigger attach on
  `core.hours_publication` — not part of this spec's own migration, and not part
  of the PR that carries this spec.
- **The sanctioned purge / erasure procedure over the ledger — one follow-up for
  both retention and redaction.** A privileged function that removes or rewrites
  named rows breaks the append-only invariant on purpose, so it needs its own
  clause, its own grant and its own ledger row recording what happened, by whom
  and why. It serves **both** purposes: purge-by-period against the retention
  term named in the owner's PD policy (EARS-32) and erasure-by-subject against
  ст. 21 152-ФЗ (EARS-28). Until it lands there is **no delete path of any kind**
  — this spec deliberately ships none, so «retention» today means «indefinite».
  **Named trigger** (owner's Q7, 2026-08-19): the first erasure request from a
  data subject, or the first narrowing of the value whitelist that has to reach
  rows already written — whichever comes first; the PD policy naming a term is
  what makes the purge half executable. What makes shipping without it safe today
  is EARS-17: declared personal data never enters the ledger.
- **A least-privilege application role for `platform` (EARS-30).** The ownership
  split and the `REVOKE UPDATE, DELETE, TRUNCATE` that would make the ledger
  tamper-resistant against more than an accident. It is a follow-up because this
  estate has exactly one Postgres role — the container superuser — and creating a
  second one reaches into the dev stand, the CI service container,
  `deploy/.env.prod` and, if `PLATFORM_DATABASE_URL` stops being a single string,
  ADR-004 §3 itself. Until then EARS-12's trigger is the whole enforcement, and
  the spec says so where it matters instead of implying otherwise.
- **Hashing or encryption of excluded values.** The donor names
  per-subject-key encryption as a tracked follow-up; here it would need a
  key-management story this estate does not have, and a bare hash of a phone
  number or an email is reversible by brute force and therefore still personal
  data. Excluded stays excluded — the fact of the change without the value is
  the safer of the two incomplete states.
- **Partitioning the ledger.** Rejected with a named re-add trigger — see
  §«Rejected alternatives».
- **Promoting the coverage guard to BLOCK.** A `docs/ci-guardrails.md` §4
  promotion, earliest four weeks after the guard lands, done as its own
  three-edit PR.
- **Implementation.** This spec is the subject of the owner's stage-2 «go». The
  migration, the transaction helper, the guard and the tests are follow-up tasks
  opened from it with `spec-issue-graph` after acceptance, and their numbers are
  written back here.
