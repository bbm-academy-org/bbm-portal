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
  // Non-Vercel host: trust the incoming Host/X-Forwarded-Host (dev localhost;
  // the P3 portal host is fronted by Caddy).
  trustHost: true,
  providers: [
    Zitadel({
      clientId: process.env.IDP_CLIENT_ID,
      clientSecret: process.env.IDP_CLIENT_SECRET,
      issuer: process.env.IDP_ISSUER,
    }),
  ],
})
