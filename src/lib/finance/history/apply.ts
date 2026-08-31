import { createHash } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'

import { financeDocumentLink } from '@/lib/platform/db/schema/finance/finance-document-link'
import { financeIntakeItem } from '@/lib/platform/db/schema/finance/finance-intake-item'
import { financeOperation } from '@/lib/platform/db/schema/finance/finance-operation'
import { getPlatformDb } from '@/lib/platform/db/client'
import { platformTransaction } from '@/lib/platform/db/transaction'

import type { FinanceActor } from '../core/actor'
import { FinanceRefusal } from '../core/errors'
import { uploadFinanceHistoryDocument } from '../documents/documents'
import { resolveFinanceDocumentStorage, type FinanceDocumentStorage } from '../documents/storage'
import { postIntakeItemInTransaction } from '../intake/posting'
import type {
  FinanceHistoryPlan,
  FinanceHistoryPlanOperation,
  FinanceHistorySourceFile,
} from './plan'
import { verifyFinanceHistoryPlanDigest } from './plan'

const BACKFILL_AUDIT_CONTEXT = {
  actorEmail: null,
  source: 'cli:finance-history-backfill' as const,
}

export type FinanceHistoryApplyOptions = {
  /** Existing member used by mandatory created_by/uploaded_by/posted_by domain columns. */
  operatorEmail: string
  loadDocumentBytes(file: FinanceHistorySourceFile): Promise<Buffer>
  storage?: FinanceDocumentStorage
}

