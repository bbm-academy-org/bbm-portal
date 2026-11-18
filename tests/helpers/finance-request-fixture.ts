import type {
  QueueDisplayAmount,
  RequestBoardItem,
} from '@/app/(platform)/p/finance/requests/request-board-contract'
import { deriveExpenseRequestStage } from '@/lib/finance/intake/request-queue'

/**
 * The §I read-model fields a request row carries since #549/#550 — the stage,
 * the «без чека» fact, the settlement, the snapshot token and the display
 * amounts — derived from a fixture's own status and money so a spec written
 * before the queue existed keeps describing a consistent row.
 *
 * The display amounts are «already in that currency» for all three: a fixture
 * that is not about conversion says nothing about rates.
 */
type QueueKeys =
  | 'stage'
  | 'hasDocument'
  | 'settledBy'
  | 'snapshot'
  | 'display'
  | 'feeAmount'
  | 'feeCurrency'
  | 'market'

export function queueFields(
  row: Pick<
    RequestBoardItem,
    'status' | 'alreadyPaid' | 'personalFunds' | 'amount' | 'documents'
  > & {
    settledBy?: number | null
  },
): Pick<RequestBoardItem, QueueKeys> {
  const same: QueueDisplayAmount = {
    kind: 'converted',
    amount: row.amount,
    numerator: row.amount,
    denominator: '1',
    basis: 'same_currency',
    rateDate: null,
    reason: null,
  }
  const settledBy = row.settledBy ?? null
  return {
    stage: deriveExpenseRequestStage({ ...row, settled: settledBy !== null }),
    hasDocument: row.documents.length > 0,
    settledBy,
    snapshot: null,
    display: { RUB: same, USD: same, EUR: same },
    // No fee and no §J block (#551): a same-currency fixture is outside §J.
    feeAmount: null,
    feeCurrency: null,
    market: null,
  }
}

/** A pre-queue fixture made whole: its own fields win, the queue fields fill the rest. */
export function withQueueFields(
  row: Omit<RequestBoardItem, QueueKeys> & Partial<Pick<RequestBoardItem, QueueKeys>>,
): RequestBoardItem {
  return { ...queueFields(row), ...row }
}
