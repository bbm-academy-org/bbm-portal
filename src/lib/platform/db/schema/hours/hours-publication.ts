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
 * `messages` (`jsonb`) is what that replaced, and it is still here on purpose:
 * this release only EXPANDS (`docs/runbooks/migrations-expand-contract.md`), so
 * the column is still WRITTEN by `src/lib/hours/core/{persist,import}.ts` and no
 * longer READ, keeping `pnpm deploy:prod --rollback <sha>` an honest button
 * across the cutover. Issue #281 is the contract release that drops it; issue
 * #275 then attaches this table's capture trigger (EARS-33), which is why
 * `core.hours_publication` is still an allowlisted absence in
 * `tools/lint/audit-coverage-allowlist.mjs`.
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
    /**
     * `PublicationMessage[]` (`src/lib/hours/types.ts`) — the pre-#274
     * representation. WRITE-ONLY until #281 contracts it away; the read path is
     * `./hours-publication-message.ts`.
     */
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
