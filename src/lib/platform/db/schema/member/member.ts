/**
 * `core.member` — the shared people registry (spec 124 EARS-1, EARS-2;
 * consolidation spec §4 «Ядро core»).
 *
 * Owned by the member module (`src/lib/member`) and reachable from any other
 * module ONLY through that module's public API — the boundary is machine-checked
 * by `module-must-not-import-foreign-tables` and the member rule pair in
 * `.dependency-cruiser.cjs` (ADR-004 §6, EARS-8).
 *
 * Two constraints here are load-bearing rather than decorative, because this
 * cycle's only write path for a hand-maintained registry is the owner's SQL
 * escape hatch (EARS-19):
 *
 *  - `CHECK (email = lower(btrim(email)))` — a hand-typed `Anton@BBM.Academy`
 *    would create a SECOND row for a person who already has one, detaching them
 *    from their hours rate. The database refuses it; the module normalizes
 *    before writing so a legal input never meets the constraint.
 *  - `CHECK (status in ('active','inactive'))` — the enum stays text with a
 *    CHECK, per the spec's column-type table.
 *
 * Money attributes deliberately do NOT live here (EARS-2/EARS-3): fork, grade
 * and the rate snapshots belong to the hours module's own tables. A member
 * without a `hours_participant` row is simply not an hours participant.
 */
import { sql } from 'drizzle-orm'
import { check, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'

export const member = core.table(
  'member',
  {
    /** Surrogate integer PK (EARS-2) — the email is an attribute, never the key. */
    id: serial('id').primaryKey(),
    slug: text('slug').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role'),
    status: text('status').notNull().default('active'),
    /** IANA zone name; the team's default, not a per-request preference. */
    timezone: text('timezone').notNull().default('Europe/Moscow'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('member_slug_unique').on(table.slug),
    uniqueIndex('member_email_unique').on(table.email),
    check('member_email_normalized', sql`${table.email} = lower(btrim(${table.email}))`),
    check('member_status_allowed', sql`${table.status} in ('active', 'inactive')`),
  ],
)

export type MemberRow = typeof member.$inferSelect
export type MemberInsert = typeof member.$inferInsert
