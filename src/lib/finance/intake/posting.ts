/**
 * The one door from an approved intake item into the immutable ledger
 * (spec 339 EARS-505/506/507/513/527/528).
 *
 * The item row is locked, its confirming document is checked, the operation is
 * built through F1's transaction-scoped writers, and only then is the item
 * linked and made terminal. All of it runs inside the same
 * `platformTransaction`; there is no operation-first recovery state to repair.
 */
import { eq, sql } from 'drizzle-orm'

import { financeConversionStep } from '@/lib/platform/db/schema/finance/finance-conversion-step'
import {
  financeIntakeItem,
  type FinanceIntakeKind,
  type FinanceIntakeItemRow,
  type FinanceIntakeSource,
} from '@/lib/platform/db/schema/finance/finance-intake-item'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import { appendPostings, realizedFxPostings, recordConversionInTransaction } from '../conversions'
import { assertFinanceLedgerAccess, financeAuditContext, type FinanceActor } from '../core/actor'
import { FinanceRefusal } from '../core/errors'
import {
  assertBalancedPerCurrency,
  assertPostingCurrencyMatchesAccount,
  assertProjectOnResultPostings,
  type PostingDraft,
} from '../core/invariants'
import {
  assertNoRetiredAccount,
  insertOperation,
  loadAccountFacts,
  prepareDimensions,
  recordOperationInTransaction,
  type RecordedOperation,
} from '../operations'
import { assertRequestPurposeReady } from '../purpose-proposals'
import {
  ensureSystemAccount,
  requireAccount,
  requireCurrency,
  type FinanceAccountView,
} from '../references'
import { intakeItemToView, lockIntakeItem, type FinanceIntakeItemView } from './items'

type PostingItem = Omit<FinanceIntakeItemRow, 'kind' | 'source'> & {
  kind: FinanceIntakeKind
  source: FinanceIntakeSource
}

/** Post one already-approved item. Approval/confirmation orchestration belongs to #386. */
export async function postIntakeItem(
  actor: FinanceActor,
  itemId: number,
): Promise<FinanceIntakeItemView> {
  assertFinanceLedgerAccess(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const item = await lockIntakeItem(tx, itemId)
    if (item.status !== 'approved') {
      throw new FinanceRefusal(
        `Позиция приёмки #${item.id} не проводится из статуса «${item.status}»: проводка доступна только после approved (EARS-505).`,
      )
    }
    await assertRequestPurposeReady(tx, item.id)
    await requireReadyDocument(tx, item.id)
    const postedBy = await requireActorMemberId(tx, actor)
    const operation = await recordItemOperation(tx, item as PostingItem)
    const postedAt = new Date()
    const [updated] = await tx
      .update(financeIntakeItem)
      .set({
        status: 'posted',
        operationId: operation.id,
        postedBy,
        postedAt,
      })
      .where(eq(financeIntakeItem.id, item.id))
      .returning()
    return intakeItemToView(updated)
  })
}

async function requireReadyDocument(tx: PlatformTx, itemId: number): Promise<void> {
  const result = await tx.execute(sql`
    select 1
      from core.finance_document_link dl
      join core.finance_document d on d.id = dl.document_id
     where dl.intake_item_id = ${itemId} and d.storage_state = 'ready'
     limit 1
  `)
  if (result.rows.length === 0) {
    throw new FinanceRefusal(
      `Позиция приёмки #${itemId} ждёт подтверждающий документ: без прикреплённого и загруженного файла книги не меняются (EARS-506).`,
    )
  }
}

async function requireActorMemberId(tx: PlatformTx, actor: FinanceActor): Promise<number> {
  const result = await tx.execute(sql`
    select id from core.member where lower(email) = ${actor.email.trim().toLowerCase()} limit 1
  `)
  const row = result.rows[0] as { id?: number } | undefined
  if (row?.id === undefined) {
    throw new FinanceRefusal(
      `У ${actor.email} нет записи в core.member, поэтому posted_by записать некому (EARS-505).`,
    )
  }
  return Number(row.id)
}

async function recordItemOperation(tx: PlatformTx, item: PostingItem): Promise<RecordedOperation> {
  assertPositiveAmounts(item)
  switch (item.kind) {
    case 'expense':
      return recordExpense(tx, item)
    case 'income':
      return recordIncome(tx, item)
    case 'transfer':
      return recordTransfer(tx, item)
    case 'conversion':
      return recordOwnConversion(tx, item)
    default:
      throw new FinanceRefusal(`Вид позиции «${item.kind}» не проводится.`)
  }
}

