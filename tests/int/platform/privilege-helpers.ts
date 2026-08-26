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
    for (const trigger of FACT_CORE_TRUNCATE_GUARDS) {
      await client.query(`alter table ${trigger.table} disable trigger ${trigger.name}`)
    }
    try {
      await client.query(statement)
    } finally {
      for (const trigger of FACT_CORE_TRUNCATE_GUARDS) {
        await client.query(`alter table ${trigger.table} enable trigger ${trigger.name}`)
      }
    }
  })
}

/**
 * The statement-level guards a fixture reset has to step around (spec 338
 * EARS-313, migration `0008`).
 *
 * `core.finance_operation` and `core.finance_posting` refuse TRUNCATE outright,
 * and they do so for any suite — a `truncate core.member … cascade` reaches them
 * through `finance_posting.member_id`, so this is not only the finance suites'
 * problem. The harness therefore lifts the two guards for the length of the
 * reset and puts them back in the `finally`, which needs table OWNERSHIP and is
 * why it lives inside `asMigrator`.
 *
 * That this is the only way to empty those tables is not a workaround, it is the
 * clause: the application has no such door at all, and a reset is a property of
 * the harness rather than of the system under test. The row-level UPDATE/DELETE
 * guards are deliberately NOT lifted — nothing here needs to edit a recorded
 * fact, and a helper that could would be a hole in exactly the invariant several
 * specs assert.
 */
const FACT_CORE_TRUNCATE_GUARDS = [
  { table: 'core.finance_operation', name: 'finance_operation_immutable_truncate' },
  { table: 'core.finance_posting', name: 'finance_posting_immutable_truncate' },
] as const

export type PrivilegeSplitState = { split: boolean; reason: string }

/**
 * Where the EARS-30 suite may skip, and where a skip is a FAILURE.
 *
 * A developer's un-provisioned branch database has nothing to deny and the suite
 * skips there, loudly and by name. CI is the other case: it provisions the split
 * itself, and it is the ONE tier behind ADR-004 A1's and spec 201's claim that
 * the privilege echelon is asserted on every PR. If the provisioning there ever
 * breaks, `split: false` must take the suite red — a skip that quietly retires
 * the only assertion of an integrity claim is worse than no assertion, because it
 * still reports green.
 *
 * Returns `true` when the suite must run, `false` when the skip is legitimate;
 * throws where the split is mandatory and absent.
 */
export function assertSplitWhereMandatory(
  state: PrivilegeSplitState,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (state.split) return true
  const inCi = Boolean(env.CI) && env.CI !== 'false' && env.CI !== '0'
  if (inCi) {
    throw new Error(
      `EARS-30: this environment MUST run the least-privilege suite and cannot — ${state.reason}. ` +
        'CI provisions the split in its own job (`pnpm platform:roles:ensure`, see ' +
        '.github/workflows/ci.yml → platform-int); if that step stopped running, the privilege ' +
        'echelon is no longer asserted anywhere and this failure is the only signal of it.',
    )
  }
  return false
}

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
