/**
 * `core.member_alias` — a person's accounts and ids in external systems
 * (spec 124 EARS-17, EARS-18, EARS-19).
 *
 * The recognition table: a meeting transcript says «dobroyar», the module answers
 * «Игорь Пирогов». `kind` is an OPEN set stored lower_snake — the vocabulary is
 * documented in the module (`src/lib/member/types.ts`, `AliasKind`), not fenced
 * in by a database enum, because a new external system must not need a
 * migration.
 *
 * The uniqueness is on the NORMALIZED EXPRESSION (`kind`, `lower(btrim(value))`),
 * not on the raw columns: this cycle's only write path is the owner's SQL escape
 * hatch (EARS-19), so a raw-column constraint would happily accept `Dobroyar`
 * next to `dobroyar` and a handle would map to two people — a lookup with no
 * useful answer. Several aliases of the SAME kind for one member stay legal (two
 * phones, two personal emails); the canonical `@bbm.academy` email lives on
 * `core.member` and is never duplicated here.
 */
import { sql } from 'drizzle-orm'
import { integer, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { member } from './member'

export const memberAlias = core.table(
  'member_alias',
  {
    id: serial('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    note: text('note'),
  },
  (table) => [
    uniqueIndex('member_alias_kind_value_unique').on(table.kind, sql`lower(btrim(${table.value}))`),
  ],
)

export type MemberAliasRow = typeof memberAlias.$inferSelect
export type MemberAliasInsert = typeof memberAlias.$inferInsert
