# Platform database — `platform` / schema `core`

How to work the platform's persistence layer (#125). **This file is the operating
manual, not the decision record.** Every decision below — the separate `platform`
database and its second connection string, the exact drizzle pins and the re-pin
rule on a Payload upgrade, the pipeline's separation table, the idempotent
`CREATE SCHEMA`, the ensure step, the table-ownership boundaries and the
snapshot-before-migrate arrangement — is recorded once, with its alternatives and
its consequences, in
[**ADR-004**](../../../../docs/adr/004-platform-persistence-foundation.md). Read
that for _why_; read this for _what to run_.

Also binding: [ADR-002](../../../../docs/adr/002-repository-and-module-strategy.md)
(module boundaries), and the consolidation spec
`docs/superpowers/specs/2026-08-04-platform-consolidation-design.md` §4 «Ядро core».

## Commands

```bash
pnpm platform:migrate:generate   # diff the schema files → a new SQL migration
pnpm platform:migrate:status     # what would `platform:migrate` do next
pnpm platform:migrate            # ensure the database exists, then apply
pnpm platform:db:ensure          # the ensure step alone (idempotent)
```

All four carry the repo's `pre*` Node-22 guard (`node scripts/require-node.mjs`),
like the Payload `migrate*` scripts next to them in `package.json`.

`platform:migrate:status` exits **non-zero** on an UNREACHABLE or ORPHAN
migration (see below) and 0 on a merely pending one — pending is a normal state,
the other two are the tree and the database disagreeing about history.

### Where `PLATFORM_DATABASE_URL` is read from

`.env` in the repo root, and the process environment — in that order of loading,
with the **environment winning**:

- `tools/platform/*.mjs` (`db:ensure`, `migrate:status`) load `.env` through
  `tools/platform/load-env.mjs`, which wraps Node 22's `process.loadEnvFile()`.
  It does not overwrite an already-set variable, so
  `PLATFORM_DATABASE_URL=… pnpm platform:migrate` still points one command at
  another stand.
- `drizzle-kit` bundles `dotenv/config` and reads the same `.env` by itself.

A missing `.env` is normal (prod and CI have none) and is not an error; a missing
**value** is, and every command fails closed naming the variable.

### After a rebase that reorders migrations: regenerate, don't re-merge

drizzle applies a migration only when its timestamp is **strictly newer** than
the newest one already in the ledger. So a migration generated in one worktree
before — but merged after — one generated in another is **never applied**, and
`drizzle-kit migrate` exits 0 the whole time. In a repo where parallel worktrees
are the norm ([`.claude/rules/parallel-sessions.md`](../../../../.claude/rules/parallel-sessions.md)),
that is a live hazard, not a curiosity.

`pnpm platform:migrate:status` names this state **UNREACHABLE** and exits
non-zero rather than showing an eternally-pending row. The fix is always the
same: delete the stranded migration and re-run `platform:migrate:generate` on top
of current `main`.

`platform:migrate` runs the ensure step (`tools/platform/ensure-database.mjs`)
first, so a database that does not exist yet is not an error you have to handle
by hand — on a fresh `pgdata` volume, in dev or in prod alike. It is idempotent
and prints which of the two things it did. Why it exists rather than a line in a
compose file: ADR-004 §5.

### After `platform:migrate:generate`: patch a generated `CREATE SCHEMA`

drizzle-kit emits a bare `CREATE SCHEMA "core";`. **Applying that here is a
guaranteed 42P06 `duplicate_schema`** — ADR-004 §4 has the mechanism and the live
run that found it. Patch every such statement to `CREATE SCHEMA IF NOT EXISTS
"core";` before committing the migration.

`tests/unit/platform-db-config.spec.ts` asserts that no migration in this
directory carries a non-idempotent `CREATE SCHEMA`, so a forgotten patch goes red
in CI rather than on a fresh database.

## Files

```
config.ts            the contract as pure values (schema, dirs, the URL rule)
drizzle.config.ts    binds it to process.env — the file `--config` names
client.ts            the drizzle handle; one pool per process
schema/core.ts       pgSchema('core') — the shared handle
schema/<module>/     per-module table files (see schema/README.md)
migrations/          generated SQL + drizzle's journal — COMMITTED
```

`drizzle.config.ts` deliberately does not sit at the repo root: a root-level
`drizzle.config.ts` reads as "the project's drizzle config", and this project
contains a second, unrelated drizzle inside `@payloadcms/db-postgres` that it
must never be mistaken for.

**The first product tables are `member/`** (migration `0001_member`): the shared
people registry `core.member` + `core.member_alias`, owned by `src/lib/member`
(spec [`docs/specs/124-hours-on-core.md`](../../../../docs/specs/124-hours-on-core.md),
issue #255). The `hours` tables and the rest of epic #111 follow; migration
`0000` still creates the `core` schema and nothing else.

## Boundaries

`pnpm boundaries` enforces the table-ownership rules of
[`.dependency-cruiser.cjs`](../../../../.dependency-cruiser.cjs) —
`cms-must-not-import-platform-db`, `module-must-not-import-foreign-tables` and
`route-layer-must-not-import-tables` (ADR-004 §6 states them and why they are
shaped that way). A module that also needs a NEIGHBOUR's API adds its own pair
next to them: `member` did, for `src/lib/member` (spec 124 EARS-8).

What that means when writing code here: put a module's tables in
`schema/<module>/`, import tables only from the directory bearing your own
module's name, and use the flat `schema/core.ts` handle for the schema itself.
[`schema/README.md`](./schema/README.md) has the layout;
`tests/unit/platform-boundaries.spec.ts` has the fixtures that prove
`pnpm boundaries` really goes red.

## Production

`pnpm deploy:prod` applies **both** pipelines, in its `deployStack` stage — which
runs after the fail-closed `checkpoint`, so neither schema can advance without a
fresh dump behind it (ADR-004 §7). Backups, retention and the cross-repo
dependency: [`deploy/README.md`](../../../../deploy/README.md) → _Platform
database_.
