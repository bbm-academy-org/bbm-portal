/**
 * The budget dashboard query — spec 584 (issue #586): one §D replay per page
 * read (`./reading.ts`), the drill-down's operation facts and the reference
 * names, handed to the PURE read model in `./dashboard.ts`. Nothing is stored
 * (EARS-702). Reading is open to every platform member (EARS-701).
 */
import { sql } from 'drizzle-orm'

import { getPlatformDb } from '@/lib/platform/db/client'

import { assertFinancePlatformMember, type FinanceActor } from '../core/actor'
import {
  buildBudgetDashboard,
  type BudgetDashboard,
  type BudgetOperationMeta,
  type BudgetPeriodKey,
} from './dashboard'
import type { BudgetDisplayCandidate } from './display-currency'
import { getBudgetDisplayReading } from './reading'

export type BudgetDashboardView = BudgetDashboard & { candidates: BudgetDisplayCandidate[] }

/** `currency` is the requested reporting currency `D` (EARS-721), parsed against the candidates. */
export async function getBudgetDashboard(
  actor: FinanceActor,
  options: { period: BudgetPeriodKey; currency?: string | null },
): Promise<BudgetDashboardView | null> {
  const loaded = await getBudgetDisplayReading(actor, options.currency)
  if (loaded === null) return null
  const { reading, today, display, candidates } = loaded
  const db = getPlatformDb()
  const [operationRows, projectRows, categoryRows, counterpartyRows] = await Promise.all([
    db.execute(sql`
      select o.id, coalesce(ip.name, op.name) as purpose, i.counterparty_id,
             coalesce(i.settles_item_id, i.id) as request_item_id
        from core.finance_operation o
        left join core.finance_intake_item i on i.operation_id = o.id
        left join core.finance_purpose ip on ip.id = i.purpose_id
        left join core.finance_purpose op on op.id = o.purpose_id
    `),
    db.execute(sql`select id, name from core.finance_project`),
    db.execute(sql`select id, name from core.finance_category`),
    db.execute(sql`select id, name from core.finance_counterparty`),
  ])
  const nullableNumber = (value: unknown) => (value === null ? null : Number(value))
  const operations = new Map<number, BudgetOperationMeta>()
  for (const row of operationRows.rows as Record<string, unknown>[]) {
    operations.set(Number(row.id), {
      purpose: row.purpose === null ? null : String(row.purpose),
      counterpartyId: nullableNumber(row.counterparty_id),
      requestItemId: nullableNumber(row.request_item_id),
    })
  }
  const names = (result: { rows: unknown[] }) =>
    new Map(
      (result.rows as { id: number; name: string }[]).map((row) => [Number(row.id), row.name]),
    )
  const dashboard = buildBudgetDashboard({
    reading,
    today,
    display,
    period: options.period,
    operations,
    names: {
      projects: names(projectRows),
      categories: names(categoryRows),
      counterparties: names(counterpartyRows),
    },
  })
  return { ...dashboard, candidates }
}

/** EARS-724 — the date of BBM's first operation, the create form's `starts_on` prefill. */
export async function getFirstOperationOn(actor: FinanceActor): Promise<string | null> {
  assertFinancePlatformMember(actor)
  const result = await getPlatformDb().execute(
    sql`select min(occurred_on)::text as first from core.finance_operation`,
  )
  const first = (result.rows[0] as { first: string | null } | undefined)?.first ?? null
  return first === null ? null : first.slice(0, 10)
}
