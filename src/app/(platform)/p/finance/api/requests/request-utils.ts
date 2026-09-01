import { auth } from '@/auth'
import type { FinanceActor } from '@/lib/finance'
import { claimGateResponse, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'

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
