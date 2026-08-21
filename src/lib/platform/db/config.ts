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

/** The env var that carries the APPLICATION's platform connection string. */
export const PLATFORM_DATABASE_URL_VAR = 'PLATFORM_DATABASE_URL'

/**
 * The env var that carries the MIGRATING role's connection string (#278,
 * EARS-30; ADR-004 A1).
 *
 * Two strings, because they are two privilege echelons and not two spellings of
 * one: `PLATFORM_DATABASE_URL` is the least-privilege role the application pool
 * opens (`client.ts`), and this one is the role that owns `core`, runs
 * `drizzle-kit migrate` and creates databases. A single string cannot express
 * that split, which is exactly why ADR-004 §3's "one connection string" claim is
 * amended rather than reinterpreted.
 */
export const PLATFORM_MIGRATE_DATABASE_URL_VAR = 'PLATFORM_MIGRATE_DATABASE_URL'

/**
 * The privilege GROUP the application role belongs to (#278).
 *
 * Fixed name, unlike the login role, and the distinction is the whole design.
 * The LOGIN identity is per-environment and env-driven — it is a credential, and
 * this estate already carries three different superuser names (`payload` in
 * dev/prod, `postgres` in CI). The GROUP is a schema-level object that migration
 * SQL has to be able to name literally: a `.sql` file takes no parameters, so a
 * grant written against `${SOME_ENV_VAR}` cannot exist. Every environment's app
 * login role is granted membership in this group by
 * `tools/platform/ensure-roles.mjs`, and the grants are written against the
 * group.
 */
export const PLATFORM_APP_ROLE_GROUP = 'platform_app'

/** The privilege group that OWNS `core` and everything in it (#278). See above. */
export const PLATFORM_MIGRATOR_ROLE_GROUP = 'platform_migrator'

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
 * How the migrating connection string was resolved (#278).
 *
 * `split` is the load-bearing field: `true` means the environment really has two
 * roles and the caller is talking to the owner of `core`; `false` means this
 * environment has not been split yet and the caller fell back to the application
 * string. Callers print {@link warning} on a fallback — the fallback is legal but
 * never silent.
 */
export type PlatformMigrateUrlResolution = {
  url: string
  split: boolean
  warning?: string
}

/**
 * Resolve the connection string the MIGRATING side must use (#278, EARS-30).
 *
 * **The fallback semantics, in full**, because "no silent fallback" is a rule
 * about a specific pair of variables and not a slogan:
 *
 * - `PLATFORM_MIGRATE_DATABASE_URL` set → that string, `split: true`. This is the
 *   split estate: dev stand, CI and production all set it, and production's
 *   `verifyRemoteEnv` (ADR-004 §7) refuses a deploy whose `deploy/.env.prod` does
 *   not.
 * - unset, `PLATFORM_DATABASE_URL` set → the application string, `split: false`,
 *   plus a `warning` naming the missing variable. This is the UN-SPLIT estate —
 *   a checkout predating #278, or a throwaway database — where the one role is
 *   still the container superuser and migrating as it is what has always
 *   happened. Refusing here would break every such environment on the merge
 *   commit for no security gain: the fallback cannot bypass a privilege split
 *   that does not exist.
 * - neither set → throw, naming both. There is still no fallback onto
 *   `DATABASE_URL`: that string points at Payload's `cms`.
 *
 * The one case that looks like a hole and is not: a split estate whose
 * `PLATFORM_MIGRATE_DATABASE_URL` is missing falls back to the least-privilege
 * application role, and Postgres then refuses the migration with `permission
 * denied` — loudly, on the object, after the warning has already named the
 * variable. A quiet success is not reachable.
 */
export function resolvePlatformMigrateDatabaseUrl(
  env: PlatformDbEnv,
): PlatformMigrateUrlResolution {
  const migrate = env[PLATFORM_MIGRATE_DATABASE_URL_VAR]?.trim()
  if (migrate) return { url: migrate, split: true }

  const app = env[PLATFORM_DATABASE_URL_VAR]?.trim()
  if (app) {
    return {
      url: app,
      split: false,
      warning:
        `${PLATFORM_MIGRATE_DATABASE_URL_VAR} is not set — migrating as the role in ` +
        `${PLATFORM_DATABASE_URL_VAR}. That is correct ONLY for an environment that has not ` +
        'been split into an application role and a migrating role yet (#278, ADR-004 A1). ' +
        'Split it with `pnpm platform:roles:ensure`.',
    }
  }

  throw new Error(
    `Neither ${PLATFORM_MIGRATE_DATABASE_URL_VAR} nor ${PLATFORM_DATABASE_URL_VAR} is set. ` +
      'The migrating side of the platform pipeline needs a connection string and has no ' +
      "fallback onto DATABASE_URL, which points at Payload's `cms` (ADR-004 §3) — set it in " +
      '.env (dev) / deploy/.env.prod (prod), see deploy/README.md.',
  )
}

/** {@link resolvePlatformMigrateDatabaseUrl}, when only the string is wanted. */
export function requirePlatformMigrateDatabaseUrl(env: PlatformDbEnv): string {
  return resolvePlatformMigrateDatabaseUrl(env).url
}

/**
 * The drizzle-kit configuration, derived from the environment. Pure.
 *
 * `schemaFilter` is what keeps `drizzle-kit generate` from proposing DROPs for
 * every table it does not know about: without it, a future pipeline pointed at a
 * database that also holds someone else's schema would generate destructive
 * diffs. Here it also states the intent — `core` is ours, nothing else is.
 *
 * The credential is the MIGRATING one (#278): drizzle-kit is the tool that
 * creates and alters the objects of `core`, so it connects as the role that owns
 * them, never as the application's least-privilege role.
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
    dbCredentials: { url: requirePlatformMigrateDatabaseUrl(env) },
  }
}
