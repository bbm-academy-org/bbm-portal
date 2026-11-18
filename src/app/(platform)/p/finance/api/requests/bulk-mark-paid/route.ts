import { z } from 'zod'

import { bulkMarkExpenseRequestsPaid, FINANCE_APPROVE_ROLE } from '@/lib/finance'

import { financeRequestActor, jsonResponse, requestApiError, textResponse } from '../request-utils'

export const dynamic = 'force-dynamic'

/**
 * The bulk retroactive act (spec 339 EARS-547/548): «Отметить все N как
 * оплаченные…». The body names the group, the batch account, an optional
 * single date and the EXPLICIT rows the dialog showed with their snapshot
 * tokens — never «everything in the group». `preview` returns the plan and the
 * exclusions without writing. Every rule about the data is the module's.
 */
const bulkSchema = z
  .object({
    group: z.enum(['pay', 'reimburse']),
    accountId: z.number().int().positive(),
    occurredOn: z.iso.date().optional(),
    items: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
            snapshot: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    preview: z.boolean().optional(),
  })
  .strict()

export async function POST(request: Request): Promise<Response> {
  const gate = await financeRequestActor()
  if (gate.refusal !== null) return gate.refusal
  // The role before anything data-dependent — and before the body is read: a
  // member without `finance-approve` learns nothing from a 400 either (EARS-501).
  if (!gate.actor.roles.includes(FINANCE_APPROVE_ROLE)) {
    return textResponse(
      403,
      `Пакетная отметка оплаты — роль «${FINANCE_APPROVE_ROLE}» (EARS-501/547).`,
    )
  }
  const parsed = bulkSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return textResponse(400, parsed.error.issues[0]?.message)

  try {
    const result = await bulkMarkExpenseRequestsPaid(gate.actor, {
      group: parsed.data.group,
      accountId: parsed.data.accountId,
      ...(parsed.data.occurredOn === undefined ? {} : { occurredOn: parsed.data.occurredOn }),
      items: parsed.data.items,
      preview: parsed.data.preview ?? false,
    })
    return jsonResponse(result)
  } catch (cause) {
    return requestApiError(cause)
  }
}
