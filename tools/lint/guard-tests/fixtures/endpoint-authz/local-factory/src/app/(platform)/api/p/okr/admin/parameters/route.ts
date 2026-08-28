function adminRoute() {
  return async () => Response.json(await readProtectedData())
}

export const GET = adminRoute({})
