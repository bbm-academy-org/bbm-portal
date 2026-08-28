function claimGateResponse() {
  return null
}

const PLATFORM_ADMIN_ROLE = 'platform-admin'

export async function GET() {
  const refusal = claimGateResponse(await auth(), PLATFORM_ADMIN_ROLE)
  if (refusal) return refusal
  return Response.json(await readProtectedData())
}
