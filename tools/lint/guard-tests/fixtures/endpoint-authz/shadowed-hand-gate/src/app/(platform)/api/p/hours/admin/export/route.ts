import { claimGateResponse } from '@/lib/platform/authGate'

export async function GET() {
  const refusal = claimGateResponse(await auth(), 'platform-admin')
  if (refusal) return refusal
  return Response.json(await readProtectedData())

  function claimGateResponse() {
    return null
  }
}
