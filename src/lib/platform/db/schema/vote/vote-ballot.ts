/**
 * `core.vote_ballot` — one member's answer to one poll (#575).
 *
 * Non-anonymous by design: the facilitator shows who voted for what. The voter
 * is the SESSION email, normalized the way `core.member.email` is stored —
 * never a value from the form. One row per (poll, voter): a re-vote while the
 * poll is open replaces the row (`on conflict … do update`).
 *
 * A rating ballot fills `choices` (indices into `vote_poll.options`); a consent
 * ballot fills `consent_answer` and, for a wish or an objection, `comment`.
 * The per-kind rules live in `src/lib/vote/rules.ts` and are enforced before
 * the write; the checks below only keep the column vocabulary closed.
 */
import { sql } from 'drizzle-orm'
import { check, integer, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { auditColumns } from '../audit-columns'
import { core } from '../core'
import { votePoll } from './vote-poll'

export const voteBallot = core.table(
  'vote_ballot',
  {
    id: serial('id').primaryKey(),
    pollId: integer('poll_id')
      .notNull()
      .references(() => votePoll.id, { onDelete: 'cascade' }),
    voterEmail: text('voter_email').notNull(),
    choices: integer('choices')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    consentAnswer: text('consent_answer'),
    comment: text('comment'),
    ...auditColumns(),
  },
  (table) => [
    check(
      'vote_ballot_consent_answer_allowed',
      sql`${table.consentAnswer} is null or ${table.consentAnswer} in ('accept', 'accept_with_wish', 'object')`,
    ),
    check(
      'vote_ballot_voter_email_normalized',
      sql`${table.voterEmail} = lower(btrim(${table.voterEmail})) and ${table.voterEmail} <> ''`,
    ),
    uniqueIndex('vote_ballot_poll_voter_unique').on(table.pollId, table.voterEmail),
  ],
)

export type VoteBallotRow = typeof voteBallot.$inferSelect
export type VoteBallotInsert = typeof voteBallot.$inferInsert
