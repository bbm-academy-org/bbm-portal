import { z } from 'zod'

import {
  approveExpenseRequest,
  cancelExpenseRequest,
  confirmExpenseRequest,
  markExpenseRequestPaid,
  markExpenseRequestReimbursed,
  refuseExpenseRequest,
  submitExpenseRequest,
} from '@/lib/finance'

import {
  financeRequestActor,
  jsonResponse,
  requestApiError,
  textResponse,
} from '../../request-utils'

export const dynamic = 'force-dynamic'

/**
 * EARS-533: the money facts the POSTING act enters — the paying account, the
 * date money really moved and, where the account is in another currency, the
 * amount it was actually charged. Both deciding acts take them, because both
 * can post: `confirm` always, and `approve` in EARS-510's one act when the
 * document is already there.
 */
const moneyDetailsShape = {
  accountId: z.number().int().positive().nullable().optional(),
  occurredOn: z.iso.date().optional(),
  paidAmount: z.string().regex(/^\d+$/).nullable().optional(),
  paidCurrency: z.string().trim().min(1).max(12).nullable().optional(),
}

/**
 * The charged amount and the currency it was charged in are ONE fact in two
 * columns, and the ledger says so itself: `finance_intake_item_paid_pair`
 * CHECKs that the two are null together and set together. Named apart in a
 * body they would reach that CHECK and come back as a 500 the caller cannot
 * read — so the pair is refused here, in the same 400 shape every other
 * malformed body gets.
 */
/** Already-uploaded receipts the act attaches; a receipt is optional (EARS-543/544). */
const documentIdsShape = {
  documentIds: z.array(z.number().int().positive()).max(20).optional(),
}

const actionSchema = z
  .discriminatedUnion('act', [
    z.object({ act: z.literal('submit') }),
    z.object({ act: z.literal('cancel') }),
    z.object({ act: z.literal('approve'), ...moneyDetailsShape }),
    z.object({ act: z.literal('confirm'), ...moneyDetailsShape }),
    // EARS-543 «Отметить оплату» / «Одобрить и отметить оплату»: the date money
    // moved is required; the account and the debited amount as EARS-533 says.
    z.object({
      act: z.literal('mark-paid'),
      ...moneyDetailsShape,
      occurredOn: z.iso.date(),
      ...documentIdsShape,
    }),
    // EARS-544 «Отметить возврат»: the refund's date, account and amount.
    z.object({
      act: z.literal('mark-reimbursed'),
      occurredOn: z.iso.date(),
      accountId: z.number().int().positive(),
      amount: z.string().regex(/^\d+$/),
      ...documentIdsShape,
    }),
    z.object({ act: z.literal('refuse'), reason: z.string().trim().min(1).max(2_000) }),
  ])
  .superRefine((value, context) => {
    if (value.act !== 'approve' && value.act !== 'confirm' && value.act !== 'mark-paid') return
    // Three states, not two: absent (the fact is not being touched), null (it is
    // being cleared) and set. The CHECK compares nullness, so both facts must be
    // in the SAME state — clearing one while setting the other breaks it too.
    const named = (fact: string | null | undefined) =>
      fact === undefined ? 'absent' : fact === null ? 'null' : 'set'
    if (named(value.paidAmount) === named(value.paidCurrency)) return
    context.addIssue({
      code: 'custom',
      path: ['paidAmount'],
      message: 'Сумма списания и её валюта называются только вместе.',
    })
  })

/** Only the keys the caller really named — an absent fact is not `undefined` data. */
function moneyDetails(input: {
  accountId?: number | null
  occurredOn?: string
  paidAmount?: string | null
  paidCurrency?: string | null
}) {
  return {
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.occurredOn === undefined ? {} : { occurredOn: input.occurredOn }),
    ...(input.paidAmount === undefined
      ? {}
      : { paidAmount: input.paidAmount === null ? null : BigInt(input.paidAmount) }),
    ...(input.paidCurrency === undefined ? {} : { paidCurrency: input.paidCurrency }),
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await financeRequestActor()
  if (gate.refusal !== null) return gate.refusal
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return textResponse(400, 'Некорректный номер заявки.')
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return textResponse(400, parsed.error.issues[0]?.message)

  try {
    const data = parsed.data
    const item = await (() => {
      switch (data.act) {
        case 'submit':
          return submitExpenseRequest(gate.actor, id)
        case 'cancel':
          return cancelExpenseRequest(gate.actor, id)
        case 'approve':
          return approveExpenseRequest(gate.actor, id, moneyDetails(data))
        case 'confirm':
          return confirmExpenseRequest(gate.actor, id, moneyDetails(data))
        case 'mark-paid':
          return markExpenseRequestPaid(gate.actor, id, {
            ...moneyDetails(data),
            ...(data.documentIds === undefined ? {} : { documentIds: data.documentIds }),
          })
        case 'mark-reimbursed':
          return markExpenseRequestReimbursed(gate.actor, id, {
            occurredOn: data.occurredOn,
            accountId: data.accountId,
            amount: BigInt(data.amount),
            ...(data.documentIds === undefined ? {} : { documentIds: data.documentIds }),
          })
        case 'refuse':
          return refuseExpenseRequest(gate.actor, id, data.reason)
      }
    })()
    return jsonResponse({ id: item.id, status: item.status, operationId: item.operationId })
  } catch (cause) {
    return requestApiError(cause)
  }
}
