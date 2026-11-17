/**
 * The owner's payment queue as a READING of the intake spine (spec 339 §I,
 * EARS-535/546/548; issue #549).
 *
 * Nothing here is stored: the stage is derived from status + flags + whether a
 * reimbursement settles the item, «без чека» is whether a ready document is
 * linked, and the snapshot token is a fingerprint of exactly what the queue
 * showed — the bulk act re-computes it under the row lock and posts nothing
 * when any row moved (EARS-548).
 */
import { createHash } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'

import { financeDocument } from '@/lib/platform/db/schema/finance/finance-document'
import { financeDocumentLink } from '@/lib/platform/db/schema/finance/finance-document-link'
import type { FinanceIntakeStatus } from '@/lib/platform/db/schema/finance/finance-intake-item'
import type { PlatformTx } from '@/lib/platform/db/transaction'

import type { FinanceIntakeItemView } from './items'
import { createIntakePostingSnapshot } from './posting'

/** The queue groups of EARS-535 — a reading, never a status column. */
export const EXPENSE_REQUEST_STAGES = [
  'decide',
  'pay',
  'reimburse',
  'draft',
  'paid',
  'refused',
  'cancelled',
] as const
export type ExpenseRequestStage = (typeof EXPENSE_REQUEST_STAGES)[number]

export type ExpenseRequestStageInput = {
  status: FinanceIntakeStatus
  alreadyPaid: boolean
  personalFunds: boolean
  /** A POSTED reimbursement names this item through `settles_item` (EARS-528). */
  settled: boolean
}

/**
 * EARS-535, clause for clause. Two rows are not one-status-to-one-group: an
 * unposted `already_paid` request paid from a COMPANY account is «К оплате»
 * (the money moved; the record is what is missing), and a POSTED
 * `personal_funds` request is still «Вернуть сотруднику» until its refund
 * settles it — posting books the debt, it does not pay it back.
 */
export function deriveExpenseRequestStage(item: ExpenseRequestStageInput): ExpenseRequestStage {
  switch (item.status) {
    case 'draft':
    case 'refused':
    case 'cancelled':
      return item.status
    case 'posted':
      return item.personalFunds && !item.settled ? 'reimburse' : 'paid'
    case 'submitted':
    case 'approved':
      if (item.alreadyPaid) return item.personalFunds ? 'reimburse' : 'pay'
      return item.status === 'submitted' ? 'decide' : 'pay'
    default: {
      const unknown: never = item.status
      throw new Error(`Unknown intake status ${String(unknown)}`)
    }
  }
}

/** What the posting snapshot of a request reads of each ready document. */
export type QueueSnapshotDocument = {
  id: number
  filename: string
  mime: string
  size: number
  kind: string
  uploadedBy: number
  uploadedAt: Date
}

/**
 * Ready documents per item, regardless of who reads the queue. Only the
 * metadata a fingerprint needs leaves this function — never content, and the
 * list route keeps its own EARS-523-narrowed document read for display.
 */
export async function readyQueueDocuments(
  db: Pick<PlatformTx, 'select'>,
  itemIds: readonly number[],
): Promise<Map<number, QueueSnapshotDocument[]>> {
  const byItem = new Map<number, QueueSnapshotDocument[]>()
  if (itemIds.length === 0) return byItem
  const rows = await db
    .select({ itemId: financeDocumentLink.intakeItemId, document: financeDocument })
    .from(financeDocumentLink)
    .innerJoin(financeDocument, eq(financeDocumentLink.documentId, financeDocument.id))
    .where(
      and(
        inArray(financeDocumentLink.intakeItemId, [...itemIds]),
        eq(financeDocument.storageState, 'ready'),
      ),
    )
  for (const { itemId, document } of rows) {
    const view: QueueSnapshotDocument = {
      id: document.id,
      filename: document.filename,
      mime: document.mime,
      size: Number(document.size),
      kind: document.kind,
      uploadedBy: document.uploadedBy,
      uploadedAt: document.uploadedAt,
    }
    const list = byItem.get(itemId)
    if (list === undefined) byItem.set(itemId, [view])
    else list.push(view)
  }
  return byItem
}

/**
 * The opaque token the bulk dialog sends back per row (EARS-548): the posting
 * snapshot of the request and its ready documents, plus the settlement it
 * showed — a refund booked by someone else in the meantime is a change too.
 */
export function expenseRequestQueueSnapshot(
  item: FinanceIntakeItemView,
  documents: readonly QueueSnapshotDocument[],
  settledBy: number | null,
): string {
  const { fingerprint } = createIntakePostingSnapshot(item, documents)
  return createHash('sha256')
    .update(`${fingerprint}:${settledBy ?? '-'}`)
    .digest('hex')
}
