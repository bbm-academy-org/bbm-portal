/**
 * Which rate a request's display conversion uses — EARS-550 as a pure function
 * (spec `docs/specs/339-ledger-intake.md` §I; issue #548).
 *
 * The rule follows Russian accounting's own convention for a foreign-currency
 * amount (ПБУ 3/2006 п. 4–5, the spec's donor pass): money that has not moved
 * is valued today; money that moved is valued on the day it moved.
 *
 *  - unpaid (not `already_paid`, not posted) → the CBR rate for today (Moscow);
 *  - filed `already_paid` (by a member or from a company account) and not
 *    posted → the CBR rate on its `occurred_on`, today where it has none;
 *  - posted → what the LEDGER recorded, in this order: the account-side amount
 *    where the posting already holds the display currency (a cross-currency
 *    payment), else the recorded conversion step covering the pair (its
 *    AMOUNTS — the fact — not its rate text, whose orientation is testimony:
 *    see `finance-conversion-step.ts`), else the CBR rate on the OPERATION's
 *    `occurred_on` — the date money moved, never `posted_at`.
 *
 * It reads the ledger's record and never writes one: the basis it returns is a
 * display instruction (EARS-553).
 */
import type { FinanceIntakeStatus } from '@/lib/platform/db/schema/finance/finance-intake-item'

/** The posting facts of a posted request, as the read model loads them. */
export type DisplayRatePostingFacts = {
  /** `finance_operation.occurred_on` — the date money moved. */
  operationOccurredOn: string
  /** When the request was posted. Carried so the rule can visibly ignore it. */
  postedAt: string | null
  /** The signed amounts the operation put on its money account(s). */
  accountAmounts: readonly { currency: string; amount: bigint }[]
  /** The operation's recorded conversion steps, by their amounts. */
  conversionSteps: readonly {
    fromCurrency: string
    toCurrency: string
    fromAmount: bigint
    toAmount: bigint
  }[]
}

/** The slice of a request the rule reads. */
export type DisplayRateRequestSnapshot = {
  currency: string
  status: FinanceIntakeStatus
  alreadyPaid: boolean
  occurredOn: string | null
  /** Required when `status` is `posted`, `null` otherwise. */
  posting: DisplayRatePostingFacts | null
}

/** Why a CBR date was chosen — carried so the screen can say which date it shows. */
export type CbrRateReason =
  'unpaid' | 'occurred_on' | 'occurred_on_missing' | 'operation_occurred_on'

export type DisplayRateBasis =
  /** The request is already in the display currency. */
  | { kind: 'same_currency' }
  /** The ledger holds the display-currency amount itself (absolute minimal units). */
  | { kind: 'ledger_amount'; amount: bigint }
  /** display amount = request amount × numerator / denominator (both minimal units). */
  | { kind: 'ledger_step'; numerator: bigint; denominator: bigint }
  /** Convert at the CBR rate effective on `date` (EARS-552 lookup). */
  | { kind: 'cbr'; date: string; reason: CbrRateReason }

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

export function displayRateBasis(
  request: DisplayRateRequestSnapshot,
  displayCurrency: string,
  today: string,
): DisplayRateBasis {
  if (request.currency === displayCurrency) return { kind: 'same_currency' }

  if (request.status === 'posted') {
    const posting = request.posting
    if (posting === null) {
      throw new Error(
        'displayRateBasis: a posted request needs its posting facts (EARS-550) — ' +
          'falling back to today would value moved money at a date it did not move.',
      )
    }
    const held = posting.accountAmounts.find((a) => a.currency === displayCurrency)
    if (held !== undefined) return { kind: 'ledger_amount', amount: abs(held.amount) }

    for (const step of posting.conversionSteps) {
      if (step.fromCurrency === request.currency && step.toCurrency === displayCurrency) {
        return { kind: 'ledger_step', numerator: step.toAmount, denominator: step.fromAmount }
      }
      if (step.fromCurrency === displayCurrency && step.toCurrency === request.currency) {
        return { kind: 'ledger_step', numerator: step.fromAmount, denominator: step.toAmount }
      }
    }
    return { kind: 'cbr', date: posting.operationOccurredOn, reason: 'operation_occurred_on' }
  }

  if (request.alreadyPaid) {
    return request.occurredOn === null
      ? { kind: 'cbr', date: today, reason: 'occurred_on_missing' }
      : { kind: 'cbr', date: request.occurredOn, reason: 'occurred_on' }
  }

  return { kind: 'cbr', date: today, reason: 'unpaid' }
}
