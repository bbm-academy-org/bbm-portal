import type { Access, CollectionConfig, PayloadRequest } from 'payload'

// Single implicit-admin model (BBMP-29): every authenticated user is a full
// admin. No roles field yet — SSO + a roles model are a deferred follow-up
// (pattern OQ-F12), so access is binary "is there a logged-in user".
//
// Payload bypasses access control entirely while zero users exist, so the
// first-user bootstrap (the /admin "create first user" screen and the
// `seed:admin` script) still works on an empty DB despite these guards.
const isAuthenticated: Access = ({ req }) => Boolean(req.user)

// The `admin` panel-access control has its own narrower signature ({ req })
// than the data `Access` type, so it gets its own typed function.
const canAccessAdmin = ({ req }: { req: PayloadRequest }): boolean => Boolean(req.user)

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  // `useAPIKey` adds an opt-in per-user API key (off by default on each user)
  // so the SSR live-preview origin can read drafts server-to-server without an
  // admin session (epic #13 / bbm-public-website#114). The preview container
  // sends the key as the full `Authorization` header `users API-Key <key>`
  // (contract: bbm-public-website src/preview/draft-source.ts). `push: false`,
  // so this adds the `enable_a_p_i_key`/`api_key`/`api_key_index` columns via a
  // committed migration — without it, key auth breaks on prod.
  auth: {
    useAPIKey: true,
  },
  // Lock the users collection down: by default Payload exposes it world-
  // readable/writable over REST, a real gap for a public prod instance.
  access: {
    admin: canAccessAdmin,
    read: isAuthenticated,
    create: isAuthenticated,
    update: isAuthenticated,
    delete: isAuthenticated,
  },
  fields: [
    // Email added by default
    // Add more fields as needed
  ],
}
