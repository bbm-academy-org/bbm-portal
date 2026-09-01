import { createCounterparty, editExpenseRequest, getExpenseRequest } from '@/lib/finance'

import {
  expenseRequestBodySchema,
  expenseRequestInput,
  financeRequestActor,
  jsonResponse,
  requestApiError,
  textResponse,
} from '../request-utils'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await financeRequestActor()
  if (gate.refusal !== null) return gate.refusal
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return textResponse(400, 'Некорректный номер заявки.')
  const parsed = expenseRequestBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return textResponse(400, parsed.error.issues[0]?.message)

  try {
    const before = await getExpenseRequest(gate.actor, id)
    if (before === null) return textResponse(404, `Заявки #${id} не существует.`)
    const body = parsed.data
    const counterpartyId = body.counterpartyName
      ? (await createCounterparty(gate.actor, { name: body.counterpartyName })).id
      : body.counterpartyId!
    const item = await editExpenseRequest(gate.actor, id, expenseRequestInput(body, counterpartyId))
    return jsonResponse({
      id: item.id,
      status: item.status,
      bounced: before.status === 'approved' && item.status === 'submitted',
    })
  } catch (cause) {
    return requestApiError(cause)
  }
}
