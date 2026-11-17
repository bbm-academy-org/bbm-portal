/**
 * Where an intake item may name a system account (spec 339 EARS-528).
 *
 * Exactly one place: the `counter_account` of a `kind = transfer` item, and
 * only the system `liability` account — the EARS-513 reimbursement, which
 * debits the liability with the `member_id` whose debt it settles. Everywhere
 * else a system account stays out of intake (spec 338 EARS-305: the cabinet
 * neither creates nor edits them, and intake must not become a side door).
 *
 * The rule is ONE pure predicate asked by three callers — filing, editing and
 * posting — of the same merged row. Posting asks again because a row may have
 * reached `approved` before this rule existed, and the ledger is the last door.
 *
 * The second rule here is the per-item link (`settles_item`, EARS-528 as
 * revised for #549): a reimbursement names the `personal_funds` item it
 * settles, for exactly that item's liability. It reads ANOTHER row, so it is a
 * separate async assertion asked by the same three callers after the placement
 * rule has passed.
 */
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'

import { financeIntakeItem } from '@/lib/platform/db/schema/finance/finance-intake-item'
import type { PlatformTx } from '@/lib/platform/db/transaction'

import { FinanceRefusal } from '../core/errors'
import { requireAccount, type FinanceAccountView } from '../references'

export type IntakeAccountFacts = Pick<
  FinanceAccountView,
  'id' | 'name' | 'kind' | 'currency' | 'isSystem'
>

export type IntakeAccountPlacementState = {
  kind: string
  currency: string
  memberId: number | null
  paidAmount: bigint | null
  paidCurrency: string | null
  personalFunds: boolean
}

/** Is this item the EARS-528 reimbursement — a transfer into the system liability account? */
export function isReimbursementTransfer(
  state: Pick<IntakeAccountPlacementState, 'kind'>,
  counterAccount: IntakeAccountFacts | null,
): boolean {
  return (
    state.kind === 'transfer' &&
    counterAccount !== null &&
    counterAccount.isSystem &&
    counterAccount.kind === 'liability'
  )
}

/** Null when the item names its accounts where EARS-528 allows; otherwise the reason. */
export function intakeAccountPlacementRefusal(
  state: IntakeAccountPlacementState,
  accounts: { account: IntakeAccountFacts | null; counterAccount: IntakeAccountFacts | null },
): string | null {
  const { account, counterAccount } = accounts
  if (account !== null && account.isSystem) {
    return (
      `Системный счёт «${account.name}» не может быть денежным счётом позиции приёмки: ` +
      'системный счёт приёмка называет только встречным счётом возмещения (EARS-528).'
    )
  }
  if (counterAccount === null || !counterAccount.isSystem) return null

  if (counterAccount.kind !== 'liability') {
    return (
      `Системный счёт «${counterAccount.name}» не может быть встречным счётом позиции приёмки: ` +
      'из системных счетов приёмка называет только счёт обязательств, и только в возмещении ' +
      '(EARS-528).'
    )
  }
  if (state.kind !== 'transfer') {
    return (
      'Счёт обязательств называется встречным счётом только у перевода-возмещения ' +
      `(kind = transfer), а эта позиция — «${state.kind}» (EARS-528).`
    )
  }
  if (state.memberId === null) {
    return (
      'Возмещение обязано назвать участника, чей долг оно закрывает: без него перевод ' +
      'уменьшил бы обязательство ни перед кем (EARS-528).'
    )
  }
  if (state.personalFunds) {
    return (
      'Возмещение уходит со счёта компании, поэтому не бывает «оплачено своими средствами» ' +
      '(EARS-528).'
    )
  }
  if (state.paidAmount !== null || state.paidCurrency !== null) {
    return (
      'Возмещение закрывает долг в его собственной валюте одной суммой; вторая сумма ' +
      'в другой валюте у него не записывается (EARS-528, EARS-513).'
    )
  }
  if (state.currency !== counterAccount.currency) {
    return (
      `Долг по счёту «${counterAccount.name}» записан в ${counterAccount.currency}, а возмещение ` +
      `называет ${state.currency}: возмещение идёт в валюте долга (EARS-528, EARS-513).`
    )
  }
  return null
}

/** The rule against the named account rows, inside the caller's transaction. */
export async function assertIntakeAccountPlacement(
  tx: PlatformTx,
  state: IntakeAccountPlacementState & {
    accountId: number | null
    counterAccountId: number | null
  },
): Promise<void> {
  const account = state.accountId === null ? null : await requireAccount(tx, state.accountId)
  const counterAccount =
    state.counterAccountId === null ? null : await requireAccount(tx, state.counterAccountId)
  const refusal = intakeAccountPlacementRefusal(state, { account, counterAccount })
  if (refusal !== null) throw new FinanceRefusal(refusal)
}

/** What the settlement rule reads of the reimbursement itself. */
export type IntakeSettlementState = {
  /** Null while the row is being filed. */
  id: number | null
  source: string
  kind: string
  status: string
  amount: bigint
  currency: string
  memberId: number | null
  counterAccountId: number | null
  settlesItemId: number | null
}

