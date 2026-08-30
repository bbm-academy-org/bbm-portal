/**
 * The expense-request workflow over the common intake spine (spec 339 §C,
 * EARS-502/508…512/531; issue #386).
 *
 * A request is not a second persistence path: every function below delegates
 * row lifecycle to `items.ts`, document access to `documents.ts`, and every
 * ledger write to `postIntakeItem`. This file owns only the product act that
 * composes those primitives: approve means post immediately when the confirming
 * document is already present, otherwise authorize and wait.
 */
import { eq } from 'drizzle-orm'

import { findMemberByEmail } from '@/lib/member'
import { financeCounterparty } from '@/lib/platform/db/schema/finance/finance-counterparty'
import type { PlatformTx } from '@/lib/platform/db/transaction'

import { assertFinanceLedgerAccess, type FinanceActor } from '../core/actor'
import { FinanceAccessRefusal, FinanceRefusal } from '../core/errors'
import { assertProductBinding } from '../core/invariants'
import { listFinanceDocuments, type FinanceDocumentView } from '../documents/documents'
import {
  requireAccount,
  requireCurrency,
  requireProduct,
  requireProject,
  requirePurpose,
} from '../references'
import {
  createIntakeItem,
  editIntakeItem,
  getIntakeItem,
  listIntakeItems,
  transitionIntakeItem,
  type EditIntakeItemPatch,
  type FinanceIntakeItemView,
  type ListIntakeItemsFilter,
} from './items'
import { assertIntakePostingSnapshot, createIntakePostingSnapshot, postIntakeItem } from './posting'

/** The fields the member-facing request form owns (EARS-508). */
export type CreateExpenseRequestInput = {
  /** Expected money date for pre-spend; replaced by the actual date at confirmation. */
  occurredOn: string
  /** Empty exactly for `personalFunds`. */
  accountId: number | null
  /** Document-side amount and currency. */
  amount: bigint
  currency: string
  /** Account-side facts when the charged currency differs. */
  paidAmount?: bigint | null
  paidCurrency?: string | null
  purposeId: number
  projectId: number
  productId?: number | null
  counterpartyId: number
  note?: string | null
  alreadyPaid?: boolean
  personalFunds?: boolean
}

export type EditExpenseRequestPatch = Partial<CreateExpenseRequestInput>

type ExpenseRequestState = {
  occurredOn: string
  accountId: number | null
  amount: bigint
  currency: string
  paidAmount: bigint | null
  paidCurrency: string | null
  purposeId: number
  projectId: number
  productId: number | null
  counterpartyId: number
  note: string | null
  alreadyPaid: boolean
  personalFunds: boolean
}

function positiveId(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new FinanceRefusal(`${label} обязателен и выбирается из справочника (EARS-508).`)
  }
}

async function requireCounterparty(tx: PlatformTx, id: number): Promise<void> {
  const [row] = await tx
    .select({ id: financeCounterparty.id })
    .from(financeCounterparty)
    .where(eq(financeCounterparty.id, id))
    .for('share')
  if (row === undefined) {
    throw new FinanceRefusal(`Контрагента #${id} нет в справочнике (EARS-508/532).`)
  }
}

