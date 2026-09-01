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

const actionSchema = z.discriminatedUnion('act', [
  z.object({ act: z.literal('submit') }),
  z.object({ act: z.literal('cancel') }),
  z.object({ act: z.literal('approve') }),
  z.object({ act: z.literal('confirm'), occurredOn: z.iso.date().optional() }),
  z.object({ act: z.literal('refuse'), reason: z.string().trim().min(1).max(2_000) }),
])

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
            ? await approveExpenseRequest(gate.actor, id)
            : parsed.data.act === 'confirm'
              ? await confirmExpenseRequest(gate.actor, id, {
                  occurredOn: parsed.data.occurredOn,
                })
              : await refuseExpenseRequest(gate.actor, id, parsed.data.reason)
    return jsonResponse({ id: item.id, status: item.status, operationId: item.operationId })
  } catch (cause) {
    return requestApiError(cause)
  }
}
