/**
 * The owner's payment-queue acts (spec 339 §I, EARS-543/544/547/548; issue #549).
 *
 * Three acts, one rule each, all through the one ledger door
 * (`postIntakeItemInTransaction`) and all inside ONE `platformTransaction`:
 *
 *  - «Отметить оплату» (`markExpenseRequestPaid`, EARS-543): posts a request
 *    from the money facts of the act, approving it first in the same
 *    transaction when it is still `submitted`. No document is required — the
 *    approve-role human's recorded act is the assertion (EARS-506, decision 37).
 *  - «Отметить возврат» (`markExpenseRequestReimbursed`, EARS-544): books a
 *    `personal_funds` request's debt (if not yet posted) in the refund
 *    account's currency AND the reimbursement transfer that settles it,
 *    naming the request in `settles_item` (EARS-528).
 *  - The bulk retroactive act (`bulkMarkExpenseRequestsPaid`, EARS-547/548):
 *    either of the two per row, all-or-nothing, oldest first.
 *
 * The ROLE is asked first in every act, before any row is read — a role-less
 * caller learns nothing about the data from the refusal (EARS-501).
 */
import { eq } from 'drizzle-orm'

import { findMemberByEmail } from '@/lib/member'
import {
  financeIntakeItem,
  type FinanceIntakeStatus,
} from '@/lib/platform/db/schema/finance/finance-intake-item'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import { assertFinanceLedgerAccess, financeAuditContext, type FinanceActor } from '../core/actor'
import { financeMemberRecordRefusal, FinanceRefusal } from '../core/errors'
import { linkReadyDocumentsInTransaction } from '../documents/documents'
import { assertRealizedFxWriteOrder, lockRealizedFxPools } from '../fx-pool-locks'
import { assertRequestPurposeReady } from '../purpose-proposals'
import {
  ensureSystemAccount,
  requireAccount,
  requireProject,
  type FinanceAccountView,
} from '../references'
import {
  formatMinorUnits,
  intakeLiabilityOf,
  liveSettlementsOf,
  settlementsOf,
} from './account-placement'
import {
  createIntakeItemInTransaction,
  intakeItemToView,
  intakeMoneyFactsRefusal,
  lockIntakeItem,
  type FinanceIntakeItemView,
} from './items'
import { postIntakeItemInTransaction, type IntakePostingMoneyDetails } from './posting'
import { reimbursementTransferValues } from './reimbursement'
import {
  deriveExpenseRequestStage,
  expenseRequestQueueSnapshot,
  readyQueueDocuments,
} from './request-queue'

type IntakeRow = typeof financeIntakeItem.$inferSelect

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type MarkExpenseRequestPaidInput = IntakePostingMoneyDetails & {
  /**
   * The EARS-548 token of the request as the card showed it
   * (`FinanceExpenseRequestView.snapshot`). A request changed since — an
   * amount, a note, a receipt, a settlement — is refused, never posted as the
   * newer version the owner did not see.
   */
  snapshot: string
  /** Already-uploaded ready receipts the act attaches to the request (optional). */
  documentIds?: readonly number[]
}

export type MarkExpenseRequestReimbursedInput = {
  /** The EARS-548 token of the request as the card showed it — see `MarkExpenseRequestPaidInput`. */
  snapshot: string
  /** The date the refund left the company account — the transfer's money date. */
  occurredOn: string
  /** The company money account the refund left. */
  accountId: number
  /** The refund debited from that account, in its currency (EARS-544). */
  amount: bigint
  documentIds?: readonly number[]
}

async function requireActorMemberId(actor: FinanceActor): Promise<number> {
  const member = await findMemberByEmail(actor.email)
  if (member === null) {
    throw financeMemberRecordRefusal(actor.email, 'отметку оплаты некому записать')
  }
  return member.id
}

function assertIsoDate(date: string | undefined, label: string): void {
  if (date !== undefined && !ISO_DATE.test(date)) {
    throw new FinanceRefusal(`${label} «${date}» записана не в формате ГГГГ-ММ-ДД (EARS-543).`)
  }
}

