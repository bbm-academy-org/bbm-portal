/**
 * The platform database's contract, as pure values (#125).
 *
 * Everything that decides WHERE our migrations go and WHAT they are allowed to
 * touch lives here, so `drizzle.config.ts` stays a one-liner and the contract is
 * unit-tested without drizzle-kit running. Separation from Payload — which owns
 * the `cms` database, the `public` schema and `payload_migrations` — is the
 * whole point of the file; see `./README.md` for the pipeline as a whole.
 */
import type { Config } from 'drizzle-kit'

/** The only Postgres schema our pipeline may see or write (spec §4, «Ядро core»). */
export const PLATFORM_SCHEMA = 'core'

/** Table files, one directory per module (see `./schema/README.md`). */
export const PLATFORM_SCHEMA_DIR = './src/lib/platform/db/schema'

/**
 * What drizzle-kit actually reads. A GLOB restricted to `*.ts`, not the bare
 * directory: pointed at a directory, drizzle-kit tries to `require()` every file
 * it finds — including the `README.md` that documents the layout, which crashes
 * `generate` with a SyntaxError on the first heading.
 */
export const PLATFORM_SCHEMA_GLOB = `${PLATFORM_SCHEMA_DIR}/**/*.ts`

/** Our migration output — deliberately NOT Payload's `src/migrations`. */
export const PLATFORM_MIGRATIONS_DIR = './src/lib/platform/db/migrations'

/**
 * Payload's migration directory, named here only so the separation is asserted
 * against a value rather than against a comment.
 */
export const PAYLOAD_MIGRATIONS_DIR = './src/migrations'

/** The env var that carries the platform connection string, everywhere. */
export const PLATFORM_DATABASE_URL_VAR = 'PLATFORM_DATABASE_URL'

/** Our migration bookkeeping table, inside `core` — never next to Payload's. */
export const PLATFORM_MIGRATIONS_TABLE = '__drizzle_migrations'

/** The environment shape this module reads (a plain record, not `process.env`). */
export type PlatformDbEnv = Record<string, string | undefined>

/**
 * `Config` is a union over every dialect drizzle-kit supports, so `dbCredentials`
 * is not readable off it without narrowing. Narrowed here once, to the single
 * shape this repo will ever produce — a postgres config carrying a URL — so both
 * callers and tests can read the fields they are asserting on.
 */
export type PlatformDrizzleConfig = Config & { dbCredentials: { url: string } }

/**
 * Read the platform connection string, or fail loudly.
 *
 * There is deliberately NO fallback to `DATABASE_URL`: that string points at the
 * `cms` database, so a fallback would silently run OUR migrations against
 * Payload's database — a failure that surfaces as damage, not as an error.
 */
export function requirePlatformDatabaseUrl(env: PlatformDbEnv): string {
  const url = env[PLATFORM_DATABASE_URL_VAR]?.trim()
  if (!url) {
    throw new Error(
      `${PLATFORM_DATABASE_URL_VAR} is not set. The platform database is a SEPARATE ` +
        "database from Payload's `cms` (spec 2026-08-04 §4) and has no fallback: set it in " +
        '.env (dev) / deploy/.env.prod (prod) — see deploy/README.md.',
    )
  }
  return url
}

/**
 * The drizzle-kit configuration, derived from the environment. Pure.
 *
 * `schemaFilter` is what keeps `drizzle-kit generate` from proposing DROPs for
 * every table it does not know about: without it, a future pipeline pointed at a
 * database that also holds someone else's schema would generate destructive
 * diffs. Here it also states the intent — `core` is ours, nothing else is.
 */
export function buildPlatformDrizzleConfig(env: PlatformDbEnv): PlatformDrizzleConfig {
  return {
    dialect: 'postgresql',
    schema: PLATFORM_SCHEMA_GLOB,
    out: PLATFORM_MIGRATIONS_DIR,
    schemaFilter: [PLATFORM_SCHEMA],
    migrations: {
      schema: PLATFORM_SCHEMA,
      table: PLATFORM_MIGRATIONS_TABLE,
    },
    dbCredentials: { url: requirePlatformDatabaseUrl(env) },
  }
}
