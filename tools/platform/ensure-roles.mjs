#!/usr/bin/env node
// bbm-portal — `pnpm platform:roles:ensure`: provision the platform's two
// Postgres roles and hand `core` over to the migrating one (#278, spec 201
// EARS-30, ADR-004 A1).
//
// WHY THIS IS A TOOL AND NOT A MIGRATION. A migration runs as the migrating
// role, and a non-superuser can neither `CREATE ROLE` nor take ownership of
// objects a superuser owns. Role creation is therefore provisioning — run
// deliberately, as the superuser, once per environment — exactly the way
// ADR-004 §5 already puts `CREATE DATABASE` in code rather than in compose.
// Compose's `/docker-entrypoint-initdb.d` was the alternative and is worse here:
// those scripts run only on a FRESH data directory, so every stand that already
// has a `pgdata` volume — which is all of them — would need a hand-run anyway,
// and the estate would carry two provisioning paths that drift.
//
// WHAT IT DOES NOT DO. It writes no grants of its own. The grants and the
// ownership of `core` live in ONE place, the migration
// `src/lib/platform/db/migrations/0007_platform_least_privilege.sql`, and this
// tool's second phase EXECUTES THAT FILE rather than restating it — a second
// copy of a REVOKE list is the copy that drifts. On a fresh database drizzle
// applies it; on an estate that already carried `core` before the split, that
// same file has to run as the superuser once (the migrator cannot re-own a
// superuser's tables), which is what phase 2 is for.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { MAINTENANCE_DATABASE, deriveMaintenanceTarget } from './ensure-database.mjs'
import { loadPlatformToolEnv } from './load-env.mjs'
import { APP_ROLE_GROUP, MIGRATOR_ROLE_GROUP } from './platform-config.mjs'

export { APP_ROLE_GROUP, MIGRATOR_ROLE_GROUP }

/** The superuser connection this tool needs — the only privilege that can split roles. */
export const SUPERUSER_URL_VAR = 'PLATFORM_SUPERUSER_DATABASE_URL'

/** The migration whose body IS the grant contract (see the file header). */
export const LEAST_PRIVILEGE_MIGRATION =
  'src/lib/platform/db/migrations/0007_platform_least_privilege.sql'

const ROLE_NAME_RE = /^[a-z_][a-z0-9_]*$/

/** SQL identifier quoting — role names never reach DDL unquoted. */
export function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

/**
 * SQL literal quoting, for the one value that cannot be a bind parameter: a
 * password in `CREATE ROLE … PASSWORD`. `standard_conforming_strings` is on by
 * default in every Postgres this estate runs, so doubling the single quote is
 * the whole escape.
 */
export function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * The login role a connection string carries. Pure.
 *
 * The credentials are read OUT of the two connection strings rather than
 * duplicated into their own `PLATFORM_*_ROLE` variables: the role this tool
 * creates and the role the application connects as then cannot drift apart, and
 * an environment names its identities in exactly one place.
 */
export function parseRoleCredentials(connectionString, varName) {
  let url
  try {
    url = new URL(String(connectionString ?? '').trim())
  } catch {
    throw new Error(`${varName} is not a URL`)
  }
  const role = decodeURIComponent(url.username || '')
  const password = decodeURIComponent(url.password || '')
  if (!role) throw new Error(`${varName} carries no user name — it cannot name a role to create`)
  if (!ROLE_NAME_RE.test(role)) {
    throw new Error(
      `${varName} names the role ${JSON.stringify(role)}, which is not a plain lower-case ` +
        'identifier; refusing to put it into DDL',
    )
  }
  if (!password) {
    throw new Error(`${varName} carries no password — a LOGIN role without one cannot connect`)
  }
  return { role, password }
}

/**
 * Refuse the two configurations that would silently produce no privilege split
 * at all. Pure.
 */