function assertExpenseRequestRow(row: IntakeRow): void {
  if (row.source !== 'request' || row.kind !== 'expense') {
    throw new FinanceRefusal(
      `Позиция #${row.id} — не заявка на расход: отметка оплаты относится только к заявкам ` +
        '(EARS-543).',
    )
  }
}

function assertMarkableStatus(row: IntakeRow, act: string): void {
  if (row.status !== 'submitted' && row.status !== 'approved') {
    throw new FinanceRefusal(
      `Заявку #${row.id} в статусе «${row.status}» нельзя ${act}: отметка относится к поданной ` +
        'или одобренной, ещё не проведённой заявке (EARS-524/543).',
    )
  }
}

/**
 * The single acts' stale-read refusal (EARS-543/544, read with EARS-548):
 * the token the card showed is recomputed under the row lock, from the same
 * read model the queue builds it from, BEFORE anything is written. This is
 * the check `snapshotCheckedByCaller` vouches for.
 */
async function assertQueueSnapshot(
  tx: PlatformTx,
  row: IntakeRow,
  snapshot: string,
): Promise<void> {
  const documents = await readyQueueDocuments(tx, [row.id])
  const settlements = await settlementsOf(tx, [row.id])
  const token = expenseRequestQueueSnapshot(
    intakeItemToView(row),
    documents.get(row.id) ?? [],
    settlements.get(row.id) ?? null,
  )
  if (token !== snapshot) {
    throw new FinanceRefusal(
      `Заявка #${row.id} изменилась после того, как карточка её показала — отметка не ` +
        'проведена; откройте заявку заново (EARS-543/544, EARS-548).',
    )
  }
}

async function requirePayingAccount(
  tx: PlatformTx,
  accountId: number,
): Promise<FinanceAccountView> {
  const account = await requireAccount(tx, accountId)
  if (account.isSystem || account.retiredAt !== null) {
    throw new FinanceRefusal(
      `Счёт «${account.name}» не может быть счётом оплаты: это системный или выведенный из ` +
        'обращения счёт (EARS-543).',
    )
  }
  return account
}

/**
 * EARS-543's readable half of the authoritative-amount rule: a cross-currency
 * payment names the amount actually debited, and the refusal says which fact
 * is missing — never a rate, never a computed sum.
 */
async function assertDebitedAmountNamed(
  tx: PlatformTx,
  row: IntakeRow,
  details: IntakePostingMoneyDetails,
): Promise<void> {
  if (row.personalFunds) return
  const accountId = details.accountId === undefined ? row.accountId : details.accountId
  if (accountId === null) return // EARS-533's own refusal names the missing account.
  const account = await requirePayingAccount(tx, accountId)
  const paidAmount = details.paidAmount === undefined ? row.paidAmount : details.paidAmount
  if (account.currency !== row.currency && paidAmount === null) {
    throw new FinanceRefusal(
      `Документ заявки #${row.id} выставлен в ${row.currency}, а счёт «${account.name}» ведётся в ` +
        `${account.currency}: укажите сумму, фактически списанную со счёта в ${account.currency}. ` +
        'Она не вычисляется по курсу — обе суммы факты (EARS-543).',
    )
  }
}

/**
 * «Отметить оплату» (EARS-543): post the request in one transaction, approving
 * it first when it is `submitted` (decider = poster, EARS-510). A receipt is
 * optional and may follow later (EARS-545).
 */
export async function markExpenseRequestPaid(
  actor: FinanceActor,
  id: number,
  input: MarkExpenseRequestPaidInput,
): Promise<FinanceIntakeItemView> {
  assertFinanceLedgerAccess(actor)
  assertIsoDate(input.occurredOn, 'Дата оплаты')
  const memberId = await requireActorMemberId(actor)
  const { documentIds, snapshot, ...details } = input

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const row = await lockIntakeItem(tx, id)
    assertExpenseRequestRow(row)
    assertMarkableStatus(row, 'отметить оплаченной')
    await assertQueueSnapshot(tx, row, snapshot)
    await linkReadyDocumentsInTransaction(tx, documentIds ?? [], row.id, memberId)
    await assertDebitedAmountNamed(tx, row, details)
    return postIntakeItemInTransaction(tx, actor, row.id, {
      ...details,
      approveSubmittedRequest: row.status === 'submitted',
      humanMarkPaidAct: true,
      snapshotCheckedByCaller: true,
    })
  })
}

