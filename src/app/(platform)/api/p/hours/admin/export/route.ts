import { auth } from '@/auth'
import { readHoursDocument } from '@/lib/hours/store-core'
import { claimGateResponse, PLATFORM_ADMIN_ROLE, type SessionLike } from '@/lib/platform/authGate'

export async function GET(): Promise<Response> {
  const session = (await auth()) as SessionLike | null
  const refusal = claimGateResponse(session, PLATFORM_ADMIN_ROLE)
  if (refusal) return refusal

  const doc = await readHoursDocument()
  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="hours.json"',
      'cache-control': 'no-store',
    },
  })
}