export function assertDistinctRoles(app, migrator) {
  if (app.role === migrator.role) {
    throw new Error(
      `the application and migrating connection strings name the SAME role (${app.role}). ` +
        'A split that is one role is not a split — give them different users.',
    )
  }
  for (const { role } of [app, migrator]) {
    if (role === APP_ROLE_GROUP || role === MIGRATOR_ROLE_GROUP) {
      throw new Error(
        `refusing to create a LOGIN role named ${role}: that is a privilege GROUP name. ` +
          'The group must stay NOLOGIN, or owning it would hand out a login.',
      )
    }
  }
  return true
}

/**
 * The role a connection string logs in as, or `null` when the string is absent
 * or not a URL. Deliberately total: this is used by the guard below, and a guard
 * that throws on an unrelated malformed variable would be a guard operators
 * learn to work around.
 */
function roleOf(connectionString) {
  try {
    return decodeURIComponent(new URL(String(connectionString ?? '').trim()).username || '') || null
  } catch {
    return null
  }
}

/**
 * Refuse to provision a role that some OTHER live connection already logs in as.
 * Pure — it decides on the strings alone, so the refusal happens before this tool
 * opens anything.
 *
 * WHY THIS IS FAIL-CLOSED AND NOT A PARAGRAPH IN THE RUNBOOK. `createLogin()` is
 * a no-op for a role that exists, so the two `ALTER ROLE` statements below land
 * on whatever role the string names — including one that was never meant to be a
 * target. On this estate `PLATFORM_DATABASE_URL` named the container superuser
 * (`payload` in dev and prod, `postgres` in CI) until the operator edited it, and
 * that role is the cluster's ONLY superuser and the one behind Payload's
 * `DATABASE_URL`. Running this tool before that edit, or re-running it from a
 * checkout whose env predates #278, would rotate that superuser's password and
 * then strip SUPERUSER from the only role that could grant it back — recovery is
 * single-user-mode surgery, not a command. Hence: the two steps of the runbook
 * are safe in EITHER order, and a stale env is a refusal rather than an outage.
 */
export function assertTargetsAreNotOperationalRoles({ app, migrator }, connections = []) {
  const targets = new Map([
    [app.role, 'PLATFORM_DATABASE_URL'],
    [migrator.role, 'PLATFORM_MIGRATE_DATABASE_URL'],
  ])
  for (const { varName, url } of connections) {
    const role = roleOf(url)
    if (!role || !targets.has(role)) continue
    throw new Error(
      `${targets.get(role)} names the role ${JSON.stringify(role)}, which is also the login of ` +
        `${varName}. This tool would ALTER that role's password and strip its attributes ` +
        '(NOCREATEDB NOCREATEROLE NOSUPERUSER) — on the container superuser that is not ' +
        'recoverable from SQL. Give the platform its OWN two roles first (see the runbook ' +
        '«Splitting the platform roles» in deploy/README.md), then re-run.',
    )
  }
  return true
}

/**
 * The same refusal for the case the strings cannot see: a target role that
 * ALREADY exists and is a superuser. Asked of the catalog, which is the only
 * place that knows.
 */
export async function assertNoPreexistingSuperuser(client, roles) {
  const { rows } = await client.query(
    'SELECT rolname FROM pg_roles WHERE rolsuper AND rolname = ANY($1::text[])',
    [roles],
  )
  const supers = (rows ?? []).map((row) => row?.rolname).filter(Boolean)
  if (supers.length) {
    throw new Error(
      `refusing to touch ${supers.join(', ')}: the role already exists and is a SUPERUSER. ` +
        'Provisioning would rotate its password and strip SUPERUSER from it, which cannot be ' +
        'undone without single-user mode. Point the platform strings at their own roles.',
    )
  }
  return true
}

/**
 * Every statement phase 1 runs, in order. Pure, so the whole provisioning
 * contract is unit-testable without a cluster.
 *
 * `ALTER ROLE <migrator login> SET role = platform_migrator` is the quiet
 * load-bearing line: with it, every object a migration creates is owned by the
 * GROUP rather than by that environment's login name, so `ALTER DEFAULT
 * PRIVILEGES FOR ROLE platform_migrator` keeps applying to tables added by
 * future migrations, in every environment, without any of them naming a
 * credential.
 */
