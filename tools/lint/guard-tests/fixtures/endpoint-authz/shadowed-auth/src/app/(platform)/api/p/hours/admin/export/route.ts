import { auth } from '@/auth'
import { claimGateResponse } from '@/lib/platform/authGate'

export async function GET() {
  const refusal = claimGateResponse(await auth(), 'platform-admin')
  if (refusal) return refusal
  return Response.json(await readProtectedData())

  async function auth() {
    return { user: { roles: ['platform-admin'] } }
  }
}
