// bbm-portal — the `.mjs` mirror of `src/lib/platform/db/config.ts` (#278).
//
// Everything here is specified ONCE, in that TypeScript module: the two
// connection-string variables, the fallback semantics of the migrating one, and
// the two privilege GROUP names with the reasoning for why a group name is fixed
// while a login name is env-driven. This file exists because the `pnpm
// platform:*` tools are plain `.mjs` run by `node` and cannot import a `.ts`
// module — and `tests/unit/platform-config-mirror.spec.ts` imports BOTH and runs
// them over the same table of environments, so the copy cannot drift in silence.

export const PLATFORM_DATABASE_URL_VAR = 'PLATFORM_DATABASE_URL'
export const PLATFORM_MIGRATE_DATABASE_URL_VAR = 'PLATFORM_MIGRATE_DATABASE_URL'
export const APP_ROLE_GROUP = 'platform_app'
export const MIGRATOR_ROLE_GROUP = 'platform_migrator'

export function resolveMigrateDatabaseUrl(env) {
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

/** Resolve and, on a fallback, say so on stderr. The fallback is legal, never silent. */
export function resolveMigrateDatabaseUrlLoudly(env, warn = (msg) => process.stderr.write(msg)) {
  const resolution = resolveMigrateDatabaseUrl(env)
  if (resolution.warning) warn(`  ! ${resolution.warning}\n`)
  return resolution.url
}