/** Validate the reference and cross-currency parts the generic spine cannot know. */
async function assertExpenseRequestState(
  tx: PlatformTx,
  state: ExpenseRequestState,
): Promise<void> {
  positiveId(state.purposeId, 'Назначение')
  positiveId(state.projectId, 'Проект')
  positiveId(state.counterpartyId, 'Контрагент')

  const documentCurrency = await requireCurrency(tx, state.currency, { forShare: true })
  if (documentCurrency.retiredAt !== null) {
    throw new FinanceRefusal(
      `Валюта документа «${state.currency}» выведена из обращения (EARS-508).`,
    )
  }

  const project = await requireProject(tx, state.projectId, { forShare: true })
  if (project.retiredAt !== null) {
    throw new FinanceRefusal(`Проект «${project.name}» выведен из обращения (EARS-508).`)
  }

  const purpose = await requirePurpose(tx, state.purposeId, { forShare: true })
  if (purpose.retiredAt !== null) {
    throw new FinanceRefusal(`Назначение «${purpose.name}» выведено из обращения (EARS-508).`)
  }
  assertProductBinding(purpose.productBinding, state.productId, purpose.name)

  if (state.productId !== null) {
    const product = await requireProduct(tx, state.productId, { forShare: true })
    if (product.retiredAt !== null) {
      throw new FinanceRefusal(`Продукт «${product.name}» выведен из обращения (EARS-508).`)
    }
    if (product.projectId !== state.projectId) {
      throw new FinanceRefusal(
        `Продукт «${product.name}» относится к проекту #${product.projectId}, а заявка — к ` +
          `проекту #${state.projectId} (EARS-508).`,
      )
    }
  }
  await requireCounterparty(tx, state.counterpartyId)

  if (state.personalFunds) {
    if (state.paidCurrency !== null) {
      await requireCurrency(tx, state.paidCurrency, { forShare: true })
    }
    return
  }
  if (state.accountId === null) return // `items.ts` gives the EARS-513 refusal.

  const account = await requireAccount(tx, state.accountId, { forShare: true })
  if (account.isSystem || account.retiredAt !== null) {
    throw new FinanceRefusal(
      `Платящий счёт «${account.name}» недоступен для новой заявки (EARS-508).`,
    )
  }
  if (account.currency !== state.currency) {
    if (state.paidAmount === null || state.paidCurrency === null) {
      throw new FinanceRefusal(
        `Документ выставлен в ${state.currency}, а счёт «${account.name}» ведётся в ` +
          `${account.currency}: укажите фактическую списанную сумму и валюту счёта ` +
          '(EARS-508, кросс-валютный платёж).',
      )
    }
    if (state.paidCurrency !== account.currency) {
      throw new FinanceRefusal(
        `Фактическая валюта списания должна быть ${account.currency} — валютой платящего ` +
          `счёта «${account.name}», а не ${state.paidCurrency} (EARS-508).`,
      )
    }
    return
  }

  if (state.paidCurrency !== null && state.paidCurrency !== account.currency) {
    throw new FinanceRefusal(
      `Платящий счёт «${account.name}» ведётся в ${account.currency}, а фактическая сумма ` +
        `названа в ${state.paidCurrency} (EARS-508).`,
    )
  }
  if (state.paidAmount !== null && state.paidAmount !== state.amount) {
    throw new FinanceRefusal(
      'Вторая сумма нужна только для другой валюты; в валюте документа сумма одна (EARS-508).',
    )
  }
}

function createState(input: CreateExpenseRequestInput): ExpenseRequestState {
  return {
    occurredOn: input.occurredOn,
    accountId: input.accountId,
    amount: input.amount,
    currency: input.currency,
    paidAmount: input.paidAmount ?? null,
    paidCurrency: input.paidCurrency ?? null,
    purposeId: input.purposeId,
    projectId: input.projectId,
    productId: input.productId ?? null,
    counterpartyId: input.counterpartyId,
    note: input.note ?? null,
    alreadyPaid: input.alreadyPaid ?? false,
    personalFunds: input.personalFunds ?? false,
  }
}

function itemState(item: FinanceIntakeItemView): ExpenseRequestState {
  if (item.purposeId === null || item.counterpartyId === null) {
    throw new FinanceRefusal(
      `Заявка #${item.id} не заполнена: назначение и контрагент обязательны перед отправкой ` +
        '(EARS-508).',
    )
  }
  return {
    occurredOn: item.occurredOn,
    accountId: item.accountId,
    amount: item.amount,
    currency: item.currency,
    paidAmount: item.paidAmount,
    paidCurrency: item.paidCurrency,
    purposeId: item.purposeId,
    projectId: item.projectId,
    productId: item.productId,
    counterpartyId: item.counterpartyId,
    note: item.note,
    alreadyPaid: item.alreadyPaid,
    personalFunds: item.personalFunds,
  }
}

