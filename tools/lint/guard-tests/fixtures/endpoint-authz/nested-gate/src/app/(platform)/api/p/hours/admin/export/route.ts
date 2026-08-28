// FIXTURE — a never-called nested gate does not protect the exported handler.
import { claimGateResponse, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'
export async function GET() {
  async function neverCalled() {
    return claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)
  }
  return Response.json(await readProtectedData())
}
