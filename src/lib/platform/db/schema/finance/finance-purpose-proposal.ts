/**
 * `core.finance_purpose_proposal` — a missing purpose proposed from one draft
 * request (spec 339 EARS-526).
 *
 * `resolved_at` is the state marker: NULL is pending, a timestamp plus
 * `resolved_purpose_id` is resolved, and a timestamp without a purpose is
 * dismissed. Both terminal outcomes retain the proposal row even if its draft
 * is later deleted, so `intake_item_id` becomes NULL through `ON DELETE SET
 * NULL`. A pending row must remain linked: the CHECK makes even a direct SQL
 * delete refuse until an admin resolves or dismisses it. The request link is
 * what lets one admin act unblock the exact draft that proposed the text;
 * without it EARS-526's request-level acceptance scenario is not representable.
 *
 * `proposed_by` is an integer with no drizzle reference. Its FK to
 * `core.member(id)` is added by hand in the migration so this finance schema
 * file does not import another module's table (ADR-004 §6).
 */
import { sql } from 'drizzle-orm'
import { check, index, integer, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financeIntakeItem } from './finance-intake-item'
import { financePurpose } from './finance-purpose'

export const financePurposeProposal = core.table(
  'finance_purpose_proposal',
  {
    id: serial('id').primaryKey(),
    intakeItemId: integer('intake_item_id').references(() => financeIntakeItem.id, {
      onDelete: 'set null',
    }),
    text: text('text').notNull(),
    /** FK → `core.member(id)`, added as SQL in the migration. */
    proposedBy: integer('proposed_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedPurposeId: integer('resolved_purpose_id').references(() => financePurpose.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'finance_purpose_proposal_resolution_shape',
      sql`${table.resolvedAt} is not null or ${table.resolvedPurposeId} is null`,
    ),
    check(
      'finance_purpose_proposal_pending_request',
      sql`${table.resolvedAt} is not null or ${table.intakeItemId} is not null`,
    ),
    uniqueIndex('finance_purpose_proposal_pending_request_unique')
      .on(table.intakeItemId)
      .where(sql`${table.resolvedAt} is null`),
    index('finance_purpose_proposal_proposed_by_idx').on(table.proposedBy),
    index('finance_purpose_proposal_resolved_purpose_idx').on(table.resolvedPurposeId),
  ],
)

export type FinancePurposeProposalRow = typeof financePurposeProposal.$inferSelect
export type FinancePurposeProposalInsert = typeof financePurposeProposal.$inferInsert
