import { auth } from '@/auth'
import { z } from 'zod'

import {
  createCounterparty,
  listCounterparties,
  FINANCE_APPROVE_ROLE,
  FINANCE_ENTRY_ROLE,
  FINANCE_INTAKE_SOURCE_REF_MAX,
  type CreateExpenseRequestInput,
  type FinanceActor,
} from '@/lib/finance'
import { claimGateResponse, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

/**
 * WHAT THE FORM MAY PUT IN `source_ref` (#517, revised EARS-503).
 *
 * An http(s) URL and nothing else. The column also holds Mattermost POST IDS —
 * migration `0017` wrote 47 of them — but those come from a reconstruction, not
 * from a person: a member typing into a browser has a URL in their clipboard,
 * and accepting a bare identifier here would mean accepting any typo at all as
 * «an identifier in some system», which the resolver could then never turn into
 * a link. So the refusal is early and says what shape is wanted.
 */
function isHttpLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const SOURCE_REF_REFUSAL =
  'Ссылка на источник должна быть адресом вида https://… — например, ссылкой на пост в ' +
  'Mattermost, где обсуждали трату.'

export const expenseRequestBodySchema = z
  .object({
    occurredOn: z.iso.date().nullable().optional(),
    accountId: z.number().int().positive().nullable().optional(),
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
    /** Optional, filing-only, immutable afterwards (#517, EARS-535/536). */
    sourceRef: z
      .string()
      .trim()
      .min(1)
      .max(FINANCE_INTAKE_SOURCE_REF_MAX)
      .refine(isHttpLink, { message: SOURCE_REF_REFUSAL })
      .nullable()
      .optional(),
    alreadyPaid: z.boolean(),
    personalFunds: z.boolean(),
  })
  .superRefine((value, context) => {
    if ((value.purposeId ?? null) === null && !value.purposeProposal) {
      context.addIssue({ code: 'custom', message: 'Выберите назначение или предложите новое.' })
    }
    if ((value.purposeId ?? null) !== null && value.purposeProposal) {
      context.addIssue({
        code: 'custom',
        path: ['purposeProposal'],
        message: 'Выберите назначение или предложите новое, но не оба варианта сразу.',
      })
    }
    if ((value.counterpartyId ?? null) === null && !value.counterpartyName) {
      context.addIssue({ code: 'custom', message: 'Выберите или создайте контрагента.' })
    }
    // The counterparty is ONE, «picked from the reference or created inline»
    // (EARS-532) — the same exclusive shape as the purpose pair above, and it
    // was missing its refusal: a body naming both was accepted and
    // `resolveRequestCounterpartyId` then preferred the NAME, filing the
    // request against a counterparty the member never picked (#388).
    if ((value.counterpartyId ?? null) !== null && value.counterpartyName) {
      context.addIssue({
        code: 'custom',
        path: ['counterpartyName'],
        message: 'Выберите контрагента или впишите нового, но не оба варианта сразу.',
      })
    }
    if (value.personalFunds && !value.alreadyPaid) {
      context.addIssue({
        code: 'custom',
        message: 'Оплата своими средствами возможна только для уже потраченных денег.',
      })
    }
    // EARS-533: a request is an INTENT. The paying account and the date money
    // moved belong to the posting act, and the only request that knows them at
    // filing is the one marked «уже потрачено».
    if (!value.alreadyPaid && ((value.accountId ?? null) !== null || value.occurredOn)) {
      context.addIssue({
        code: 'custom',
        message:
          'Счёт списания и дата движения денег заполняются, только когда отмечено «уже ' +
          'потрачено»: заявка на будущую трату их не знает (EARS-508/533).',
      })
    }
    if (value.alreadyPaid && !value.occurredOn) {
      context.addIssue({
        code: 'custom',
        path: ['occurredOn'],
        message: 'Укажите дату, когда деньги действительно ушли (EARS-508).',
      })
    }
    if (value.alreadyPaid && !value.personalFunds && (value.accountId ?? null) === null) {
      context.addIssue({
        code: 'custom',
        path: ['accountId'],
        message: 'Укажите счёт списания или отметьте «оплачено своими средствами» (EARS-508).',
      })
    }
  })

export const purposeProposalRecoverySchema = z
  .object({ purposeProposal: z.string().trim().min(1).max(500) })
  .strict()

export type ExpenseRequestBody = z.infer<typeof expenseRequestBodySchema>

function normalizeCounterpartyName(name: string): string {
  return name.trim().toLowerCase()
}

async function findCounterpartyIdByName(name: string): Promise<number | null> {
  const normalizedName = normalizeCounterpartyName(name)
  const existing = (await listCounterparties()).find(
    (counterparty) => normalizeCounterpartyName(counterparty.name) === normalizedName,
  )
  return existing?.id ?? null
}

export async function resolveRequestCounterpartyId(
  actor: FinanceActor,
  body: Pick<ExpenseRequestBody, 'counterpartyId' | 'counterpartyName'>,
): Promise<number> {
  if (!body.counterpartyName) return body.counterpartyId!

  const existingId = await findCounterpartyIdByName(body.counterpartyName)
  if (existingId !== null) return existingId

  try {
    return (await createCounterparty(actor, { name: body.counterpartyName })).id
  } catch (cause) {
    const racedId = await findCounterpartyIdByName(body.counterpartyName)
    if (racedId !== null) return racedId
    throw cause
  }
}

/**
 * WHO MAY SAY «THE COMPANY PAID» — owner decision 36 (Антон, 2026-09-14, #115),
 * spec 339 EARS-508 revision 2026-09-14: «конечно, не любой сотрудник имеет
 * доступ к корп. счетам».
 *
 * THE FORM'S HIDDEN CONTROL IS NOT THE GATE, and the spec says so in as many
 * words: the handler refuses the claim «however the API is reached». A
 * submitter holding neither `finance-entry` nor `finance-approve` may file an
 * already-paid request only as their own money — `personal_funds` set and no
 * `account` named. Either half missing is the same refusal.
 *
 * It is deliberately NOT part of `expenseRequestBodySchema`: that schema is the
 * body's own shape and knows no actor, and a zod refinement that needed one
 * would have to be re-created per request. Null means «nothing to refuse».
 */
export function companyAccountRefusal(
  actor: FinanceActor,
  body: Pick<ExpenseRequestBody, 'alreadyPaid' | 'personalFunds' | 'accountId'>,
): string | null {
  if (!body.alreadyPaid) return null
  const financeRole =
    actor.roles.includes(FINANCE_ENTRY_ROLE) || actor.roles.includes(FINANCE_APPROVE_ROLE)
  if (financeRole) return null
  if (body.personalFunds && (body.accountId ?? null) === null) return null
  return (
    'Оплату с корпоративного счёта оформляет финансовая роль (finance-entry / ' +
    'finance-approve): уже потраченную сумму подайте как оплаченную своими ' +
    'средствами (EARS-508, решение 36).'
  )
}

export function expenseRequestInput(
  body: ExpenseRequestBody,
  counterpartyId: number,
): CreateExpenseRequestInput {
  return {
    occurredOn: body.occurredOn ?? null,
    accountId: body.accountId ?? null,
    amount: BigInt(body.amount),
    currency: body.currency,
    paidAmount: body.paidAmount ? BigInt(body.paidAmount) : null,
    paidCurrency: body.paidCurrency ?? null,
    purposeId: body.purposeId ?? null,
    projectId: body.projectId,
    productId: body.productId ?? null,
    counterpartyId,
    note: body.note ?? null,
    sourceRef: body.sourceRef ?? null,
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
