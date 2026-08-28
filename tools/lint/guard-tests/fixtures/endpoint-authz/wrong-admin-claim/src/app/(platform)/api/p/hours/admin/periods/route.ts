// FIXTURE — `/admin/` requires the admin claim, not merely workspace membership.
import { auth } from '@/auth'
import { claimGateResponse, PLATFORM_USER_ROLE } from '@/lib/platform/authGate'
export async function GET() {
  const refusal = claimGateResponse(await auth(), PLATFORM_USER_ROLE)
  if (refusal) return refusal
  return Response.json({ data: [] })
}
