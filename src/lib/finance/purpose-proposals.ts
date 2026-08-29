/** Missing-purpose proposals bound to draft requests (spec 339 EARS-526). */
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { findMemberByEmail } from '@/lib/member'
import { getPlatformDb } from '@/lib/platform/db/client'
import { financeIntakeItem } from '@/lib/platform/db/schema/finance/finance-intake-item'
import { financePurposeProposal } from '@/lib/platform/db/schema/finance/finance-purpose-proposal'
import { financePurpose } from '@/lib/platform/db/schema/finance/finance-purpose'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import {
  assertFinanceIntakeAccess,
  assertFinanceReferenceAccess,
  financeAuditContext,
  holdsFinanceReferenceRole,
  type FinanceActor,
} from './core/actor'
import { FinanceAccessRefusal, FinanceRefusal } from './core/errors'

export type FinancePurposeProposalStatus = 'pending' | 'resolved' | 'dismissed'

export type FinancePurposeProposalView = {
  id: number
  intakeItemId: number | null
  text: string
  proposedBy: number
  createdAt: Date
  resolvedPurposeId: number | null
  resolvedAt: Date | null
  status: FinancePurposeProposalStatus
}

function toView(row: typeof financePurposeProposal.$inferSelect): FinancePurposeProposalView {
  const status: FinancePurposeProposalStatus =
    row.resolvedAt === null ? 'pending' : row.resolvedPurposeId === null ? 'dismissed' : 'resolved'
  return { ...row, status }
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FinanceRefusal('Предложение назначения не может быть пустым (EARS-526).')
  }
  return value.trim()
}

async function requireMemberId(actor: FinanceActor): Promise<number> {
  const member = await findMemberByEmail(actor.email)
  if (member === null) {
    throw new FinanceAccessRefusal(
      `У ${actor.email} нет записи в общем реестре людей (core.member), а предложение ` +
        'назначения обязано называть автора. Заведите участника — src/lib/member.',
    )
  }
  return member.id
}

async function lockRequest(tx: PlatformTx, id: number) {
  const [row] = await tx
    .select()
    .from(financeIntakeItem)
    .where(eq(financeIntakeItem.id, id))
    .for('update')
  if (row === undefined) throw new FinanceRefusal(`Заявки #${id} не существует.`)
  return row
}

async function requireProposal(tx: PlatformTx, id: number) {
  const [row] = await tx
    .select()
    .from(financePurposeProposal)
    .where(eq(financePurposeProposal.id, id))
  if (row === undefined) throw new FinanceRefusal(`Предложения назначения #${id} не существует.`)
  return row
}

function pendingRequestId(row: typeof financePurposeProposal.$inferSelect, id: number): number {
  if (row.resolvedAt !== null) {
    throw new FinanceRefusal(
      `Предложение назначения #${id} уже ${
        row.resolvedPurposeId === null ? 'отклонено' : 'разрешено'
      } и повторно не меняется (EARS-526).`,
    )
  }
  if (row.intakeItemId === null) {
    throw new FinanceRefusal(
      `Ожидающее предложение назначения #${id} потеряло связь с заявкой; ` +
        'такое состояние запрещено EARS-526.',
    )
  }
  return row.intakeItemId
}

async function lockPendingProposalForRequest(tx: PlatformTx, id: number, requestId: number) {
  const [row] = await tx
    .select()
    .from(financePurposeProposal)
    .where(eq(financePurposeProposal.id, id))
    .for('update')
  if (row === undefined) throw new FinanceRefusal(`Предложения назначения #${id} не существует.`)
  const currentRequestId = pendingRequestId(row, id)
  if (currentRequestId !== requestId) {
    throw new FinanceRefusal(
      `Предложение назначения #${id} больше не связано с заявкой #${requestId}; ` +
        'повторите действие по его текущему состоянию (EARS-526).',
    )
  }
  return row
}

async function pendingProposal(tx: PlatformTx, intakeItemId: number) {
  const [row] = await tx
    .select({ id: financePurposeProposal.id })
    .from(financePurposeProposal)
    .where(
      and(
        eq(financePurposeProposal.intakeItemId, intakeItemId),
        isNull(financePurposeProposal.resolvedAt),
      ),
    )
  return row
}

/** The caller holds the request row, so lifecycle writes serialize before this read. */
export async function assertNoPendingPurposeProposal(
  tx: PlatformTx,
  intakeItemId: number,
): Promise<void> {
  const pending = await pendingProposal(tx, intakeItemId)
  if (pending !== undefined) {
    throw new FinanceRefusal(
      `Заявка #${intakeItemId} ждёт решения по предложению назначения #${pending.id}; ` +
        'сначала разрешите или отклоните предложение (EARS-526).',
    )
  }
}