/**
 * «Отметить возврат» (EARS-544) — the request's debt and its settlement in ONE
 * transaction. The request posts at its own `occurred_on` (the date the
 * member's card was charged — EARS-508); the refund date of the act is the
 * transfer's.
 */
export async function markExpenseRequestReimbursed(
  actor: FinanceActor,
  id: number,
  input: MarkExpenseRequestReimbursedInput,
): Promise<FinanceIntakeItemView> {
  assertFinanceLedgerAccess(actor)
  assertIsoDate(input.occurredOn, 'Дата возврата')
  const memberId = await requireActorMemberId(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const row = await lockIntakeItem(tx, id)
    assertExpenseRequestRow(row)
    await assertQueueSnapshot(tx, row, input.snapshot)
    const account = await requirePayingAccount(tx, input.accountId)
    // EARS-544's refusals (a refused or cancelled request among them) come
    // BEFORE the receipts are linked: the 0014/0019 link guard would otherwise
    // answer first, with a database error instead of a readable refusal.
    const plan = planReimbursement(row, account.currency, input.amount)
    if ('refusal' in plan) throw new FinanceRefusal(plan.refusal)
    await linkReadyDocumentsInTransaction(tx, input.documentIds ?? [], row.id, memberId)
    const { request } = await reimburseInTransaction(tx, actor, memberId, row, {
      account,
      refund: input.amount,
      refundDate: input.occurredOn,
    })
    return request
  })
}

type ReimbursementPlan = {
  /** The EARS-544 required refund: the item's whole liability, fee included. */
  refund: bigint
  /** What the posting act writes when the request is not yet posted. */
  postingDetails: IntakePostingMoneyDetails | null
}

/**
 * EARS-544's arithmetic, as a refusal or a plan. Pure over the row and the
 * refund account's currency, so the single act and the bulk eligibility pass
 * read one rule.
 */
function planReimbursement(
  row: IntakeRow,
  currency: string,
  refund: bigint | null,
): { refusal: string } | ReimbursementPlan {
  if (!row.personalFunds || !row.alreadyPaid) {
    return {
      refusal:
        `Заявка #${row.id} оплачена не из собственных средств участника: возвращать нечего ` +
        '(EARS-544).',
    }
  }
  if (!['submitted', 'approved', 'posted'].includes(row.status)) {
    return {
      refusal: `Заявку #${row.id} в статусе «${row.status}» нельзя отметить возвращённой (EARS-524/544).`,
    }
  }
  if (row.memberId === null) {
    return {
      refusal: `У заявки #${row.id} не указан участник, которому возвращать деньги (EARS-513/544).`,
    }
  }
  const fee = row.feeAmount ?? 0n
  const posted = row.status === 'posted'
  const booked = posted || row.paidCurrency !== null
  const liabilityCurrency = booked ? (row.paidCurrency ?? row.currency) : currency
  if (booked && liabilityCurrency !== currency) {
    return {
      refusal:
        `Долг по заявке #${row.id} ${posted ? 'записан' : 'заявлен'} в ${liabilityCurrency}, а ` +
        `счёт возврата ведётся в ${currency}: перевод одновалютный, возврат делается со счёта в ` +
        `валюте долга; межвалютное погашение уже записанного долга в v1 не поддерживается ` +
        '(EARS-544, EARS-528).',
    }
  }
  if (row.feeCurrency !== null && row.feeCurrency !== liabilityCurrency) {
    return {
      refusal:
        `Комиссия заявки #${row.id} записана в ${row.feeCurrency}, а долг — в ${liabilityCurrency}: ` +
        'комиссия по оплате своими средствами списывается в валюте долга (EARS-513/544).',
    }
  }

  if (booked) {
    const required = intakeLiabilityOf(row).amount
    if (refund !== null && refund !== required) return requiredRefusal(row, required, currency)
    return { refund: required, postingDetails: posted ? null : {} }
  }
  if (currency === row.currency) {
    const required = row.amount + fee
    if (refund !== null && refund !== required) return requiredRefusal(row, required, currency)
    return { refund: required, postingDetails: {} }
  }
  // Cross-currency: the act asserts the card lost the refund less the fee for
  // the spend itself (EARS-544) — that is the account-side amount it writes.
  if (refund === null) {
    return {
      refusal:
        `Заявка #${row.id} выставлена в ${row.currency}, а возврат идёт в ${currency}: сумма ` +
        'возврата — факт, её называет отметка, а не курс (EARS-544, Q2).',
    }
  }
  if (refund <= fee) {
    return {
      refusal:
        `Сумма возврата по заявке #${row.id} (${formatMinorUnits(refund, currency)}) должна быть ` +
        `больше комиссии ${formatMinorUnits(fee, currency)}: без неё за саму трату не остаётся ` +
        'ничего (EARS-544).',
    }
  }
  return { refund, postingDetails: { paidAmount: refund - fee, paidCurrency: currency } }
}

