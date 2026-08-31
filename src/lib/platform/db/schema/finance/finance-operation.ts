/**
 * `core.finance_operation` — the unit the register shows (spec 338 EARS-310,
 * EARS-313…316, EARS-318).
 *
 * An operation is a set of postings that balance per currency; a whole
 * conversion chain, however many exchange steps it has, is ONE operation
 * (EARS-318), which is why the steps hang off this row rather than off a group
 * table of their own.
 *
 * IMMUTABLE (EARS-313). The module refuses every update and delete, and so does
 * a database trigger installed by the migration — the accident guard of the
 * spec-201 precedent. The only correction is a REVERSAL: a new operation with
 * `source = 'reversal'` whose `reverses` points at the original and whose
 * postings mirror it with negated amounts (EARS-314). `reverses` is UNIQUE, so
 * "an operation is reversed at most once" (EARS-315) is a database fact; a
 * reversal is itself reversible, which is what undoes a mistaken сторно.
 *
 * `source` is the closed provenance set of decision 3 (EARS-316). F1 fixes the
 * enum and the columns; `source_ref` stays empty until F2's intakes fill it.
 * `backdated` marks an operation entered for a day that has already passed —
 * the flag the register needs to explain why yesterday's total moved.
 */
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  integer,
  serial,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financePurpose } from './finance-purpose'

export const FINANCE_OPERATION_SOURCES = [
  'request',
  'bank_import',
  'hours',
  'manual',
  'backfill',
  'reversal',
] as const
export type FinanceOperationSource = (typeof FINANCE_OPERATION_SOURCES)[number]

export const financeOperation = core.table(
  'finance_operation',
  {
    id: serial('id').primaryKey(),
    /** The day the money moved, `YYYY-MM-DD` — not the day it was entered. */
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    /** Null for transfers, conversions and income (spec's data-model table). */
    purposeId: integer('purpose_id').references(() => financePurpose.id),
    source: text('source').notNull(),
    /** F2's intakes fill this; F1 only reserves it (EARS-316). */
    sourceRef: text('source_ref'),
    backdated: boolean('backdated').notNull().default(false),
    /** The operation this one сторнирует (EARS-314); unique → EARS-315. */
    reverses: integer('reverses').references((): AnyPgColumn => financeOperation.id),
  },
  (table) => [
    check(
      'finance_operation_source_allowed',
      sql`${table.source} in ('request', 'bank_import', 'hours', 'manual', 'backfill', 'reversal')`,
    ),
    // A reversal names its original, and only a reversal may (EARS-314).
    check(
      'finance_operation_reversal_shape',
      sql`(${table.source} = 'reversal') = (${table.reverses} is not null)`,
    ),
    check('finance_operation_no_self_reversal', sql`${table.reverses} <> ${table.id}`),
    uniqueIndex('finance_operation_backfill_source_ref_unique')
      .on(table.source, table.sourceRef)
      .where(sql`${table.source} = 'backfill' and ${table.sourceRef} is not null`),
    uniqueIndex('finance_operation_reverses_unique').on(table.reverses),
  ],
)

export type FinanceOperationRow = typeof financeOperation.$inferSelect
export type FinanceOperationInsert = typeof financeOperation.$inferInsert