function assertPositiveAmounts(item: PostingItem): void {
  if (item.amount <= 0n || (item.paidAmount !== null && item.paidAmount <= 0n)) {
    throw new FinanceRefusal('Проводимые суммы должны быть положительными.')
  }
  if (item.feeAmount !== null && item.feeAmount <= 0n) {
    throw new FinanceRefusal('Комиссия должна быть положительной суммой расхода.')
  }
}

async function recordExpense(tx: PlatformTx, item: PostingItem): Promise<RecordedOperation> {
  if (item.purposeId === null) {
    throw new FinanceRefusal('Расход без назначения не проводится.')
  }
  const result = await ensureSystemAccount(tx, 'expense', item.currency)
  const payer = await resolveExpensePayer(tx, item)
  const chargedAmount = item.paidAmount ?? item.amount
  const chargedCurrency = item.paidCurrency ?? item.currency
  assertAccountCurrency(payer, chargedCurrency, 'счёта списания')
  assertFeeCurrency(item, chargedCurrency)

  if (chargedCurrency !== item.currency) {
    return recordCrossCurrencyResult(tx, item, {
      result,
      resultAmount: item.amount,
      resultSign: 1n,
      money: payer,
      moneyAmount: chargedAmount,
      moneySign: -1n,
      fromCurrency: chargedCurrency,
      fromAmount: chargedAmount,
      toCurrency: item.currency,
      toAmount: item.amount,
    })
  }
  assertNoRedundantPaidAmount(item)
  const postings: PostingDraft[] = [
    resultPosting(item, result.id, item.amount),
    moneyPosting(item, payer.id, -item.amount),
    ...(await feePostings(tx, item, payer)),
  ]
  return recordOperationInTransaction(tx, operationInput(item, postings))
}

async function recordIncome(tx: PlatformTx, item: PostingItem): Promise<RecordedOperation> {
  assertNoPurpose(item)
  if (item.accountId === null || item.personalFunds) {
    throw new FinanceRefusal('Доход обязан назвать денежный счёт компании.')
  }
  const money = await requireMoneyAccount(tx, item.accountId, 'счёта зачисления')
  const result = await ensureSystemAccount(tx, 'income', item.currency)
  const receivedAmount = item.paidAmount ?? item.amount
  const receivedCurrency = item.paidCurrency ?? item.currency
  assertAccountCurrency(money, receivedCurrency, 'счёта зачисления')
  assertFeeCurrency(item, receivedCurrency)

  if (receivedCurrency !== item.currency) {
    return recordCrossCurrencyResult(tx, item, {
      result,
      resultAmount: item.amount,
      resultSign: -1n,
      money,
      moneyAmount: receivedAmount,
      moneySign: 1n,
      fromCurrency: item.currency,
      fromAmount: item.amount,
      toCurrency: receivedCurrency,
      toAmount: receivedAmount,
    })
  }
  assertNoRedundantPaidAmount(item)
  const postings: PostingDraft[] = [
    resultPosting(item, result.id, -item.amount),
    moneyPosting(item, money.id, item.amount),
    ...(await feePostings(tx, item, money)),
  ]
  return recordOperationInTransaction(tx, operationInput(item, postings))
}

async function recordTransfer(tx: PlatformTx, item: PostingItem): Promise<RecordedOperation> {
  assertNoPurpose(item)
  if (item.accountId === null || item.counterAccountId === null) {
    throw new FinanceRefusal('Перевод обязан назвать счёт списания и счёт зачисления.')
  }
  if (item.paidAmount !== null || item.paidCurrency !== null) {
    throw new FinanceRefusal('Межвалютный перевод записывается как kind = conversion.')
  }
  const source = await requireMoneyAccount(tx, item.accountId, 'счёта списания')
  const target = await requireAccount(tx, item.counterAccountId)
  assertAccountCurrency(source, item.currency, 'счёта списания')
  assertAccountCurrency(target, item.currency, 'счёта зачисления')
  if (target.isSystem && target.kind !== 'liability') {
    throw new FinanceRefusal(
      'Перевод из приёмки может назвать системным только liability-счёт (EARS-528).',
    )
  }
  if (target.kind === 'liability' && item.memberId === null) {
    throw new FinanceRefusal(
      'Возмещение обязано назвать участника, чей долг оно закрывает (EARS-528).',
    )
  }
  assertFeeCurrency(item, source.currency)
  const postings: PostingDraft[] = [
    { accountId: source.id, amount: -item.amount, currency: item.currency },
    {
      accountId: target.id,
      amount: item.amount,
      currency: item.currency,
      memberId: target.kind === 'liability' ? item.memberId : null,
    },
    ...(await feePostings(tx, item, source)),
  ]
  return recordOperationInTransaction(tx, operationInput(item, postings))
}

