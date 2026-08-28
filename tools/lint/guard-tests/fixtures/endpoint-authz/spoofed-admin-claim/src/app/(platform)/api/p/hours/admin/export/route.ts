import { auth } from '@/auth'
import {
  claimGateResponse,
  PLATFORM_USER_ROLE as PLATFORM_ADMIN_ROLE,
} from '@/lib/platform/authGate'

export async function GET() {
  const refusal = claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)
  if (refusal) return refusal
  return Response.json(await readProtectedData())
}
