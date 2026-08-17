/**
 * `core.hours_publication` — the Mattermost verification batch of one period
 * (spec 124 EARS-1, EARS-6, EARS-31; canon: spec 100).
 *
 * `period_id` is the PK, which is exactly the «at most one batch per period»
 * constraint of EARS-6 — today even the file reader refuses a second one. A
 * `sending` batch that survived a crash therefore still blocks a new batch and
 * still locks period mutations (spec 100 req. 12/15) without any extra state.
 *
 * The batch is `jsonb` on purpose (EARS-6): it is a delivery-protocol artifact —
 * frozen message texts plus per-message `delivery`/`sent_at` — that is never
 * queried relationally, only rewritten WHOLE as delivery progresses. Rewriting
 * the array whole is what keeps its element order and length stable, and order is
 * a correctness property here: delivery addresses messages BY INDEX (spec 100
 * req. 2/10, EARS-21).
 *
 * `started_at` / `published_at` are `text` ISO-8601 (`toISOString()`), like every
 * timestamp that appears verbatim in the owner's export (spec 124 column table).
 * `published_at` is null until every message is `sent`.
 */
import { sql } from 'drizzle-orm'
import { check, jsonb, text } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { hoursPeriod } from './hours-period'

export const hoursPublication = core.table(
  'hours_publication',
  {
    /** PK **and** FK: one batch per period, structurally (EARS-6). */
    periodId: text('period_id')
      .primaryKey()
      .references(() => hoursPeriod.id),
    /** `sending | published | incomplete` — text with a CHECK, per the spec's
     * column table; the readable refusals stay in the domain layer. */
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    publishedAt: text('published_at'),
    previewFingerprint: text('preview_fingerprint').notNull(),
    /** `PublicationMessage[]` (`src/lib/hours/types.ts`) — order-significant. */
    messages: jsonb('messages').notNull(),
  },
  (table) => [
    check(
      'hours_publication_status_allowed',
      sql`${table.status} in ('sending', 'published', 'incomplete')`,
    ),
  ],
)

export type HoursPublicationRow = typeof hoursPublication.$inferSelect
export type HoursPublicationInsert = typeof hoursPublication.$inferInsert
