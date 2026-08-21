#!/usr/bin/env node
// bbm-portal — `pnpm platform:db:ensure`: create the `platform` database if it
// is missing, idempotently (#125).

import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { loadPlatformToolEnv } from './load-env.mjs'
import { MIGRATOR_ROLE_GROUP, resolveMigrateDatabaseUrlLoudly } from './platform-config.mjs'

export const MAINTENANCE_DATABASE = 'postgres'
export const PAYLOAD_DATABASE = 'cms'
export const PLATFORM_DATABASE = 'platform'
export const BRANCH_DATABASE_RE = /^platform_([1-9][0-9]*)$/

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/

// DDL cannot bind identifiers as parameters; every database name must pass this
// regex before it can reach CREATE/DROP.
export function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

export function deriveMaintenanceTarget(connectionString) {
  const raw = typeof connectionString === 'string' ? connectionString.trim() : ''
  if (!raw) {
    return { ok: false, error: 'the platform connection string is empty' }
  }

  let url
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: `not a URL: ${raw}` }
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return {
      ok: false,
      error: `expected a postgres:// connection string, got ${url.protocol}//…`,
    }
  }

  // Keep pathname encoding intact: a name that needed decoding is not a plain
  // identifier and must fail closed below.
  const database = url.pathname.replace(/^\//, '')
  if (!database) {
    return { ok: false, error: `no database name in the connection string (${raw})` }
  }
  if (!IDENTIFIER_RE.test(database)) {
    return {
      ok: false,
      error: `refusing to create a database whose name is not a plain identifier: ${JSON.stringify(database)}`,
    }
  }

  // Case-insensitive refusal is intentional: quoted "CMS" would be distinct in
  // Postgres, but this tool's contract is to never name Payload's DB in DDL.
  const normalized = database.toLowerCase()
  if (normalized === MAINTENANCE_DATABASE) {
    return {
      ok: false,
      error:
        `the connection string points at the maintenance database \`${MAINTENANCE_DATABASE}\` — ` +
        'it always exists, so this is a misconfigured PLATFORM_DATABASE_URL, not a bootstrap',
    }
  }
  if (normalized === PAYLOAD_DATABASE) {
    return {
      ok: false,
      error:
        `the connection string points at \`${PAYLOAD_DATABASE}\`, Payload's own database. The ` +
        'platform pipeline never touches it (spec 2026-08-04 §4) — check PLATFORM_DATABASE_URL.',
    }
  }

  // Swap only the path, preserving credentials, port and query params such as
  // sslmode; rebuilding URLs is how maintenance connections silently drift.
  const maintenance = new URL(url.toString())
  maintenance.pathname = `/${MAINTENANCE_DATABASE}`
  return {
    ok: true,
    database,
    host: url.host,
    maintenanceUrl: maintenance.toString(),
  }
}

export function formatEnsureOutcome({ database, created, host }) {
  return created
    ? `  ✓ database ${database} CREATED on ${host}`
    : `  ✓ database ${database} already exists on ${host} — nothing to do`
}

export function assertDroppableBranchDatabaseName(database, taskId) {
  const task = String(taskId ?? '').trim()
  const match = BRANCH_DATABASE_RE.exec(String(database ?? ''))
  if (!match || match[1] !== task) {
    throw new Error(
      `refusing to drop database ${JSON.stringify(database)}: only platform_<numeric-task-id> ` +
        `derived from this worktree (${task || 'missing task id'}) may be dropped`,
    )
  }
  return true
}

export function formatDropOutcome({ database, existed, host }) {
  return existed
    ? `  ✓ database ${database} DROPPED on ${host}`
    : `  ✓ database ${database} already absent on ${host} — nothing to do`
}

export async function ensureDatabase(connectionString, { Client } = {}) {
  const target = deriveMaintenanceTarget(connectionString)
  if (!target.ok) throw new Error(target.error)

  const ClientImpl = Client ?? (await import('pg')).Client
  const client = new ClientImpl({ connectionString: target.maintenanceUrl })
  await client.connect()
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      target.database,
    ])
    const created = rowCount === 0
    // This is the full live scope of the ensure seam: one optional CREATE
    // DATABASE, no schemas and no migrations.
    //
    // `OWNER platform_migrator` when that privilege group exists (#278): a
    // database created without it belongs to whichever login role happened to
    // run the ensure step, and every environment would then hold `core` under a
    // different owner name. Absent group → the single-role estate, and the
    // plain CREATE is still correct there.
    if (created) {
      const { rowCount: hasGroup } = await client.query(
        'SELECT 1 FROM pg_roles WHERE rolname = $1',
        [MIGRATOR_ROLE_GROUP],
      )
      await client.query(
        hasGroup > 0
          ? `CREATE DATABASE ${quoteIdentifier(target.database)} OWNER ${quoteIdentifier(MIGRATOR_ROLE_GROUP)}`
          : `CREATE DATABASE ${quoteIdentifier(target.database)}`,
      )
    }
    return { database: target.database, created, host: target.host }
  } finally {
    await client.end()
  }
}

export async function dropBranchDatabase(connectionString, taskId, { Client } = {}) {
  const target = deriveMaintenanceTarget(connectionString)
  if (!target.ok) throw new Error(target.error)
  // Drop is narrower than ensure: only the exact branch DB derived from the task
  // id can pass, never shared `platform` and never Payload `cms`.
  assertDroppableBranchDatabaseName(target.database, taskId)

  const ClientImpl = Client ?? (await import('pg')).Client
  const client = new ClientImpl({ connectionString: target.maintenanceUrl })
  await client.connect()
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      target.database,
    ])
    const existed = rowCount > 0
    if (existed) {
      await client.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [target.database],
      )
      await client.query(`DROP DATABASE ${quoteIdentifier(target.database)}`)
    }
    return { database: target.database, existed, host: target.host }
  } finally {
    await client.end()
  }
}

async function main() {
  loadPlatformToolEnv()
  // CREATE DATABASE is DDL, so this step runs as the MIGRATING role (#278) — the
  // application role is deliberately NOCREATEDB.
  const connectionString = resolveMigrateDatabaseUrlLoudly(process.env)
  const target = deriveMaintenanceTarget(connectionString)
  if (!target.ok) {
    console.error(
      `\n✗ platform:db:ensure FAILED: ${target.error}\n` +
        '  PLATFORM_MIGRATE_DATABASE_URL (falling back to PLATFORM_DATABASE_URL) is the\n' +
        "  platform database connection string — a SEPARATE database from Payload's `cms`.\n" +
        '  See deploy/README.md and .env.example.',
    )
    process.exit(1)
  }

  const outcome = await ensureDatabase(connectionString)
  console.log(formatEnsureOutcome(outcome))
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = resolve(fileURLToPath(import.meta.url))
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main().catch((err) => {
    console.error(`\n✗ platform:db:ensure FAILED: ${err?.message ?? String(err)}`)
    process.exit(1)
  })
}
