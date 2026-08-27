/**
 * The intake status machine (spec `docs/specs/339-ledger-intake.md` §H,
 * EARS-524; the transition block under «Status model»).
 *
 * **The table below IS the clause.** EARS-524 says «the system shall refuse any
 * intake-item transition or edit outside the status machine of this spec», and a
 * refusal written as a chain of `if`s scattered across handlers is exactly how a
 * machine acquires an eighth transition nobody decided on. So the seven legal
 * transitions are DATA here, every handler asks this file, and «every transition
 * not listed is refused» is true by construction rather than by vigilance.
 *
 * This file is pure: no database, no actor, no I/O. It answers «is this move
 * legal, and what does it need» — WHO may make it is the actor gate's question
 * (`../core/actor.ts`), and the two are deliberately separate because the same
 * move has different gates depending on the row (`cancel` is the submitter's,
 * `approve` is the approve role's, and only the caller holds the row).
 *
 * **`post` is listed and not implemented.** `approved → posted` is a real
 * transition of the spec, so the machine knows it; the posting ACT — the atomic
 * write of the operation, the document gate, the cross-currency legs — is
 * EARS-505/506 and ships with #385. `transitionIntakeItem` therefore refuses it
 * by NAME rather than by silence: a caller who reaches for it gets told which
 * child owns it, not «нельзя».
 */
import type { FinanceIntakeStatus } from '@/lib/platform/db/schema/finance/finance-intake-item'

import { FinanceRefusal } from '../core/errors'

/** The acts a caller can ask for. `delete` is the only one that ends with no row. */
export const FINANCE_INTAKE_ACTS = [
  'submit',
  'approve',
  'refuse',
  'cancel',
  'post',
  'delete',
] as const
export type FinanceIntakeTransitionAct = (typeof FINANCE_INTAKE_ACTS)[number]

/**
 * Who the act belongs to, as a label the handler resolves against the row.
 *
 *  - `entry-or-submitter` — the entry role, or the submitter of their own
 *    request (the EARS-502 carve-out). `submit` and `delete` both sit here;
 *  - `submitter` — the person who filed it, and only them. `cancel` alone: a
 *    withdrawal is a statement about one's own intent, not a clerical act, so it
 *    is the one gate the entry role does not widen;
 *  - `approve` — `finance-approve` (EARS-501).
 */
export type FinanceIntakeGate = 'entry-or-submitter' | 'submitter' | 'approve'

export type FinanceIntakeTransition = {
  act: FinanceIntakeTransitionAct
  from: FinanceIntakeStatus
  /** `null` — the row ceases to exist. Only `delete` from `draft` does that. */
  to: FinanceIntakeStatus | null
  gate: FinanceIntakeGate
  reasonRequired: boolean
}

/** The spec's status block, transcribed. Nothing outside this list is legal. */
export const FINANCE_INTAKE_TRANSITIONS: readonly FinanceIntakeTransition[] = [
  {
    act: 'submit',
    from: 'draft',
    to: 'submitted',
    gate: 'entry-or-submitter',
    reasonRequired: false,
  },
  // The ONLY deletion in the whole machine (EARS-524: «no deletion past draft»).
  // Gated like `submit` rather than on the author alone — owner ruling, Антон,
  // 2026-08-27: a draft is deleted by its CREATOR or by any `finance-entry`
  // holder. Creator-only left `draft` with no exit at all once its author had
  // gone: `cancel` starts at `submitted` and refusal is the approve role's act on
  // a submitted item, so a bad import row was undeletable by everyone.
  { act: 'delete', from: 'draft', to: null, gate: 'entry-or-submitter', reasonRequired: false },
  { act: 'approve', from: 'submitted', to: 'approved', gate: 'approve', reasonRequired: false },
  { act: 'refuse', from: 'submitted', to: 'refused', gate: 'approve', reasonRequired: true },
  { act: 'cancel', from: 'submitted', to: 'cancelled', gate: 'submitter', reasonRequired: false },
  { act: 'post', from: 'approved', to: 'posted', gate: 'approve', reasonRequired: false },
  // Revoking an unposted authorization — a reason is required here too (EARS-512).
  { act: 'refuse', from: 'approved', to: 'refused', gate: 'approve', reasonRequired: true },
]

/** Nothing leaves these — «documents stay linked for the record» (EARS-524). */
export const FINANCE_INTAKE_TERMINAL_STATUSES = ['refused', 'cancelled', 'posted'] as const

/**
 * The money and dimension fields of EARS-524 — the set whose edit the approval
 * covers, and therefore the set whose edit in `approved` bounces the item back.
 *
 * `note`, `alreadyPaid`, `personalFunds`, `counterpartyId` and `memberId` are
 * deliberately NOT here: the spec names this list, and widening it silently
 * would make re-approval fire on data the approver never judged.
 */
