import type { DefaultSession } from 'next-auth'
import 'next-auth/jwt'

/**
 * The workspace roles on the Auth.js session (spec 311 EARS-415).
 *
 * Declared here rather than cast at every read: `session.user.roles` is the
 * single input of every gate in `src/lib/platform/authGate.ts`, and a gate
 * whose input is an `any` is a gate a refactor can silently open. The values
 * are the Zitadel project roles of `urn:zitadel:iam:org:project:roles`; the
 * type is `string[]` and not `PlatformRole[]` on purpose — the IdP is free to
 * carry a role this build has never heard of (EARS-466), and narrowing here
 * would make that a type error instead of what it is: a claim nothing grants.
 */
declare module 'next-auth' {
  interface User {
    roles?: string[]
  }
  interface Session {
    user: {
      roles: string[]
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    roles?: string[]
  }
}
