import { claimGateResponse } from '@/lib/platform/authGate'

export async function GET() {
  const refusal = claimGateResponse(
    { user: { roles: ['platform-admin'] } },
    'platform-admin',
  )
  if (refusal) return refusal
  return Response.json(await readProtectedData())
}
