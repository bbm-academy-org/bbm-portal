import { sql } from 'drizzle-orm'

import type { FinanceActor } from '@/lib/finance'
import {
  platformTransaction,
  type AuditContext,
  type PlatformTx,
} from '@/lib/platform/db/transaction'

import { asMigrator, truncateAsFixture } from './privilege-helpers'

/**
 * Fixtures for the finance integration specs (spec `docs/specs/338-ledger-core.md`).
 *
 * Two things here are not boilerplate and are worth reading before using them.
 *
 * **The reset goes through `truncateAsFixture`, which lifts the immutability
 * guard.** `core.finance_operation` and `core.finance_posting` carry BEFORE
 * UPDATE/DELETE/TRUNCATE triggers (EARS-313), so a plain `truncate` is REFUSED —
 * for the hours and member suites too, since a `truncate core.member … cascade`
 * reaches `finance_posting` through its FK. That is why the lifting lives in the
 * SHARED helper (`./privilege-helpers`) rather than here.
 *
 * **The fund row is re-seeded after every reset.** `core.finance_project` holds
 * exactly one `is_fund` row, created by migration `0008` (EARS-304), and a
 * truncate takes it with everything else. Re-creating it here keeps each test
 * starting from the state a freshly migrated database is in.
 */

/** The fixture's own door (spec 201 EARS-7): a repo writer with no human behind it. */
export const FIXTURE_AUDIT_CTX: AuditContext = { actorEmail: null, source: 'cli:int-fixture' }

/**
 * An admin actor — what a signed-in `platform-admin` session looks like here.
 *
 * Since #380 this actor administers the REFERENCES and nothing else: it holds
 * no flow role, so every ledger write it attempts is refused (EARS-529). That is
 * not an oversight in the fixture, it is the clause — the ledger-writing actor
 * is `APPROVER` below.
 */
export const ADMIN: FinanceActor = {
  email: 'anton@bbm.academy',
  roles: ['platform-admin'],
}

/** The ledger actor — `finance-approve` posts and reverses (EARS-501). */
export const APPROVER: FinanceActor = {
  email: 'approver@bbm.academy',
  roles: ['platform-user', 'finance-approve'],
}

/** A member who may READ /p/finance and may write nothing (EARS-330/501/530). */
export const MEMBER: FinanceActor = {
  email: 'member@bbm.academy',
  roles: ['platform-user'],
}

/** One raw fixture statement inside one attributed transaction. */
export function fixtureWrite<T>(fn: (tx: PlatformTx) => Promise<T>): Promise<T> {
  return platformTransaction(FIXTURE_AUDIT_CTX, fn)
}

/**
 * Reset every finance table, children first, and restore the seeded fund row.
 *
 * `member` is included because `finance_posting.member_id` points at it ON
 * DELETE RESTRICT (EARS-322): a leftover member would carry a posting into the
 * next test, and a leftover posting would make the member undeletable.
 */
export async function truncateFinanceTables(): Promise<void> {
  await truncateAsFixture(`truncate table
    core.finance_posting, core.finance_conversion_step, core.finance_operation,
    core.finance_purpose, core.finance_category, core.finance_product,
    core.finance_project, core.finance_account, core.finance_currency,
    core.member_alias, core.member
    restart identity cascade`)
  // What migration `0008` seeds (EARS-304), restored so every test starts from
  // the state of a freshly migrated database.
  await asMigrator(async (client) => {
    await client.query(`insert into core.finance_project (name, is_fund) values ('Фонд BBM', true)`)
  })
}

/** The id of the seeded fund project. */
export async function fundProjectId(): Promise<number> {
  return fixtureWrite(async (tx) => {
    const result = await tx.execute(sql`select id from core.finance_project where is_fund`)
    return Number((result.rows[0] as { id: number }).id)
  })
}

/** A person in the shared registry, for the `member_id` dimension (EARS-322). */
export async function seedMember(email: string, name: string): Promise<number> {
  return fixtureWrite(async (tx) => {
    const result = await tx.execute(sql`
      insert into core.member (slug, email, name)
      values (${name.toLowerCase().replace(/\s+/g, '-')}, ${email}, ${name})
      returning id
    `)
    return Number((result.rows[0] as { id: number }).id)
  })
}
