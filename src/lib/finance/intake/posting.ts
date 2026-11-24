/**
 * The one door from an approved intake item into the immutable ledger
 * (spec 339 EARS-505/506/507/513/527/528).
 *
 * The item row is locked, its confirming document is checked, the operation is
 * built through F1's transaction-scoped writers, and only then is the item
 * linked and made terminal. All of it runs inside the same
 * `platformTransaction`; there is no operation-first recovery state to repair.
 */
import { createHash } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'

import { financeConversionStep } from '@/lib/platform/db/schema/finance/finance-conversion-step'
import { financeDocument } from '@/lib/platform/db/schema/finance/finance-document'
import { financeDocumentLink } from '@/lib/platform/db/schema/finance/finance-document-link'
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
  assertRealizedFxWriteOrder,
  lockFxSystemAccounts,
  lockRealizedFxPools,
  type RealizedFxPoolLocks,
} from '../fx-pool-locks'
import {
  assertNoRetiredAccount,
  insertOperation,
  loadAccountFacts,
  prepareDimensions,
  parseRecordOperationInput,
  recordOperationInTransaction,
  type RecordedOperation,
} from '../operations'
import { assertRequestPurposeReady } from '../purpose-proposals'
import {
  ensureSystemAccount,
  requireAccount,
  requireCurrency,
  requireFundProject,
  type FinanceAccountView,
} from '../references'
import {
  assertIntakeAccountPlacement,
  assertIntakeSettlement,
  isReimbursementTransfer,
} from './account-placement'
import { contributionItemRefusal } from './contribution'
import {
  intakeItemToView,
  intakeMoneyFactsRefusal,
  intakePaidPairRefusal,
  lockIntakeItem,
  type FinanceIntakeItemView,
} from './items'

/**
 * The row as the ledger writers may read it.
 *
 * `occurredOn` is narrowed to a non-null string on purpose: the COLUMN is
 * nullable since EARS-533 (an unposted pre-spend request has no money date),
 * but nothing downstream of `postIntakeItem`'s gate may branch on that — the
 * gate refuses first, and every writer below keeps reading one date.
 */
type PostingItem = Omit<FinanceIntakeItemRow, 'kind' | 'source' | 'occurredOn'> & {
  kind: FinanceIntakeKind
  source: FinanceIntakeSource
  occurredOn: string
}

type PostingSnapshotDocument = {
  id: number
  filename: string
  mime: string
  size: number
  kind: string
  uploadedBy: number
  uploadedAt: Date
}

/** Opaque optimistic identity of the request and ready documents a verifier saw. */
export type IntakePostingSnapshot = Readonly<{ fingerprint: string }>

export function createIntakePostingSnapshot(
  item: FinanceIntakeItemView,
  documents: readonly PostingSnapshotDocument[],
): IntakePostingSnapshot {
  const normalizedItem = {
    ...item,
    amount: item.amount.toString(),
    paidAmount: item.paidAmount?.toString() ?? null,
    feeAmount: item.feeAmount?.toString() ?? null,
    decidedAt: item.decidedAt?.toISOString() ?? null,
    postedAt: item.postedAt?.toISOString() ?? null,
  }
  const normalizedDocuments = [...documents]
    .sort((left, right) => left.id - right.id)
    .map((document) => ({
      ...document,
      uploadedAt: document.uploadedAt.toISOString(),
    }))
  return Object.freeze({
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify(canonicalizeJson({ item: normalizedItem, documents: normalizedDocuments })),
      )
      .digest('hex'),
  })
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  )
}

/**
 * The money facts a request cannot know, supplied by the posting act (EARS-533).
 *
 * They are OPTIONS of the posting rather than a prior edit for the reason the
 * status machine gives: written here they land inside the posting transaction,
 * so the item never passes through a state whose approval covers data it has
 * not seen, and nothing bounces.
 */
export type IntakePostingMoneyDetails = {
  /** The account the money really left; `personal_funds` names none. */
  accountId?: number | null
  /** The account-side amount where the account is in another currency. */
  paidAmount?: bigint | null
  paidCurrency?: string | null
  /**
   * The actual money date supplied by EARS-511's confirmation act. It is
   * written with the posting in this transaction, so the sanctioned approved
   * edit never exists as an intermediate state and never bounces approval.
   */
  occurredOn?: string
}

