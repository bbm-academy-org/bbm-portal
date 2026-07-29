import NextAuth from 'next-auth'
import Zitadel from 'next-auth/providers/zitadel'

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
})
