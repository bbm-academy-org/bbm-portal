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
 * One pool per process. Cached on `globalThis` because Next's dev server
 * re-evaluates modules on every hot reload, and a module-local singleton would
 * leak a pool per edit until Postgres refuses new connections.
 */
const CACHE_KEY = Symbol.for('bbm-portal.platform-db')

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
export function getPlatformDb(): NodePgDatabase {
  const host = cache()
  const existing = host[CACHE_KEY]
  if (existing) return existing.db

  const pool = new Pool({ connectionString: requirePlatformDatabaseUrl(process.env) })
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
