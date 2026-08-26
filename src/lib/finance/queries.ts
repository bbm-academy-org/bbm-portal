/**
 * The read side — balances, the register, and the EARS-333 exception list
 * (spec 338 EARS-317, EARS-323, EARS-333).
 *
 * **A balance is always a SUM over postings.** No table stores one, and there is
 * no opening-balance mechanism anywhere in this module (EARS-317): an account
 * starts at zero because it has no postings, and it stops being zero when it
 * has some. That is why `accountBalances()` takes no «as of which opening» and
 * why no function here accepts a starting amount.
 *
 * These functions take no actor. EARS-330 narrows WRITES; reading BBM's money is
 * open to every platform member by the owner's transparency policy (EARS-325),
 * and the surface — #357 — decides who may look.
 */
import { sql } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'

export type AccountBalance = {
  accountId: number
  name: string
  kind: string
  currency: string
  isSystem: boolean
  retiredAt: Date | null
  /** Minimal units of `currency`. The sum of the account's postings, always. */
  balance: bigint
}

export type RegisterEntry = {
  operationId: number
  occurredOn: string
  source: string
  purposeId: number | null
  purposeName: string | null
  backdated: boolean
  reverses: number | null
  /** The operation reversing THIS one, if any (EARS-314: both stay visible). */
  reversedBy: number | null
  postings: {
    id: number
    accountId: number
    accountName: string
    amount: bigint
    currency: string
    projectId: number | null
    categoryId: number | null
    productId: number | null
    memberId: number | null
  }[]
}

export type MissingProductPosting = {
  postingId: number
  operationId: number
  occurredOn: string
  purposeId: number
  purposeName: string
  amount: bigint
  currency: string
  projectId: number | null
}

/**
 * Every account with its balance, each in ITS OWN currency (EARS-317, EARS-325).
 *
 * Conversion for display is deliberately absent: an amount keeps the currency it
 * happened in (EARS-310), and a single-number total across currencies is an F3
 * reporting decision with a rate source behind it, not a ledger fact.
 */
export async function accountBalances(): Promise<AccountBalance[]> {
  const db = getPlatformDb()
  const result = await db.execute(sql`
    select a.id, a.name, a.kind, a.currency, a.is_system, a.retired_at,
           coalesce(sum(p.amount), 0)::text as balance
      from core.finance_account a
      left join core.finance_posting p on p.account_id = a.id
     group by a.id, a.name, a.kind, a.currency, a.is_system, a.retired_at
     order by a.id
  `)
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    accountId: Number(row.id),
    name: String(row.name),
    kind: String(row.kind),
    currency: String(row.currency),
    isSystem: Boolean(row.is_system),
    retiredAt: row.retired_at === null ? null : new Date(String(row.retired_at)),
    balance: BigInt(String(row.balance)),
  }))
}

/**
 * The register — operations newest first, with their postings (EARS-314).
 *
 * A reversed operation and its сторно BOTH appear, each carrying the pointer to
 * the other: the correction is visible as a second fact, never as the first one
 * having quietly changed.
 */
export async function listRegister(options: { limit?: number } = {}): Promise<RegisterEntry[]> {
  const db = getPlatformDb()
  const limit = options.limit ?? 200
  const result = await db.execute(sql`
    select o.id, o.occurred_on, o.source, o.purpose_id, o.backdated, o.reverses,
           pu.name as purpose_name,
           (select r.id from core.finance_operation r where r.reverses = o.id) as reversed_by,
           p.id as posting_id, p.account_id, a.name as account_name, p.amount::text as amount,
           p.currency, p.project_id, p.category_id, p.product_id, p.member_id
      from core.finance_operation o
      left join core.finance_purpose pu on pu.id = o.purpose_id
      join core.finance_posting p on p.operation_id = o.id
      join core.finance_account a on a.id = p.account_id
     where o.id in (select id from core.finance_operation order by id desc limit ${limit})
     order by o.id desc, p.id asc
  `)
  const entries = new Map<number, RegisterEntry>()
  for (const raw of result.rows as Record<string, unknown>[]) {
    const operationId = Number(raw.id)
    let entry = entries.get(operationId)
    if (entry === undefined) {
      entry = {
        operationId,
        occurredOn: String(raw.occurred_on).slice(0, 10),
        source: String(raw.source),
        purposeId: raw.purpose_id === null ? null : Number(raw.purpose_id),
        purposeName: raw.purpose_name === null ? null : String(raw.purpose_name),
        backdated: Boolean(raw.backdated),
        reverses: raw.reverses === null ? null : Number(raw.reverses),
        reversedBy: raw.reversed_by === null ? null : Number(raw.reversed_by),
        postings: [],
      }
      entries.set(operationId, entry)
    }
    entry.postings.push({
      id: Number(raw.posting_id),
      accountId: Number(raw.account_id),
      accountName: String(raw.account_name),
      amount: BigInt(String(raw.amount)),
      currency: String(raw.currency),
      projectId: raw.project_id === null ? null : Number(raw.project_id),
      categoryId: raw.category_id === null ? null : Number(raw.category_id),
      productId: raw.product_id === null ? null : Number(raw.product_id),
      memberId: raw.member_id === null ? null : Number(raw.member_id),
    })
  }
  return [...entries.values()]
}

/**
 * EARS-333 — the exception list: postings recorded against an `optional`-binding
 * purpose that carry no product.
 *
 * This is the query by which the taxonomy converges FROM USE. `optional` is the
 * honest answer while nobody knows yet whether a purpose is product-bound; this
 * list is what turns the accumulated «nobody said» into the evidence for making
 * it `required` or `forbidden` (Accounting policy, ruling 2). Its reporting
 * surface is F3's — F1 owes the query, not a screen.
 */
export async function postingsMissingOptionalProduct(): Promise<MissingProductPosting[]> {
  const db = getPlatformDb()
  const result = await db.execute(sql`
    select p.id as posting_id, o.id as operation_id, o.occurred_on,
           pu.id as purpose_id, pu.name as purpose_name,
           p.amount::text as amount, p.currency, p.project_id
      from core.finance_posting p
      join core.finance_operation o on o.id = p.operation_id
      join core.finance_purpose pu on pu.id = o.purpose_id
      join core.finance_account a on a.id = p.account_id
     where pu.product_binding = 'optional'
       and p.product_id is null
       and a.kind in ('income', 'expense')
     order by o.occurred_on desc, p.id desc
  `)
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    postingId: Number(row.posting_id),
    operationId: Number(row.operation_id),
    occurredOn: String(row.occurred_on).slice(0, 10),
    purposeId: Number(row.purpose_id),
    purposeName: String(row.purpose_name),
    amount: BigInt(String(row.amount)),
    currency: String(row.currency),
    projectId: row.project_id === null ? null : Number(row.project_id),
  }))
}
