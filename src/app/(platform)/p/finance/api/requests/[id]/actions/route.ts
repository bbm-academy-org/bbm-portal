import { z } from 'zod'

import {
  approveExpenseRequest,
  cancelExpenseRequest,
  confirmExpenseRequest,
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

const actionSchema = z.discriminatedUnion('act', [
  z.object({ act: z.literal('submit') }),
  z.object({ act: z.literal('cancel') }),
  z.object({ act: z.literal('approve'), ...moneyDetailsShape }),
  z.object({ act: z.literal('confirm'), ...moneyDetailsShape }),
  z.object({ act: z.literal('refuse'), reason: z.string().trim().min(1).max(2_000) }),
])

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
    const item =
      parsed.data.act === 'submit'
        ? await submitExpenseRequest(gate.actor, id)
        : parsed.data.act === 'cancel'
          ? await cancelExpenseRequest(gate.actor, id)
          : parsed.data.act === 'approve'
            ? await approveExpenseRequest(gate.actor, id, moneyDetails(parsed.data))
            : parsed.data.act === 'confirm'
              ? await confirmExpenseRequest(gate.actor, id, moneyDetails(parsed.data))
              : await refuseExpenseRequest(gate.actor, id, parsed.data.reason)
    return jsonResponse({ id: item.id, status: item.status, operationId: item.operationId })
  } catch (cause) {
    return requestApiError(cause)
  }
}
