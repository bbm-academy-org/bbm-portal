/**
 * The `core` Postgres schema (#125, spec 2026-08-04 §4 «Ядро core»).
 *
 * The only shared file in this directory, and the reason the initial migration
 * has anything to say at all: declaring the schema is what makes drizzle-kit
 * emit `CREATE SCHEMA "core"`. Note that the generated statement has to be
 * hand-patched to `IF NOT EXISTS` — the migrator creates this schema itself for
 * the ledger before it applies migration 0000, so the bare form is a guaranteed
 * 42P06. See `../README.md` → "A generated CREATE SCHEMA must be patched".
 *
 * Everything else here is per-module — a module's tables are built from this
 * handle inside its OWN directory (`./<module>/tables.ts`), never here.
 */
import { pgSchema } from 'drizzle-orm/pg-core'

export const core = pgSchema('core')
