/**
 * `core.hours_participant` — the hours module's attributes of a person
 * (spec 124 EARS-1, EARS-3, EARS-21).
 *
 * The PK **is** the FK to `core.member`: one row per participating member, and a
 * member WITHOUT a row here is simply not an hours participant (today's «тебя нет
 * в списке участников» mode). That is why the money attributes live here and not
 * on `member` (EARS-2/EARS-3): the shared registry holds the whole team, salary
 * adjacency stays inside the module that owns it.
 *
 * The FK to `core.member(id)` — `ON DELETE RESTRICT` — is declared in **SQL**, in
 * the migration, NOT here. Declaring it in drizzle would mean importing
 * `../member/member` into the hours module's own table directory, i.e. holding a
 * typed handle on another module's table (ADR-004 §6 «a module may import only
 * from the directory bearing its own name»). The constraint is asserted by an
 * integration test rather than trusted (`tests/int/platform/hours-core.int.spec.ts`,
 * EARS-1), so nothing about it rests on a comment. `RESTRICT` is deliberate: the
 * registry must not be able to delete a person out from under their saved
 * assessments — history is the product (081 §16).
 *
 * `sort_key` (EARS-21): the participants table renders in today's JSON array
 * order (081 §19), which the PK cannot express — the PK follows the member seed,
 * not the hours document. New participants append after the current maximum.
 */
import { sql } from 'drizzle-orm'
import { check, integer, text } from 'drizzle-orm/pg-core'

import { core } from '../core'

export const hoursParticipant = core.table(
  'hours_participant',
  {
    /** FK → `core.member(id)`, added as SQL in the migration; see the header. */
    memberId: integer('member_id').primaryKey(),
    /** Рыночная вилка роли, ₽/мес — integers (spec 124 column table). */
    forkMin: integer('fork_min'),
    forkMax: integer('fork_max'),
    /** Точка внутри вилки; the rate is COMPUTED from fork + grade, never stored. */
    grade: text('grade'),
    sortKey: integer('sort_key').notNull(),
  },
  (table) => [check('hours_participant_grade_allowed', sql`${table.grade} in ('I', 'II', 'III')`)],
)

export type HoursParticipantRow = typeof hoursParticipant.$inferSelect
export type HoursParticipantInsert = typeof hoursParticipant.$inferInsert
