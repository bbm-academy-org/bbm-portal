/**
 * The ledger facts the §J market valuation reads (spec
 * `docs/specs/339-ledger-intake.md` §J, EARS-557/560/561; issue #558).
 *
 * This is a READ function of the ledger side and nothing more: it knows the
 * intake and ledger tables and nothing about the Bank of Russia rates. The
 * valuation itself lives in `./fx/` and imports these loaders — the direction
 * EARS-553 allows (fx reads the ledger; the ledger never reads fx). No row
 * here is written, and no amount is computed: every number is what the ledger
 * recorded.
 *
 * The loaders select CANDIDATES broadly — which of them is a foreign-currency
 * payment or a «факт не внесён» request is decided by the pure classifier in
 * `./fx/market.ts`, where the rule is unit-tested. The chain predicate is the
 * one exception: «owns a conversion step, carries no purpose, is no reversal and
 * is not reversed, and no intake expense posted it» (EARS-561) is a statement
 * about the ledger's shape, so it is the query.
 */
import { sql, type SQL } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'

/** An intake expense as the valuation needs it — posted, or already paid and pending. */
export type MarketIntakeFact = {
  itemId: number
  kind: string
  status: string
  alreadyPaid: boolean
  personalFunds: boolean
  /** The date money moved (EARS-508); `null` while a pending request has none. */
  occurredOn: string | null
  /** The submission moment as a Moscow calendar date (EARS-556). */
  submittedOn: string
  /** The document side, minimal units of `currency`. */
  amount: bigint
  currency: string
  /** The account side when it differs from the document (EARS-505). */
  paidAmount: bigint | null
  paidCurrency: string | null
  feeAmount: bigint | null
  feeCurrency: string | null
  /** The paying money account; `null` for `personal_funds` or a pending request. */
  accountName: string | null
  accountCurrency: string | null
  operationId: number | null
  /** Some operation `reverses` this item's operation (EARS-314). */
  operationReversed: boolean
  counterpartyName: string | null
  memberName: string | null
}

/** One money-account posting of a chain (system accounts are not part of either end). */
export type MarketChainLeg = {
  accountId: number
  accountName: string
  amount: bigint
  currency: string
  /** A step-linked posting — on a money account, that is a step's fee (EARS-318). */
  onStep: boolean
}

/** A conversion operation measured as one chain (EARS-561). */
export type MarketChainFact = {
  operationId: number
  occurredOn: string
  /** The exchange steps in step order. */
  steps: { fromCurrency: string; toCurrency: string }[]
  moneyLegs: MarketChainLeg[]
}

/**
 * A period of payment dates, inclusive at both ends; an open end is unbounded.
 * The §J read model's `MarketPeriod` is this same shape — declared here because
 * the ledger side never imports from `./fx/` (EARS-553).
 */
export type MarketFactsPeriod = { from?: string; to?: string }

type Row = Record<string, unknown>

/** `and <date> between …` for the bounds that are set; nothing for an open end. */
function periodClause(date: SQL, period: MarketFactsPeriod | undefined): SQL {
  const from = period?.from === undefined ? sql`` : sql`and ${date} >= ${period.from}::date`
  const to = period?.to === undefined ? sql`` : sql`and ${date} <= ${period.to}::date`
  return sql`${from} ${to}`
}

const nullableBigint = (value: unknown) => (value === null ? null : BigInt(String(value)))
const nullableText = (value: unknown) => (value === null ? null : String(value))

/**
 * Posted intake expenses and already-paid pending ones — the candidates of
 * EARS-557 and EARS-560. `itemId` narrows to one request (the details sheet);
 * `period` bounds the payment date IN THE QUERY — `occurred_on`, else the
 * Moscow submission date (EARS-560) — so a report reads its period, not the
 * whole history (lead review of #561).
 */
