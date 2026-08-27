/**
 * `core.finance_document` — the confirming file behind a posting (spec
 * `docs/specs/339-ledger-intake.md` §D, Data model, issue #382).
 *
 * **The row is metadata; the bytes are somewhere else.** `storage_key` names an
 * object in a PRIVATE location — a private bucket in production, a local
 * directory in dev (EARS-514). It is deliberately not a URL: a URL in a column
 * is a URL somebody eventually hands out, and the whole clause is that no
 * public or unauthenticated address to a document exists. The one way to the
 * content is `readFinanceDocument` in `src/lib/finance/documents/`, which asks
 * the EARS-523 question first.
 *
 * **Never the public media bucket, and never Payload** (owner ruling
 * 2026-08-26). The estate's only current bucket, `bbm-portal-media`, is
 * deliberately public-read so the marketing site can load images straight from
 * it; an accounting record in there is readable by anyone who guesses the key.
 * `resolveFinanceDocumentStorage` refuses to be pointed at it by name.
 *
 * **`kind` is DATA, not a gate** (EARS-515, owner decision 29). The taxonomy is
 * the corpus's five real classes plus the bank statement (EARS-521) and a rest
 * bucket; the CHECK below fixes the set, and nothing anywhere reads the kind to
 * decide whether a posting may proceed. That is the point: a foreign invoice is
 * often generated only at payment and IS the proof, while a RU invoice attached
 * days early posts nothing until someone asserts the payment.
 *
 * **`mime` and `size` carry CHECKs for the same reason the intake spine's
 * columns do** — they are the accident guard behind a readable module refusal
 * (`assertFinanceDocumentUpload`), not the user experience. The mime list is
 * written out here rather than interpolated from `FINANCE_DOCUMENT_MIME_TYPES`,
 * exactly as `finance_intake_item` writes its own enums: a CHECK is migration
 * TEXT, and a constant that silently rewrites already-applied SQL is worse than
 * a duplication a test can compare.
 *
 * `uploaded_by` is an integer with **no drizzle reference**: its FK to
 * `core.member(id)` is written by hand in the migration, because declaring it
 * here would import `schema/member/` into `schema/finance/` — the import
 * ADR-004 §6 keeps out of a module. Same shape as
 * `finance_intake_item.created_by`.
 *
 * Rows here are practically immutable: `kind` is the one editable column and
 * only while no linked item has posted (EARS-516). The bytes never change at
 * all — `put` refuses an occupied key, and `storage_key` is unique, so a
 * "replacement" cannot be smuggled in under an existing row.
 */
import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, serial, text, timestamp } from 'drizzle-orm/pg-core'

import { core } from '../core'

/**
 * The classes of confirming document (EARS-515): the corpus's five, the bank
 * statement EARS-521 imports from, and a rest bucket so an unexpected file is
 * filed rather than refused.
 */
export const FINANCE_DOCUMENT_KINDS = [
  'ru_invoice',
  'fiscal_receipt',
  'foreign_invoice',
  'payment_order',
  'bank_screenshot',
  'bank_statement',
  'other',
] as const
export type FinanceDocumentKind = (typeof FINANCE_DOCUMENT_KINDS)[number]

/**
 * «PDF and images» (EARS-514) spelled out.
 *
 * The list is closed on purpose: an accounting archive is not a file drop, and
 * the types that are not here — an office document with macros, an HTML file
 * that would run in the reader's origin if it were ever served inline, an
 * archive — are exactly the ones a private bucket should not be holding.
 */
export const FINANCE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/heic',
] as const
export type FinanceDocumentMimeType = (typeof FINANCE_DOCUMENT_MIME_TYPES)[number]

export const financeDocument = core.table(
  'finance_document',
  {
    id: serial('id').primaryKey(),
    /** The object's key in the PRIVATE location — not a URL, see the docblock. */
    storageKey: text('storage_key').notNull().unique(),
    /** What the uploader called it. Shown to people; never used as a path. */
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    /** Bytes. `bigint` for the same reason the money columns are (spec 338 EARS-310). */
    size: bigint('size', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    /** FK → `core.member(id)`, added as SQL in the migration. */
    uploadedBy: integer('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'finance_document_kind_allowed',
      sql`${table.kind} in ('ru_invoice', 'fiscal_receipt', 'foreign_invoice', 'payment_order', 'bank_screenshot', 'bank_statement', 'other')`,
    ),
    check(
      'finance_document_mime_allowed',
      sql`${table.mime} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/heic')`,
    ),
    // An empty object is not a document: it is an upload that went wrong and
    // would sit in the archive looking like proof of something.
    check('finance_document_size_positive', sql`${table.size} > 0`),
    index('finance_document_uploaded_by_idx').on(table.uploadedBy),
  ],
)

export type FinanceDocumentRow = typeof financeDocument.$inferSelect
export type FinanceDocumentInsert = typeof financeDocument.$inferInsert
