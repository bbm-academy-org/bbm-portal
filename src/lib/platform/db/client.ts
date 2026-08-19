/**
 * The platform database client (#125) — drizzle over `pg`, on the `core` schema.
 *
 * This is the ONLY place the application opens a connection to the `platform`
 * database. Payload keeps its own pool to `cms` inside its adapter; the two
 * never meet, which is what makes "the CMS side may not import
 * src/lib/platform/db" (`.dependency-cruiser.cjs`) an enforceable statement
 * rather than a wish.
 *
 * Table definitions are deliberately NOT imported here. A module owns its own
 * tables (`./schema/<module>/`) and builds its queries from them; a shared
 * barrel would hand every module a typed handle on every other module's tables
 * and quietly defeat the boundary rule.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { requirePlatformDatabaseUrl } from './config'

/**
 * The startup options every connection this pool opens carries (spec 201
 * EARS-26, «the app-connection mark»).
 *
 * A SESSION-scoped GUC set once per physical connection through libpq's
 * `options`, so it is a property of «who opened this socket» — exactly the
 * distinction `core.audit_row_change()` needs to tell an application write with
 * no audit context (refused) from a `psql` session, the drizzle-kit migration
 * runner or a restore (degraded to `source = 'db-direct'`).
 *
 * It lives HERE and never in `PLATFORM_DATABASE_URL`: `pg` merges the parsed
 * connection string OVER the explicit config
 * (`pg/lib/connection-parameters.js`), so an `options=` parameter in the URL
 * would both overwrite this mark and stamp drizzle-kit's own runner as the app
 * — after which a data-bearing migration (`source = 'migration'`) would be
 * refused. The environment variable carries no `options=`.
 *
 * Load-bearing assumption, stated because the mark stops meaning anything
 * without it: NO transaction pooler sits between the application and Postgres.
 * True today (the app connects directly), and it has to stay true — under
 * transaction pooling a session-scoped GUC would be shared by whoever borrows
 * the physical connection next.
 */
export const PLATFORM_CONNECTION_MARK = '-c app.connection=app'

/**
 * One pool per process. Cached on `globalThis` because Next's dev server
 * re-evaluates modules on every hot reload, and a module-local singleton would
 * leak a pool per edit until Postgres refuses new connections.
 */
const CACHE_KEY = Symbol.for('bbm-portal.platform-db')

/**
 * The handle the application gets — `NodePgDatabase` WITHOUT `.transaction(…)`
 * (spec 201 EARS-24, mechanism 1).
 *
 * Opening a raw transaction outside `src/lib/platform/db/` is therefore a
 * COMPILE ERROR rather than a style violation: the one way to open a write
 * transaction against `platform` is `platformTransaction(ctx, fn, options?)` in
 * `./transaction.ts`, which sets the audit context the capture trigger demands.
 * This is the only part of the fail-closed story TypeScript can give, and it is
 * claimed for that part only — the load-bearing half is EARS-26, in the
 * database (see `PLATFORM_CONNECTION_MARK` above).
 */
export type PlatformDb = Omit<NodePgDatabase, 'transaction'>

type Cache = { pool: Pool; db: NodePgDatabase }
type CacheHost = typeof globalThis & { [CACHE_KEY]?: Cache }

function cache(): CacheHost {
  return globalThis as CacheHost
}

/**
 * The drizzle handle on the platform database. Throws — loudly, naming the
 * variable — when `PLATFORM_DATABASE_URL` is unset: there is no fallback onto
 * Payload's `DATABASE_URL`, because that would run platform queries against the
 * `cms` database.
 */
export function getPlatformDb(): PlatformDb {
  return openPlatformDb()
}

/**
 * The SAME handle, with `.transaction(…)` still on it. **Internal to
 * `src/lib/platform/db/`** — the only legitimate caller is
 * `./transaction.ts`, which is what makes `platformTransaction()` the single
 * door of EARS-24. Everything else takes `getPlatformDb()` above and gets a
 * type that cannot open a transaction at all.
 */
export function openPlatformDb(): NodePgDatabase {
  const host = cache()
  const existing = host[CACHE_KEY]
  if (existing) return existing.db

  const pool = new Pool({
    connectionString: requirePlatformDatabaseUrl(process.env),
    options: PLATFORM_CONNECTION_MARK,
  })
  const db = drizzle(pool)
  host[CACHE_KEY] = { pool, db }
  return db
}

/** Close the pool. Used by tests and one-off scripts; the app never calls it. */
export async function closePlatformDb(): Promise<void> {
  const host = cache()
  const existing = host[CACHE_KEY]
  if (!existing) return
  delete host[CACHE_KEY]
  await existing.pool.end()
}