function requiredRefusal(row: IntakeRow, required: bigint, currency: string) {
  return {
    refusal:
      `Возврат по заявке #${row.id} должен быть ровно на сумму долга ` +
      `${formatMinorUnits(required, currency)} — с комиссией, если она записана (EARS-544).`,
  }
}

/**
 * Book (if needed) and settle one `personal_funds` request inside the caller's
 * transaction. Shared by the single act and the bulk act, so both write the
 * same two postings the same way.
 */
async function reimburseInTransaction(
  tx: PlatformTx,
  actor: FinanceActor,
  memberId: number,
  row: IntakeRow,
  act: {
    account: FinanceAccountView
    refund: bigint | null
    refundDate: string
    requestDate?: string
  },
): Promise<{ request: FinanceIntakeItemView; transfer: FinanceIntakeItemView }> {
  const plan = planReimbursement(row, act.account.currency, act.refund)
  if ('refusal' in plan) throw new FinanceRefusal(plan.refusal)

  const request =
    plan.postingDetails === null
      ? intakeItemToView(row)
      : await postIntakeItemInTransaction(tx, actor, row.id, {
          ...plan.postingDetails,
          ...(act.requestDate === undefined ? {} : { occurredOn: act.requestDate }),
          approveSubmittedRequest: row.status === 'submitted',
          humanMarkPaidAct: true,
          snapshotCheckedByCaller: true,
        })

  const liability = await ensureSystemAccount(tx, 'liability', act.account.currency)
  const filed = await createIntakeItemInTransaction(
    tx,
    reimbursementTransferValues(
      {
        occurredOn: act.refundDate,
        accountId: act.account.id,
        amount: plan.refund,
        currency: act.account.currency,
        memberId: row.memberId!,
        projectId: row.projectId,
        settlesItemId: row.id,
        note: `Возврат по заявке #${row.id}`,
      },
      liability.id,
    ),
    memberId,
  )
  // The refund act IS the decision on its own transfer (EARS-544): decider and
  // poster are the act's author, exactly as on the request it settles.
  await tx
    .update(financeIntakeItem)
    .set({ status: 'approved', decidedBy: memberId, decidedAt: new Date() })
    .where(eq(financeIntakeItem.id, filed.id))
  const transfer = await postIntakeItemInTransaction(tx, actor, filed.id, {
    humanMarkPaidAct: true,
  })
  return { request, transfer }
}

// ── the bulk retroactive act (EARS-547/548) ─────────────────────────────────

export type BulkMarkGroup = 'pay' | 'reimburse'

