import { auth } from '@/auth'
import { z } from 'zod'

import type { CreateExpenseRequestInput, FinanceActor } from '@/lib/finance'
import { claimGateResponse, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

export const expenseRequestBodySchema = z
  .object({
    occurredOn: z.iso.date(),
    accountId: z.number().int().positive().nullable(),
    amount: z.string().regex(/^\d+$/),
    currency: z.string().trim().min(1).max(12),
    paidAmount: z.string().regex(/^\d+$/).nullable().optional(),
    paidCurrency: z.string().trim().min(1).max(12).nullable().optional(),
    purposeId: z.number().int().positive().nullable().optional(),
    purposeProposal: z.string().trim().min(1).max(500).nullable().optional(),
    projectId: z.number().int().positive(),
    productId: z.number().int().positive().nullable().optional(),
    counterpartyId: z.number().int().positive().nullable().optional(),
    counterpartyName: z.string().trim().min(1).max(200).nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
    alreadyPaid: z.boolean(),
    personalFunds: z.boolean(),
  })
  .superRefine((value, context) => {
    if ((value.purposeId ?? null) === null && !value.purposeProposal) {
      context.addIssue({ code: 'custom', message: 'Выберите назначение или предложите новое.' })
    }
    if ((value.counterpartyId ?? null) === null && !value.counterpartyName) {
      context.addIssue({ code: 'custom', message: 'Выберите или создайте контрагента.' })
    }
    if (value.personalFunds && !value.alreadyPaid) {
      context.addIssue({
        code: 'custom',
        message: 'Оплата своими средствами возможна только для уже потраченных денег.',
      })
    }
  })

export type ExpenseRequestBody = z.infer<typeof expenseRequestBodySchema>

export function expenseRequestInput(
  body: ExpenseRequestBody,
  counterpartyId: number,
): CreateExpenseRequestInput {
  return {
    occurredOn: body.occurredOn,
    accountId: body.accountId,
    amount: BigInt(body.amount),
    currency: body.currency,
    paidAmount: body.paidAmount ? BigInt(body.paidAmount) : null,
    paidCurrency: body.paidCurrency ?? null,
    purposeId: body.purposeId ?? null,
    projectId: body.projectId,
    productId: body.productId ?? null,
    counterpartyId,
    note: body.note ?? null,
    alreadyPaid: body.alreadyPaid,
    personalFunds: body.personalFunds,
  }
}

export async function financeRequestActor(): Promise<
  { actor: FinanceActor; refusal: null } | { actor: null; refusal: Response }
> {
  const session = await auth()
  const refusal = claimGateResponse(session, PLATFORM_USER_ROLE)
  if (refusal !== null) return { actor: null, refusal }
  const email = session?.user?.email
  if (typeof email !== 'string' || email.trim() === '') {
    return {
      actor: null,
      refusal: new Response('Сессия без email не может работать с заявками.', { status: 403 }),
    }
  }
  return {
    actor: {
      email: email.trim().toLowerCase(),
      roles: (session?.user as { roles?: string[] } | undefined)?.roles ?? [],
    },
    refusal: null,
  }
}

export function requestApiError(cause: unknown): Response {
  const error = cause as { name?: string; message?: string }
  if (error?.name === 'FinanceAccessRefusal') return textResponse(403, error.message)
  if (error?.name === 'FinanceRefusal') return textResponse(422, error.message)
  throw cause
}

export function textResponse(status: number, body = 'Некорректный запрос.'): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