export function buildRoleProvisioningStatements({ app, migrator, database }) {
  const appRole = quoteIdentifier(app.role)
  const migratorRole = quoteIdentifier(migrator.role)
  const appGroup = quoteIdentifier(APP_ROLE_GROUP)
  const migratorGroup = quoteIdentifier(MIGRATOR_ROLE_GROUP)

  const createGroup = (name) =>
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(name)}) ` +
    `THEN EXECUTE 'CREATE ROLE ${quoteIdentifier(name)} NOLOGIN'; END IF; END $$`

  // Created bare and given the password by the ALTER below, so the password
  // appears in exactly one statement and the CREATE stays a plain existence check.
  const createLogin = ({ role }) =>
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) ` +
    `THEN EXECUTE 'CREATE ROLE ${quoteIdentifier(role)} LOGIN'; END IF; END $$`

  const statements = [
    createGroup(APP_ROLE_GROUP),
    createGroup(MIGRATOR_ROLE_GROUP),
    createLogin(app),
    createLogin(migrator),
    `ALTER ROLE ${appRole} LOGIN PASSWORD ${quoteLiteral(app.password)}`,
    `ALTER ROLE ${migratorRole} LOGIN PASSWORD ${quoteLiteral(migrator.password)}`,
    `GRANT ${appGroup} TO ${appRole}`,
    `GRANT ${migratorGroup} TO ${migratorRole}`,
    // The migrating side creates databases (ADR-004 §5's ensure step, and the
    // per-worktree branch DB of `dev:db:branch`); the application side must not.
    // Granted to BOTH: role ATTRIBUTES are not inherited through membership, so
    // the group's CREATEDB only reaches the login role through the `SET role`
    // below — and the direct grant keeps the tooling working if that default is
    // ever overridden on a session.
    `ALTER ROLE ${migratorGroup} CREATEDB`,
    `ALTER ROLE ${migratorRole} CREATEDB`,
    `ALTER ROLE ${appRole} NOCREATEDB NOCREATEROLE NOSUPERUSER`,
    `ALTER ROLE ${migratorRole} SET role = ${quoteIdentifier(MIGRATOR_ROLE_GROUP)}`,
    // Never the other way round: an application role that inherited the owner
    // group would bypass every REVOKE this whole issue exists to write.
    `REVOKE ${migratorGroup} FROM ${appRole}`,
  ]

  if (database) {
    const db = quoteIdentifier(database)
    statements.push(
      `ALTER DATABASE ${db} OWNER TO ${migratorGroup}`,
      `GRANT CONNECT ON DATABASE ${db} TO ${appGroup}`,
    )
  }
  return statements
}

