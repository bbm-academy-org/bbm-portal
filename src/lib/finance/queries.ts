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
import { sql, type SQL } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'

import {
  evaluateCurrentMoney,
  selectCurrentMoneyAccounts,
  type CurrentMoneyOperationFact,
  type CurrentMoneyValuation,
} from './current-money'

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
  sourceRef: string | null
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

export type LiabilityBalance = {
  accountId: number
  memberId: number
  memberName: string
  currency: string
  /** Signed ledger balance: a credit (what BBM owes) is negative. */
  balance: bigint
}

/**
 * Every account with its balance, each in ITS OWN currency (EARS-317, EARS-325).
 *
 * Conversion is deliberately absent from this primitive: an amount keeps the
 * currency it happened in (EARS-310). F1b's conservative total is the separate
 * `currentMoneyOverview()` read model below; F3 owns period-report conversion.
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
 * The whole ledger, read into memory and replayed on every `/p/finance` view.
 *
 * Three UNBOUNDED selects — every operation, every conversion step, every
 * posting joined to its account — with no LIMIT, no date window and no cache, on
 * a page open to every `platform-user`. At F1b's data volume that is invisible;
 * the cost is linear in the lifetime size of the ledger from then on. The
 * windowed / materialized read model is filed as #420 and is deliberately not
 * done here: EARS-325's arithmetic is correct, only its access pattern is not.
 */
async function currentMoneyOperationFacts(): Promise<CurrentMoneyOperationFact[]> {
  const db = getPlatformDb()
  const [operationResult, stepResult, postingResult] = await Promise.all([
    db.execute(sql`
      select id, occurred_on, reverses
        from core.finance_operation
       order by occurred_on, id
    `),
    db.execute(sql`
      select operation_id, step_no, from_currency, to_currency
        from core.finance_conversion_step
       order by operation_id, step_no
    `),
    db.execute(sql`
      select p.operation_id, p.account_id, a.kind as account_kind, a.is_system,
             p.currency, p.amount::text as amount, cs.step_no as conversion_step_no
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
        left join core.finance_conversion_step cs on cs.id = p.conversion_step_id
       order by p.operation_id, p.id
    `),
  ])

  const operations = new Map<number, CurrentMoneyOperationFact>()
  for (const row of operationResult.rows as Record<string, unknown>[]) {
    const operationId = Number(row.id)
    operations.set(operationId, {
      operationId,
      occurredOn: String(row.occurred_on).slice(0, 10),
      reverses: row.reverses === null ? null : Number(row.reverses),
      steps: [],
      postings: [],
    })
  }
  for (const row of stepResult.rows as Record<string, unknown>[]) {
    operations.get(Number(row.operation_id))?.steps.push({
      stepNo: Number(row.step_no),
      fromCurrency: String(row.from_currency),
      toCurrency: String(row.to_currency),
    })
  }
  for (const row of postingResult.rows as Record<string, unknown>[]) {
    operations.get(Number(row.operation_id))?.postings.push({
      accountId: Number(row.account_id),
      accountKind: String(row.account_kind),
      isSystem: Boolean(row.is_system),
      currency: String(row.currency),
      amount: BigInt(String(row.amount)),
      conversionStepNo: row.conversion_step_no === null ? null : Number(row.conversion_step_no),
    })
  }
  return [...operations.values()]
}

/** The complete F1b cash card read model (EARS-325), defaulting to RUB. */
export async function currentMoneyOverview(
  reportingCurrency = 'RUB',
): Promise<CurrentMoneyValuation> {
  const [balances, operations] = await Promise.all([
    accountBalances(),
    currentMoneyOperationFacts(),
  ])
  return evaluateCurrentMoney({
    reportingCurrency,
    accounts: selectCurrentMoneyAccounts(balances),
    operations,
  })
}

/** Who BBM owes, per member and currency (spec 339 EARS-527). */
export async function liabilityBalances(
  filter: { memberId?: number } = {},
): Promise<LiabilityBalance[]> {
  const db = getPlatformDb()
  const memberFilter =
    filter.memberId === undefined ? sql`` : sql`and p.member_id = ${filter.memberId}`
  const result = await db.execute(sql`
    select a.id as account_id, p.member_id, m.name as member_name, a.currency,
           sum(p.amount)::text as balance
      from core.finance_posting p
      join core.finance_account a on a.id = p.account_id and a.kind = 'liability'
      join core.member m on m.id = p.member_id
     where p.member_id is not null ${memberFilter}
     group by a.id, p.member_id, m.name, a.currency
    having sum(p.amount) <> 0
     order by p.member_id, a.currency
  `)
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    accountId: Number(row.account_id),
    memberId: Number(row.member_id),
    memberName: String(row.member_name),
    currency: String(row.currency),
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
async function registerEntriesWhere(operationScope: SQL): Promise<RegisterEntry[]> {
  const db = getPlatformDb()
  const result = await db.execute(sql`
    select o.id, o.occurred_on, o.source, o.source_ref, o.purpose_id, o.backdated, o.reverses,
           pu.name as purpose_name,
           (select r.id from core.finance_operation r where r.reverses = o.id) as reversed_by,
           p.id as posting_id, p.account_id, a.name as account_name, p.amount::text as amount,
           p.currency, p.project_id, p.category_id, p.product_id, p.member_id
      from core.finance_operation o
      left join core.finance_purpose pu on pu.id = o.purpose_id
      join core.finance_posting p on p.operation_id = o.id
      join core.finance_account a on a.id = p.account_id
     where ${operationScope}
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
        sourceRef: raw.source_ref === null ? null : String(raw.source_ref),
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

export async function listRegister(options: { limit?: number } = {}): Promise<RegisterEntry[]> {
  const limit = options.limit ?? 200
  return registerEntriesWhere(
    sql`o.id in (select id from core.finance_operation order by id desc limit ${limit})`,
  )
}

/** The complete register projection for an explicit bounded set of operation ids. */
export async function registerEntriesByIds(
  operationIds: readonly number[],
): Promise<RegisterEntry[]> {
  const ids = [...new Set(operationIds)]
  if (ids.length === 0) return []
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new RangeError('Finance operation ids must be positive integers.')
  }
  const parameters = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )
  return registerEntriesWhere(sql`o.id in (${parameters})`)
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
