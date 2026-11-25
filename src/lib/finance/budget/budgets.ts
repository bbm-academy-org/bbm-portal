/**
 * The budget record and its write path — spec 338 §D EARS-338/339 (issue #593).
 *
 * A budget is a LIMIT, kept as a record and never as postings: these handlers
 * write `core.finance_budget` and nothing else — no operation, no account, no
 * balance. Only `finance-approve` creates, edits or retires one (EARS-339),
 * however the handler is reached; every write runs through
 * `platformTransaction` with the signed-in actor, so `core.audit_event` is its
 * history. A budget is retired, never deleted. Reading it is open to every
 * platform member (spec 339 EARS-530, decision 32).
 *
 * In v1 only the fund project carries a budget, and one unretired budget per
 * project exists (EARS-338) — the second rule backed by the partial unique index
 * `finance_budget_one_live_per_project`, so a concurrent second create is the
 * same readable refusal, not a constraint name.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { getPlatformDb } from '@/lib/platform/db/client'
import {
  financeBudget,
  type FinanceBudgetRow,
} from '@/lib/platform/db/schema/finance/finance-budget'
import { financeProject } from '@/lib/platform/db/schema/finance/finance-project'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

import {
  assertFinanceBudgetAccess,
  assertFinancePlatformMember,
  financeAuditContext,
  type FinanceActor,
} from '../core/actor'
import { FinanceRefusal } from '../core/errors'
import { requireCurrency, requireFundProject, requireProject } from '../references'

export type FinanceBudgetView = {
  id: number
  projectId: number
  name: string
  /** The limit, minimal units of `currency`. */
  limitAmount: bigint
  currency: string
  startsOn: string
  retiredAt: Date | null
}

// ── the module's schemas (EARS-339: readable refusals, EARS-326) ─────────────

const budgetName = z
  .string({ error: 'Название бюджета — текст.' })
  .trim()
  .min(1, 'Укажите название бюджета.')
const limitAmount = z
  .union([z.bigint(), z.string().trim().regex(/^\d+$/), z.number().int()], {
    error: 'Лимит — целая сумма в минимальных единицах валюты.',
  })
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n, 'Лимит бюджета — положительная сумма.')
const currencyCode = z
  .string({ error: 'Укажите валюту бюджета.' })
  .trim()
  .min(1, 'Укажите валюту бюджета.')
const startsOn = z.iso.date({ error: 'Дата начала бюджета записывается как ГГГГ-ММ-ДД.' })

export const financeBudgetCreateSchema = z
  .object({
    /** Omitted → the fund, the one project v1 accepts (EARS-338). */
    projectId: z.coerce.number().int().positive().optional(),
    name: budgetName,
    limitAmount,
    currency: currencyCode,
    startsOn,
  })
  .strict()

export const financeBudgetUpdateSchema = z
  .object({
    name: budgetName.optional(),
    limitAmount: limitAmount.optional(),
    currency: currencyCode.optional(),
    startsOn: startsOn.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Укажите хотя бы одно изменение бюджета.')

export type CreateFinanceBudgetInput = z.input<typeof financeBudgetCreateSchema>
export type UpdateFinanceBudgetInput = z.input<typeof financeBudgetUpdateSchema>

function parseOrRefuse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  const reasons = [...new Set(parsed.error.issues.map((issue) => issue.message))]
  throw new FinanceRefusal(`Бюджет не записан: ${reasons.join(' ')} (EARS-339).`)
}

// ── writes ───────────────────────────────────────────────────────────────────

/** Record a budget on the fund (EARS-338/339). */
export async function createBudget(
  actor: FinanceActor,
  input: CreateFinanceBudgetInput,
): Promise<FinanceBudgetView> {
  assertFinanceBudgetAccess(actor)
  const values = parseOrRefuse(financeBudgetCreateSchema, input)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const fund = await requireFundProject(tx)
    if (values.projectId !== undefined && values.projectId !== fund.id) {
      const project = await requireProject(tx, values.projectId)
      throw new FinanceRefusal(
        `Бюджет в v1 задаётся только фонду «${fund.name}», а не проекту «${project.name}» ` +
          '(EARS-338).',
      )
    }
    await requireLiveCurrency(tx, values.currency)
    const live = await liveBudgetOf(tx, fund.id)
    if (live !== null) throw secondBudgetRefusal(fund.name, live.name)
    try {
      const [row] = await tx
        .insert(financeBudget)
        .values({
          projectId: fund.id,
          name: values.name,
          limitAmount: values.limitAmount,
          currency: values.currency,
          startsOn: values.startsOn,
        })
        .returning()
      return toView(row)
    } catch (error) {
      if (isConstraint(error, 'finance_budget_one_live_per_project')) {
        throw secondBudgetRefusal(fund.name, null)
      }
      throw error
    }
  })
}

