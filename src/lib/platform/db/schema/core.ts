/**
 * The `core` Postgres schema (#125, spec 2026-08-04 §4 «Ядро core»).
 *
 * The only shared file in this directory, and the reason the initial migration
 * has anything to say at all: declaring the schema is what makes drizzle-kit
 * emit `CREATE SCHEMA "core"`. Everything else here is per-module — a module's
 * tables are built from this handle inside its OWN directory
 * (`./<module>/tables.ts`), never here.
 */
import { pgSchema } from 'drizzle-orm/pg-core'

export const core = pgSchema('core')
