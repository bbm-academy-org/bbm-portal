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
  auth: true,
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