/** The item as it will post — the row with the act's money facts applied. */
export function applyIntakePostingDetails<T extends FinanceIntakeItemView>(
  item: T,
  details: IntakePostingMoneyDetails,
): T {
  return {
    ...item,
    ...(details.occurredOn === undefined ? {} : { occurredOn: details.occurredOn }),
    ...(details.accountId === undefined ? {} : { accountId: details.accountId }),
    ...(details.paidAmount === undefined ? {} : { paidAmount: details.paidAmount }),
    ...(details.paidCurrency === undefined ? {} : { paidCurrency: details.paidCurrency }),
  }
}

/**
 * Does the act name ANY of the four money facts EARS-533 defers to posting?
 *
 * The four are one list, and every caller that asks the question must ask it of
 * the whole list: `approveExpenseRequest`'s no-document guard kept its own copy
 * without `paidCurrency` and would have dropped a body that named only the
 * currency instead of refusing it (#388 review round 2).
 */
export function namesIntakePostingMoneyFacts(details: IntakePostingMoneyDetails): boolean {
  return (
    details.occurredOn !== undefined ||
    details.accountId !== undefined ||
    details.paidAmount !== undefined ||
    details.paidCurrency !== undefined
  )
}

export type PostIntakeItemOptions = IntakePostingMoneyDetails & {
  /** EARS-510: approve a submitted expense request and post it in this transaction. */
  approveSubmittedRequest?: boolean
  /** The exact request/document identity approved by the verifier (EARS-510/531). */
  expectedSnapshot?: IntakePostingSnapshot
  /**
   * EARS-506's one exception: the approve-role HUMAN mark-paid act (EARS-543,
   * the EARS-544 refund with its reimbursement, the EARS-547 bulk act) posts
   * with no document — the recorded act and its author are the assertion that
   * money moved. Direct entry and an automated verifier never set it.
   */
  humanMarkPaidAct?: boolean
  /**
   * The caller already re-checked the request's snapshot under the row lock in
   * THIS transaction (the bulk act checks the token the dialog showed; the
   * single acts check the one they read). Only the module's own acts set it.
   */
  snapshotCheckedByCaller?: boolean
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Post one authorized item; EARS-510 may approve a submitted request in the same transaction. */
export async function postIntakeItem(
  actor: FinanceActor,
  itemId: number,
  options: PostIntakeItemOptions = {},
): Promise<FinanceIntakeItemView> {
  assertFinanceLedgerAccess(actor)

  return platformTransaction(financeAuditContext(actor), (tx) =>
    postIntakeItemInTransaction(tx, actor, itemId, options),
  )
}

/**
 * The posting itself, inside the CALLER's transaction (EARS-505): the refund
 * act posts a request and its reimbursement, and the bulk act posts every row
 * of a batch, each in ONE `platformTransaction` — one `txid` in the journal.
 * The caller has asked `assertFinanceLedgerAccess` already.
 */
export async function postIntakeItemInTransaction(
  tx: PlatformTx,
  actor: FinanceActor,
  itemId: number,
  options: PostIntakeItemOptions = {},
): Promise<FinanceIntakeItemView> {
  const item = await lockIntakeItem(tx, itemId)
  if (
    item.source === 'request' &&
    options.expectedSnapshot === undefined &&
    options.snapshotCheckedByCaller !== true
  ) {
    throw new FinanceRefusal(
      `Заявка #${item.id} проводится только по снимку, который подтвердил document verifier ` +
        '(EARS-531).',
    )
  }
  const approveAndPost = options.approveSubmittedRequest === true
  const expectedStatus = approveAndPost ? 'submitted' : 'approved'
  if (item.status !== expectedStatus) {
    throw new FinanceRefusal(
      `Позиция приёмки #${item.id} не проводится из статуса «${item.status}»: ` +
        `${approveAndPost ? 'одноактное согласование ожидает submitted' : 'проводка доступна только после approved'} ` +
        '(EARS-505/510).',
    )
  }
  if (approveAndPost && (item.source !== 'request' || item.kind !== 'expense')) {
    throw new FinanceRefusal(
      'Одноактное согласование и проведение относится только к заявке на расход ' +
        '(EARS-510). Остальные позиции сначала проходят обычный approved.',
    )
  }
  if (
    namesIntakePostingMoneyFacts(options) &&
    (item.source !== 'request' || item.kind !== 'expense')
  ) {
    throw new FinanceRefusal(
      'Счёт списания и фактическая дата вводятся в момент проведения только у заявки на ' +
        'расход (EARS-508/511/533).',
    )
  }
  if (options.occurredOn !== undefined && !ISO_DATE.test(options.occurredOn)) {
    throw new FinanceRefusal(
      `Фактическая дата «${options.occurredOn}» записана не в формате ГГГГ-ММ-ДД ` +
        '(EARS-508/511/533).',
    )
  }
  const withDetails = applyIntakePostingDetails(intakeItemToView(item), options)
  // EARS-533: the gate. Everything below reads one date and one payer.
  const moneyFacts = intakeMoneyFactsRefusal(withDetails, { posting: true })
  if (moneyFacts !== null) throw new FinanceRefusal(moneyFacts)
  // The charged pair belongs to the same gate: a caller of the module's own
  // API may half-name it, and without this the row invariant aborts the
  // transaction with a constraint name (#388 review round 2).
  const paidPair = intakePaidPairRefusal(withDetails)
  if (paidPair !== null) throw new FinanceRefusal(paidPair)
  if (options.expectedSnapshot !== undefined) {
    await assertIntakePostingSnapshot(tx, withDetails, options.expectedSnapshot)
  }
  // Built from the ROW plus the act's money facts, not from the view: the
  // ledger writers below read row fields the view does not carry, and a cast
  // of the view would hand them `undefined` without a type error.
  const postingItem = {
    ...item,
    occurredOn: withDetails.occurredOn,
    accountId: withDetails.accountId,
    paidAmount: withDetails.paidAmount,
    paidCurrency: withDetails.paidCurrency,
  } as PostingItem
  // EARS-528 again at the last door: a row may predate the filing-time rule.
  await assertIntakeAccountPlacement(tx, postingItem)
  await assertIntakeSettlement(tx, postingItem)
  await assertRequestPurposeReady(tx, item.id)
  if (options.humanMarkPaidAct === true) {
    assertHumanMarkPaidScope(postingItem)
  } else {
    await requireReadyDocument(tx, item.id)
  }
  const postedBy = await requireActorMemberId(tx, actor)
  const operation = await recordItemOperation(tx, postingItem)
  const postedAt = new Date()
  const [updated] = await tx
    .update(financeIntakeItem)
    .set({
      status: 'posted',
      occurredOn: postingItem.occurredOn,
      accountId: postingItem.accountId,
      paidAmount: postingItem.paidAmount,
      paidCurrency: postingItem.paidCurrency,
      ...(approveAndPost ? { decidedBy: postedBy, decidedAt: postedAt } : {}),
      operationId: operation.id,
      postedBy,
      postedAt,
    })
    .where(eq(financeIntakeItem.id, item.id))
    .returning()
  return intakeItemToView(updated)
}

/**
 * Where the documentless human act reaches (EARS-506): an expense REQUEST, and
 * the reimbursement transfer the refund act books with it. Nothing else — a
 * manual line or a backfill row stays document-gated whoever posts it.
 */
function assertHumanMarkPaidScope(item: PostingItem): void {
  const request = item.source === 'request' && item.kind === 'expense'
  const reimbursement = item.kind === 'transfer' && item.settlesItemId !== null
  if (request || reimbursement) return
  throw new FinanceRefusal(
    `Позиция приёмки #${item.id} проводится только с подтверждающим документом: отметка оплаты ` +
      'без чека относится к заявке на расход и её возмещению (EARS-506).',
  )
}

/** Public posting keeps request confirmation behind the verifier-owned workflow. */
export function postIntakeItemPublic(
  actor: FinanceActor,
  itemId: number,
): Promise<FinanceIntakeItemView> {
  return postIntakeItem(actor, itemId)
}

/** Re-check the verifier's optimistic snapshot while the intake row lock is held. */
export async function assertIntakePostingSnapshot(
  tx: PlatformTx,
  item: FinanceIntakeItemView,
  expected: IntakePostingSnapshot,
): Promise<void> {
  const rows = await tx
    .select({ document: financeDocument })
    .from(financeDocumentLink)
    .innerJoin(financeDocument, eq(financeDocumentLink.documentId, financeDocument.id))
    .where(
      and(eq(financeDocumentLink.intakeItemId, item.id), eq(financeDocument.storageState, 'ready')),
    )
  const actual = createIntakePostingSnapshot(
    item,
    rows.map(({ document }) => ({
      id: document.id,
      filename: document.filename,
      mime: document.mime,
      size: Number(document.size),
      kind: document.kind,
      uploadedBy: document.uploadedBy,
      uploadedAt: document.uploadedAt,
    })),
  )
  if (actual.fingerprint !== expected.fingerprint) {
    throw new FinanceRefusal(
      `Заявка #${item.id} или её документы изменились после проверки; согласование относится к прежнему снимку, ` +
        'поэтому проведение отменено и требуется повторная проверка (EARS-510/531).',
    )
  }
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
    case 'contribution':
      return recordContribution(tx, item)
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
  const chargedAmount = item.paidAmount ?? item.amount
  const chargedCurrency = item.paidCurrency ?? item.currency
  const fxPoolLocks =
    chargedCurrency === item.currency
      ? null
      : await lockRealizedFxPools(tx, [
          { fromCurrency: chargedCurrency, toCurrency: item.currency },
        ])
  if (fxPoolLocks !== null) {
    await lockFxSystemAccounts(tx, [
      { kind: 'expense', currency: item.currency },
      { kind: 'conversion', currency: chargedCurrency },
      { kind: 'conversion', currency: item.currency },
      { kind: 'fx_result', currency: item.currency },
      ...(item.personalFunds ? [{ kind: 'liability' as const, currency: chargedCurrency }] : []),
      ...(item.feeCurrency === null
        ? []
        : [{ kind: 'expense' as const, currency: item.feeCurrency }]),
    ])
    await assertRealizedFxWriteOrder(
      tx,
      [{ fromCurrency: chargedCurrency, toCurrency: item.currency }],
      fxPoolLocks,
      item.occurredOn,
      item.source,
    )
  }
  const payer = await resolveExpensePayer(tx, item)
  assertAccountCurrency(payer, chargedCurrency, 'счёта списания')
  assertFeeCurrency(item, chargedCurrency)
  const result = await ensureSystemAccount(tx, 'expense', item.currency)

  if (chargedCurrency !== item.currency) {
    return recordCrossCurrencyResult(tx, item, {
      fxPoolLocks: fxPoolLocks!,
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
  const receivedCurrency = item.paidCurrency ?? item.currency
  assertAccountCurrency(money, receivedCurrency, 'счёта зачисления')
  assertFeeCurrency(item, receivedCurrency)

  if (receivedCurrency !== item.currency) {
    throw new FinanceRefusal(
      'Межвалютный доход через intake не поддерживается: утверждённый cross-currency путь описывает только расход, где валюта списания действительно выбывает из денежного счёта.',
    )
  }
  assertNoRedundantPaidAmount(item)
  const postings: PostingDraft[] = [
    resultPosting(item, result.id, -item.amount),
    moneyPosting(item, money.id, item.amount),
    ...(await feePostings(tx, item, money)),
  ]
  return recordOperationInTransaction(tx, operationInput(item, postings))
}

/**
 * Spec 339 §K EARS-567 → spec 338 EARS-336: a contribution posts as one debit on
 * the receiving company money account and one credit on the module's `equity`
 * account of that currency, on the fund, carrying the contributor's
 * `member_id` where a member contributed. Never income.
 */
async function recordContribution(tx: PlatformTx, item: PostingItem): Promise<RecordedOperation> {
  const refusal = contributionItemRefusal(item)
  if (refusal !== null) throw new FinanceRefusal(refusal)
  const fund = await requireFundProject(tx)
  if (item.projectId !== fund.id) {
    throw new FinanceRefusal(
      `Проект взноса — фонд «${fund.name}»: деньги вносятся в BBM, а не в проект (EARS-567).`,
    )
  }
  const money = await requireMoneyAccount(tx, item.accountId as number, 'счёта зачисления')
  assertAccountCurrency(money, item.currency, 'счёта зачисления')
  const equity = await ensureSystemAccount(tx, 'equity', item.currency)
  return recordOperationInTransaction(
    tx,
    operationInput(item, [
      { accountId: money.id, amount: item.amount, currency: item.currency },
      {
        accountId: equity.id,
        amount: -item.amount,
        currency: item.currency,
        projectId: fund.id,
        memberId: item.memberId,
      },
    ]),
  )
}

async function recordTransfer(tx: PlatformTx, item: PostingItem): Promise<RecordedOperation> {
  assertNoPurpose(item)
  if (item.accountId === null || item.counterAccountId === null) {
    throw new FinanceRefusal('Перевод обязан назвать счёт списания и счёт зачисления.')
  }
  const source = await requireMoneyAccount(tx, item.accountId, 'счёта списания')
  const target = await requireAccount(tx, item.counterAccountId)
  if (item.paidAmount !== null || item.paidCurrency !== null) {
    if (isReimbursementTransfer(item, target) && item.paidCurrency !== item.currency) {
      return recordCrossCurrencyReimbursement(tx, item, source, target)
    }
    throw new FinanceRefusal('Межвалютный перевод записывается как kind = conversion.')
  }
  assertAccountCurrency(source, item.currency, 'счёта списания')
  assertAccountCurrency(target, item.currency, 'счёта зачисления')
  // Which system account may stand here, and with which member, was already
  // decided by `assertIntakeAccountPlacement` before this writer ran.
  assertFeeCurrency(item, source.currency)
  const postings: PostingDraft[] = [
    { accountId: source.id, amount: -item.amount, currency: item.currency },
    {
      accountId: target.id,
      amount: item.amount,
      currency: item.currency,
      memberId: isReimbursementTransfer(item, target) ? item.memberId : null,
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
  if (item.currency === item.paidCurrency) {
    throw new FinanceRefusal(
      'kind = conversion требует две разные валюты; движение между счетами одной валюты записывается как kind = transfer.',
    )
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
    backdated: item.source === 'backfill',
  })
}

type CrossCurrencyResult = {
  fxPoolLocks: RealizedFxPoolLocks
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
  const rate = deriveRate(cross.fromAmount, from.precision, cross.toAmount, to.precision)
  const conversionStep = {
    fromCurrency: cross.fromCurrency,
    toCurrency: cross.toCurrency,
    fromAmount: cross.fromAmount,
    toAmount: cross.toAmount,
    rate,
  }
  const conversionFrom = await ensureSystemAccount(tx, 'conversion', cross.fromCurrency)
  const conversionTo = await ensureSystemAccount(tx, 'conversion', cross.toCurrency)
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
    ...(await realizedFxPostings(tx, conversionStep, cross.fxPoolLocks)),
  ]
  return insertSingleStepOperation(tx, item, postings, conversionStep)
}

/**
 * Spec 339 §K EARS-568 — a reimbursement settling a liability booked in another
 * currency than its paying company account, as ONE operation: the whole sum
 * that left the account (`paid_amount`, agent's fee included) credited to it;
 * one conversion step from that currency into the liability's, receiving
 * exactly the liability amount at the rate the two amounts imply (decision 18
 * — never a Bank of Russia rate, EARS-553); the liability debit carrying the
 * member; and the agent's itemized fee as the step's own expense on the fund
 * project, the step disposing the rest. It enters the EARS-328 pool like the
 * cross-currency vendor payment, and EARS-543's write-order refusal applies.
 */
async function recordCrossCurrencyReimbursement(
  tx: PlatformTx,
  item: PostingItem,
  source: FinanceAccountView,
  liability: FinanceAccountView,
): Promise<RecordedOperation> {
  const paidAmount = item.paidAmount
  const paidCurrency = item.paidCurrency
  if (paidAmount === null || paidCurrency === null) {
    throw new FinanceRefusal(intakePaidPairRefusal(item) ?? 'Вторая сумма записывается парой.')
  }
  if (source.currency !== paidCurrency) {
    throw new FinanceRefusal(
      `Межвалютное возмещение списывается со счёта компании в ${paidCurrency}, а счёт ` +
        `«${source.name}» ведётся в ${source.currency} (EARS-568).`,
    )
  }
  assertAccountCurrency(liability, item.currency, 'счёта зачисления')
  const fee = item.feeAmount ?? 0n
  if (item.feeAmount !== null && item.feeCurrency !== paidCurrency) {
    throw new FinanceRefusal(
      `Комиссия платёжного агента записана в ${item.feeCurrency}, а счёт возврата ведётся в ` +
        `${paidCurrency}: комиссия списывается в валюте счёта (EARS-568).`,
    )
  }
  if (fee >= paidAmount) {
    throw new FinanceRefusal(
      'Комиссия платёжного агента должна быть меньше всей суммы, ушедшей со счёта: иначе на ' +
        'погашение долга не остаётся ничего (EARS-568).',
    )
  }

  const pair = { fromCurrency: paidCurrency, toCurrency: item.currency }
  const fxPoolLocks = await lockRealizedFxPools(tx, [pair])
  await lockFxSystemAccounts(tx, [
    { kind: 'conversion', currency: paidCurrency },
    { kind: 'conversion', currency: item.currency },
    { kind: 'fx_result', currency: item.currency },
    { kind: 'liability', currency: item.currency },
    ...(item.feeAmount === null ? [] : [{ kind: 'expense' as const, currency: paidCurrency }]),
  ])
  await assertRealizedFxWriteOrder(tx, [pair], fxPoolLocks, item.occurredOn, item.source)

  const disposed = paidAmount - fee
  const from = await requireCurrency(tx, paidCurrency)
  const to = await requireCurrency(tx, item.currency)
  const conversionStep = {
    ...pair,
    fromAmount: disposed,
    toAmount: item.amount,
    rate: deriveRate(disposed, from.precision, item.amount, to.precision),
  }
  const conversionFrom = await ensureSystemAccount(tx, 'conversion', paidCurrency)
  const conversionTo = await ensureSystemAccount(tx, 'conversion', item.currency)
  const postings: PostingDraft[] = [
    { accountId: source.id, amount: -disposed, currency: paidCurrency },
    {
      accountId: conversionFrom.id,
      amount: disposed,
      currency: paidCurrency,
      conversionStepNo: 1,
    },
    {
      accountId: conversionTo.id,
      amount: -item.amount,
      currency: item.currency,
      conversionStepNo: 1,
    },
    {
      accountId: liability.id,
      amount: item.amount,
      currency: item.currency,
      memberId: item.memberId,
    },
  ]
  if (item.feeAmount !== null) {
    // The payout process's overhead, not the reimbursed service's: the fund (EARS-568).
    const fund = await requireFundProject(tx)
    const expense = await ensureSystemAccount(tx, 'expense', paidCurrency)
    postings.push(
      {
        accountId: expense.id,
        amount: fee,
        currency: paidCurrency,
        projectId: fund.id,
        conversionStepNo: 1,
      },
      { accountId: source.id, amount: -fee, currency: paidCurrency, conversionStepNo: 1 },
    )
  }
  postings.push(...(await realizedFxPostings(tx, conversionStep, fxPoolLocks)))
  return insertSingleStepOperation(tx, item, postings, conversionStep)
}

/** The checked write of a one-step operation: the row, its step, then the postings naming it. */
async function insertSingleStepOperation(
  tx: PlatformTx,
  item: PostingItem,
  postings: readonly PostingDraft[],
  conversionStep: {
    fromCurrency: string
    toCurrency: string
    rate: string
  },
): Promise<RecordedOperation> {
  const parsed = parseRecordOperationInput(operationInput(item, postings))
  const accounts = await loadAccountFacts(tx, parsed.postings)
  assertNoRetiredAccount(accounts)
  const prepared = await prepareDimensions(tx, parsed, accounts)
  assertPostingCurrencyMatchesAccount(prepared, accounts)
  assertProjectOnResultPostings(prepared, accounts)
  assertBalancedPerCurrency(prepared)

  const operation = await insertOperation(tx, {
    occurredOn: parsed.occurredOn,
    source: parsed.source,
    purposeId: parsed.purposeId ?? null,
    sourceRef: parsed.sourceRef ?? null,
    backdated: parsed.backdated ?? false,
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
    backdated: item.source === 'backfill',
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
  if (fraction === '') return whole.toString()
  return `${whole}.${fraction}`
}