/**
 * The amount and currency an EARS-513 debt was booked for — the sum its posting
 * credited to the liability account: the charged side (`paid_*`, falling back
 * to the document side) plus the fee where one is recorded (shipped
 * `assertFeeCurrency` keeps the fee in that same currency).
 */
export function intakeLiabilityOf(item: {
  amount: bigint
  currency: string
  paidAmount: bigint | null
  paidCurrency: string | null
  feeAmount: bigint | null
}): { amount: bigint; currency: string } {
  return {
    amount: (item.paidAmount ?? item.amount) + (item.feeAmount ?? 0n),
    currency: item.paidCurrency ?? item.currency,
  }
}

const NBSP = String.fromCharCode(0xa0)

/** Minor units as «1 200,00» — for refusals a person reads (precision 2 assumed for display). */
export function formatMinorUnits(amount: bigint, currency: string): string {
  const negative = amount < 0n
  const absolute = negative ? -amount : amount
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  const fraction = (absolute % 100n).toString().padStart(2, '0')
  return `${negative ? '−' : ''}${whole},${fraction} ${currency}`
}

/**
 * EARS-528 (revised 2026-11-17): every non-`backfill` liability transfer names
 * the posted `personal_funds` item it settles, of the same member, in that
 * item's liability currency and for exactly its liability amount, and no other
 * live transfer settles it already. `backfill` may name one (then the same
 * checks apply) but need not — §E rebuilds history that holds no portal request.
 *
 * The settled row is locked `for update`: two reimbursements of one debt racing
 * each other serialise here, and the second one reads the first.
 */
export async function assertIntakeSettlement(
  tx: PlatformTx,
  state: IntakeSettlementState,
): Promise<void> {
  const counterAccount =
    state.counterAccountId === null ? null : await requireAccount(tx, state.counterAccountId)
  const reimbursement = isReimbursementTransfer(state, counterAccount)

  if (!reimbursement) {
    if (state.settlesItemId !== null) {
      throw new FinanceRefusal(
        'Ссылку на погашаемую позицию (settles_item) несёт только перевод-возмещение на счёт ' +
          'обязательств (EARS-528).',
      )
    }
    return
  }
  if (state.settlesItemId === null) {
    if (state.source === 'backfill') return
    throw new FinanceRefusal(
      'Возмещение обязано назвать позицию «оплачено своими средствами», которую оно гасит ' +
        '(settles_item): без неё очередь не узнает, что долг закрыт, и предложит вернуть деньги ' +
        'второй раз (EARS-528).',
    )
  }

  const [settled] = await tx
    .select()
    .from(financeIntakeItem)
    .where(eq(financeIntakeItem.id, state.settlesItemId))
    .for('update')
  if (settled === undefined) {
    throw new FinanceRefusal(
      `Позиции #${state.settlesItemId}, которую гасит возмещение, нет (EARS-528).`,
    )
  }
  if (settled.status !== 'posted' || !settled.personalFunds) {
    throw new FinanceRefusal(
      `Позиция #${settled.id} — не проведённая позиция «оплачено своими средствами»: гасить ` +
        'возмещением можно только записанный долг (EARS-528, EARS-513).',
    )
  }
  if (settled.memberId !== state.memberId) {
    throw new FinanceRefusal(
      `Позиция #${settled.id} — долг другого участника: возмещение гасит долг того участника, ` +
        'которого называет (EARS-528).',
    )
  }
  const liability = intakeLiabilityOf(settled)
  if (liability.currency !== state.currency) {
    throw new FinanceRefusal(
      `Долг по позиции #${settled.id} записан в валюте ${liability.currency}, а возмещение — ` +
        `в ${state.currency}: возмещение идёт в валюте долга (EARS-528).`,
    )
  }
  if (liability.amount !== state.amount) {
    throw new FinanceRefusal(
      `Возмещение по позиции #${settled.id} должно быть ровно на сумму долга ` +
        `${formatMinorUnits(liability.amount, liability.currency)}, а названо ` +
        `${formatMinorUnits(state.amount, state.currency)} (EARS-528).`,
    )
  }
  const others = await tx
    .select({ id: financeIntakeItem.id })
    .from(financeIntakeItem)
    .where(
      and(
        eq(financeIntakeItem.settlesItemId, settled.id),
        notInArray(financeIntakeItem.status, ['refused', 'cancelled']),
        state.id === null ? sql`true` : ne(financeIntakeItem.id, state.id),
      ),
    )
  if (others.length > 0) {
    throw new FinanceRefusal(
      `Долг по позиции #${settled.id} уже гасит возмещение #${others[0].id}: второе возмещение ` +
        'того же долга не принимается (EARS-528).',
    )
  }
}

/** Which of these posted items a live reimbursement already settles, and by which transfer. */
export async function settlementsOf(
  db: Pick<PlatformTx, 'select'>,
  itemIds: readonly number[],
): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map()
  const rows = await db
    .select({ id: financeIntakeItem.id, settles: financeIntakeItem.settlesItemId })
    .from(financeIntakeItem)
    .where(
      and(
        inArray(financeIntakeItem.settlesItemId, [...itemIds]),
        eq(financeIntakeItem.status, 'posted'),
      ),
    )
  return new Map(rows.map((row) => [row.settles!, row.id]))
}
