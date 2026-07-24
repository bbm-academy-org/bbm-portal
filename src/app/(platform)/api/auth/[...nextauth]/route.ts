import { handlers } from '@/auth'

// Auth.js route handler — sign-in / callback / signout / session, mounted at
// /api/auth/* (next-auth default basePath). Lives in the (platform) group as a
// platform concern; the more specific /api/auth/* segments win over Payload's
// /api/[...slug] catch-all (src/app/(payload)/api).
export const { GET, POST } = handlers