export async function marketIntakeFacts(
  options: { itemId?: number; period?: MarketFactsPeriod } = {},
): Promise<MarketIntakeFact[]> {
  const only = options.itemId === undefined ? sql`` : sql`and i.id = ${options.itemId}`
  const within = periodClause(
    sql`coalesce(i.occurred_on, (i.created_at at time zone 'Europe/Moscow')::date)`,
    options.period,
  )
  const result = await getPlatformDb().execute(sql`
    select i.id, i.kind, i.status, i.already_paid, i.personal_funds,
           i.occurred_on::text as occurred_on,
           to_char(i.created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD') as submitted_on,
           i.amount::text as amount, i.currency,
           i.paid_amount::text as paid_amount, i.paid_currency,
           i.fee_amount::text as fee_amount, i.fee_currency,
           a.name as account_name, a.currency as account_currency,
           i.operation_id,
           exists (select 1 from core.finance_operation r where r.reverses = i.operation_id)
             as operation_reversed,
           cp.name as counterparty_name, m.name as member_name
      from core.finance_intake_item i
      left join core.finance_account a on a.id = i.account_id
      left join core.finance_counterparty cp on cp.id = i.counterparty_id
      left join core.member m on m.id = i.member_id
     where i.kind = 'expense'
       and (i.status = 'posted' or (i.already_paid and i.status in ('submitted', 'approved')))
       ${only}
       ${within}
     order by i.id
  `)
  return (result.rows as Row[]).map((row) => ({
    itemId: Number(row.id),
    kind: String(row.kind),
    status: String(row.status),
    alreadyPaid: Boolean(row.already_paid),
    personalFunds: Boolean(row.personal_funds),
    occurredOn: nullableText(row.occurred_on),
    submittedOn: String(row.submitted_on),
    amount: BigInt(String(row.amount)),
    currency: String(row.currency),
    paidAmount: nullableBigint(row.paid_amount),
    paidCurrency: nullableText(row.paid_currency),
    feeAmount: nullableBigint(row.fee_amount),
    feeCurrency: nullableText(row.fee_currency),
    accountName: nullableText(row.account_name),
    accountCurrency: nullableText(row.account_currency),
    operationId: row.operation_id === null ? null : Number(row.operation_id),
    operationReversed: Boolean(row.operation_reversed),
    counterpartyName: nullableText(row.counterparty_name),
    memberName: nullableText(row.member_name),
  }))
}

/**
 * Every conversion chain of the ledger (EARS-561) whose `occurred_on` is in
 * `period` (bounded in the query), with its steps and money legs.
 */
export async function marketChainFacts(
  options: { period?: MarketFactsPeriod } = {},
): Promise<MarketChainFact[]> {
  const db = getPlatformDb()
  const within = periodClause(sql`o.occurred_on`, options.period)
  const chains = await db.execute(sql`
    select o.id, o.occurred_on::text as occurred_on
      from core.finance_operation o
     where o.reverses is null
       and o.purpose_id is null
       and exists (select 1 from core.finance_conversion_step s where s.operation_id = o.id)
       and not exists (select 1 from core.finance_operation r where r.reverses = o.id)
       and not exists (
         select 1 from core.finance_intake_item i
          where i.operation_id = o.id and i.kind = 'expense'
       )
       ${within}
     order by o.id
  `)
  const facts = new Map<number, MarketChainFact>()
  for (const row of chains.rows as Row[]) {
    const operationId = Number(row.id)
    facts.set(operationId, {
      operationId,
      occurredOn: String(row.occurred_on),
      steps: [],
      moneyLegs: [],
    })
  }
  if (facts.size === 0) return []
  const ids = sql.join(
    [...facts.keys()].map((id) => sql`${id}`),
    sql`, `,
  )
  const steps = await db.execute(sql`
    select operation_id, from_currency, to_currency
      from core.finance_conversion_step
     where operation_id in (${ids})
     order by operation_id, step_no
  `)
  for (const row of steps.rows as Row[]) {
    facts.get(Number(row.operation_id))?.steps.push({
      fromCurrency: String(row.from_currency),
      toCurrency: String(row.to_currency),
    })
  }
  const legs = await db.execute(sql`
    select p.operation_id, p.account_id, a.name as account_name, p.amount::text as amount,
           p.currency, p.conversion_step_id is not null as on_step
      from core.finance_posting p
      join core.finance_account a on a.id = p.account_id
     where p.operation_id in (${ids}) and not a.is_system
     order by p.operation_id, p.id
  `)
  for (const row of legs.rows as Row[]) {
    facts.get(Number(row.operation_id))?.moneyLegs.push({
      accountId: Number(row.account_id),
      accountName: String(row.account_name),
      amount: BigInt(String(row.amount)),
      currency: String(row.currency),
      onStep: Boolean(row.on_step),
    })
  }
  return [...facts.values()]
}
