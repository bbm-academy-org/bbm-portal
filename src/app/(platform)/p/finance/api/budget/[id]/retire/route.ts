import { retireBudget } from '@/lib/finance'

import {
  financeRequestActor,
  jsonResponse,
  requestApiError,
  textResponse,
} from '../../../requests/request-utils'

/** `POST /p/finance/api/budget/<id>/retire` — close the budget, kept in history (spec 584 EARS-726). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await financeRequestActor()
  if (gate.refusal !== null) return gate.refusal
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return textResponse(404, 'Бюджет не найден.')
  try {
    const budget = await retireBudget(gate.actor, id)
    return jsonResponse({ id: budget.id })
  } catch (cause) {
    return requestApiError(cause)
  }
}
