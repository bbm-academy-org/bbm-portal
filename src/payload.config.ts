import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { PublicProjects } from './collections/PublicProjects'
import { Team } from './collections/Team'
import { Pages } from './collections/Pages'
import { Leads } from './collections/Leads'
import { Philosophy } from './globals/Philosophy'
import { Contact } from './globals/Contact'
import { SiteChrome } from './globals/SiteChrome'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Origins of the public site allowed to POST leads cross-origin to /api/leads.
// Comma-split from env so prod scopes it to the real RF-contour site origin(s);
// empty in dev (same-origin) means no cross-origin access is granted.
const siteOrigins = (process.env.PUBLIC_SITE_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  // Allow the public site's browser origin to POST leads cross-origin to
  // /api/leads. Only CORS is scoped here — the lead create is unauthenticated,
  // so CSRF (which only gates cookie-bearing requests) is irrelevant to it.
  // `csrf` is left at its default ([]) on purpose: listing the public site
  // there would wrongly trust it as an authenticated-cookie origin.
  cors: siteOrigins,
  collections: [Users, Media, PublicProjects, Team, Pages, Leads],
  globals: [Philosophy, Contact, SiteChrome],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    // Migrations are the single source of truth for the schema (decision #2:
    // Payload owns the dedicated `cms` database and runs its own migrations).
    // `push: false` disables dev schema auto-push so even local dev applies the
    // committed migrations — no dev/prod schema drift. Run `pnpm migrate` before
    // `pnpm dev`; generate a new migration with `pnpm migrate:create` after any
    // collection/global change.
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  sharp,
  plugins: [
    // Media → Timeweb Object Storage (decision #3): S3-compatible, account-level
    // keys, path-style addressing. Gated on S3_BUCKET so local dev without keys
    // keeps falling back to disk; production sets the env and serves from S3.
    s3Storage({
      enabled: Boolean(process.env.S3_BUCKET),
      collections: {
        // disablePayloadAccessControl → media URLs are the direct public-bucket
        // URLs (s3.twcstorage.ru/<bucket>/<key>), not proxied through this app.
        // The bucket is public-read, so the public site loads images straight
        // from object storage (CDN history) instead of through the portal.
        media: {
          disablePayloadAccessControl: true,
        },
      },
      bucket: process.env.S3_BUCKET || '',
      config: {
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION,
        // Timeweb addresses buckets by path (s3.twcstorage.ru/<bucket>/<key>),
        // not by virtual-host subdomain — required for non-AWS S3.
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        },
      },
    }),
  ],
})
