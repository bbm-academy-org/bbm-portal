// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { PLATFORM_APP_ROLE_GROUP, PLATFORM_MIGRATOR_ROLE_GROUP } from '@/lib/platform/db/config'
import { platformTransaction } from '@/lib/platform/db/transaction'

import { auditEventsFor, auditWatermark, refusedWith } from './audit-helpers'
import { seedMember, truncateHoursTables } from './hours-core-helpers'
import { privilegeSplitState } from './privilege-helpers'

/**
 * The privilege echelon (spec 201 EARS-30, issue #278 — the acceptance criteria
 * of that issue, and the scenario spec 201 §«Deviations» filed as blocked).
 *
 * This is the assertion spec 201 says «could not be made»: with one superuser
 * role, `REVOKE` is a no-op and a refusal proves nothing. It is performable now,
 * and what it proves is the half EARS-12's triggers cannot: the triggers stop an
 * ACCIDENT, and the grants stop a role. The two are asserted in different files
 * on purpose — `audit-ledger.int.spec.ts` runs the trigger refusals through the
 * MIGRATING connection precisely so that they keep testing the trigger rather
 * than quietly starting to test this file's REVOKE.
 *
 * Skips, loudly and by name, on a database that is not split — see
 * `privilegeSplitState`.
 */

const db = getPlatformDb()

const split = await privilegeSplitState({
  query: async (text: string) => {
    const { rows } = await db.execute(sql.raw(text))
    return { rows: rows as Record<string, unknown>[] }
  },
})

afterAll(async () => {
  await closePlatformDb()
})

describe.skipIf(!split.split)(`least-privilege application role (${split.reason})`, () => {
  it('EARS-30: the application role is a member of the app group and NOT of the owner group', async () => {
    const { rows } = await db.execute<{ in_app: boolean; in_owner: boolean; is_super: boolean }>(
      sql`select pg_has_role(current_user, ${PLATFORM_APP_ROLE_GROUP}, 'usage') as in_app,
                 pg_has_role(current_user, ${PLATFORM_MIGRATOR_ROLE_GROUP}, 'usage') as in_owner,
                 (select rolsuper from pg_roles where rolname = current_user) as is_super`,
    )
    expect(rows[0]).toEqual({ in_app: true, in_owner: false, is_super: false })
  })

  it('EARS-30: `core.audit_event` and both audit functions are owned by the migrating role', async () => {
    const { rows: table } = await db.execute<{ owner: string }>(
      sql`select tableowner as owner from pg_tables
          where schemaname = 'core' and tablename = 'audit_event'`,
    )
    expect(table[0].owner).toBe(PLATFORM_MIGRATOR_ROLE_GROUP)

    // The one that is load-bearing rather than tidy: a SECURITY DEFINER function
    // executes as its OWNER, so this is what lets the capture trigger insert into
    // a ledger the caller below cannot write to.
    const { rows: fns } = await db.execute<{ proname: string; owner: string }>(
      sql`select proname, pg_get_userbyid(proowner) as owner from pg_proc
          where pronamespace = 'core'::regnamespace
            and proname in ('audit_row_change', 'audit_event_append_only')
          order by proname`,
    )
    expect(fns).toEqual([
      { proname: 'audit_event_append_only', owner: PLATFORM_MIGRATOR_ROLE_GROUP },
      { proname: 'audit_row_change', owner: PLATFORM_MIGRATOR_ROLE_GROUP },
    ])
  })

  it('EARS-30: UPDATE, DELETE and TRUNCATE on the ledger are refused by PRIVILEGE, before any trigger runs', async () => {
    // `permission denied`, not the trigger's own message: that difference is the
    // evidence. A trigger refusal here would mean the check that a superuser can
    // switch off with one statement is still the only thing standing.
    await expect(db.execute(sql`update core.audit_event set diff = '{}'::jsonb`)).rejects.toSatisfy(
      refusedWith(/permission denied for table audit_event/),
    )
    await expect(db.execute(sql`delete from core.audit_event`)).rejects.toSatisfy(
      refusedWith(/permission denied for table audit_event/),
    )
    await expect(db.execute(sql`truncate core.audit_event`)).rejects.toSatisfy(
      refusedWith(/permission denied for table audit_event/),
    )
  })

  it('EARS-30: a DIRECT INSERT into the ledger is refused too — only the capture function writes', async () => {
    await expect(
      db.execute(
        sql`insert into core.audit_event (event_type, table_name, source, pk, diff, txid)
            values ('data.member.update', 'member', 'portal', '{}'::jsonb, '{}'::jsonb, 1)`,
      ),
    ).rejects.toSatisfy(refusedWith(/permission denied for table audit_event/))
  })

  // Titled EARS-30 alone, deliberately: what is asserted here is the PRIVILEGE
  // (`SELECT` survived the revoke), not spec 201's EARS-23, which is the read
  // path itself — «SQL run by an agent, result pasted into the issue» — and has
  // no automated counterpart until a surface over the ledger exists. It stays on
  // the deferral list of `tools/lint/ears-test-lint.mjs` for exactly that reason,
  // and citing it in a title here would retire that obligation without meeting it.
  it('EARS-30: SELECT on the ledger is retained — the ledger read path runs as this role', async () => {
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from core.audit_event`,
    )
    expect(typeof rows[0].n).toBe('number')
  })

  it('EARS-30: an ordinary audited write still appends an attributed ledger row', async () => {
    // The whole point of revoking INSERT rather than all writes: the application
    // cannot touch the ledger, and its normal work still lands in it, through the
    // SECURITY DEFINER capture function of EARS-12.
    await truncateHoursTables(db)
    const id = await seedMember({ email: 'privilege@bbm.academy', name: 'Пётр' })
    const mark = await auditWatermark(db)

    await platformTransaction({ actorEmail: 'anton@bbm.academy', source: 'portal' }, (tx) =>
      tx.execute(sql`update core.member set name = 'Пётр Б' where id = ${id}`),
    )

    const [event] = await auditEventsFor(db, mark, 'member')
    expect(event.event_type).toBe('data.member.update')
    expect(event.actor_email).toBe('anton@bbm.academy')
    expect(event.diff).toEqual({ name: { old: 'Пётр', new: 'Пётр Б' } })
  })

  it('EARS-30: the module tables the application does own stay writable', async () => {
    // Least privilege here is a claim about the LEDGER. If this test ever fails,
    // the grant migration narrowed something it was not asked to narrow.
    const { rows } = await db.execute<{ priv: string }>(
      sql`select privilege_type as priv from information_schema.table_privileges
          where table_schema = 'core' and table_name = 'member' and grantee = ${PLATFORM_APP_ROLE_GROUP}
          order by privilege_type`,
    )
    expect(rows.map((r) => r.priv)).toEqual(
      expect.arrayContaining(['DELETE', 'INSERT', 'SELECT', 'UPDATE']),
    )
  })
})