/** What is safe to print. Passwords never reach stdout, masked or otherwise. */
export function formatRolesOutcome({ app, migrator, database, grantsApplied }) {
  return [
    `  ✓ application role ${app} → member of ${APP_ROLE_GROUP}`,
    `  ✓ migrating role   ${migrator} → member of ${MIGRATOR_ROLE_GROUP} (owner of core)`,
    grantsApplied
      ? `  ✓ ${LEAST_PRIVILEGE_MIGRATION} applied to ${database}`
      : `  ✓ ${database} carries no \`core\` schema yet — \`pnpm platform:migrate\` will apply the grants`,
  ].join('\n')
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

export function readLeastPrivilegeSql(root = repoRoot()) {
  return readFileSync(resolve(root, LEAST_PRIVILEGE_MIGRATION), 'utf8')
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
}

export async function ensureRoles(
  { superuserUrl, appUrl, migrateUrl, otherUrls = [] },
  { Client, sqlStatements } = {},
) {
  const app = parseRoleCredentials(appUrl, 'PLATFORM_DATABASE_URL')
  const migrator = parseRoleCredentials(migrateUrl, 'PLATFORM_MIGRATE_DATABASE_URL')
  assertDistinctRoles(app, migrator)
  assertTargetsAreNotOperationalRoles({ app, migrator }, [
    { varName: SUPERUSER_URL_VAR, url: superuserUrl },
    ...otherUrls,
  ])

  const target = deriveMaintenanceTarget(appUrl)
  if (!target.ok) throw new Error(target.error)
  const migrateTarget = deriveMaintenanceTarget(migrateUrl)
  if (!migrateTarget.ok) throw new Error(migrateTarget.error)
  if (migrateTarget.database !== target.database || migrateTarget.host !== target.host) {
    throw new Error(
      `the two connection strings point at different databases (${target.host}/${target.database} ` +
        `vs ${migrateTarget.host}/${migrateTarget.database}). They are two ROLES on one database, ` +
        'not two databases.',
    )
  }

  // Phase 1 is cluster-level (CREATE ROLE, ALTER DATABASE) and must NOT connect
  // to the target database: on a fresh environment that database does not exist
  // yet, and splitting the roles is exactly what has to happen BEFORE it is
  // created. So the superuser string is used for its credentials and host only;
  // the connection goes to the maintenance database, the same way the ensure step
  // reaches CREATE DATABASE.
  const adminUrl = new URL(superuserUrl)
  adminUrl.pathname = `/${MAINTENANCE_DATABASE}`

  const ClientImpl = Client ?? (await import('pg')).Client
  const admin = new ClientImpl({ connectionString: adminUrl.toString() })
  await admin.connect()
  let databaseExists = false
  try {
    // Before the first ALTER, and while holding the one connection that can see
    // the catalog: a target role that already exists as a SUPERUSER is refused.
    await assertNoPreexistingSuperuser(admin, [app.role, migrator.role])
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      target.database,
    ])
    databaseExists = rowCount > 0
    for (const statement of buildRoleProvisioningStatements({
      app,
      migrator,
      database: databaseExists ? target.database : null,
    })) {
      await admin.query(statement)
    }
  } finally {
    await admin.end()
  }

  // Phase 2 — the grants, inside the target database, as the superuser. Only
  // needed for a database that already carried `core` before the split; a fresh
  // one gets the same file from drizzle a moment later.
  let grantsApplied = false
  if (databaseExists) {
    const inDb = new URL(superuserUrl)
    inDb.pathname = `/${target.database}`
    const client = new ClientImpl({ connectionString: inDb.toString() })
    await client.connect()
    try {
      const { rowCount } = await client.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'core'",
      )
      if (rowCount > 0) {
        for (const statement of sqlStatements ?? readLeastPrivilegeSql()) {
          await client.query(statement)
        }
        grantsApplied = true
      }
    } finally {
      await client.end()
    }
  }

  return {
    app: app.role,
    migrator: migrator.role,
    database: target.database,
    grantsApplied,
  }
}

async function main() {
  loadPlatformToolEnv()
  const superuserUrl = process.env[SUPERUSER_URL_VAR]?.trim()
  if (!superuserUrl) {
    throw new Error(
      `${SUPERUSER_URL_VAR} is not set. Splitting roles is the one operation that needs the ` +
        'container superuser (the POSTGRES_USER of the compose file) — it creates roles and ' +
        'takes ownership of objects the superuser owns. It is deliberately NOT the ' +
        'application or migrating string.',
    )
  }
  const appUrl = process.env.PLATFORM_DATABASE_URL?.trim()
  const migrateUrl = process.env.PLATFORM_MIGRATE_DATABASE_URL?.trim()
  if (!appUrl || !migrateUrl) {
    throw new Error(
      'both PLATFORM_DATABASE_URL (the application role) and PLATFORM_MIGRATE_DATABASE_URL ' +
        '(the migrating role) must be set: this tool creates exactly the two roles those ' +
        'strings name, so a missing one has no role to create.',
    )
  }

  // Every other connection string this box is known to use, so that a target
  // role which is somebody else's service account is refused by name rather than
  // demoted. Payload's `DATABASE_URL` is the one that matters on this estate: in
  // dev and prod it is the same `payload` superuser the platform used to borrow.
  const otherUrls = [{ varName: 'DATABASE_URL', url: process.env.DATABASE_URL }]

  const outcome = await ensureRoles({ superuserUrl, appUrl, migrateUrl, otherUrls })
  console.log(formatRolesOutcome(outcome))
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main().catch((err) => {
    console.error(`\n✗ platform:roles:ensure FAILED: ${err?.message ?? String(err)}`)
    process.exit(1)
  })
}
