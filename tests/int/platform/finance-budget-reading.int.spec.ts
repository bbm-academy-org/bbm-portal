// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  approveExpenseRequest,
  createAccount,
  createBudget,
  createCurrency,
  createExpenseRequest,
  createIntakeItem,
  createProject,
  createPurpose,
  FinanceAccessRefusal,
  FinanceRefusal,
  getBudgetReading,
  listExpenseRequests,
  markExpenseRequestPaid,
  markExpenseRequestReimbursed,
  postIntakeItem,
  submitExpenseRequest,
  transitionIntakeItem,
  uploadFinanceDocument,
  type BudgetReading,
  type CreateExpenseRequestInput,
} from '@/lib/finance'
import type { FinanceDocumentStorage } from '@/lib/finance/documents/storage'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import {
  ADMIN,
  APPROVER,
  ENTRY,
  MEMBER,
  fixtureWrite,
  fundProjectId,
  seedCounterparty,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'
import { truncateAsFixture } from './privilege-helpers'

/**
 * The budget reading end to end — spec 338 §D EARS-340…345 through the real
 * ledger, and the contribution intake path of spec 339 EARS-567 that feeds it
 * (issue #593). The pure replay is covered fixture by fixture in
 * `tests/unit/finance-budget-replay.spec.ts`; here §D fixtures 1 and 12 run
 * through the posting door, the payment-queue acts and the read-model loader.
 */
const db = getPlatformDb()
const PDF = Buffer.from('%PDF-1.7 contribution statement')
const blobs = new Map<string, Buffer>()
const storage: FinanceDocumentStorage = {
  driver: 'local',
  bucket: null,
  async put(key, body) {
    blobs.set(key, Buffer.from(body))
  },
  async get(key) {
    const body = blobs.get(key)
    if (body === undefined) throw new Error(`Missing fixture object ${key}`)
    return Buffer.from(body)
  },
  async remove(key) {
    blobs.delete(key)
  },
}

beforeEach(async () => {
  blobs.clear()
  await truncateFinanceTables()
  await truncateAsFixture('truncate table core.finance_fx_rate restart identity')
})

afterAll(async () => {
  await closePlatformDb()
})

async function seedRefs() {
  const entryMemberId = await seedMember(ENTRY.email, 'Entry Clerk')
  await seedMember(APPROVER.email, 'Approver Person')
  const memberMemberId = await seedMember(MEMBER.email, 'Plain Member')
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  await createCurrency(ADMIN, { code: 'USD', name: 'Доллар', precision: 2 })
  await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
  const bank = await createAccount(ADMIN, { name: 'Банк RUB', kind: 'bank', currency: 'RUB' })
  const purpose = await createPurpose(ADMIN, { name: 'Сервис', productBinding: 'forbidden' })
  const project = await createProject(ADMIN, { name: 'P' })
  const fundId = await fundProjectId()
  const counterpartyId = await seedCounterparty('Vendor', entryMemberId)
  await createBudget(APPROVER, {
    name: 'Бюджет фонда',
    limitAmount: 200_000n,
    currency: 'RUB',
    startsOn: '2026-01-01',
  })
  return {
    memberMemberId,
    bankId: bank.id,
    purposeId: purpose.id,
    projectId: project.id,
    fundId,
    counterpartyId,
  }
}

type Refs = Awaited<ReturnType<typeof seedRefs>>

async function upload(intakeItemIds: number[]) {
  return uploadFinanceDocument(
    ENTRY,
    {
      filename: 'statement.pdf',
      mime: 'application/pdf',
      bytes: PDF,
      kind: 'fiscal_receipt',
      intakeItemIds,
    },
    storage,
  )
}

/** EARS-567: `finance-entry` files the contribution; `finance-approve` posts it on a document. */
async function contribute(refs: Refs, amount: bigint, occurredOn = '2026-02-01') {
  const item = await createIntakeItem(ENTRY, {
    source: 'manual',
    kind: 'contribution',
    occurredOn,
    accountId: refs.bankId,
    amount,
    currency: 'RUB',
    projectId: refs.fundId,
    memberId: refs.memberMemberId,
  })
  await transitionIntakeItem(ENTRY, item.id, 'submit')
  await transitionIntakeItem(APPROVER, item.id, 'approve')
  await upload([item.id])
  return postIntakeItem(APPROVER, item.id)
}

function request(
  refs: Refs,
  overrides: Partial<CreateExpenseRequestInput> = {},
): CreateExpenseRequestInput {
  return {
    occurredOn: null,
    accountId: null,
    amount: 10_000n,
    currency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
    ...overrides,
  }
}

async function submitted(input: CreateExpenseRequestInput) {
  const draft = await createExpenseRequest(MEMBER, input)
  return submitExpenseRequest(MEMBER, draft.id)
}

async function snapshotOf(id: number): Promise<string> {
  const rows = await listExpenseRequests(APPROVER)
  const row = rows.find((candidate) => candidate.id === id)
  if (row?.snapshot == null) throw new Error(`request #${id} carries no snapshot`)
  return row.snapshot
}

async function paid(input: CreateExpenseRequestInput, occurredOn: string, accountId?: number) {
  const filed = await submitted(input)
  await markExpenseRequestPaid(APPROVER, filed.id, {
    snapshot: await snapshotOf(filed.id),
    occurredOn,
    ...(accountId === undefined ? {} : { accountId }),
  })
  return filed
}

async function reading(): Promise<BudgetReading> {
  const value = await getBudgetReading(MEMBER)
  if (value === null) throw new Error('no live budget')
  return value
}

const known = (amount: bigint) => ({ status: 'known', amount })

function amountOf(figure: BudgetReading['spent']): bigint {
  if (figure.status !== 'known') throw new Error(`withheld: ${figure.currencies.join(', ')}`)
  return figure.amount
}

/** EARS-344 — contributed + income = spent + cash at cost − owed, exactly, in B. */
function expectIdentity(value: BudgetReading): void {
  expect(amountOf(value.contributed) + amountOf(value.income)).toBe(
    amountOf(value.spent) + amountOf(value.cashAtCost) - amountOf(value.owed),
  )
}

describe('the contribution intake path (spec 339 EARS-567)', () => {
  it('EARS-567: a contribution is filed by entry, refused at posting without a document, and posted on one', async () => {
    const refs = await seedRefs()
    expect(
      await createIntakeItem(MEMBER, {
        source: 'manual',
        kind: 'contribution',
        occurredOn: '2026-02-01',
        accountId: refs.bankId,
        amount: 100_000n,
        currency: 'RUB',
        projectId: refs.fundId,
        memberId: refs.memberMemberId,
      }).then(
        () => null,
        (error: unknown) => error,
      ),
    ).toBeInstanceOf(FinanceAccessRefusal)

    const item = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'contribution',
      occurredOn: '2026-02-01',
      accountId: refs.bankId,
      amount: 100_000n,
      currency: 'RUB',
      projectId: refs.fundId,
      memberId: refs.memberMemberId,
    })
    await transitionIntakeItem(ENTRY, item.id, 'submit')
    await transitionIntakeItem(APPROVER, item.id, 'approve')
    await expect(postIntakeItem(APPROVER, item.id)).rejects.toBeInstanceOf(FinanceRefusal)

    await upload([item.id])
    const posted = await postIntakeItem(APPROVER, item.id)
    const legs = await db.execute(sql`
      select a.kind, p.amount::text as amount, p.project_id, p.member_id
        from core.finance_posting p join core.finance_account a on a.id = p.account_id
       where p.operation_id = ${posted.operationId} order by p.id
    `)
    expect(legs.rows).toEqual([
      { kind: 'bank', amount: '100000', project_id: null, member_id: null },
      {
        kind: 'equity',
        amount: '-100000',
        project_id: refs.fundId,
        member_id: refs.memberMemberId,
      },
    ])
    expect(amountOf((await reading()).contributed)).toBe(100_000n)
    expect(amountOf((await reading()).income)).toBe(0n)
  })
})

