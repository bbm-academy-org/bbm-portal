// FIXTURE — one hand-gated method must not bless an ungated neighbour.
import { auth } from '@/auth'
import { claimGateResponse, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'
export async function GET() {
  const refusal = claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)
  if (refusal) return refusal
  return Response.json({ data: [] })
}
export async function POST() {
  return Response.json({ ok: true })
}
