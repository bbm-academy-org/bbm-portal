import { encode } from 'next-auth/jwt'
import type { BrowserContext } from '@playwright/test'

/**
 * Mint an Auth.js session cookie for a stand, without the IdP.
 *
 * **Why this rather than `signInThroughZitadel`.** A test about WHO IS REFUSED
 * has to control the refused party's roles exactly. Driving the dev Zitadel
 * gives whatever roles that account happens to hold — `bbm-test` holds
 * `platform-admin` plus both finance flow roles after `provision.sh` step 8, so
 * it is the wrong witness by construction, and a second account with exactly
 * `platform-user` is an IdP fixture nobody has provisioned. Minting the cookie
 * states the session under test in one line and needs no credentials at all,
 * which also means the flow runs on a bare stand and in CI rather than being
 * skipped.
 *
 * **What it does NOT weaken.** The cookie is signed and encrypted with the
 * stand's own `AUTH_SECRET`, so the server validates it exactly as it validates
 * a real one; everything downstream — `auth()`, the claim gate, the module's
 * EARS-523 join — runs untouched. What is skipped is the OIDC round trip, which
 * `tests/e2e/platform-claim-gate.e2e.spec.ts` covers on its own.
 *
 * `roles` becomes the token's `roles` field, which is what `src/auth.ts` reads
 * in its `session` callback — and stamping it is also what keeps the session out
 * of the legacy-cookie branch of `resolveClaimGate`.
 */
export async function signInAsPlatformMember(
  context: BrowserContext,
  baseURL: string,
  member: { email: string; name?: string; roles: string[] },
): Promise<void> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set — cannot mint a session for this stand')

  const url = new URL(baseURL)
  // Auth.js picks the `__Secure-` name on https and the bare one on http; the
  // cookie name is ALSO the encryption salt, so the two must agree.
  const cookieName =
    url.protocol === 'https:' ? '__Secure-authjs.session-token' : 'authjs.session-token'

  const token = await encode({
    token: {
      email: member.email,
      name: member.name ?? member.email,
      sub: member.email,
      roles: member.roles,
    },
    secret,
    salt: cookieName,
    maxAge: 60 * 30,
  })

  await context.addCookies([
    {
      name: cookieName,
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
    },
  ])
}
