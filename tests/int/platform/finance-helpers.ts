import { sql } from 'drizzle-orm'

import {
  createAccount,
  createCurrency,
  createIntakeItem,
  createPurpose,
  type FinanceActor,
  type FinanceIntakeItemView,
} from '@/lib/finance'
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

/** The intake actor — `finance-entry` fills the intake and attaches documents (EARS-501). */
export const ENTRY: FinanceActor = {
  email: 'entry@bbm.academy',
  roles: ['platform-user', 'finance-entry'],
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
    core.finance_document_link, core.finance_document,
    core.finance_purpose_proposal,
    core.finance_intake_item, core.finance_counterparty,
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

/**
 * A counterparty row, seeded RAW (spec 339 EARS-532).
 *
 * Deliberately not through a module function: `finance_intake_item.counterparty_id`
 * needs a target row, and #381 ships the TABLE only — the counterparty reference
 * as a module surface (inline creation, admin rename) is #383. A fixture that
 * called a function this PR does not own would be a claim it does.
 */
export async function seedCounterparty(name: string, createdBy: number): Promise<number> {
  return fixtureWrite(async (tx) => {
    const result = await tx.execute(sql`
      insert into core.finance_counterparty (name, created_by)
      values (${name}, ${createdBy})
      returning id
    `)
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

/**
 * Everything an intake item needs to name, plus the member ids of the three
 * actors — a document row records its uploader as a `core.member(id)`, so a
 * document fixture has to be able to say WHICH id it expects.
 *
 * `tests/int/platform/finance-intake.int.spec.ts` (#381) keeps its own narrower
 * local copy; this one is the shared seed the document suite (#382) builds on
 * and is deliberately additive rather than a rewrite of an acceptance-critical
 * file from another task.
 */
export async function seedIntakeReferences() {
  const entryMemberId = await seedMember(ENTRY.email, 'Entry Clerk')
  const approverMemberId = await seedMember(APPROVER.email, 'Approver Person')
  const memberMemberId = await seedMember(MEMBER.email, 'Plain Member')
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  const account = await createAccount(ADMIN, {
    name: 'Тинькофф RUB',
    kind: 'bank',
    currency: 'RUB',
  })
  const purpose = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'forbidden' })
  const projectId = await fundProjectId()
  const counterpartyId = await seedCounterparty('Anthropic', entryMemberId)
  return {
    accountId: account.id,
    purposeId: purpose.id,
    projectId,
    counterpartyId,
    entryMemberId,
    approverMemberId,
    memberMemberId,
  }
}

export type FinanceIntakeRefs = Awaited<ReturnType<typeof seedIntakeReferences>>

/**
 * One intake item created BY `actor`, optionally forced into a terminal status.
 *
 * `source` defaults to `manual` (the entry role's own path); pass `request` for
 * the EARS-502 carve-out. A `status` override is written RAW: `refused` and
 * `cancelled` are reached through the status machine in real life, and driving
 * the machine here would make every document test also a test of #381.
 */
export async function seedIntakeItemFor(
  actor: FinanceActor,
  refs: FinanceIntakeRefs,
  overrides: { source?: 'manual' | 'request'; status?: 'refused' | 'cancelled' } = {},
): Promise<FinanceIntakeItemView> {
  const item = await createIntakeItem(actor, {
    source: overrides.source ?? 'manual',
    kind: 'expense',
    occurredOn: '2026-08-20',
    accountId: refs.accountId,
    amount: 120_000n,
    currency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
  })
  if (overrides.status === undefined) return item
  await fixtureWrite(async (tx) => {
    await tx.execute(sql`
      update core.finance_intake_item
      set status = ${overrides.status},
          refusal_reason = ${overrides.status === 'refused' ? 'фикстура' : null}
      where id = ${item.id}
    `)
  })
  return { ...item, status: overrides.status }
}

/**
 * Drive an intake item to `posted`, RAW — the EARS-516 precondition.
 *
 * Posting is #385's clause (EARS-505/506) and the spine deliberately refuses
 * `approved → posted` today. The document layer only needs the STATE, so the
 * fixture writes the operation and the terminal row itself rather than waiting
 * for a sibling task; when #385 lands, this helper is what it replaces.
 */
export async function postIntakeItem(itemId: number): Promise<number> {
  return fixtureWrite(async (tx) => {
    const item = await tx.execute(sql`
      select occurred_on, purpose_id, created_by from core.finance_intake_item where id = ${itemId}
    `)
    const row = item.rows[0] as { occurred_on: string; purpose_id: number; created_by: number }
    const operation = await tx.execute(sql`
      insert into core.finance_operation (occurred_on, purpose_id, source)
      values (${row.occurred_on}, ${row.purpose_id}, 'manual')
      returning id
    `)
    const operationId = Number((operation.rows[0] as { id: number }).id)
    await tx.execute(sql`
      update core.finance_intake_item
      set status = 'posted', operation_id = ${operationId},
          posted_by = ${row.created_by}, posted_at = now()
      where id = ${itemId}
    `)
    return operationId
  })
}
