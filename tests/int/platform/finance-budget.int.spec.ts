// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createBudget,
  createCurrency,
  createProject,
  FinanceAccessRefusal,
  FinanceRefusal,
  getLiveBudget,
  retireBudget,
  updateBudget,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import {
  ADMIN,
  APPROVER,
  ENTRY,
  MEMBER,
  fundProjectId,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'

/**
 * The budget record and its write path — spec 338 §D EARS-338/339 (issue #593).
 * A budget is a record, never postings; only `finance-approve` writes it, every
 * write lands in `core.audit_event`, it is retired and never deleted, and every
 * member reads it.
 */
const db = getPlatformDb()

beforeEach(async () => {
  await truncateFinanceTables()
  await seedMember(APPROVER.email, 'Approver Person')
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  await createCurrency(ADMIN, { code: 'USD', name: 'Доллар', precision: 2 })
})

afterAll(async () => {
  await closePlatformDb()
})

const BUDGET = {
  name: 'Бюджет фонда',
  limitAmount: 5_000_00n,
  currency: 'RUB',
  startsOn: '2026-01-01',
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a refusal')
}

async function countOf(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from core.${table}`))
  return Number((result.rows[0] as { n: number }).n)
}

describe('the budget record (spec 338 EARS-338/339)', () => {
  it('EARS-338: a budget on the fund is a record that writes no posting and no operation', async () => {
    const budget = await createBudget(APPROVER, BUDGET)

    expect(budget).toMatchObject({
      projectId: await fundProjectId(),
      name: 'Бюджет фонда',
      limitAmount: 5_000_00n,
      currency: 'RUB',
      startsOn: '2026-01-01',
      retiredAt: null,
    })
    expect(await countOf('finance_posting')).toBe(0)
    expect(await countOf('finance_operation')).toBe(0)
    expect(await countOf('finance_account')).toBe(0)
  })

  it('EARS-338: a budget on a project other than the fund is refused in v1', async () => {
    const project = await createProject(ADMIN, { name: 'Курс' })

    const refusal = await refusalOf(createBudget(APPROVER, { ...BUDGET, projectId: project.id }))

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-338')
    expect(await countOf('finance_budget')).toBe(0)
  })

  it('EARS-338: a second unretired budget on the fund is refused; after retiring, a new one is accepted', async () => {
    const first = await createBudget(APPROVER, BUDGET)

    const refusal = await refusalOf(createBudget(APPROVER, { ...BUDGET, name: 'Второй' }))
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-338')

    await retireBudget(APPROVER, first.id)
    const second = await createBudget(APPROVER, { ...BUDGET, name: 'Второй' })
    expect(second.retiredAt).toBeNull()
    // Retired, never deleted: both rows remain.
    expect(await countOf('finance_budget')).toBe(2)
    expect((await getLiveBudget(MEMBER))?.id).toBe(second.id)
  })

  it('EARS-339: creating, editing and retiring are refused without finance-approve, before anything is written', async () => {
    for (const actor of [MEMBER, ENTRY, ADMIN]) {
      const refusal = await refusalOf(createBudget(actor, BUDGET))
      expect(refusal).toBeInstanceOf(FinanceAccessRefusal)
      expect(String(refusal)).toContain('finance-approve')
    }
    const budget = await createBudget(APPROVER, BUDGET)
    for (const actor of [MEMBER, ENTRY, ADMIN]) {
      expect(await refusalOf(updateBudget(actor, budget.id, { limitAmount: 1n }))).toBeInstanceOf(
        FinanceAccessRefusal,
      )
      expect(await refusalOf(retireBudget(actor, budget.id))).toBeInstanceOf(FinanceAccessRefusal)
    }
    expect((await getLiveBudget(MEMBER))?.limitAmount).toBe(5_000_00n)
  })

  it('EARS-339: every change of the limit is recorded in core.audit_event with the signed-in actor', async () => {
    const budget = await createBudget(APPROVER, BUDGET)
    const edited = await updateBudget(APPROVER, budget.id, {
      name: 'Бюджет фонда 2026',
      limitAmount: 7_000_00n,
      currency: 'USD',
      startsOn: '2026-02-01',
    })
    expect(edited).toMatchObject({
      name: 'Бюджет фонда 2026',
      limitAmount: 7_000_00n,
      currency: 'USD',
      startsOn: '2026-02-01',
    })

    const audited = await db.execute(sql`
      select op, actor_email, diff from core.audit_event
       where table_name = 'finance_budget' order by id
    `)
    const rows = audited.rows as {
      op: string
      actor_email: string
      diff: Record<string, unknown>
    }[]
    expect(rows.map((row) => row.actor_email)).toEqual([APPROVER.email, APPROVER.email])
    expect(rows[1]?.diff.limit_amount).toEqual({ old: 500000, new: 700000 })
  })

  it('EARS-339: invalid input is refused readably through the module schema', async () => {
    for (const bad of [
      { ...BUDGET, name: '   ' },
      { ...BUDGET, limitAmount: 0n },
      { ...BUDGET, limitAmount: -5n },
      { ...BUDGET, startsOn: '01.01.2026' },
      { ...BUDGET, currency: 'XXX' },
    ]) {
      const refusal = await refusalOf(createBudget(APPROVER, bad))
      expect(refusal).toBeInstanceOf(FinanceRefusal)
      expect(String(refusal)).not.toMatch(/ZodError|violates|constraint/)
    }
    expect(await countOf('finance_budget')).toBe(0)
  })

  it('EARS-339: a retired budget is not edited, and a budget is never deleted', async () => {
    const budget = await createBudget(APPROVER, BUDGET)
    await retireBudget(APPROVER, budget.id)

    expect(await refusalOf(updateBudget(APPROVER, budget.id, { limitAmount: 1n }))).toBeInstanceOf(
      FinanceRefusal,
    )
    expect(await refusalOf(retireBudget(APPROVER, budget.id))).toBeInstanceOf(FinanceRefusal)
    expect(await getLiveBudget(MEMBER)).toBeNull()
    expect(await countOf('finance_budget')).toBe(1)
  })

  it('EARS-339: every platform member reads the live budget', async () => {
    await createBudget(APPROVER, BUDGET)
    for (const actor of [MEMBER, ENTRY, ADMIN, APPROVER]) {
      expect((await getLiveBudget(actor))?.name).toBe('Бюджет фонда')
    }
  })
})
