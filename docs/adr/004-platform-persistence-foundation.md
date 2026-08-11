# ADR-004: Platform persistence foundation — the `platform` database, drizzle, and our own migration pipeline

**Status:** Accepted
**Date:** 2026-08-11
**Decider:** Anton Sidorov (owner) — §1 (spec revision 2026-08-04-b, closing the major review of PR #109); the lead, in-session under the owner's go for #125 — §2–§7
**Prepared by:** Claude (implementation session for #125; the live-run finding in §4 came from the owner's run against the dev stand, 2026-08-11)
**Related:** ADR-002 (modular monolith, machine-enforced module boundaries), ADR-003 (`cms` vs `portal` surfaces), consolidation spec `docs/superpowers/specs/2026-08-04-platform-consolidation-design.md` §3 decision 1 + §4 «Ядро core», `bbm-platform-prd` §7.3, issue #125 (owner ruling 2026-08-07: these decisions are recorded as an ADR in the same PR), #124 (`/p/hours` product design), #156 (the pre-migrate checkpoint stage), `sidorovanthon/bbm#112` (cross-repo backup coverage)

## Context

Until #125 this repo had exactly one database — `cms` — owned end to end by Payload: its adapter opened it, its `payload_migrations` table recorded schema history, and `DATABASE_URL` was the only connection string in the estate. Everything the platform stored lived either inside Payload collections or, in the case of `/p/hours`, in a JSON document on a volume.

That does not carry the platform. The consolidation spec makes `core` the master of operational data — `member`, `membership`, `event_log`, `outbox`, the `/p/hours` tables — and everything downstream in epic #111 (the hours migration, the cutover off JSON, Access Sync) needs a real relational home with a migration story before any of it can be designed, let alone built.

Three constraints shaped the answer:

1. **Payload's database is not ours to share.** `bbm-platform-prd` §7.3 puts custom platform services' schemas in their own database, separate from self-hosted products' databases. Payload is a self-hosted product here (ADR-003: `cms.bbm.academy` is only the CMS).
2. **drizzle already exists in this process, invisibly.** `@payloadcms/db-postgres` vendors `drizzle-orm` and `drizzle-kit` as its own internals. Any platform use of drizzle therefore either becomes an explicit dependency or becomes a bet on another package's transitive tree.
3. **Migrations on this estate are forward-only** (`docs/runbooks/migrations-expand-contract.md`) and run on a single VPS whose only recovery point is a dump. A second database doubles the surface a bad migration can damage.

## Decision

### 1. A separate `platform` database, not a schema inside `cms` (owner, 2026-08-04)

The platform core gets its **own database `platform`**, in the **same** Postgres container as `cms`, with schema `core` inside it. The application receives a **second connection string, `PLATFORM_DATABASE_URL`**. Payload's `cms` database, its adapter configuration and its `DATABASE_URL` are untouched and remain purely Payload's.

This is the owner's decision of spec revision 2026-08-04-b, taken when the major review of PR #109 found that the spec's original wording — `core` as a schema reached over the same `DATABASE_URL` — contradicted PRD §7.3. Same instance, because one VPS with one Postgres is the whole estate; different database, because ownership is the property being bought.

### 2. `drizzle-orm` and `drizzle-kit` as exact pins, matched to the Payload adapter

Both are direct dependencies at **exact** versions equal to what `@payloadcms/db-postgres` resolves internally — today `drizzle-orm@0.45.2` and `drizzle-kit@0.31.7` against adapter 3.85.1. `pg` is pinned the same way and for the same reason (`8.20.0`): the driver and the platform tooling open real connections, and a transitive resolution is not a footing for a migration pipeline.

**Upgrade rule: when the Payload adapter moves, re-pin to whatever the new adapter vendors, in the same PR as the Payload upgrade.** Two drizzle copies in one process are harmless while they are the same copy; a caret range is precisely how they stop being one, silently, on an unrelated install.

### 3. Our own migration pipeline, structurally unable to reach `cms`

The platform pipeline is `drizzle-kit` driven by `src/lib/platform/db/drizzle.config.ts`, and is separated from Payload's along every axis at once:

|                      | Payload              | Platform                          |
| -------------------- | -------------------- | --------------------------------- |
| database             | `cms`                | `platform`                        |
| schema               | `public`             | `core` (`schemaFilter: ['core']`) |
| connection string    | `DATABASE_URL`       | `PLATFORM_DATABASE_URL`           |
| migrations directory | `src/migrations`     | `src/lib/platform/db/migrations`  |
| ledger               | `payload_migrations` | `core.__drizzle_migrations`       |
| command              | `pnpm migrate`       | `pnpm platform:migrate`           |

Two properties make the separation structural rather than conventional. `PLATFORM_DATABASE_URL` has **no fallback** to `DATABASE_URL` — an unset variable fails loudly instead of quietly migrating Payload's database. And the ledger lives **inside `core`**, so every object the platform owns sits in one schema that `schemaFilter` also confines drizzle-kit's diffing to.

**Migration order is a parallel-sessions hazard, and is surfaced rather than prevented.** drizzle applies a migration only when its timestamp is strictly newer than the newest one in the ledger. A migration generated in one worktree _before_ — but merged _after_ — one generated in another is therefore never applied, while `drizzle-kit migrate` keeps exiting 0. Preventing that would mean rewriting migration identity on merge; instead `pnpm platform:migrate:status` classifies such a migration as **UNREACHABLE** (as distinct from PENDING) and exits non-zero, and the remedy is fixed: regenerate on top of current `main`, never re-merge. This matters here specifically because parallel worktrees are this repo's normal mode (`.claude/rules/parallel-sessions.md`) and the next two consumers (#124, the hours migration) will generate migrations from separate ones.

### 4. Schema-creating migrations are idempotent (`CREATE SCHEMA IF NOT EXISTS`)

Because the ledger lives at `core.__drizzle_migrations` (§3), drizzle's migrator must create the `core` schema **itself**, to hold the ledger, before it applies migration `0000`. drizzle-kit generates a bare `CREATE SCHEMA "core";`, and the two collide: the owner's live run against the dev stand on 2026-08-11 aborted with Postgres **42P06 `duplicate_schema`**, zero migrations applied. The ordering is deterministic, so this failed on every fresh database and no offline check could have surfaced it.

Every schema-creating statement in `src/lib/platform/db/migrations` therefore uses `IF NOT EXISTS`. This is independently correct beyond the ledger ordering: the ensure step of §5, a partially-applied run and a restore-from-dump each present the same already-there schema. Since `platform:migrate:generate` re-emits the bare form, the invariant is asserted by test over the whole migrations directory rather than trusted to whoever regenerates a file next.

### 5. The database is bootstrapped by an idempotent ensure step, not by compose

`pnpm platform:db:ensure` — run automatically as the first half of `pnpm platform:migrate` — connects to the maintenance database derived from `PLATFORM_DATABASE_URL`, creates `platform` if it is absent, and logs which of the two things it did. Neither compose file creates the database.

The precedent is already in the stand: the dev Zitadel creates its own `zitadel` database inside this same Postgres on first boot. Putting the bootstrap in code rather than in compose gives dev and prod **one** code path, so a fresh `pgdata` volume needs no hand-run `psql` on either side.

The step is deliberately narrow and fail-closed: it runs at most one `CREATE DATABASE` and refuses a non-postgres scheme, a missing or non-identifier database name, the maintenance database itself, and `cms` by name.

### 6. Table ownership is machine-enforced, per module

Two rules in `.dependency-cruiser.cjs` (`pnpm boundaries`, a BLOCK job in CI) extend ADR-002 §3's "a module owns its data and never imports another module's internals" to the database layer:

- **`cms-must-not-import-platform-db`** — CMS-side code may not import `src/lib/platform/db` at all.
- **`module-must-not-import-foreign-tables`** — table files live one directory per module (`src/lib/platform/db/schema/<module>/`), and a module may import only from the directory bearing **its own** name. The shared `schema/core.ts` handle sits flat, outside any module directory, and is importable by all; there is deliberately no barrel file, since a barrel would be a legal one-hop path from any module to any table.
- **`route-layer-must-not-import-tables`** — nothing under `src/app/` may import a table file at all. The rule above keys on `src/(lib|modules)/<module>/`, so without this one a page in the `(platform)` route group could hold any module's table handle while both other rules stayed green: the invariant would be stated and not enforced. A route renders and asks a module for data through its API; it owns no module name, so this rule needs no per-module exception.

This is a **group match** over the module name rather than one rule pair per module, because it has to hold for modules that do not exist yet — `member` and the hours tables arrive with their product cycles. A boundary that must be edited before it can catch anything is not a boundary.

### 7. Snapshot-before-migrate is the existing checkpoint stage, extended

`pnpm deploy:prod` already had a fail-closed `checkpoint` stage (#156) that runs the box's `backup-portal.sh` before anything migrates and pins the resulting dump under a per-deploy S3 key. Rather than a second snapshot mechanism, that stage now pins **every** fresh dump artifact instead of the newest one, and the platform migration runs in the same stage-protected window as Payload's.

Coverage is judged **per database, by matching the dump filenames**, and reported as a warning rather than enforced. Counting files was the first shape and measured the wrong thing — `pinned >= 2` is satisfied by any stray second dump while `platform` is still uncovered, i.e. it goes quiet exactly when the warning is true.

**A second connection string implies a second failure mode at deploy time**, which the same stage ordering answers: `deploy/.env.prod` is host-only and no deploy can write to it, so the first deploy after this change meets a box whose env file predates the code. The pipeline therefore gains a `verifyRemoteEnv` stage that greps that file for every required variable **before** the tree is shipped and before the checkpoint is taken. Placement is the decision: the stack stage runs under `bash -euo pipefail`, so without this gate the missing variable aborts the deploy _after_ the dump and Payload's migration and _before_ `up -d` — a half-finished deploy needing an operator on the box, instead of a refusal that changed nothing.

Dumping the second database is **not** this repo's code: `backup-portal.sh` is owned by the `bbm` ops repo, and extending it to cover `platform` — plus the restore runbook and drill — is delegated to `sidorovanthon/bbm#112`. Because this repo's stage matched on a filename pattern rather than a fixed name, that cross-repo change lands with no edit here. Until it does, the stage names the uncovered database in a warning on every deploy: reported rather than enforced, because hard-failing would hold every deploy hostage to another repository's merge, and passing silently would let the gap be discovered during a restore.

## Consequences

- **#124 and the hours migration inherit a fixed target.** `/p/hours` tables are designed against `core`, with FKs to `member` in the same schema, and appear **only** through `pnpm platform:migrate:generate` + a committed migration. `hours.json` becomes a frozen archive at cutover, not a parallel store.
- **Epics 2–3 inherit the boundary, not just the database.** A new module adds `schema/<module>/`, and the moment it does, `pnpm boundaries` starts enforcing that nobody else reads its tables. Cross-module data goes through a module's API — that constraint is now checked, not reviewed.
- **Payload upgrades acquire a re-pin duty.** Bumping `@payloadcms/db-postgres` without re-pinning `drizzle-orm`/`drizzle-kit`/`pg` puts two different drizzle versions in one process. Renovate will propose the drizzle bumps independently; they are accepted only together with the adapter's.
- **Backup completeness is a cross-repo dependency until `bbm#112` lands.** Prod runs two databases while the box dumps one. The warning line in the deploy log is the standing reminder; the checkpoint remains fail-closed on producing _no_ dump at all.
- **Regenerating migration `0000` reintroduces a production-breaking bug** unless the `IF NOT EXISTS` patch is re-applied. The guard is a unit test over the migrations directory, so the failure surfaces in CI rather than on a fresh database.
- **A third database in one instance is now a pattern, not an exception** (`cms`, `zitadel`, `platform`), each created by its own owner on first use. `POSTGRES_DB` in the compose contracts names only Payload's.

## Rejected alternatives

- **Schema `core` inside the `cms` database, over the single `DATABASE_URL`.** The spec's original shape, **rejected by the owner** in revision 2026-08-04-b after the PR #109 major review: it contradicts `bbm-platform-prd` §7.3, which separates custom platform services' databases from self-hosted products'. It would also make every Payload backup, restore and adapter behaviour a platform concern and vice versa — one `pg_restore` of the CMS would take the platform's data with it.
- **Creating the second database in the compose files** (an init script, or a second `POSTGRES_DB`-style service). Rejected for dev/prod divergence: the dev stand and the prod stack are different files with different lifecycles, so the bootstrap would exist twice and be verified once. The ensure step is one code path exercised identically in both, and the estate already had the precedent (Zitadel).
- **Keeping the drizzle ledger outside `core`** (drizzle's default `drizzle` schema, or `public`). This would have made §4's 42P06 disappear without an `IF NOT EXISTS` — but at the cost of the property that pays for the separation: everything the platform owns lives in exactly one schema, which `schemaFilter` confines and a single `DROP SCHEMA core CASCADE` fully describes. An idempotent DDL statement is a smaller price than a split ownership boundary.
- **Caret or floating drizzle versions.** Rejected because the adapter vendors its own copy: a range lets an unrelated `pnpm install` drift the platform's drizzle away from Payload's, and the two only coexist safely while they are the same version. Exact pins make the coupling visible in `package.json` and reviewable in a diff.
- **A dedicated snapshot step for platform migrations.** Rejected as a second implementation of a contract that already exists (#156) and is owned elsewhere (`bbm`'s `backup-portal.sh`). Two snapshot mechanisms would drift, and the one nobody exercised would be the one relied on during an incident.

---

_Recorded per the owner ruling on issue #125 (2026-08-07): the foundation's decisions belong in `docs/adr/`, in the same PR as the build, not as prose in the issue. §1 restates an owner decision already taken on 2026-08-04; §2–§7 are the engineering decisions of the #125 implementation, taken in-session under that task's go._
