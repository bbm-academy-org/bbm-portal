/**
 * `core.hours_publication_message` — one Mattermost message of one verification
 * batch (spec 201 EARS-31, issue #274; canon: spec 100 req. 2/10, spec 124
 * EARS-6/EARS-21).
 *
 * Until #274 these rows were the elements of `core.hours_publication.messages`,
 * a `jsonb` array rewritten WHOLE on every delivery step. That shape is what
 * made the parent table unauditable: an audited diff of the column would say
 * «everything changed» once per delivered message and say nothing useful, and
 * the value it would carry is frozen message texts plus per-member delivery data
 * — exactly the content spec 201's Q2 answer keeps out of an append-only ledger
 * nothing can redact. Normalised, a delivery step updates ONE row and the audit
 * records one small diff, which is why EARS-31 is a prerequisite of attaching
 * the capture trigger to `core.hours_publication` at all (EARS-33, issue #275).
 *
 * `position` is the **explicit** form of the array index spec 100 req. 2/10 and
 * spec 124 EARS-21 already relied on: delivery goes strictly in preview order and
 * addresses a message by its position, so order is a correctness property rather
 * than cosmetics. It is 0-based and contiguous per batch — `src/lib/hours/core/load.ts`
 * asserts that when it rebuilds the legacy array, so «array index» and
 * «position» cannot drift apart above this layer.
 *
 * **The primary key IS `(period_id, position)`.** No surrogate id: the pair is
 * the row's whole identity, one batch holds at most one message per position,
 * and the PK's unique index is the `UNIQUE (period_id, position)` the task asks
 * for. It is also what the audit ledger records as the row's `pk` — the capture
 * function reads the primary key from the catalog (spec 201 EARS-4), so the trail
 * reads `{"period_id": …, "position": 0}` rather than a meaningless surrogate.
 * This is the first `core` table with a composite PK, i.e. the first one that
 * exercises that clause.
 *
 * Column types repeat the frozen legacy shape of `PublicationMessage`
 * (`src/lib/hours/types.ts`): `sent_at` is `text` ISO-8601, like every timestamp
 * that appears verbatim in the owner's export (spec 124 column table), and
 * `delivery` is text with a CHECK mirroring `PublicationDelivery`.
 *
 * The FK to `core.hours_publication(period_id)` is `ON DELETE CASCADE`: the
 * parent has no delete path in the product at all (a delivery record is history,
 * `persist.ts`), and a batch that ever were removed must not leave its messages
 * behind as orphans.
 */
import { sql } from 'drizzle-orm'
import { check, integer, primaryKey, text } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { hoursPublication } from './hours-publication'

export const hoursPublicationMessage = core.table(
  'hours_publication_message',
  {
    periodId: text('period_id')
      .notNull()
      .references(() => hoursPublication.periodId, { onDelete: 'cascade' }),
    /** 0-based, contiguous, preview order — delivery addresses THIS (spec 100 req. 2/10). */
    position: integer('position').notNull(),
    email: text('email').notNull(),
    /** Exact Mattermost Markdown, frozen before the first network request. */
    text: text('text').notNull(),
    delivery: text('delivery').notNull(),
    sentAt: text('sent_at'),
  },
  (table) => [
    primaryKey({
      name: 'hours_publication_message_period_position_pk',
      columns: [table.periodId, table.position],
    }),
    check(
      'hours_publication_message_delivery_allowed',
      sql`${table.delivery} in ('pending', 'sent', 'failed', 'unknown')`,
    ),
    check('hours_publication_message_position_non_negative', sql`${table.position} >= 0`),
  ],
)

export type HoursPublicationMessageRow = typeof hoursPublicationMessage.$inferSelect
export type HoursPublicationMessageInsert = typeof hoursPublicationMessage.$inferInsert
