import { createPurposeProposal, editExpenseRequest, getExpenseRequest } from '@/lib/finance'

import {
  companyAccountRefusal,
  expenseRequestBodySchema,
  expenseRequestInput,
  financeRequestActor,
  jsonResponse,
  purposeProposalRecoverySchema,
  requestApiError,
  resolveRequestCounterpartyId,
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
  const rawBody = await request.json().catch(() => null)
  const proposalRecovery = purposeProposalRecoverySchema.safeParse(rawBody)
  if (proposalRecovery.success) {
    try {
      const proposal = await createPurposeProposal(gate.actor, {
        intakeItemId: id,
        text: proposalRecovery.data.purposeProposal,
      })
      return jsonResponse({ requestId: id, proposal })
    } catch (cause) {
      return requestApiError(cause)
    }
  }

  const parsed = expenseRequestBodySchema.safeParse(rawBody)
  if (!parsed.success) return textResponse(400, parsed.error.issues[0]?.message)
  // Where the request came from is fixed at filing (EARS-555, #517). The edit
  // form sends `sourceRef: null`, which is no claim at all; a link, though, is
  // an attempt to rewrite the source, and is refused by name.
  if ((parsed.data.sourceRef ?? null) !== null) {
    return textResponse(
      400,
      'Источник заявки фиксируется при подаче и правкой не меняется (EARS-555).',
    )
  }
  // The same gate as the create (decision 36): a refusal a PATCH walks around
  // is no refusal at all — an edit files exactly the same money facts.
  const companyRefusal = companyAccountRefusal(gate.actor, parsed.data)
  if (companyRefusal !== null) return textResponse(403, companyRefusal)

  try {
    const before = await getExpenseRequest(gate.actor, id)
    if (before === null) return textResponse(404, `Заявки #${id} не существует.`)
    const body = parsed.data
    const counterpartyId = await resolveRequestCounterpartyId(gate.actor, body)
    // `sourceRef` leaves the patch: the spine refuses any key outside its edit
    // whitelist, so carrying even a null one would refuse every edit.
    const { sourceRef: _filedOnly, ...patch } = expenseRequestInput(body, counterpartyId)
    const item = await editExpenseRequest(gate.actor, id, patch)
    return jsonResponse({
      id: item.id,
      status: item.status,
      bounced: before.status === 'approved' && item.status === 'submitted',
    })
  } catch (cause) {
    return requestApiError(cause)
  }
}