describe('the budget reading through the ledger (spec 338 §D)', () => {
  it('EARS-341: fixture 1 — the plain path, before and after the member is reimbursed', async () => {
    const refs = await seedRefs()
    await contribute(refs, 100_000n)
    await paid(request(refs, { amount: 30_000n }), '2026-02-02', refs.bankId)
    const own = await paid(
      request(refs, {
        amount: 5_000n,
        projectId: refs.fundId,
        occurredOn: '2026-02-03',
        alreadyPaid: true,
        personalFunds: true,
      }),
      '2026-02-03',
    )
    const pending = await submitted(request(refs, { amount: 10_000n }))
    await approveExpenseRequest(APPROVER, pending.id)

    const before = await reading()
    expect(before).toMatchObject({
      currency: 'RUB',
      limit: 200_000n,
      spent: known(35_000n),
      remaining: known(165_000n),
      contributed: known(100_000n),
      income: known(0n),
      owed: known(5_000n),
      owedProvisional: false,
      cashAtCost: known(70_000n),
      reconciles: true,
    })
    expect(before.breakdown.projects).toEqual(
      expect.arrayContaining([
        { projectId: refs.projectId, spent: known(30_000n) },
        { projectId: refs.fundId, spent: known(5_000n) },
      ]),
    )
    expect(before.breakdown.exchangeResult).toEqual(known(0n))
    expectIdentity(before)

    await markExpenseRequestReimbursed(APPROVER, own.id, {
      snapshot: await snapshotOf(own.id),
      occurredOn: '2026-02-04',
      accountId: refs.bankId,
      amount: 5_000n,
    })
    const after = await reading()
    expect(after).toMatchObject({
      spent: known(35_000n),
      owed: known(0n),
      cashAtCost: known(65_000n),
    })
    expectIdentity(after)
  })

  it('EARS-343: fixture 12 — a foreign-card debt is provisional at the CBR rate until the agent reimbursement replaces it', async () => {
    const refs = await seedRefs()
    await fixtureWrite((tx) =>
      tx.execute(sql`
        insert into core.finance_fx_rate (source, currency, rate_date, nominal, value_rub)
        values ('cbr', 'THB', '2026-02-02', 1, '2.5')
      `),
    )
    await contribute(refs, 100_000n)
    const own = await paid(
      request(refs, {
        amount: 300n,
        currency: 'USD',
        paidAmount: 10_000n,
        paidCurrency: 'THB',
        occurredOn: '2026-02-02',
        alreadyPaid: true,
        personalFunds: true,
      }),
      '2026-02-02',
    )

    const open = await reading()
    expect(open).toMatchObject({
      spent: known(25_000n),
      owed: known(25_000n),
      owedProvisional: true,
      cashAtCost: known(100_000n),
      contributed: known(100_000n),
    })
    expect(open.breakdown.projects).toEqual([{ projectId: refs.projectId, spent: known(25_000n) }])
    expectIdentity(open)

    await markExpenseRequestReimbursed(APPROVER, own.id, {
      snapshot: await snapshotOf(own.id),
      occurredOn: '2026-02-10',
      accountId: refs.bankId,
      amount: 27_000n,
      agentFeeAmount: 1_000n,
    })
    const settled = await reading()
    expect(settled).toMatchObject({
      spent: known(27_000n),
      owed: known(0n),
      owedProvisional: false,
      cashAtCost: known(73_000n),
      contributed: known(100_000n),
    })
    expect(settled.breakdown.projects).toEqual(
      expect.arrayContaining([
        { projectId: refs.projectId, spent: known(25_000n) },
        { projectId: refs.fundId, spent: known(1_000n) },
      ]),
    )
    expect(settled.breakdown.exchangeResult).toEqual(known(1_000n))
    expectIdentity(settled)
  })

  it('EARS-340: with no CBR rate for the debt currency, the figures that include it are withheld naming it', async () => {
    const refs = await seedRefs()
    await contribute(refs, 100_000n)
    await paid(
      request(refs, {
        amount: 300n,
        currency: 'USD',
        paidAmount: 10_000n,
        paidCurrency: 'THB',
        occurredOn: '2026-02-02',
        alreadyPaid: true,
        personalFunds: true,
      }),
      '2026-02-02',
    )

    const value = await reading()
    expect(value.spent).toEqual({ status: 'withheld', currencies: ['THB'] })
    expect(value.owed).toEqual({ status: 'withheld', currencies: ['THB'] })
    expect(value.contributed).toEqual(known(100_000n))
    expect(value.cashAtCost).toEqual(known(100_000n))
  })

  it('EARS-344: every member reads the figures in the budget currency; no budget, no reading', async () => {
    expect(await getBudgetReading(MEMBER)).toBeNull()
    const refs = await seedRefs()
    await contribute(refs, 100_000n)
    for (const actor of [MEMBER, ENTRY, ADMIN, APPROVER]) {
      const value = await getBudgetReading(actor)
      expect(value?.currency).toBe('RUB')
      expect(value?.contributed).toEqual(known(100_000n))
    }
  })
})