async function requireExpenseRequest(
  actor: FinanceActor,
  id: number,
): Promise<FinanceIntakeItemView> {
  const item = await getIntakeItem(actor, id)
  if (item === null) throw new FinanceRefusal(`Заявки #${id} не существует.`)
  assertExpenseRequest(item)
  return item
}

function assertExpenseRequest(item: FinanceIntakeItemView): void {
  if (item.source !== 'request' || item.kind !== 'expense') {
    throw new FinanceRefusal(
      `Позиция #${item.id} не является заявкой на расход: source = «${item.source}», ` +
        `kind = «${item.kind}».`,
    )
  }
}

/** Create a member-owned draft. Submission is a separate explicit act. */
export async function createExpenseRequest(
  actor: FinanceActor,
  input: CreateExpenseRequestInput,
): Promise<FinanceIntakeItemView> {
  const state = createState(input)
  const member = state.personalFunds ? await findMemberByEmail(actor.email) : null
  if (state.personalFunds && member === null) {
    throw new FinanceAccessRefusal(
      `У ${actor.email} нет записи в core.member, поэтому заявку об оплате своими средствами ` +
        'некому связать с будущим возмещением (EARS-508/513).',
    )
  }
  return createIntakeItem(
    actor,
    {
      source: 'request',
      kind: 'expense',
      ...state,
      memberId: member?.id ?? null,
    },
    { validate: (tx) => assertExpenseRequestState(tx, state) },
  )
}

/** Edit only through the status/ownership rules of the common spine. */
export async function editExpenseRequest(
  actor: FinanceActor,
  id: number,
  patch: EditExpenseRequestPatch,
): Promise<FinanceIntakeItemView> {
  const item = await requireExpenseRequest(actor, id)
  const spinePatch: EditIntakeItemPatch = {
    ...patch,
    ...(patch.personalFunds === undefined
      ? {}
      : { memberId: patch.personalFunds ? item.createdBy : null }),
  }
  return editIntakeItem(actor, id, spinePatch, {
    async validate(tx, next) {
      assertExpenseRequest(next)
      await assertExpenseRequestState(tx, itemState(next))
    },
  })
}

export async function submitExpenseRequest(
  actor: FinanceActor,
  id: number,
): Promise<FinanceIntakeItemView> {
  await requireExpenseRequest(actor, id)
  return (await transitionIntakeItem(actor, id, 'submit', {
    async validate(tx, current) {
      assertExpenseRequest(current)
      await assertExpenseRequestState(tx, itemState(current))
    },
  }))!
}

export async function cancelExpenseRequest(
  actor: FinanceActor,
  id: number,
): Promise<FinanceIntakeItemView> {
  await requireExpenseRequest(actor, id)
  return (await transitionIntakeItem(actor, id, 'cancel'))!
}

export async function getExpenseRequest(
  actor: FinanceActor,
  id: number,
): Promise<FinanceIntakeItemView | null> {
  const item = await getIntakeItem(actor, id)
  if (item === null) return null
  if (item.source !== 'request' || item.kind !== 'expense') return null
  return item
}

export async function listExpenseRequests(
  actor: FinanceActor,
  filter: Pick<ListIntakeItemsFilter, 'status'> = {},
): Promise<FinanceIntakeItemView[]> {
  const items = await listIntakeItems(actor, { ...filter, source: ['request'] })
  return items.filter((item) => item.kind === 'expense')
}

export type FinanceDocumentVerificationVerdict =
  { verdict: 'verified' } | { verdict: 'needs_review'; reason: string }

export type FinanceDocumentVerificationContext = {
  actor: FinanceActor
  request: FinanceIntakeItemView
  documents: readonly FinanceDocumentView[]
}

/** One injected verifier; no mutable registry and no second shipped implementation. */
export type FinanceDocumentVerifier = {
  readonly id: string
  verify(context: FinanceDocumentVerificationContext): Promise<FinanceDocumentVerificationVerdict>
}

