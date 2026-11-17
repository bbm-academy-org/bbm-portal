/**
 * The reimbursement route (spec 339 EARS-528, issue #466).
 *
 * A reimbursement is not a new kind of record: it is a `manual`, `kind =
 * transfer` intake item from a company money account into the system
 * `liability` account, carrying the member whose EARS-513 debt it settles. It
 * then walks the ordinary machine (submit → approve → post, document-gated by
 * EARS-506) and posts through the one ledger door, `postIntakeItem`.
 *
 * This facade exists so a caller names the DEBT — member and currency — rather
 * than a system account id the cabinet never shows (spec 338 EARS-305). It adds
 * no rule of its own: the placement rule lives in `./account-placement` and
 * runs inside `createIntakeItem`'s transaction like for any other item.
 *
 * Seam for #549 («reimburse in one act», spec PR #552): that act settles a
 * specific request and names it through `settles_item`. It composes this same
 * shape (`reimbursementTransferValues`) inside its own transaction; the column
 * and its uniqueness arrive with #549, not here.
 */
import { and, eq } from 'drizzle-orm'

import { financeAccount } from '@/lib/platform/db/schema/finance/finance-account'
import { getPlatformDb } from '@/lib/platform/db/client'

import type { FinanceActor } from '../core/actor'
import { FinanceRefusal } from '../core/errors'
import { createIntakeItem, type CreateIntakeItemInput, type FinanceIntakeItemView } from './items'

export type CreateReimbursementTransferInput = {
  /** The date the money left the company account. */
  occurredOn: string
  /** The company money account the refund left. */
  accountId: number
  /** The amount returned, in the debt's currency (EARS-513: `paid_currency`, else `currency`). */
  amount: bigint
  currency: string
  /** The member whose debt this settles. */
  memberId: number
  projectId: number
  counterpartyId?: number | null
  note?: string | null
  feeAmount?: bigint | null
  feeCurrency?: string | null
}

/** The intake shape of a reimbursement, given the liability account of its currency. */
export function reimbursementTransferValues(
  input: CreateReimbursementTransferInput,
  liabilityAccountId: number,
): CreateIntakeItemInput {
  return {
    source: 'manual',
    kind: 'transfer',
    occurredOn: input.occurredOn,
    accountId: input.accountId,
    counterAccountId: liabilityAccountId,
    amount: input.amount,
    currency: input.currency,
    memberId: input.memberId,
    projectId: input.projectId,
    counterpartyId: input.counterpartyId ?? null,
    note: input.note ?? null,
    feeAmount: input.feeAmount ?? null,
    feeCurrency: input.feeCurrency ?? null,
  }
}

/** File a reimbursement as a draft intake item (EARS-528). */
export async function createReimbursementTransfer(
  actor: FinanceActor,
  input: CreateReimbursementTransferInput,
): Promise<FinanceIntakeItemView> {
  const liability = await findLiabilityAccount(input.currency)
  if (liability === null) {
    // No liability account in this currency means no EARS-513 debt was ever
    // recorded in it: there is nothing to settle, and creating the system
    // account here would turn a typo in the currency into a debt owed BY the
    // member.
    throw new FinanceRefusal(
      `Долгов перед участниками в ${input.currency} не записано — возмещать в этой валюте нечего ` +
        '(EARS-528, EARS-513).',
    )
  }
  return createIntakeItem(actor, reimbursementTransferValues(input, liability))
}

async function findLiabilityAccount(currency: string): Promise<number | null> {
  const [row] = await getPlatformDb()
    .select({ id: financeAccount.id })
    .from(financeAccount)
    .where(
      and(
        eq(financeAccount.kind, 'liability'),
        eq(financeAccount.currency, currency),
        eq(financeAccount.isSystem, true),
      ),
    )
  return row?.id ?? null
}