export const FINANCE_INTAKE_MONEY_FIELDS = [
  'kind',
  'accountId',
  'counterAccountId',
  'amount',
  'currency',
  'paidAmount',
  'paidCurrency',
  'feeAmount',
  'feeCurrency',
  'purposeId',
  'projectId',
  'productId',
  'occurredOn',
] as const
export type FinanceIntakeMoneyField = (typeof FINANCE_INTAKE_MONEY_FIELDS)[number]

const MONEY_FIELD_SET: ReadonlySet<string> = new Set(FINANCE_INTAKE_MONEY_FIELDS)
const TERMINAL_SET: ReadonlySet<string> = new Set(FINANCE_INTAKE_TERMINAL_STATUSES)

export function isTerminalIntakeStatus(status: FinanceIntakeStatus): boolean {
  return TERMINAL_SET.has(status)
}

export function isIntakeMoneyField(field: string): field is FinanceIntakeMoneyField {
  return MONEY_FIELD_SET.has(field)
}

/** The transition, or `undefined` — the honest answer to «is this move listed». */
export function findIntakeTransition(
  act: FinanceIntakeTransitionAct,
  from: FinanceIntakeStatus,
): FinanceIntakeTransition | undefined {
  return FINANCE_INTAKE_TRANSITIONS.find(
    (transition) => transition.act === act && transition.from === from,
  )
}

const ACT_NAMES: Record<FinanceIntakeTransitionAct, string> = {
  submit: 'отправка',
  approve: 'согласование',
  refuse: 'отказ',
  cancel: 'отзыв',
  post: 'проводка',
  delete: 'удаление',
}

/**
 * The move, or a readable refusal naming what IS possible from here (EARS-326).
 *
 * The message lists the legal acts of the current status rather than saying
 * «нельзя»: a submitter who tries to delete a `submitted` request needs to read
 * «отзовите» — the machine's answer to their actual intent.
 */
export function assertIntakeTransition(input: {
  act: FinanceIntakeTransitionAct
  from: FinanceIntakeStatus
  reason?: string | null
}): FinanceIntakeTransition {
  const transition = findIntakeTransition(input.act, input.from)
  if (transition === undefined) {
    const available = FINANCE_INTAKE_TRANSITIONS.filter((row) => row.from === input.from).map(
      (row) => ACT_NAMES[row.act],
    )
    const tail =
      available.length === 0
        ? `Статус «${input.from}» — терминальный: из него не ведёт ни один переход (EARS-524).`
        : `Из статуса «${input.from}» возможно только: ${available.join(', ')} (EARS-524).`
    throw new FinanceRefusal(
      `Переход «${ACT_NAMES[input.act]}» для заявки не предусмотрен. ${tail}`,
    )
  }
  if (transition.reasonRequired && (input.reason ?? '').trim() === '') {
    throw new FinanceRefusal(
      'Отказ без причины не записывается: причина обязательна и остаётся видимой ' +
        'заявителю вместе с документами (EARS-512).',
    )
  }
  return transition
}

/** What an edit does to the status — and whether it is allowed at all. */
export type FinanceIntakeEditPlan = {
  nextStatus: FinanceIntakeStatus
  /** True when the approval was invalidated by this edit (EARS-524). */
  bounced: boolean
}

/**
 * Plan an edit against the machine (EARS-524).
 *
 * Three cases, and the third is the interesting one:
 *
 *  - terminal — refused outright: `posted` is the ledger's own immutability
 *    reaching back into the intake, `refused`/`cancelled` are the record of a
 *    decision and editing one would rewrite history;
 *  - `draft`/`submitted` — everything is editable, status unchanged;
 *  - `approved` — a money/dimension edit returns the item to `submitted`, «the
 *    approval never covers data it has not seen». Anything else (a note) is left
 *    where it is.
 *
 * The ONE sanctioned exception the spec names — the poster setting `occurred_on`
 * at EARS-511's one-act confirmation without bouncing — belongs to the posting
 * path and lands with #385; it is deliberately not a flag here, because a
 * general «skip the bounce» option is exactly how the clause would leak.
 */
export function planIntakeEdit(
  status: FinanceIntakeStatus,
  changedFields: readonly string[],
): FinanceIntakeEditPlan {
  if (isTerminalIntakeStatus(status)) {
    throw new FinanceRefusal(
      `Заявка в статусе «${status}» больше не редактируется: это терминальный статус ` +
        '(EARS-524). Проведённую операцию исправляют сторнированием (EARS-313/314), ' +
        'отказ и отзыв остаются записью принятого решения.',
    )
  }
  if (status === 'approved') {
    const touched = changedFields.filter((field) => isIntakeMoneyField(field))
    if (touched.length > 0) {
      return { nextStatus: 'submitted', bounced: true }
    }
    return { nextStatus: 'approved', bounced: false }
  }
  return { nextStatus: status, bounced: false }
}