/** The transaction-scoped invariant the atomic posting path in #385 consumes. */
export async function assertRequestPurposeReady(
  tx: PlatformTx,
  intakeItemId: number,
): Promise<void> {
  const request = await lockRequest(tx, intakeItemId)
  if (request.source !== 'request' || request.kind !== 'expense') return
  await assertNoPendingPurposeProposal(tx, request.id)
  if (request.purposeId === null) {
    throw new FinanceRefusal(
      `Заявка #${request.id} не отправляется без назначения: выберите строку справочника или ` +
        'подайте предложение назначения (EARS-526).',
    )
  }
}

/** A member proposes only from their own draft request; finance-entry may assist. */
export async function createPurposeProposal(
  actor: FinanceActor,
  input: { intakeItemId: number; text: string },
): Promise<FinancePurposeProposalView> {
  const text = requireText(input.text)
  const proposedBy = await requireMemberId(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const request = await lockRequest(tx, input.intakeItemId)
    const ownDraftRequest =
      request.source === 'request' && request.status === 'draft' && request.createdBy === proposedBy
    assertFinanceIntakeAccess(actor, { ownRequest: ownDraftRequest })
    if (request.source !== 'request' || request.status !== 'draft') {
      throw new FinanceRefusal(
        `Предложение назначения создаётся только из черновика заявки; позиция #${request.id} ` +
          `имеет source = «${request.source}», status = «${request.status}» (EARS-526).`,
      )
    }
    if (request.purposeId !== null) {
      throw new FinanceRefusal(
        `У заявки #${request.id} уже выбрано назначение #${request.purposeId}; предложение ` +
          'нужно только когда подходящего назначения нет (EARS-526).',
      )
    }
    const pending = await pendingProposal(tx, request.id)
    if (pending !== undefined) {
      throw new FinanceRefusal(
        `У заявки #${request.id} уже есть ожидающее предложение назначения #${pending.id} ` +
          '(EARS-526).',
      )
    }
    const [row] = await tx
      .insert(financePurposeProposal)
      .values({ intakeItemId: request.id, text, proposedBy })
      .returning()
    return toView(row)
  })
}

/** Admin sees the cabinet queue; every other member sees only proposals they filed. */
export async function listPurposeProposals(
  actor: FinanceActor,
): Promise<FinancePurposeProposalView[]> {
  const query = getPlatformDb().select().from(financePurposeProposal)
  const rows = holdsFinanceReferenceRole(actor)
    ? await query.orderBy(asc(financePurposeProposal.id))
    : await query
        .where(eq(financePurposeProposal.proposedBy, await requireMemberId(actor)))
        .orderBy(asc(financePurposeProposal.id))
  return rows.map(toView)
}

/** Link a pending proposal to a real purpose and unblock its exact draft atomically. */
export async function resolvePurposeProposal(
  actor: FinanceActor,
  id: number,
  input: { purposeId: number },
): Promise<FinancePurposeProposalView> {
  assertFinanceReferenceAccess(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const observed = await requireProposal(tx, id)
    const requestId = pendingRequestId(observed, id)
    const request = await lockRequest(tx, requestId)
    await lockPendingProposalForRequest(tx, id, request.id)
    const [purpose] = await tx
      .select()
      .from(financePurpose)
      .where(eq(financePurpose.id, input.purposeId))
    if (purpose === undefined || purpose.retiredAt !== null) {
      throw new FinanceRefusal(
        `Назначение #${input.purposeId} не существует или выведено из использования; ` +
          'предложение можно разрешить только в действующее назначение (EARS-526).',
      )
    }
    if (request.source !== 'request' || request.status !== 'draft' || request.purposeId !== null) {
      throw new FinanceRefusal(
        `Заявка #${request.id} уже не является черновиком без назначения; предложение #${id} ` +
          'не может перезаписать её текущее состояние (EARS-526).',
      )
    }

    const [resolved] = await tx
      .update(financePurposeProposal)
      .set({ resolvedPurposeId: purpose.id, resolvedAt: sql`now()` })
      .where(eq(financePurposeProposal.id, id))
      .returning()
    await tx
      .update(financeIntakeItem)
      .set({ purposeId: purpose.id })
      .where(eq(financeIntakeItem.id, request.id))
    return toView(resolved)
  })
}

/** Dismissal is terminal but keeps the proposal row and leaves the request blocked. */
export async function dismissPurposeProposal(
  actor: FinanceActor,
  id: number,
): Promise<FinancePurposeProposalView> {
  assertFinanceReferenceAccess(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const observed = await requireProposal(tx, id)
    const requestId = pendingRequestId(observed, id)
    await lockRequest(tx, requestId)
    await lockPendingProposalForRequest(tx, id, requestId)
    const [dismissed] = await tx
      .update(financePurposeProposal)
      .set({ resolvedAt: sql`now()`, resolvedPurposeId: null })
      .where(eq(financePurposeProposal.id, id))
      .returning()
    return toView(dismissed)
  })
}
