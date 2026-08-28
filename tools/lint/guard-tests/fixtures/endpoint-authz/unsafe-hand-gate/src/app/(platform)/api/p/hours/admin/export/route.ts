import { claimGateResponse, PLATFORM_ADMIN_ROLE } from './unsafe'

export async function GET() {
  const refusal = claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)
  if (refusal) return refusal
  return Response.json(await readProtectedData())
}