async function recordOwnConversion(tx: PlatformTx, item: PostingItem): Promise<RecordedOperation> {
  assertNoPurpose(item)
  if (
    item.accountId === null ||
    item.counterAccountId === null ||
    item.paidAmount === null ||
    item.paidCurrency === null
  ) {
    throw new FinanceRefusal('kind = conversion обязан назвать два счёта и две фактические суммы.')
  }
  const from = await requireCurrency(tx, item.currency)
  const to = await requireCurrency(tx, item.paidCurrency)
  const rate = deriveRate(item.amount, from.precision, item.paidAmount, to.precision)
  return recordConversionInTransaction(tx, {
    occurredOn: item.occurredOn,
    sourceAccountId: item.accountId,
    targetAccountId: item.counterAccountId,
    steps: [
      {
        fromCurrency: item.currency,
        toCurrency: item.paidCurrency,
        fromAmount: item.amount,
        toAmount: item.paidAmount,
        rate,
        fee:
          item.feeAmount === null || item.feeCurrency === null
            ? null
            : { amount: item.feeAmount, currency: item.feeCurrency, projectId: item.projectId },
      },
    ],
    source: item.source,
    sourceRef: item.sourceRef,
  })
}

type CrossCurrencyResult = {
  result: FinanceAccountView
  resultAmount: bigint
  resultSign: 1n | -1n
  money: FinanceAccountView
  moneyAmount: bigint
  moneySign: 1n | -1n
  fromCurrency: string
  fromAmount: bigint
  toCurrency: string
  toAmount: bigint
}

/** Module-private vendor/result path: one step, two authoritative amounts. */
async function recordCrossCurrencyResult(
  tx: PlatformTx,
  item: PostingItem,
  cross: CrossCurrencyResult,
): Promise<RecordedOperation> {
  const from = await requireCurrency(tx, cross.fromCurrency)
  const to = await requireCurrency(tx, cross.toCurrency)
  const conversionFrom = await ensureSystemAccount(tx, 'conversion', cross.fromCurrency)
  const conversionTo = await ensureSystemAccount(tx, 'conversion', cross.toCurrency)
  const rate = deriveRate(cross.fromAmount, from.precision, cross.toAmount, to.precision)
  const conversionStep = {
    fromCurrency: cross.fromCurrency,
    toCurrency: cross.toCurrency,
    fromAmount: cross.fromAmount,
    toAmount: cross.toAmount,
    rate,
  }
  const postings: PostingDraft[] = [
    resultPosting(item, cross.result.id, cross.resultSign * cross.resultAmount),
    moneyPosting(item, cross.money.id, cross.moneySign * cross.moneyAmount),
    {
      accountId: conversionFrom.id,
      amount: cross.fromAmount,
      currency: cross.fromCurrency,
      conversionStepNo: 1,
    },
    {
      accountId: conversionTo.id,
      amount: -cross.toAmount,
      currency: cross.toCurrency,
      conversionStepNo: 1,
    },
    ...(await feePostings(tx, item, cross.money, 1)),
    ...(await realizedFxPostings(tx, conversionStep)),
  ]
  const accounts = await loadAccountFacts(tx, postings)
  assertNoRetiredAccount(accounts)
  const prepared = await prepareDimensions(tx, operationInput(item, postings), accounts)
  assertPostingCurrencyMatchesAccount(prepared, accounts)
  assertProjectOnResultPostings(prepared, accounts)
  assertBalancedPerCurrency(prepared)

  const operation = await insertOperation(tx, {
    occurredOn: item.occurredOn,
    source: item.source,
    purposeId: item.kind === 'expense' ? item.purposeId : null,
    sourceRef: item.sourceRef,
    backdated: false,
    reverses: null,
    postings: [],
  })
  const [step] = await tx
    .insert(financeConversionStep)
    .values({
      operationId: operation.id,
      stepNo: 1,
      fromCurrency: conversionStep.fromCurrency,
      toCurrency: conversionStep.toCurrency,
      rate: conversionStep.rate,
    })
    .returning()
  return appendPostings(tx, operation, prepared, new Map([[1, step.id]]))
}

