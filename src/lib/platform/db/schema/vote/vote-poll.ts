/**
 * `core.vote_poll` — one poll of the vote module (#575): a rating round
 * (members pick up to two options) or a consent round on one wording.
 *
 * `options` is the rating's ordered option list; a ballot stores INDICES into
 * it, which is why the list is never edited once a poll opens (there is no
 * edit path at all). A consent poll carries an empty list — its question is
 * the title. `source_poll_id` links a consent draft to the rating it was
 * created from («Создать согласие по двум лидерам»); the reference stays
 * inside this module's own directory, so it is a drizzle reference rather
 * than a hand-written one.
 */
import { sql } from 'drizzle-orm'
import { check, integer, serial, text, type AnyPgColumn } from 'drizzle-orm/pg-core'

import { auditColumns } from '../audit-columns'
import { core } from '../core'

export const votePoll = core.table(
  'vote_poll',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    options: text('options')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status').notNull().default('draft'),
    sourcePollId: integer('source_poll_id').references((): AnyPgColumn => votePoll.id, {
      onDelete: 'set null',
    }),
    ...auditColumns(),
  },
  (table) => [
    check('vote_poll_kind_allowed', sql`${table.kind} in ('rating', 'consent')`),
    check('vote_poll_status_allowed', sql`${table.status} in ('draft', 'open', 'closed')`),
    check('vote_poll_title_present', sql`btrim(${table.title}) <> ''`),
  ],
)

export type VotePollRow = typeof votePoll.$inferSelect
export type VotePollInsert = typeof votePoll.$inferInsert