/** Edit a live budget's name, limit, currency or start date (EARS-339). */
export async function updateBudget(
  actor: FinanceActor,
  id: number,
  patch: UpdateFinanceBudgetInput,
): Promise<FinanceBudgetView> {
  assertFinanceBudgetAccess(actor)
  const values = parseOrRefuse(financeBudgetUpdateSchema, patch)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requireLiveBudgetRow(tx, id, 'изменить')
    if (values.currency !== undefined) await requireLiveCurrency(tx, values.currency)
    const [row] = await tx
      .update(financeBudget)
      .set(values)
      .where(eq(financeBudget.id, current.id))
      .returning()
    return toView(row)
  })
}

/** Retire a budget — never delete it (EARS-339). */
export async function retireBudget(actor: FinanceActor, id: number): Promise<FinanceBudgetView> {
  assertFinanceBudgetAccess(actor)
  return platformTransaction(financeAuditContext(actor), async (tx) => {
    const current = await requireLiveBudgetRow(tx, id, 'вывести из обращения')
    const [row] = await tx
      .update(financeBudget)
      .set({ retiredAt: new Date() })
      .where(eq(financeBudget.id, current.id))
      .returning()
    return toView(row)
  })
}

// ── reads (open to every member) ─────────────────────────────────────────────

/**
 * The fund's live budget, or null when none is recorded. Every platform member
 * reads it (EARS-339); the actor is taken so the read names its reader like
 * every other module surface does.
 */
export async function getLiveBudget(actor: FinanceActor): Promise<FinanceBudgetView | null> {
  assertFinancePlatformMember(actor)
  const [row] = await getPlatformDb()
    .select({ budget: financeBudget })
    .from(financeBudget)
    .innerJoin(financeProject, eq(financeProject.id, financeBudget.projectId))
    .where(and(eq(financeProject.isFund, true), isNull(financeBudget.retiredAt)))
  return row === undefined ? null : toView(row.budget)
}

async function liveBudgetOf(tx: PlatformTx, projectId: number): Promise<FinanceBudgetView | null> {
  const [row] = await tx
    .select()
    .from(financeBudget)
    .where(and(eq(financeBudget.projectId, projectId), isNull(financeBudget.retiredAt)))
  return row === undefined ? null : toView(row)
}

async function requireLiveBudgetRow(
  tx: PlatformTx,
  id: number,
  act: string,
): Promise<FinanceBudgetRow> {
  const [row] = await tx.select().from(financeBudget).where(eq(financeBudget.id, id)).for('update')
  if (row === undefined) throw new FinanceRefusal(`Бюджета #${id} нет (EARS-338).`)
  if (row.retiredAt !== null) {
    throw new FinanceRefusal(
      `Бюджет «${row.name}» уже выведен из обращения — его нельзя ${act}; заведите новый ` +
        '(EARS-339).',
    )
  }
  return row
}

async function requireLiveCurrency(tx: PlatformTx, code: string): Promise<void> {
  const currency = await requireCurrency(tx, code, { forShare: true })
  if (currency.retiredAt !== null) {
    throw new FinanceRefusal(`Валюта «${code}» выведена из обращения — бюджет в ней не задаётся.`)
  }
}

function secondBudgetRefusal(fundName: string, liveName: string | null): FinanceRefusal {
  return new FinanceRefusal(
    `У фонда «${fundName}» уже есть действующий бюджет${liveName === null ? '' : ` «${liveName}»`}: ` +
      'второй не заводится — измените действующий или выведите его из обращения (EARS-338).',
  )
}

function isConstraint(error: unknown, constraint: string): boolean {
  const node = error as { code?: string; constraint?: string; cause?: unknown } | undefined
  if (node?.code === '23505') return node.constraint === constraint
  return node?.cause === undefined ? false : isConstraint(node.cause, constraint)
}

function toView(row: FinanceBudgetRow): FinanceBudgetView {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    limitAmount: row.limitAmount,
    currency: row.currency,
    startsOn: row.startsOn,
    retiredAt: row.retiredAt,
  }
}
