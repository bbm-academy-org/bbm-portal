/**
 * `core.finance_document_link` — which items a document confirms (spec
 * `docs/specs/339-ledger-intake.md` Data model, issue #382).
 *
 * **Why a link table and not a column.** One document may confirm SEVERAL
 * items, and the corpus is where that came from: one bank screenshot proving
 * two consultations, one «$370 + $22» payment covering two lines. A
 * `document_id` on the intake item would force the archive to hold the same
 * file twice and then make «is this document linked to anything posted» — the
 * EARS-516 question — a search rather than a join.
 *
 * **The operation link is DERIVED, never stored.** A document reaches an
 * operation through its item's `operation_id`; there is no `operation_id` here
 * and adding one would create a second answer to the same question, which is
 * how a document ends up attached to a posting its item never made.
 *
 * **The pair is unique** — attaching the same file to the same item twice is a
 * double click, not a second fact.
 *
 * `ON DELETE cascade` on both parents, and each half has its own reason. A
 * document's deletion is already gated by EARS-516 (`deleteFinanceDocument`
 * refuses while any linked item is terminal), so by the time a row here can be
 * cascaded away the module has already decided it may be; an intake item can
 * only be deleted while `draft`, and a link to a draft that no longer exists is
 * not a record of anything. Database triggers in migration `0010` enforce the
 * same rule against direct DML. `linked_by` is RESTRICT like every other member
 * reference in this tree: the registry must not delete a person out from under
 * an act recorded to their name.
 *
 * `linked_by` is an integer with **no drizzle reference** for the reason the
 * rest of `schema/finance/` states: the FK to `core.member(id)` is written by
 * hand in the migration, because declaring it here would import
 * `schema/member/` into `schema/finance/` (ADR-004 §6).
 */
import { index, integer, serial, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financeDocument } from './finance-document'
import { financeIntakeItem } from './finance-intake-item'

export const financeDocumentLink = core.table(
  'finance_document_link',
  {
    id: serial('id').primaryKey(),
    documentId: integer('document_id')
      .notNull()
      .references(() => financeDocument.id, { onDelete: 'cascade' }),
    intakeItemId: integer('intake_item_id')
      .notNull()
      .references(() => financeIntakeItem.id, { onDelete: 'cascade' }),
    /** FK → `core.member(id)`, added as SQL in the migration. */
    linkedBy: integer('linked_by').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('finance_document_link_pair_unique').on(table.documentId, table.intakeItemId),
    // The two directions the module actually asks in: «what confirms this item»
    // (the read gate and the posting gate #385) and «what does this document
    // confirm» (the EARS-516 immutability question).
    index('finance_document_link_intake_item_idx').on(table.intakeItemId),
  ],
)

export type FinanceDocumentLinkRow = typeof financeDocumentLink.$inferSelect
export type FinanceDocumentLinkInsert = typeof financeDocumentLink.$inferInsert
