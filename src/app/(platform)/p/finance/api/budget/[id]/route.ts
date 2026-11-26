import { updateBudget } from '@/lib/finance'

import {
  financeRequestActor,
  jsonResponse,
  requestApiError,
  textResponse,
} from '../../requests/request-utils'

/** `PATCH /p/finance/api/budget/<id>` — one audited change of the budget (spec 584 EARS-725). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await financeRequestActor()
  if (gate.refusal !== null) return gate.refusal
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return textResponse(404, 'Бюджет не найден.')
  try {
    const budget = await updateBudget(gate.actor, id, await request.json().catch(() => ({})))
    return jsonResponse({ id: budget.id })
  } catch (cause) {
    return requestApiError(cause)
  }
}
