// FIXTURE — an admin handler may not choose a weaker claim at runtime.
import {
  claimGateResponse,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_USER_ROLE,
} from '@/lib/platform/authGate'
export async function GET() {
  const refusal = claimGateResponse(
    await auth(),
    useAdmin ? PLATFORM_ADMIN_ROLE : PLATFORM_USER_ROLE,
  )
  if (refusal) return refusal
  return Response.json(await readProtectedData())
}
