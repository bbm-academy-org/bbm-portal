/**
 * The budget reading — spec 338 §D EARS-340…345 as a module query (issue #593).
 *
 * Loads every operation BBM has with its steps and postings, the intake item
 * each operation posted (and the `settles_item` link of spec 339 EARS-528), and
 * the fund's live budget, then hands them to the PURE replay in `./replay.ts`.
 * Nothing is stored: every figure is a read model (EARS-344), and it is read in
 * the budget's currency whatever the reporting currency (decision 13 does not
 * apply).
 *
 * This file is the ONE ledger-side reader of the Bank of Russia rate store
 * (spec 339 EARS-553, narrowed by spec 338 EARS-340 item 3): it builds the
 * provisional value of a member's open foreign-currency debt — the EARS-552
 * lookup, the EARS-551 rule for USD-pegged stablecoins, through RUB — and
 * injects it into the replay as a function. No rate reaches the replay any
 * other way, and no stored amount is computed from one. The EARS-553 isolation
 * test allowlists this path and nothing else under `src/lib/finance/budget/`.
 *
 * Reading is open to every platform member (EARS-339, spec 339 EARS-530).
 */
import { sql } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'

import { assertFinancePlatformMember, type FinanceActor } from '../core/actor'
import { marketQuoteCurrency } from '../fx/market'
import { convertAtRubRates, pickRateOn, type FxRate } from '../fx/rates'
import { rateSeries } from '../fx/store'
import { getLiveBudget } from './budgets'
import {
  replayBudget,
  type BudgetOperationFact,
  type BudgetReading,
  type ProvisionalValuer,
} from './replay'

/** The fund's budget reading, or null while no live budget is recorded. */
export async function getBudgetReading(actor: FinanceActor): Promise<BudgetReading | null> {
  assertFinancePlatformMember(actor)
  const budget = await getLiveBudget(actor)
  if (budget === null) return null
  const operations = await budgetOperationFacts()
  const provisionalValue = await provisionalValuer(budget.currency, operations)
  return replayBudget({
    budget: {
      currency: budget.currency,
      limitAmount: budget.limitAmount,
      startsOn: budget.startsOn,
    },
    operations,
    provisionalValue,
  })
}

async function budgetOperationFacts(): Promise<BudgetOperationFact[]> {
  const db = getPlatformDb()
  const [operationResult, stepResult, postingResult] = await Promise.all([
    db.execute(sql`
      select o.id, o.occurred_on, o.reverses, i.id as intake_item_id, i.settles_item_id
        from core.finance_operation o
        left join core.finance_intake_item i on i.operation_id = o.id
       order by o.occurred_on, o.id
    `),
    db.execute(sql`
      select operation_id, step_no, from_currency, to_currency
        from core.finance_conversion_step
       order by operation_id, step_no
    `),
    db.execute(sql`
      select p.id, p.operation_id, p.account_id, a.kind as account_kind, a.is_system,
             p.currency, p.amount::text as amount, p.project_id, p.member_id,
             cs.step_no as conversion_step_no
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
        left join core.finance_conversion_step cs on cs.id = p.conversion_step_id
       order by p.operation_id, p.id
    `),
  ])

  const nullableNumber = (value: unknown) => (value === null ? null : Number(value))
  const operations = new Map<number, BudgetOperationFact>()
  for (const row of operationResult.rows as Record<string, unknown>[]) {
    const operationId = Number(row.id)
    operations.set(operationId, {
      operationId,
      occurredOn: String(row.occurred_on).slice(0, 10),
      reverses: nullableNumber(row.reverses),
      intakeItemId: nullableNumber(row.intake_item_id),
      settlesItemId: nullableNumber(row.settles_item_id),
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
      postingId: Number(row.id),
      accountId: Number(row.account_id),
      accountKind: String(row.account_kind),
      isSystem: Boolean(row.is_system),
      currency: String(row.currency),
      amount: BigInt(String(row.amount)),
      projectId: nullableNumber(row.project_id),
      memberId: nullableNumber(row.member_id),
      conversionStepNo: nullableNumber(row.conversion_step_no),
    })
  }
  return [...operations.values()]
}

/**
 * EARS-340 item 3 — `quantity` of `currency` at the Bank of Russia rate of the
 * day (the latest stored quote on or before it, EARS-552; USDT/USDC at USD's,
 * EARS-551), converted through RUB into minor units of `B` and rounded once;
 * null where no quote or precision exists (item 7 withholds the figure).
 */
async function provisionalValuer(
  B: string,
  operations: readonly BudgetOperationFact[],
): Promise<ProvisionalValuer> {
  const debtCurrencies = new Set<string>()
  let lastDay = '0000-01-01'
  for (const operation of operations) {
    if (operation.occurredOn > lastDay) lastDay = operation.occurredOn
    for (const posting of operation.postings) {
      if (posting.accountKind === 'liability' && posting.currency !== B) {
        debtCurrencies.add(posting.currency)
      }
    }
  }
  if (debtCurrencies.size === 0) return () => null

  const quoted = new Set([...debtCurrencies, B].map(marketQuoteCurrency))
  const [series, precisions] = await Promise.all([
    rateSeries([...quoted], '0001-01-01', lastDay),
    currencyPrecisions([...debtCurrencies, B]),
  ])
  return (currency, occurredOn, quantity) =>
    valueAt(series, precisions, currency, B, occurredOn, quantity)
}

function valueAt(
  series: readonly FxRate[],
  precisions: ReadonlyMap<string, number>,
  currency: string,
  B: string,
  occurredOn: string,
  quantity: bigint,
): bigint | null {
  const from = pickRateOn(series, marketQuoteCurrency(currency), occurredOn)
  const to = pickRateOn(series, marketQuoteCurrency(B), occurredOn)
  const precisionFrom = precisions.get(currency)
  const precisionTo = precisions.get(B)
  if (from === null || to === null || precisionFrom === undefined || precisionTo === undefined) {
    return null
  }
  return convertAtRubRates(quantity, from, to, precisionFrom, precisionTo).amount
}

async function currencyPrecisions(codes: readonly string[]): Promise<Map<string, number>> {
  const result = await getPlatformDb().execute(sql`
    select code, precision from core.finance_currency
     where code in (${sql.join(
       codes.map((code) => sql`${code}`),
       sql`, `,
     )})
  `)
  return new Map(
    (result.rows as { code: string; precision: number }[]).map((row) => [
      row.code,
      Number(row.precision),
    ]),
  )
}
