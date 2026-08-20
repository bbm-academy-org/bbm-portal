/**
 * `core.hours_publication` — the Mattermost verification batch of one period
 * (spec 124 EARS-1, EARS-6, EARS-31; canon: spec 100).
 *
 * `period_id` is the PK, which is exactly the «at most one batch per period»
 * constraint of EARS-6 — today even the file reader refuses a second one. A
 * `sending` batch that survived a crash therefore still blocks a new batch and
 * still locks period mutations (spec 100 req. 12/15) without any extra state.
 *
 * The batch's messages live in `./hours-publication-message.ts` since #274 (spec
 * 201 EARS-31): one row per message, keyed `(period_id, position)`, which is the
 * explicit form of the array index spec 100 req. 2/10 and EARS-21 always relied
 * on. Delivery addresses a message BY POSITION and updates ONE row, so the audit
 * ledger records one small diff per step instead of «everything changed».
 *
 * The `messages` (`jsonb`) column that representation replaced is GONE since the
 * contract release #281 (`0005_hours_publication_drop_messages.sql`, EARS-31
 * step 4). #274 kept it alive on purpose for exactly one release — written but
 * not read, so `pnpm deploy:prod --rollback <sha>` stayed an honest button
 * across the cutover (`docs/runbooks/migrations-expand-contract.md`). That
 * window is closed: rolling the app back past #281 is no longer an app-only
 * operation, and the child table is now the only representation there is.
 *
 * `core.hours_publication` is still an allowlisted absence in
 * `tools/lint/audit-coverage-allowlist.mjs` — issue #275 attaches this table's
 * capture trigger and removes the entry (EARS-33), which the column's removal
 * unblocks but does not itself do.
 *
 * `started_at` / `published_at` are `text` ISO-8601 (`toISOString()`), like every
 * timestamp that appears verbatim in the owner's export (spec 124 column table).
 * `published_at` is null until every message is `sent`.
 */
import { sql } from 'drizzle-orm'
import { check, text } from 'drizzle-orm/pg-core'

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