async function resolveExpensePayer(tx: PlatformTx, item: PostingItem): Promise<FinanceAccountView> {
  const currency = item.paidCurrency ?? item.currency
  if (item.personalFunds) {
    if (item.accountId !== null || item.memberId === null) {
      throw new FinanceRefusal(
        'Расход personal_funds не называет счёт компании и обязан назвать участника (EARS-513).',
      )
    }
    return ensureSystemAccount(tx, 'liability', currency)
  }
  if (item.accountId === null) {
    throw new FinanceRefusal('Расход обязан назвать счёт списания.')
  }
  return requireMoneyAccount(tx, item.accountId, 'счёта списания')
}

async function requireMoneyAccount(
  tx: PlatformTx,
  accountId: number,
  label: string,
): Promise<FinanceAccountView> {
  const account = await requireAccount(tx, accountId)
  if (account.isSystem) {
    throw new FinanceRefusal(`Системный счёт «${account.name}» не может быть ${label}.`)
  }
  return account
}

function assertAccountCurrency(account: FinanceAccountView, currency: string, label: string): void {
  if (account.currency !== currency) {
    throw new FinanceRefusal(
      `Валюта ${label} «${account.name}» — ${account.currency}, а позиция называет ${currency} (EARS-312).`,
    )
  }
}

function assertNoPurpose(item: PostingItem): void {
  if (item.purposeId !== null) {
    throw new FinanceRefusal('Назначение указывается только у расхода.')
  }
}

function assertNoRedundantPaidAmount(item: PostingItem): void {
  if (item.paidAmount !== null && item.paidAmount !== item.amount) {
    throw new FinanceRefusal(
      'Вторая сумма нужна для другой валюты; в одной валюте у операции одна авторитетная сумма.',
    )
  }
}

function assertFeeCurrency(item: PostingItem, payerCurrency: string): void {
  if (item.feeCurrency !== null && item.feeCurrency !== payerCurrency) {
    throw new FinanceRefusal(
      `Комиссия в ${item.feeCurrency} не может быть списана со счёта в ${payerCurrency}.`,
    )
  }
}

function operationInput(item: PostingItem, postings: readonly PostingDraft[]) {
  return {
    occurredOn: item.occurredOn,
    source: item.source,
    postings,
    purposeId: item.kind === 'expense' ? item.purposeId : null,
    sourceRef: item.sourceRef,
  }
}

function resultPosting(item: PostingItem, accountId: number, amount: bigint): PostingDraft {
  return {
    accountId,
    amount,
    currency: item.currency,
    projectId: item.projectId,
    productId: item.productId,
    memberId: item.memberId,
  }
}

function moneyPosting(item: PostingItem, accountId: number, amount: bigint): PostingDraft {
  return {
    accountId,
    amount,
    currency: item.paidCurrency ?? item.currency,
    memberId: item.personalFunds ? item.memberId : null,
  }
}

async function feePostings(
  tx: PlatformTx,
  item: PostingItem,
  payer: FinanceAccountView,
  conversionStepNo?: number,
): Promise<PostingDraft[]> {
  if (item.feeAmount === null || item.feeCurrency === null) return []
  const expense = await ensureSystemAccount(tx, 'expense', item.feeCurrency)
  return [
    {
      accountId: expense.id,
      amount: item.feeAmount,
      currency: item.feeCurrency,
      projectId: item.projectId,
      productId: item.productId,
      memberId: item.memberId,
      conversionStepNo,
    },
    {
      accountId: payer.id,
      amount: -item.feeAmount,
      currency: item.feeCurrency,
      memberId: item.personalFunds ? item.memberId : null,
      conversionStepNo,
    },
  ]
}

/** A decimal testimony derived from the amounts, never used to compute either. */
export function deriveRate(
  fromAmount: bigint,
  fromPrecision: number,
  toAmount: bigint,
  toPrecision: number,
): string {
  const numerator = toAmount * 10n ** BigInt(fromPrecision)
  const denominator = fromAmount * 10n ** BigInt(toPrecision)
  const whole = numerator / denominator
  let remainder = numerator % denominator
  if (remainder === 0n) return whole.toString()
  let fraction = ''
  for (let index = 0; index < 48 && remainder !== 0n; index += 1) {
    remainder *= 10n
    fraction += (remainder / denominator).toString()
    remainder %= denominator
  }
  fraction = fraction.replace(/0+$/, '')
  if (whole === 0n && !/[1-9]/.test(fraction)) {
    throw new FinanceRefusal('Из двух сумм не удалось выразить положительный десятичный курс.')
  }
  return `${whole}.${fraction}`
}