/** v1: the approve-role human's explicit confirmation (EARS-531). */
export const humanFinanceDocumentVerifier: FinanceDocumentVerifier = Object.freeze({
  id: 'human-finance-approve',
  async verify(context) {
    assertFinanceLedgerAccess(context.actor)
    return { verdict: 'verified' }
  },
})

export type ConfirmExpenseRequestOptions = {
  /** Actual money date, replacing the expected pre-spend date without a bounce. */
  occurredOn?: string
  /** Internal integration seam; v1 callers omit it and use the human verifier. */
  verifier?: FinanceDocumentVerifier
}

/**
 * Verify and post an already-authorized request. The ledger door remains
 * `postIntakeItem`; a verifier can decide WHETHER it is called, never replace it.
 */
export async function confirmExpenseRequest(
  actor: FinanceActor,
  id: number,
  options: ConfirmExpenseRequestOptions = {},
): Promise<FinanceIntakeItemView> {
  assertFinanceLedgerAccess(actor)
  const request = await requireExpenseRequest(actor, id)
  const documents = await listFinanceDocuments(actor, { intakeItemId: id })
  if (documents.length === 0) {
    throw new FinanceRefusal(
      `Заявка #${id} ждёт подтверждающий документ: подтверждать и проводить пока нечего ` +
        '(EARS-506/511).',
    )
  }

  return verifyAndPostExpenseRequest(actor, request, documents, options)
}

async function verifyAndPostExpenseRequest(
  actor: FinanceActor,
  request: FinanceIntakeItemView,
  documents: readonly FinanceDocumentView[],
  options: ConfirmExpenseRequestOptions & { approveSubmittedRequest?: boolean },
): Promise<FinanceIntakeItemView> {
  const verifier = options.verifier ?? humanFinanceDocumentVerifier
  const expectedSnapshot = createIntakePostingSnapshot(request, documents)
  if (verifier.id.trim() === '') {
    throw new FinanceRefusal('Document verifier обязан иметь непустой id (EARS-531).')
  }
  const verification = await verifier.verify({ actor, request, documents })
  if (verification.verdict !== 'verified') {
    throw new FinanceRefusal(
      `Verifier «${verifier.id}» не подтвердил заявку #${request.id}: ${verification.reason}. ` +
        'Проводки нет; заявка остаётся в очереди finance-approve (EARS-531).',
    )
  }

  return postIntakeItem(actor, request.id, {
    occurredOn: options.occurredOn,
    approveSubmittedRequest: options.approveSubmittedRequest,
    expectedSnapshot,
  })
}

/** Approve now; with a ready document the same act verifies and posts. */
export async function approveExpenseRequest(
  actor: FinanceActor,
  id: number,
  options: Pick<ConfirmExpenseRequestOptions, 'verifier'> = {},
): Promise<FinanceIntakeItemView> {
  assertFinanceLedgerAccess(actor)
  const request = await requireExpenseRequest(actor, id)
  const documents = await listFinanceDocuments(actor, { intakeItemId: id })
  if (documents.length === 0) {
    const expectedSnapshot = createIntakePostingSnapshot(request, documents)
    return (await transitionIntakeItem(actor, id, 'approve', {
      async validate(tx, current) {
        assertExpenseRequest(current)
        await assertIntakePostingSnapshot(tx, current, expectedSnapshot)
      },
    }))!
  }
  return verifyAndPostExpenseRequest(actor, request, documents, {
    ...options,
    approveSubmittedRequest: true,
  })
}

/** Refuse a submitted claim or revoke an unposted authorization. */
export async function refuseExpenseRequest(
  actor: FinanceActor,
  id: number,
  reason: string,
): Promise<FinanceIntakeItemView> {
  await requireExpenseRequest(actor, id)
  return (await transitionIntakeItem(actor, id, 'refuse', { reason }))!
}
