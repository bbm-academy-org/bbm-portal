// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  createCurrency,
  createIntakeItem,
  createPurpose,
  createReimbursementTransfer,
  editIntakeItem,
  FinanceRefusal,
  getIntakeItem,
  liabilityBalances,
  postIntakeItem,
  systemAccount,
  transitionIntakeItem,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import {
  ADMIN,
  APPROVER,
  ENTRY,
  fixtureWrite,
  fundProjectId,
  seedCounterparty,
  seedMember,
  truncateFinanceTables,
} from './finance-helpers'

/**
 * The reimbursement route (spec 339 EARS-528, issue #466): the EARS-513 debt to
 * a member is settled by an ordinary `kind = transfer` intake item whose
 * counter account is the system liability account and which names the member.
 * Every other placement of a system account in intake stays refused — at
 * filing, at editing and again at posting.
 */
const db = getPlatformDb()

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

async function seedReferences() {
  const entryMemberId = await seedMember(ENTRY.email, 'Entry Clerk')
  const approverMemberId = await seedMember(APPROVER.email, 'Approver Person')
  const payerMemberId = await seedMember('payer@bbm.academy', 'Payer Person')
  const otherMemberId = await seedMember('other@bbm.academy', 'Other Person')
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
  const rub = await createAccount(ADMIN, { name: 'Карта RUB', kind: 'card', currency: 'RUB' })
  const thb = await createAccount(ADMIN, { name: 'Счёт THB', kind: 'bank', currency: 'THB' })
  const purpose = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'forbidden' })
  const projectId = await fundProjectId()
  const counterpartyId = await seedCounterparty('Vendor', entryMemberId)
  const liability = await systemAccount(ADMIN, 'liability', 'RUB')
  const expense = await systemAccount(ADMIN, 'expense', 'RUB')
  return {
    entryMemberId,
    approverMemberId,
    payerMemberId,
    otherMemberId,
    rubAccountId: rub.id,
    thbAccountId: thb.id,
    purposeId: purpose.id,
    projectId,
    counterpartyId,
    liabilityId: liability.id,
    expenseId: expense.id,
  }
}

type Refs = Awaited<ReturnType<typeof seedReferences>>

function transferInput(refs: Refs, overrides: Record<string, unknown> = {}) {
  return {
    source: 'manual' as const,
    kind: 'transfer' as const,
    occurredOn: '2026-08-21',
    accountId: refs.rubAccountId,
    counterAccountId: refs.liabilityId,
    amount: 300_000n,
    currency: 'RUB',
    projectId: refs.projectId,
    memberId: refs.payerMemberId,
    ...overrides,
  }
}

async function attachDocument(itemId: number, linkedBy: number): Promise<void> {
  await fixtureWrite(async (tx) => {
    const inserted = await tx.execute(sql`
      insert into core.finance_document
        (storage_key, content_digest, filename, mime, size, kind, storage_state, uploaded_by)
      values (${`finance/documents/reimbursement-${itemId}.pdf`},
              ${`sha256:${'0'.repeat(64)}`}, 'payment.pdf', 'application/pdf', 10,
              'payment_order', 'ready', ${linkedBy})
      returning id
    `)
    const documentId = Number((inserted.rows[0] as { id: number }).id)
    await tx.execute(sql`
      insert into core.finance_document_link (document_id, intake_item_id, linked_by)
      values (${documentId}, ${itemId}, ${linkedBy})
    `)
  })
}

/** Drive a manual item through the real machine and post it. */
async function approveAndPost(itemId: number, refs: Refs) {
  await transitionIntakeItem(ENTRY, itemId, 'submit')
  await transitionIntakeItem(APPROVER, itemId, 'approve')
  await attachDocument(itemId, refs.approverMemberId)
  return postIntakeItem(APPROVER, itemId)
}

/** The EARS-513 debt: an expense paid from the member's own card, posted. */
async function postPersonalFundsDebt(refs: Refs, amount: bigint): Promise<void> {
  const debt = await createIntakeItem(ENTRY, {
    source: 'manual',
    kind: 'expense',
    occurredOn: '2026-08-20',
    accountId: null,
    amount,
    currency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
    alreadyPaid: true,
    personalFunds: true,
    memberId: refs.payerMemberId,
  })
  await approveAndPost(debt.id, refs)
}

async function intakeCount(): Promise<number> {
  const result = await db.execute(sql`select count(*)::int as count from core.finance_intake_item`)
  return Number((result.rows[0] as { count: number }).count)
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  )
}

