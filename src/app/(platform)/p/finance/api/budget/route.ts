import { createBudget } from '@/lib/finance'

import { financeRequestActor, jsonResponse, requestApiError } from '../requests/request-utils'

/**
 * `POST /p/finance/api/budget` — create the fund's budget (spec 584 EARS-724,
 * spec 338 EARS-338/339). The module refuses without `finance-approve`
 * however this handler is reached (EARS-723); the refusal is its own words.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = await financeRequestActor()
  if (gate.refusal !== null) return gate.refusal
  try {
    const budget = await createBudget(gate.actor, await request.json().catch(() => ({})))
    return jsonResponse({ id: budget.id }, 201)
  } catch (cause) {
    return requestApiError(cause)
  }
}