/**
 * Where the account-side amount of a bulk row comes from (spec 339 Open
 * questions Q2). Only `actual` exists: the amount is a recorded fact, and a row
 * whose account-side currency differs from the batch account's has none, so it
 * is ineligible. Answer (b) of Q2 — a CBR-estimated amount flagged as such —
 * would be a second member of this union and a second branch in
 * `accountSideAmount`, nothing else; it is NOT built until the owner answers.
 */
export type BulkAccountSideAmountPolicy = 'actual'

export type BulkMarkExpenseRequestsInput = {
  group: BulkMarkGroup
  accountId: number
  /** One date for every row; omitted → each row's own default (EARS-547). */
  occurredOn?: string
  /** The rows the dialog showed, each with the snapshot token it showed (EARS-548). */
  items: readonly { id: number; snapshot: string }[]
  /** Plan only: return what would post, at which date, and what is excluded. */
  preview?: boolean
  amountPolicy?: BulkAccountSideAmountPolicy
}

export type BulkMarkExpenseRequestsResult = {
  /** In posting order — ascending (date, id). Empty on a preview. */
  posted: { id: number; operationId: number; occurredOn: string; settlementId: number | null }[]
  /** Left untouched, each with the reason the posting gate gives. */
  excluded: { id: number; reason: string }[]
  /** The posting plan, in order; on a real run it equals `posted`. */
  planned: { id: number; occurredOn: string }[]
}