describe('a reimbursement must name the member whose debt it settles (EARS-528)', () => {
  it('EARS-528: refuses filing a transfer to the liability account without a member', async () => {
    const refs = await seedReferences()
    const refusal = await refusalOf(
      createIntakeItem(ENTRY, transferInput(refs, { memberId: null })),
    )
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
    expect(String(refusal)).toContain('участника')
    expect(await intakeCount()).toBe(0)
  })

  it('EARS-528: refuses an edit that drops the member from a reimbursement', async () => {
    const refs = await seedReferences()
    const item = await createIntakeItem(ENTRY, transferInput(refs))
    const refusal = await refusalOf(editIntakeItem(ENTRY, item.id, { memberId: null }))
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
    expect(await getIntakeItem(ENTRY, item.id)).toMatchObject({ memberId: refs.payerMemberId })
  })

  it('EARS-528: refuses a reimbursement in a currency other than the debt it settles', async () => {
    const refs = await seedReferences()
    const refusal = await refusalOf(
      createIntakeItem(
        ENTRY,
        transferInput(refs, { accountId: refs.thbAccountId, currency: 'THB' }),
      ),
    )
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
    expect(await intakeCount()).toBe(0)
  })

  it('EARS-528: posting re-checks a row that reached approved without a member', async () => {
    const refs = await seedReferences()
    // A row the module would refuse today, written raw: posting is the last
    // door and must not trust that every row was filed through the new rule.
    const itemId = await fixtureWrite(async (tx) => {
      const inserted = await tx.execute(sql`
        insert into core.finance_intake_item
          (source, kind, status, occurred_on, account_id, counter_account_id, amount, currency,
           project_id, created_by, decided_by, decided_at)
        values ('manual', 'transfer', 'approved', '2026-08-21', ${refs.rubAccountId},
                ${refs.liabilityId}, 300000, 'RUB', ${refs.projectId}, ${refs.entryMemberId},
                ${refs.approverMemberId}, now())
        returning id
      `)
      return Number((inserted.rows[0] as { id: number }).id)
    })
    await attachDocument(itemId, refs.approverMemberId)
    const refusal = await refusalOf(postIntakeItem(APPROVER, itemId))
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
    expect(await getIntakeItem(APPROVER, itemId)).toMatchObject({
      status: 'approved',
      operationId: null,
    })
  })
})

describe('intake names a system account nowhere else (EARS-528, spec 338 EARS-305)', () => {
  it('EARS-528: refuses the liability account as the money account of a transfer', async () => {
    const refs = await seedReferences()
    const refusal = await refusalOf(
      createIntakeItem(
        ENTRY,
        transferInput(refs, { accountId: refs.liabilityId, counterAccountId: refs.rubAccountId }),
      ),
    )
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
  })

  it('EARS-528: refuses a system account other than liability as a transfer target', async () => {
    const refs = await seedReferences()
    const refusal = await refusalOf(
      createIntakeItem(ENTRY, transferInput(refs, { counterAccountId: refs.expenseId })),
    )
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
  })

  it('EARS-528: refuses the liability account as counter account of an expense', async () => {
    const refs = await seedReferences()
    const refusal = await refusalOf(
      createIntakeItem(ENTRY, {
        source: 'manual',
        kind: 'expense',
        occurredOn: '2026-08-20',
        accountId: refs.rubAccountId,
        counterAccountId: refs.liabilityId,
        amount: 120_000n,
        currency: 'RUB',
        purposeId: refs.purposeId,
        projectId: refs.projectId,
        counterpartyId: refs.counterpartyId,
        memberId: refs.payerMemberId,
      }),
    )
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
    expect(await intakeCount()).toBe(0)
  })

  it('EARS-528: refuses an edit that turns a reimbursement into a different kind', async () => {
    const refs = await seedReferences()
    const item = await createIntakeItem(ENTRY, transferInput(refs))
    const refusal = await refusalOf(editIntakeItem(ENTRY, item.id, { kind: 'income' }))
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
    expect(await getIntakeItem(ENTRY, item.id)).toMatchObject({ kind: 'transfer' })
  })
})

describe('a posted reimbursement lowers exactly that member debt (EARS-513/527/528)', () => {
  it('EARS-528: the member-filtered liability drops by exactly the transferred amount, audited to the poster', async () => {
    const refs = await seedReferences()
    await postPersonalFundsDebt(refs, 875_000n)
    expect(await liabilityBalances({ memberId: refs.payerMemberId })).toEqual([
      expect.objectContaining({ currency: 'RUB', balance: -875_000n }),
    ])

    const repayment = await createReimbursementTransfer(ENTRY, {
      occurredOn: '2026-08-21',
      accountId: refs.rubAccountId,
      amount: 300_000n,
      currency: 'RUB',
      memberId: refs.payerMemberId,
      projectId: refs.projectId,
      note: 'Возврат части долга',
    })
    expect(repayment).toMatchObject({
      source: 'manual',
      kind: 'transfer',
      status: 'draft',
      counterAccountId: refs.liabilityId,
      memberId: refs.payerMemberId,
    })

    const before = await db.execute(sql`select coalesce(max(id), 0) as id from core.audit_event`)
    const since = (before.rows[0] as { id: string }).id
    const posted = await approveAndPost(repayment.id, refs)

    expect(posted.status).toBe('posted')
    expect(await liabilityBalances({ memberId: refs.payerMemberId })).toEqual([
      expect.objectContaining({ currency: 'RUB', balance: -575_000n }),
    ])
    expect(await liabilityBalances({ memberId: refs.otherMemberId })).toEqual([])

    const events = await db.execute(sql`
      select table_name, actor_email from core.audit_event
       where id > ${since}
         and table_name in ('finance_operation', 'finance_posting', 'finance_intake_item')
    `)
    const captured = events.rows as { table_name: string; actor_email: string | null }[]
    const tables = new Set(captured.map((row) => row.table_name))
    expect(tables).toEqual(new Set(['finance_operation', 'finance_posting', 'finance_intake_item']))
    const postingActors = captured
      .filter((row) => row.table_name !== 'finance_intake_item')
      .map((row) => row.actor_email)
    expect(new Set(postingActors)).toEqual(new Set([APPROVER.email]))
  })

  it('EARS-528: the reimbursement route refuses a currency no debt was ever recorded in', async () => {
    const refs = await seedReferences()
    const refusal = await refusalOf(
      createReimbursementTransfer(ENTRY, {
        occurredOn: '2026-08-21',
        accountId: refs.thbAccountId,
        amount: 300_000n,
        currency: 'THB',
        memberId: refs.payerMemberId,
        projectId: refs.projectId,
      }),
    )
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('THB')
    expect(await intakeCount()).toBe(0)
  })
})