export type FinanceHistoryApplyResult = {
  planDigest: string
  applied: { sourceRef: string; intakeItemId: number; operationId: number }[]
  skipped: { sourceRef: string; operationId: number }[]
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

async function operatorMemberId(email: string): Promise<number> {
  const normalized = email.trim().toLowerCase()
  if (normalized === '') throw new FinanceRefusal('The history operator email is required.')
  const rows = await getPlatformDb().execute(
    // The member table belongs to another module, so finance reaches it by SQL,
    // exactly as the existing intake/posting primitives do.
    sql`
      select id from core.member where lower(email) = ${normalized} limit 1
    `,
  )
  const row = rows.rows[0] as { id?: number } | undefined
  if (row?.id === undefined) {
    throw new FinanceRefusal(`No core.member row exists for history operator ${normalized}.`)
  }
  return Number(row.id)
}

async function existingBackfillOperation(sourceRef: string): Promise<number | null> {
  const [row] = await getPlatformDb()
    .select({ id: financeOperation.id })
    .from(financeOperation)
    .where(and(eq(financeOperation.source, 'backfill'), eq(financeOperation.sourceRef, sourceRef)))
  return row?.id ?? null
}

async function stageDocument(
  file: FinanceHistoryPlanOperation['documents'][number],
  uploadedBy: number,
  bytes: Buffer,
  storage: FinanceDocumentStorage,
): Promise<number> {
  if (!Buffer.isBuffer(bytes))
    throw new FinanceRefusal(`Mattermost file ${file.id} did not return bytes.`)
  if (bytes.byteLength !== file.size || sha256(bytes) !== file.contentDigest) {
    throw new FinanceRefusal(
      `Mattermost file ${file.id} no longer matches the authorized source snapshot (size or digest changed).`,
    )
  }
  const extension = /\.[a-z0-9]{1,8}$/i.exec(file.filename)?.[0].toLowerCase() ?? ''
  const identity = createHash('sha256')
    .update(`mattermost:${file.id}:${file.contentDigest}`)
    .digest('hex')
  const document = await uploadFinanceHistoryDocument(
    {
      storageKey: `finance/documents/history/${identity}${extension}`,
      filename: file.filename,
      mime: file.mime,
      bytes,
      kind: file.kind,
      uploadedBy,
    },
    BACKFILL_AUDIT_CONTEXT,
    storage,
  )
  return document.id
}

function pgFailure(error: unknown): { code?: string; constraint?: string } {
  const node = error as { code?: string; constraint?: string; cause?: unknown } | null | undefined
  if (typeof node?.code === 'string') return { code: node.code, constraint: node.constraint }
  return node?.cause === undefined ? {} : pgFailure(node.cause)
}

function isBackfillUniqueRace(error: unknown): boolean {
  const failure = pgFailure(error)
  return (
    failure.code === '23505' &&
    (failure.constraint === 'finance_intake_item_source_ref_unique' ||
      failure.constraint === 'finance_operation_backfill_source_ref_unique')
  )
}

function intakeValues(operation: FinanceHistoryPlanOperation, createdBy: number) {
  return {
    source: 'backfill' as const,
    sourceRef: operation.sourceRef,
    kind: operation.kind,
    status: 'approved' as const,
    occurredOn: operation.occurredOn,
    accountId: operation.accountId,
    counterAccountId: operation.counterAccountId,
    amount: BigInt(operation.amount),
    currency: operation.currency,
    paidAmount: operation.paidAmount === null ? null : BigInt(operation.paidAmount),
    paidCurrency: operation.paidCurrency,
    feeAmount: operation.feeAmount === null ? null : BigInt(operation.feeAmount),
    feeCurrency: operation.feeCurrency,
    purposeId: operation.purpose?.id ?? null,
    projectId: operation.projectId,
    productId: operation.productId,
    counterpartyId: operation.counterpartyId,
    memberId: operation.memberId,
    note: operation.note,
    alreadyPaid: operation.alreadyPaid,
    personalFunds: operation.personalFunds,
    createdBy,
  }
}

/** Apply only an exact reviewed plan; the CLI is the sole intended caller. */
export async function applyFinanceHistoryPlan(
  plan: FinanceHistoryPlan,
  expectedDigest: string,
  options: FinanceHistoryApplyOptions,
): Promise<FinanceHistoryApplyResult> {
  verifyFinanceHistoryPlanDigest(plan, expectedDigest)
  if (plan.invalidRows.length > 0) {
    throw new FinanceRefusal(
      `Finance history plan contains ${plan.invalidRows.length} invalid row(s); apply is refused.`,
    )
  }
  const intraPlanDuplicates = plan.duplicates.filter(
    (duplicate) => duplicate.existingOperationId === null,
  )
  if (intraPlanDuplicates.length > 0) {
    throw new FinanceRefusal(
      `Finance history plan contains ${intraPlanDuplicates.length} duplicate source ref(s) inside the plan; apply is refused.`,
    )
  }
  const existingDuplicateRefs = new Set(
    plan.duplicates
      .filter((duplicate) => duplicate.existingOperationId !== null)
      .map((duplicate) => duplicate.sourceRef),
  )
  const withoutDocuments = plan.operations.filter(
    (operation) =>
      operation.validation.valid &&
      !existingDuplicateRefs.has(operation.sourceRef) &&
      operation.documents.length === 0,
  )
  if (withoutDocuments.length > 0) {
    throw new FinanceRefusal(
      `Finance history plan has ${withoutDocuments.length} valid row(s) without a confirming document; apply is refused before any write.`,
    )
  }
  const uploadedBy = await operatorMemberId(options.operatorEmail)
  const actor: FinanceActor = {
    email: options.operatorEmail,
    roles: ['platform-user', 'finance-approve'],
  }
  const storage = options.storage ?? resolveFinanceDocumentStorage()
  const documentIds = new Map<string, number>()
  const result: FinanceHistoryApplyResult = {
    planDigest: plan.planDigest,
    applied: [],
    skipped: [],
  }

  for (const operation of plan.operations) {
    if (!operation.validation.valid) continue
    const existing = await existingBackfillOperation(operation.sourceRef)
    if (existing !== null) {
      result.skipped.push({ sourceRef: operation.sourceRef, operationId: existing })
      continue
    }
    for (const document of operation.documents) {
      if (documentIds.has(document.id)) continue
      const bytes = await options.loadDocumentBytes(document)
      documentIds.set(document.id, await stageDocument(document, uploadedBy, bytes, storage))
    }

    let applied: { operationId: number; intakeItemId: number | null }
    try {
      applied = await platformTransaction(BACKFILL_AUDIT_CONTEXT, async (tx) => {
        const [already] = await tx
          .select({ id: financeOperation.id })
          .from(financeOperation)
          .where(
            and(
              eq(financeOperation.source, 'backfill'),
              eq(financeOperation.sourceRef, operation.sourceRef),
            ),
          )
        if (already !== undefined) return { operationId: already.id, intakeItemId: null }
        const [item] = await tx
          .insert(financeIntakeItem)
          .values(intakeValues(operation, uploadedBy))
          .onConflictDoNothing()
          .returning({ id: financeIntakeItem.id })
        if (item === undefined) {
          const [raced] = await tx
            .select({ id: financeOperation.id })
            .from(financeOperation)
            .where(
              and(
                eq(financeOperation.source, 'backfill'),
                eq(financeOperation.sourceRef, operation.sourceRef),
              ),
            )
          if (raced === undefined) {
            throw new FinanceRefusal(
              `Backfill intake ${operation.sourceRef} already exists without a posted operation.`,
            )
          }
          return { operationId: raced.id, intakeItemId: null }
        }
        await tx.insert(financeDocumentLink).values(
          operation.documents.map((document) => ({
            documentId: documentIds.get(document.id)!,
            intakeItemId: item.id,
            linkedBy: uploadedBy,
          })),
        )
        const posted = await postIntakeItemInTransaction(tx, actor, item.id)
        return { operationId: posted.operationId!, intakeItemId: item.id }
      })
    } catch (error) {
      if (!isBackfillUniqueRace(error)) throw error
      const raced = await existingBackfillOperation(operation.sourceRef)
      if (raced === null) throw error
      applied = { operationId: raced, intakeItemId: null }
    }
    if (applied.intakeItemId === null) {
      result.skipped.push({ sourceRef: operation.sourceRef, operationId: applied.operationId })
    } else {
      result.applied.push({
        sourceRef: operation.sourceRef,
        intakeItemId: applied.intakeItemId,
        operationId: applied.operationId,
      })
    }
  }
  return result
}