const MOSCOW_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * The row's default date (EARS-547): its `occurred_on`, else the day it was
 * filed in Europe/Moscow — decision 40 accepts the filing day as the best-known
 * money date of a backlog paid outside the system. `created_at` is the filing
 * timestamp the module holds today (#516 audit columns).
 */
function defaultRowDate(row: IntakeRow): string {
  return row.occurredOn ?? MOSCOW_DATE.format(row.createdAt)
}

type PlannedRow = {
  row: IntakeRow
  date: string
  /** The FX pair the posting crosses, if any — for the write-order pre-check. */
  pair: { fromCurrency: string; toCurrency: string } | null
  refund: bigint | null
}

/**
 * The account-side amount of a `pay` row under the policy (Q2): the recorded
 * fact or nothing. Returns the refusal text when the row has none.
 */
function accountSideAmount(
  row: IntakeRow,
  account: FinanceAccountView,
  policy: BulkAccountSideAmountPolicy,
): string | null {
  const sideCurrency = row.paidCurrency ?? row.currency
  if (sideCurrency === account.currency) return null
  switch (policy) {
    case 'actual':
      return (
        `Валюта списания ${sideCurrency} ≠ ${account.currency} — валюте счёта пакета: сумма, ` +
        'фактически списанная со счёта, неизвестна; отметьте заявку отдельно с этой суммой ' +
        '(EARS-547, Q2).'
      )
  }
}

/**
 * The bulk retroactive act (EARS-547): one account, explicit rows with their
 * snapshot tokens, all-or-nothing in ONE transaction, oldest first. Ineligible
 * rows are returned with the reason and left untouched; a CHANGED row (stale
 * token) fails the whole batch (EARS-548).
 */
export async function bulkMarkExpenseRequestsPaid(
  actor: FinanceActor,
  input: BulkMarkExpenseRequestsInput,
): Promise<BulkMarkExpenseRequestsResult> {
  assertFinanceLedgerAccess(actor)
  if (input.group !== 'pay' && input.group !== 'reimburse') {
    throw new FinanceRefusal(`Группа «${String(input.group)}» не отмечается пакетом (EARS-547).`)
  }
  if (input.items.length === 0) {
    throw new FinanceRefusal('Пакет пуст: назовите заявки, которые показал диалог (EARS-547).')
  }
  const ids = input.items.map((item) => item.id)
  if (new Set(ids).size !== ids.length) {
    throw new FinanceRefusal('Заявка названа в пакете дважды (EARS-547).')
  }
  assertIsoDate(input.occurredOn, 'Дата пакета')
  const policy = input.amountPolicy ?? 'actual'
  const memberId = await requireActorMemberId(actor)

  return platformTransaction(financeAuditContext(actor), async (tx) => {
    // Lock in id order — two batches over overlapping rows cannot deadlock.
    const rows = new Map<number, IntakeRow>()
    for (const id of [...ids].sort((left, right) => left - right)) {
      rows.set(id, await lockIntakeItem(tx, id))
    }

    // EARS-548 first: a batch over data the owner did not see posts nothing.
    const documents = await readyQueueDocuments(tx, ids)
    const settlements = await settlementsOf(tx, ids)
    // A live but not yet posted reimbursement (a manual transfer awaiting its
    // posting) does not settle the debt yet — the row stays in «Вернуть
    // сотруднику» — but the posting gate (EARS-528) would refuse a second one.
    const pendingSettlements = await liveSettlementsOf(tx, ids)
    const changed = input.items.filter(({ id, snapshot }) => {
      const row = rows.get(id)!
      const token = expenseRequestQueueSnapshot(
        intakeItemToView(row),
        documents.get(id) ?? [],
        settlements.get(id) ?? null,
      )
      return token !== snapshot
    })
    if (changed.length > 0) {
      throw new FinanceRefusal(
        `${changed.map(({ id }) => `Заявка #${id}`).join(', ')} изменилась после открытия ` +
          'диалога — пакет не проведён целиком; откройте диалог заново (EARS-548).',
      )
    }

    const account = await requirePayingAccount(tx, input.accountId)
    const excluded: BulkMarkExpenseRequestsResult['excluded'] = []
    const candidates: PlannedRow[] = []
    for (const { id } of input.items) {
      const row = rows.get(id)!
      const reason =
        staticIneligibility(row, input.group, account, policy, settlements.get(id)) ??
        pendingSettlementIneligibility(row, input.group, pendingSettlements.get(id))
      if (reason !== null) {
        excluded.push({ id, reason })
        continue
      }
      const date = input.occurredOn ?? defaultRowDate(row)
      const sideCurrency =
        input.group === 'pay' ? (row.paidCurrency ?? row.currency) : account.currency
      const plan =
        input.group === 'reimburse' ? planReimbursement(row, account.currency, null) : null
      candidates.push({
        row,
        date,
        pair:
          sideCurrency === row.currency
            ? null
            : { fromCurrency: sideCurrency, toCurrency: row.currency },
        refund: plan !== null && !('refusal' in plan) ? plan.refund : null,
      })
    }

    // The posting gate's data-dependent refusals, asked BEFORE any write: a
    // refusal thrown after a write would abort the whole transaction, while an
    // ineligible row must only be listed (EARS-547).
    const pairs = candidates.flatMap((candidate) =>
      candidate.pair === null ? [] : [candidate.pair],
    )
    const fxLocks = pairs.length === 0 ? null : await lockRealizedFxPools(tx, pairs)
    const planned: PlannedRow[] = []
    for (const candidate of candidates) {
      const reason = await gateIneligibility(tx, candidate, account, fxLocks)
      if (reason !== null) excluded.push({ id: candidate.row.id, reason })
      else planned.push(candidate)
    }
    planned.sort((left, right) =>
      left.date === right.date ? left.row.id - right.row.id : left.date < right.date ? -1 : 1,
    )
    const plan = planned.map(({ row, date }) => ({ id: row.id, occurredOn: date }))
    if (input.preview === true) return { posted: [], excluded, planned: plan }

    const posted: BulkMarkExpenseRequestsResult['posted'] = []
    for (const { row, date, refund } of planned) {
      if (input.group === 'pay') {
        const item = await postIntakeItemInTransaction(tx, actor, row.id, {
          occurredOn: date,
          accountId: row.accountId ?? account.id,
          approveSubmittedRequest: row.status === 'submitted',
          humanMarkPaidAct: true,
          snapshotCheckedByCaller: true,
        })
        posted.push({
          id: row.id,
          operationId: item.operationId!,
          occurredOn: date,
          settlementId: null,
        })
      } else {
        const { request, transfer } = await reimburseInTransaction(tx, actor, memberId, row, {
          account,
          refund,
          refundDate: date,
          requestDate: row.status === 'posted' ? undefined : date,
        })
        posted.push({
          id: row.id,
          operationId: request.operationId!,
          occurredOn: date,
          settlementId: transfer.id,
        })
      }
    }
    return { posted, excluded, planned: plan }
  })
}

/** Refusals that read only the row, the group and the batch account. */
function staticIneligibility(
  row: IntakeRow,
  group: BulkMarkGroup,
  account: FinanceAccountView,
  policy: BulkAccountSideAmountPolicy,
  settledBy: number | undefined,
): string | null {
  if (row.source !== 'request' || row.kind !== 'expense') {
    return `Позиция #${row.id} — не заявка на расход (EARS-547).`
  }
  const stage = deriveExpenseRequestStage({
    status: row.status as FinanceIntakeStatus,
    alreadyPaid: row.alreadyPaid,
    personalFunds: row.personalFunds,
    settled: settledBy !== undefined,
  })
  if (stage !== group) {
    return `Заявка #${row.id} не в группе «${group === 'pay' ? 'К оплате' : 'Вернуть сотруднику'}» (EARS-535/547).`
  }
  if (row.personalFunds && row.memberId === null) {
    return `У заявки #${row.id} «оплачено своими средствами» не указан участник (EARS-513/547).`
  }
  if (group === 'pay') {
    if (row.accountId !== null && row.accountId !== account.id) {
      return (
        `Заявка #${row.id} уже называет другой счёт оплаты; пакет оплачивает с одного счёта ` +
        '(EARS-547).'
      )
    }
    return accountSideAmount(row, account, policy)
  }
  const liabilityCurrency = row.paidCurrency ?? row.currency
  if (liabilityCurrency !== account.currency) {
    return (
      `Валюта долга ${liabilityCurrency} ≠ ${account.currency} — валюте счёта пакета: сумма ` +
      'возврата в этой валюте неизвестна; отметьте возврат отдельно (EARS-547, Q2).'
    )
  }
  const plan = planReimbursement(row, account.currency, null)
  return 'refusal' in plan ? plan.refusal : null
}

/**
 * EARS-547 «listed with that refusal»: the posting gate's EARS-528 refusal of
 * a second live reimbursement of one debt, asked before the batch writes, so
 * the row is listed instead of aborting the whole transaction.
 */
function pendingSettlementIneligibility(
  row: IntakeRow,
  group: BulkMarkGroup,
  pendingTransferId: number | undefined,
): string | null {
  if (group !== 'reimburse' || pendingTransferId === undefined) return null
  return (
    `Долг по заявке #${row.id} уже гасит возмещение #${pendingTransferId}, ещё не проведённое: ` +
    'второе возмещение того же долга не принимается (EARS-528/547).'
  )
}

/** The posting gate's own refusals, asked read-only before the batch writes. */
async function gateIneligibility(
  tx: PlatformTx,
  candidate: PlannedRow,
  account: FinanceAccountView,
  fxLocks: Awaited<ReturnType<typeof lockRealizedFxPools>> | null,
): Promise<string | null> {
  const { row, date } = candidate
  try {
    if (row.status !== 'posted') {
      await assertRequestPurposeReady(tx, row.id)
      const project = await requireProject(tx, row.projectId)
      if (project.retiredAt !== null) {
        return `Проект «${project.name}» заявки #${row.id} выведен из обращения (EARS-547).`
      }
      const facts = intakeMoneyFactsRefusal(
        {
          source: row.source,
          alreadyPaid: row.alreadyPaid,
          personalFunds: row.personalFunds,
          accountId: row.personalFunds ? null : (row.accountId ?? account.id),
          occurredOn: date,
        },
        { posting: true },
      )
      if (facts !== null) return facts
      if (candidate.pair !== null && fxLocks !== null) {
        await assertRealizedFxWriteOrder(tx, [candidate.pair], fxLocks, date, row.source)
      }
    }
    return null
  } catch (error) {
    if (error instanceof FinanceRefusal) return error.message
    throw error
  }
}
