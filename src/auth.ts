import NextAuth from 'next-auth'
import Zitadel from 'next-auth/providers/zitadel'

import {
  ZITADEL_ROLES_CLAIM,
  normalizeRolesClaim,
  rolesClaimStamped,
} from '@/lib/platform/authGate'

/**
 * Auth.js (next-auth v5) — the in-app OIDC session for the BBM Platform surface
 * (spec 059 req.4, owner decision 2026-07-24: in-app BFF, not oauth2-proxy).
 *
 * Single provider: the Zitadel dev IdP stood up by P2a (PR #71). Config is read
 * from the repo-root `.env` (IDP_* contract, spec 059 req.5); the client secret
 * and AUTH_SECRET live on the box / in the gitignored `.env`, never committed.
 *
 * Session strategy is the default JWT — the session cookie is httpOnly and no
 * OIDC tokens are exposed to the client beyond what Auth.js manages. Payload
 * native auth (the `users` collection) is unaffected; it stays admin-only.
 *
 * Callback URL: the next-auth default `/<basePath>/callback/zitadel`
 * = `/api/auth/callback/zitadel`. The dev Zitadel client registers this URI
 * (infra/dev-stand/idp/provision.sh); a fresh stand re-run picks it up.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Origin handling (spec 060 req.5): `trustHost` is deliberately NOT set.
  // Auth.js v5 then defaults it from the environment (@auth/core
  // setEnvDefaults): truthy when AUTH_URL is set OR NODE_ENV !== 'production'.
  //   - Prod (portal-prod-tw, behind Caddy): AUTH_URL=
  //     https://portal.bbm.academy/api/auth is REQUIRED — createActionURL
  //     builds every sign-in/callback/redirect URL from AUTH_URL and ignores
  //     the incoming Host/X-Forwarded-Host entirely, so the origin is fixed by
  //     config, not by trusting request headers. Without AUTH_URL a prod
  //     build fails closed (UntrustedHost error), never open.
  //   - Dev (localhost, no AUTH_URL): NODE_ENV !== 'production' keeps host
  //     inference on — unchanged dev ergonomics.
  providers: [
    Zitadel({
      clientId: process.env.IDP_CLIENT_ID,
      clientSecret: process.env.IDP_CLIENT_SECRET,
      issuer: process.env.IDP_ISSUER,
      // Scope is requested EXPLICITLY (spec 081 req.8): the hours module
      // identifies a participant by the session's email claim, and an email
      // that is merely "usually there by default" is not something a payout
      // mechanic may rest on. The OKR gate never needed the claim, so nothing
      // here was pinned before. The change is group-wide — the OKR login is
      // re-checked on acceptance. `email_verified` is deliberately NOT required:
      // this is a corporate IdP whose accounts the owner creates himself.
      authorization: { params: { scope: 'openid profile email' } },
    }),
  ],
  callbacks: {
    // Spec 311 EARS-415: the workspace roles are read from Zitadel's project
    // roles claim and surfaced on the session, which is what every gate in
    // `src/lib/platform/authGate.ts` reads. Zitadel emits the claim only
    // because the project carries `projectRoleAssertion:true` and the member
    // holds a user grant on it (infra/dev-stand/idp/provision.sh steps 1, 2, 8).
    //
    // `profile` is present only on the sign-in pass; on every later pass the
    // roles ride the existing token. That is EARS-460 exactly — a granted role
    // takes effect for that member on their NEXT SESSION, with no redeploy.
    // The other direction (EARS-459, a revoke landing on the next REQUEST) is
    // NOT what a claim carried in a session cookie does, and is deliberately
    // not faked here; it is tracked as its own decision, see the PR of #313.
    jwt({ token, profile }) {
      if (profile) {
        token.roles = normalizeRolesClaim((profile as Record<string, unknown>)[ZITADEL_ROLES_CLAIM])
      }
      return token
    },
    session({ session, token }) {
      // Fail closed: a token with no readable roles yields an empty set, never
      // an absent field a downstream check could read as "not applicable".
      session.user.roles = normalizeRolesClaim(token.roles)
      // …but "read and empty" and "never read" are different facts, and only
      // the token's shape carries the difference. Sessions minted before this
      // build have no `roles` field at all: the strategy is the default JWT
      // with the default 30-day maxAge and no adapter, so on the deploy of the
      // gate every already-signed-in member of the live workspace arrives with
      // such a token. `resolveClaimGate` sends exactly those through sign-in
      // once — the pass above always stamps the field — instead of into the
      // bare 403 of EARS-418, which is meant for an account the IdP grants
      // nothing, not for a cookie older than the feature.
      session.user.rolesClaimAbsent = !rolesClaimStamped(token)
      return session
    },
  },
})
