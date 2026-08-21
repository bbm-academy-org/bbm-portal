import { Client } from 'pg'

import {
  PLATFORM_APP_ROLE_GROUP,
  PLATFORM_MIGRATOR_ROLE_GROUP,
  requirePlatformMigrateDatabaseUrl,
} from '@/lib/platform/db/config'

/**
 * The two privilege echelons, as two connections (#278, spec 201 EARS-30).
 *
 * The application pool of `client.ts` is one of them and is what every other
 * suite here uses. This module opens the OTHER one — the role that owns `core` —
 * because two assertions need it and neither can be made from a single
 * connection: that the append-only triggers still refuse a write from a role
 * privileged enough to attempt one (EARS-12 is not made redundant by the grants,
 * it is the second echelon), and that the ledger is owned by the migrating role
 * rather than by whoever the application connects as.
 */
export async function asMigrator<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: requirePlatformMigrateDatabaseUrl(process.env) })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Reset fixture tables, through the MIGRATING connection (#278).
 *
 * `TRUNCATE … RESTART IDENTITY` is not a DML privilege: restarting the identity
 * sequence is an `ALTER SEQUENCE`, and Postgres asks for OWNERSHIP of the
 * sequence, not for `TRUNCATE` on the table. So a fixture reset is not something
 * a least-privilege application role can do, and the honest answer is that it
 * should not be able to: resetting a table is a property of the test harness,
 * not of the application under test. Giving the app role sequence ownership to
 * keep these two lines working would have handed it back exactly the kind of
 * privilege this issue exists to take away.
 */
export function truncateAsFixture(statement: string): Promise<void> {
  return asMigrator(async (client) => {
    await client.query(statement)
  })
}

export type PrivilegeSplitState = { split: boolean; reason: string }

/**
 * Is THIS database actually split into two roles?
 *
 * Asked of the live catalog rather than of the environment, because the only
 * answer that matters is what Postgres will enforce. A suite that asserts
 * `permission denied` has to skip where there is nothing to deny — an
 * un-provisioned developer database, or a checkout predating #278 — and it must
 * skip loudly, naming the reason, so a skip is never read as a pass.
 */
export async function privilegeSplitState(client: {
  query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>
}): Promise<PrivilegeSplitState> {
  const { rows } = await client.query(`
    select current_user as who,
           coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_super,
           to_regrole('${PLATFORM_APP_ROLE_GROUP}') is not null as app_group_exists,
           to_regrole('${PLATFORM_MIGRATOR_ROLE_GROUP}') is not null as migrator_group_exists,
           case when to_regrole('${PLATFORM_MIGRATOR_ROLE_GROUP}') is null then false
                else pg_has_role(current_user, '${PLATFORM_MIGRATOR_ROLE_GROUP}', 'usage') end as owns_core
  `)
  const row = rows[0] as {
    who: string
    is_super: boolean
    app_group_exists: boolean
    migrator_group_exists: boolean
    owns_core: boolean | null
  }

  if (!row.app_group_exists || !row.migrator_group_exists) {
    return {
      split: false,
      reason: `${PLATFORM_APP_ROLE_GROUP}/${PLATFORM_MIGRATOR_ROLE_GROUP} do not exist — run \`pnpm platform:roles:ensure\``,
    }
  }
  if (row.is_super) {
    return { split: false, reason: `the application connects as the superuser ${row.who}` }
  }
  if (row.owns_core) {
    return {
      split: false,
      reason: `the application role ${row.who} is a member of ${PLATFORM_MIGRATOR_ROLE_GROUP}`,
    }
  }
  return { split: true, reason: `application role ${row.who}` }
}
