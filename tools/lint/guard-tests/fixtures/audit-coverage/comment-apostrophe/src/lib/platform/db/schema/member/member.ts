/**
 * The regression fixture for the guard's one silent failure: prose apostrophes.
 *
 * Every comment below carries at least one — «the team's default», «the row's
 * business key» — which a string-aware-but-not-comment-aware tokenizer reads as
 * an opening quote. Before the fix this file parsed with ZERO columns and the
 * guard went green; `nickname` is the column that must now be reported.
 */
import { core } from '../core'

export const member = core.table(
  'member',
  {
    /** Surrogate PK — the email is an attribute, never the row's business key. */
    id: serial('id').primaryKey(),
    slug: text('slug').notNull(),
    // IANA zone name; the team's default, not a per-request preference.
    note: text('note'),
    /* A block comment with an apostrophe too — the guard's other quote form. */
    nickname: text('nickname'),
    /* A nested option object and a template literal, per the spec's shape: */
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
    // id: text('legacy_id'), <- commented out, and must NOT parse as a column
  },
  (table) => [uniqueIndex('member_slug_unique').on(table.slug)],
)
