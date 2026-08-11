#!/usr/bin/env node
// bbm-portal — `pnpm platform:db:ensure`: create the `platform` database if it
// is missing, idempotently (#125).
//
//   pnpm platform:db:ensure          create it if absent, then exit
//   pnpm platform:migrate            runs this first, then drizzle-kit migrate
//
// WHY this exists rather than a compose change. The `platform` database lives in
// the SAME Postgres instance as `cms` (spec 2026-08-04 §4), and a Postgres
// container creates exactly one database from POSTGRES_DB — the second one has
// to be created by somebody. The dev Zitadel already solves it the same way: it
// connects as the superuser and creates its own `zitadel` database on first
// boot. Doing it here means dev and prod bootstrap through ONE code path, and a
// fresh `pgdata` volume needs no hand-run psql on either side.
//
// FAIL-CLOSED and narrow on purpose. It connects to the maintenance database
// derived from PLATFORM_DATABASE_URL, runs at most one `CREATE DATABASE`, and
// refuses every input where that could mean something else: a non-postgres
// scheme, a missing database name, a name that is not a plain identifier, the
// maintenance database itself, or `cms` — Payload's database, which this tool
// must never so much as name in a DDL statement.
//
// It never drops, never migrates and never touches a schema; `drizzle-kit
// migrate` owns everything from `CREATE SCHEMA "core"` onwards.

import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The database every Postgres server has, used only to issue CREATE DATABASE. */
export const MAINTENANCE_DATABASE = 'postgres'

/** Payload's database. Naming it here is always a mistake — see the header. */
export const PAYLOAD_DATABASE = 'cms'

/** Plain, unquoted-safe Postgres identifier. Anything else is refused. */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/

/** Quote an identifier for DDL. The name is validated first; this is belt-and-braces. */
export function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

/**
 * Split a platform connection string into "the database to ensure" and "the
 * connection to ensure it from". Pure; never throws — a bad string comes back as
 * `{ ok: false, error }` so the caller prints one diagnostic instead of a stack.
 *
 * The maintenance URL is the SAME string with only the path swapped, so
 * credentials, port and query parameters (`sslmode`, …) are carried over
 * verbatim rather than re-assembled — re-assembly is how a `sslmode=require`
 * quietly goes missing between two connections to the same server.
 */
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

  // `pathname` keeps its percent-encoding; a database name that needed any is
  // not a plain identifier and is refused below anyway.
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
  if (database === MAINTENANCE_DATABASE) {
    return {
      ok: false,
      error:
        `the connection string points at the maintenance database \`${MAINTENANCE_DATABASE}\` — ` +
        'it always exists, so this is a misconfigured PLATFORM_DATABASE_URL, not a bootstrap',
    }
  }
  if (database === PAYLOAD_DATABASE) {
    return {
      ok: false,
      error:
        `the connection string points at \`${PAYLOAD_DATABASE}\`, Payload's own database. The ` +
        'platform pipeline never touches it (spec 2026-08-04 §4) — check PLATFORM_DATABASE_URL.',
    }
  }

  const maintenance = new URL(url.toString())
  maintenance.pathname = `/${MAINTENANCE_DATABASE}`
  return {
    ok: true,
    database,
    host: url.host,
    maintenanceUrl: maintenance.toString(),
  }
}

/** The one line this tool prints on success. Pure — it always says what it DID. */
export function formatEnsureOutcome({ database, created, host }) {
  return created
    ? `  ✓ database ${database} CREATED on ${host}`
    : `  ✓ database ${database} already exists on ${host} — nothing to do`
}

// ── the live half ────────────────────────────────────────────────────────────

async function main() {
  const target = deriveMaintenanceTarget(process.env.PLATFORM_DATABASE_URL)
  if (!target.ok) {
    console.error(
      `\n✗ platform:db:ensure FAILED: ${target.error}\n` +
        '  PLATFORM_DATABASE_URL is the platform database connection string — it is a\n' +
        "  SEPARATE database from Payload's `cms`. See deploy/README.md and .env.example.",
    )
    process.exit(1)
  }

  // Imported lazily so the pure seams above stay importable in tests without pg.
  const { Client } = await import('pg')
  const client = new Client({ connectionString: target.maintenanceUrl })
  await client.connect()
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      target.database,
    ])
    const created = rowCount === 0
    if (created) {
      // No parameter binding is possible in DDL, hence the identifier validation
      // in deriveMaintenanceTarget — the name reached here only if it matched
      // IDENTIFIER_RE.
      await client.query(`CREATE DATABASE ${quoteIdentifier(target.database)}`)
    }
    console.log(formatEnsureOutcome({ database: target.database, created, host: target.host }))
  } finally {
    await client.end()
  }
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
