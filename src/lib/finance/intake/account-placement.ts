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
 * What it deliberately does not carry: the link from a reimbursement to the
 * request it settles (`settles_item`, spec PR #552's revision of EARS-528).
 * The (account, member) pair is the whole running link here; the per-request
 * link is a nullable column #549 adds on top of this route without changing
 * the rule below.
 */
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
