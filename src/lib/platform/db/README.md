# Platform database — `platform` / schema `core`

The platform's own persistence layer (#125), and its own migration pipeline.
Canon for the decision: `docs/superpowers/specs/2026-08-04-platform-consolidation-design.md`
§4 «Ядро core»; module boundaries: [ADR-002](../../../../docs/adr/002-repository-and-module-strategy.md).

## Two databases, two pipelines, no overlap

|                    | Payload / CMS                | Platform                              |
| ------------------ | ---------------------------- | ------------------------------------- |
| database           | `cms`                        | `platform`                            |
| schema             | `public`                     | `core`                                |
| connection string  | `DATABASE_URL`               | `PLATFORM_DATABASE_URL`               |
| migrations live in | `src/migrations`             | `src/lib/platform/db/migrations`      |
| ledger table       | `payload_migrations`         | `core.__drizzle_migrations`           |
| driven by          | `pnpm migrate` (Payload CLI) | `pnpm platform:migrate` (drizzle-kit) |

Both databases sit in the **same** Postgres container — dev and prod alike. That
is the only thing they share. `schemaFilter: ['core']` keeps drizzle-kit from
even looking at anything else, and there is deliberately **no** fallback from
`PLATFORM_DATABASE_URL` to `DATABASE_URL`: a fallback would run our migrations
against Payload's database, and the failure would show up as damage rather than
as an error.

## Commands

```bash
pnpm platform:migrate:generate   # diff the schema files → a new SQL migration
pnpm platform:migrate:status     # what would `platform:migrate` do next
pnpm platform:migrate            # ensure the database exists, then apply
pnpm platform:db:ensure          # the ensure step alone (idempotent)
```

All four carry the repo's `pre*` Node-22 guard (`node scripts/require-node.mjs`),
like the Payload `migrate*` scripts next to them in `package.json`.

**The ensure step** (`tools/platform/ensure-database.mjs`) is why dev and prod
bootstrap identically. A Postgres container creates exactly one database from
`POSTGRES_DB`, so the second one has to be created by somebody; the dev Zitadel
already solves this the same way, creating its own `zitadel` database on first
boot. The step connects to the maintenance database derived from
`PLATFORM_DATABASE_URL`, runs at most one `CREATE DATABASE`, logs which of the
two things it did — and refuses every input where "create a database" could mean
something else: a non-postgres scheme, a missing or non-identifier database name,
the maintenance database itself, or `cms`.

### A generated `CREATE SCHEMA` must be patched to `IF NOT EXISTS`

`drizzle-kit generate` emits a bare `CREATE SCHEMA "core";`, and applying that is
a guaranteed **42P06 duplicate_schema** here — because our ledger lives at
`core.__drizzle_migrations`, so the migrator creates the `core` schema itself, to
hold the ledger, _before_ it applies migration 0000. (Found on the dev stand,
2026-08-11: the run aborted with zero migrations applied.) The same idempotence
is what lets a migration re-run against a database where a partial run or a
restore already left the schema in place.

So `0000_create_core_schema.sql` is hand-patched to `CREATE SCHEMA IF NOT EXISTS
"core";`. **Re-generating it re-emits the bare form** — patch it again.
`tests/unit/platform-db-config.spec.ts` asserts no migration in this directory
carries a non-idempotent `CREATE SCHEMA`, so a forgotten patch goes red in CI
rather than on prod.

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

**No product tables yet, on purpose.** `member`, `hours` and the rest are product
work (#124 and the follow-ups in epic #111); the initial migration creates the
`core` schema and nothing else.

## Boundaries

Two rules in [`.dependency-cruiser.cjs`](../../../../.dependency-cruiser.cjs)
make the separation machine-checked (`pnpm boundaries`):

- **`cms-must-not-import-platform-db`** — CMS-side code may not open this
  database.
- **`module-must-not-import-foreign-tables`** — a module may import table files
  from `schema/<its own name>/` only. See [`schema/README.md`](./schema/README.md)
  for why the directory layout is what makes this expressible, and
  `tests/unit/platform-boundaries.spec.ts` for the fixtures that prove
  `pnpm boundaries` really goes red.

## Production

`pnpm deploy:prod` applies **both** pipelines, in its `deployStack` stage — which
runs after the fail-closed `checkpoint`, so neither schema can advance without a
fresh dump behind it. Backups, retention and the cross-repo dependency:
[`deploy/README.md`](../../../../deploy/README.md) → _Platform database_.
