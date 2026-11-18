// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  approveExpenseRequest,
  bulkMarkExpenseRequestsPaid,
  cancelExpenseRequest,
  createAccount,
  createCurrency,
  createExpenseRequest,
  createIntakeItem,
  createPurpose,
  createReimbursementTransfer,
  deleteFinanceDocument,
  FinanceAccessRefusal,
  FinanceRefusal,
  getExpenseRequest,
  liabilityBalances,
  listExpenseRequests,
  listFinanceDocuments,
  markExpenseRequestPaid,
  markExpenseRequestReimbursed,
  postIntakeItem,
  recordConversion,
  refuseExpenseRequest,
  submitExpenseRequest,
  transitionIntakeItem,
  uploadFinanceDocument,
  type CreateExpenseRequestInput,
  type FinanceActor,
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
import { asMigrator } from './privilege-helpers'

/**
 * The owner's payment queue — the domain half (spec 339 §I, issue #549):
 * mark-paid without a document (EARS-506/543), approve that never posts
 * (EARS-510), the refund act that books the debt and settles it in one
 * transaction (EARS-544, EARS-528's `settles_item`), attach-later
 * (EARS-545) and the bulk retroactive act (EARS-547/548).
 */
const db = getPlatformDb()
const PDF = Buffer.from('%PDF-1.7 payment queue receipt')
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
})

afterAll(async () => {
  await closePlatformDb()
})

async function seedRefs() {
  const entryMemberId = await seedMember(ENTRY.email, 'Entry Clerk')
  const approverMemberId = await seedMember(APPROVER.email, 'Approver Person')
  const memberMemberId = await seedMember(MEMBER.email, 'Plain Member')
  const otherMemberId = await seedMember('other@bbm.academy', 'Other Person')
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  await createCurrency(ADMIN, { code: 'USD', name: 'Доллар', precision: 2 })
  const rub = await createAccount(ADMIN, { name: 'Карта RUB', kind: 'card', currency: 'RUB' })
  const usd = await createAccount(ADMIN, { name: 'Счёт USD', kind: 'bank', currency: 'USD' })
  const purpose = await createPurpose(ADMIN, { name: 'Хостинг', productBinding: 'forbidden' })
  const projectId = await fundProjectId()
  const counterpartyId = await seedCounterparty('Vendor', entryMemberId)
  return {
    entryMemberId,
    approverMemberId,
    memberMemberId,
    otherMemberId,
    rubAccountId: rub.id,
    usdAccountId: usd.id,
    purposeId: purpose.id,
    projectId,
    counterpartyId,
  }
}

type Refs = Awaited<ReturnType<typeof seedRefs>>

/** A pre-spend request: no money date, no paying account (EARS-508/533). */
function preSpend(refs: Refs, overrides: Partial<CreateExpenseRequestInput> = {}) {
  return {
    occurredOn: null,
    accountId: null,
    amount: 120_000n,
    currency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
    ...overrides,
  } satisfies CreateExpenseRequestInput
}

/** An «уже потрачено» request paid from the member's own card (EARS-513). */
function ownFunds(refs: Refs, overrides: Partial<CreateExpenseRequestInput> = {}) {
  return preSpend(refs, {
    occurredOn: '2026-09-01',
    alreadyPaid: true,
    personalFunds: true,
    ...overrides,
  })
}

async function submitted(actor: FinanceActor, input: CreateExpenseRequestInput) {
  const draft = await createExpenseRequest(actor, input)
  return submitExpenseRequest(actor, draft.id)
}

async function approved(actor: FinanceActor, input: CreateExpenseRequestInput) {
  const request = await submitted(actor, input)
  return approveExpenseRequest(APPROVER, request.id)
}

async function upload(actor: FinanceActor, intakeItemIds: number[]) {
  return uploadFinanceDocument(
    actor,
    {
      filename: 'receipt.pdf',
      mime: 'application/pdf',
      bytes: PDF,
      kind: 'fiscal_receipt',
      intakeItemIds,
    },
    storage,
  )
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  )
}

async function auditCursor(): Promise<string> {
  const result = await db.execute(
    sql`select coalesce(max(id), 0)::text as id from core.audit_event`,
  )
  return (result.rows[0] as { id: string }).id
}

async function eventsSince(since: string, table: string) {
  const result = await db.execute(sql`
    select txid, actor_email, pk, diff from core.audit_event
     where id > ${since} and table_name = ${table}
     order by id
  `)
  return result.rows as {
    txid: string
    actor_email: string | null
    pk: Record<string, unknown>
    diff: Record<string, { new?: unknown }>
  }[]
}

async function transfersSettling(itemId: number) {
  const result = await db.execute(sql`
    select id, status, amount::text as amount, currency, occurred_on::text as occurred_on,
           member_id, operation_id
      from core.finance_intake_item
     where settles_item_id = ${itemId}
  `)
  return result.rows as {
    id: number
    status: string
    amount: string
    currency: string
    occurred_on: string
    member_id: number
    operation_id: number | null
  }[]
}

function rubBalance(balances: Awaited<ReturnType<typeof liabilityBalances>>): bigint {
  return balances.find((row) => row.currency === 'RUB')?.balance ?? 0n
}

async function queueRow(actor: FinanceActor, id: number) {
  const row = (await listExpenseRequests(actor)).find((request) => request.id === id)
  if (row === undefined) throw new Error(`request #${id} is not on the queue`)
  return row
}

/** The EARS-548 token the queue shows an approver for this request — what a card sends back. */
async function snapshotOf(id: number): Promise<string> {
  const { snapshot } = await queueRow(APPROVER, id)
  if (snapshot === null) throw new Error(`request #${id} carries no snapshot for the approver`)
  return snapshot
}

describe('marking paid needs no document (EARS-506/510/543)', () => {
  it('EARS-506: an approved pre-spend request with zero documents posts through mark-paid with account and date', async () => {
    const refs = await seedRefs()
    const request = await approved(MEMBER, preSpend(refs))
    expect(await listFinanceDocuments(APPROVER, { intakeItemId: request.id })).toEqual([])

    const posted = await markExpenseRequestPaid(APPROVER, request.id, {
      snapshot: await snapshotOf(request.id),
      occurredOn: '2026-09-02',
      accountId: refs.rubAccountId,
    })

    expect(posted).toMatchObject({
      status: 'posted',
      occurredOn: '2026-09-02',
      accountId: refs.rubAccountId,
      postedBy: refs.approverMemberId,
    })
    expect(posted.operationId).not.toBeNull()
  })

  it('EARS-510: approving a submitted request that HAS an attached invoice leaves it approved, unposted', async () => {
    const refs = await seedRefs()
    const request = await submitted(MEMBER, preSpend(refs))
    await upload(MEMBER, [request.id])

    const result = await approveExpenseRequest(APPROVER, request.id)

    expect(result).toMatchObject({ status: 'approved', operationId: null, postedBy: null })
    expect(result.decidedBy).toBe(refs.approverMemberId)
  })

  it('EARS-510: approve alone refuses the posting act’s money facts instead of posting', async () => {
    const refs = await seedRefs()
    const request = await submitted(MEMBER, preSpend(refs))
    await upload(MEMBER, [request.id])

    const refusal = await refusalOf(
      approveExpenseRequest(APPROVER, request.id, {
        occurredOn: '2026-09-02',
        accountId: refs.rubAccountId,
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({ status: 'submitted' })
  })

  it('EARS-543: mark-paid on a submitted item approves and posts in one transaction', async () => {
    const refs = await seedRefs()
    const request = await submitted(MEMBER, preSpend(refs))
    const since = await auditCursor()

    const posted = await markExpenseRequestPaid(APPROVER, request.id, {
      snapshot: await snapshotOf(request.id),
      occurredOn: '2026-09-03',
      accountId: refs.rubAccountId,
    })

    expect(posted).toMatchObject({
      status: 'posted',
      decidedBy: refs.approverMemberId,
      postedBy: refs.approverMemberId,
    })
    const itemEvents = await eventsSince(since, 'finance_intake_item')
    const operationEvents = await eventsSince(since, 'finance_operation')
    expect(itemEvents.length).toBeGreaterThan(0)
    const txids = new Set([...itemEvents, ...operationEvents].map((event) => event.txid))
    expect(txids.size).toBe(1)
    expect(itemEvents.map((event) => event.diff.status?.new)).not.toContain('approved')
  })

  it('EARS-543: a USD document paid from a RUB account without the debited amount is refused, naming the missing fact', async () => {
    const refs = await seedRefs()
    const request = await approved(MEMBER, preSpend(refs, { amount: 10_000n, currency: 'USD' }))

    const refusal = await refusalOf(
      markExpenseRequestPaid(APPROVER, request.id, {
        snapshot: await snapshotOf(request.id),
        occurredOn: '2026-09-03',
        accountId: refs.rubAccountId,
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toMatch(/сумм/i)
    expect(String(refusal)).toContain('RUB')
    expect(String(refusal)).toContain('EARS-543')
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({
      status: 'approved',
      operationId: null,
    })
  })

  it('EARS-543: a mark-paid over a request that changed after the card read it is refused and posts nothing', async () => {
    const refs = await seedRefs()
    const request = await approved(MEMBER, preSpend(refs))
    const seen = await snapshotOf(request.id)
    await fixtureWrite((tx) =>
      tx.execute(sql`
        update core.finance_intake_item set amount = 150000 where id = ${request.id}
      `),
    )

    const refusal = await refusalOf(
      markExpenseRequestPaid(APPROVER, request.id, {
        snapshot: seen,
        occurredOn: '2026-09-02',
        accountId: refs.rubAccountId,
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain(`#${request.id}`)
    expect(String(refusal)).toContain('EARS-548')
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({
      status: 'approved',
      operationId: null,
    })
  })

  it('EARS-543: a receipt attached after the card was read makes its mark-paid stale', async () => {
    const refs = await seedRefs()
    const request = await submitted(MEMBER, preSpend(refs))
    const seen = await snapshotOf(request.id)
    await upload(MEMBER, [request.id])

    const refusal = await refusalOf(
      markExpenseRequestPaid(APPROVER, request.id, {
        snapshot: seen,
        occurredOn: '2026-09-02',
        accountId: refs.rubAccountId,
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({ status: 'submitted' })
  })

  it('EARS-543: a role-less member is refused as an access refusal, before any data is read', async () => {
    const refs = await seedRefs()
    const request = await approved(MEMBER, preSpend(refs))

    const own = await refusalOf(
      markExpenseRequestPaid(MEMBER, request.id, {
        snapshot: 'x',
        occurredOn: '2026-09-03',
        accountId: refs.rubAccountId,
      }),
    )
    const missing = await refusalOf(
      markExpenseRequestPaid(MEMBER, 999_999, {
        snapshot: 'x',
        occurredOn: '2026-09-03',
        accountId: refs.rubAccountId,
      }),
    )

    expect(own).toBeInstanceOf(FinanceAccessRefusal)
    expect(missing).toBeInstanceOf(FinanceAccessRefusal)
  })

  it('EARS-543: with a USD/RUB conversion posted on day D, an earlier-dated USD mark-paid from RUB is refused naming D', async () => {
    const refs = await seedRefs()
    await recordConversion(APPROVER, {
      occurredOn: '2026-09-10',
      sourceAccountId: refs.rubAccountId,
      targetAccountId: refs.usdAccountId,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'USD',
          fromAmount: 1_000_000n,
          toAmount: 10_000n,
          rate: '0.01',
        },
      ],
    })
    const request = await approved(MEMBER, preSpend(refs, { amount: 10_000n, currency: 'USD' }))

    const refusal = await refusalOf(
      markExpenseRequestPaid(APPROVER, request.id, {
        snapshot: await snapshotOf(request.id),
        occurredOn: '2026-09-05',
        accountId: refs.rubAccountId,
        paidAmount: 900_000n,
        paidCurrency: 'RUB',
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('2026-09-10')
    expect(String(refusal)).toContain('отметьте более ранние валютные оплаты раньше более поздних')
    expect(String(refusal)).not.toContain('backfill')
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({ status: 'approved' })
  })
})

describe('the refund act books the debt and settles it at once (EARS-544/528)', () => {
  it('EARS-544: an unposted USD personal-funds request refunded with 9 000 ₽ books the debt in RUB and settles it', async () => {
    const refs = await seedRefs()
    const prior = rubBalance(await liabilityBalances({ memberId: refs.memberMemberId }))
    const request = await submitted(MEMBER, ownFunds(refs, { amount: 10_000n, currency: 'USD' }))

    const settled = await markExpenseRequestReimbursed(APPROVER, request.id, {
      snapshot: await snapshotOf(request.id),
      occurredOn: '2026-09-04',
      accountId: refs.rubAccountId,
      amount: 900_000n,
    })

    expect(settled).toMatchObject({
      status: 'posted',
      paidAmount: 900_000n,
      paidCurrency: 'RUB',
      occurredOn: '2026-09-01',
      decidedBy: refs.approverMemberId,
      postedBy: refs.approverMemberId,
    })
    const transfers = await transfersSettling(request.id)
    expect(transfers).toEqual([
      expect.objectContaining({
        status: 'posted',
        amount: '900000',
        currency: 'RUB',
        occurred_on: '2026-09-04',
        member_id: refs.memberMemberId,
      }),
    ])
    expect(rubBalance(await liabilityBalances({ memberId: refs.memberMemberId }))).toBe(prior)
    expect((await queueRow(APPROVER, request.id)).stage).toBe('paid')

    const second = await refusalOf(
      markExpenseRequestReimbursed(APPROVER, request.id, {
        snapshot: await snapshotOf(request.id),
        occurredOn: '2026-09-05',
        accountId: refs.rubAccountId,
        amount: 900_000n,
      }),
    )
    expect(second).toBeInstanceOf(FinanceRefusal)
    expect(await transfersSettling(request.id)).toHaveLength(1)
  })

  it('EARS-544: on an already-posted USD-liability request a RUB refund is refused readably', async () => {
    const refs = await seedRefs()
    const request = await submitted(MEMBER, ownFunds(refs, { amount: 10_000n, currency: 'USD' }))
    await markExpenseRequestPaid(APPROVER, request.id, {
      snapshot: await snapshotOf(request.id),
      occurredOn: '2026-09-01',
    })
    expect((await queueRow(APPROVER, request.id)).stage).toBe('reimburse')

    const refusal = await refusalOf(
      markExpenseRequestReimbursed(APPROVER, request.id, {
        snapshot: await snapshotOf(request.id),
        occurredOn: '2026-09-04',
        accountId: refs.rubAccountId,
        amount: 900_000n,
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('USD')
    expect(String(refusal)).toContain('EARS-544')
    expect(await transfersSettling(request.id)).toEqual([])
  })

  it('EARS-544: a same-currency refund that is not the whole liability is refused naming the required sum', async () => {
    const refs = await seedRefs()
    const request = await submitted(MEMBER, ownFunds(refs, { amount: 120_000n }))

    const refusal = await refusalOf(
      markExpenseRequestReimbursed(APPROVER, request.id, {
        snapshot: await snapshotOf(request.id),
        occurredOn: '2026-09-04',
        accountId: refs.rubAccountId,
        amount: 100_000n,
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toMatch(/1\s?200[,.]00|120000/)
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({ status: 'submitted' })
    expect(await transfersSettling(request.id)).toEqual([])
  })

  it('EARS-544: a refund over a request that changed after the card read it is refused and writes nothing', async () => {
    const refs = await seedRefs()
    const request = await submitted(MEMBER, ownFunds(refs))
    const seen = await snapshotOf(request.id)
    await fixtureWrite((tx) =>
      tx.execute(sql`
        update core.finance_intake_item set note = 'изменено после открытия карточки'
         where id = ${request.id}
      `),
    )

    const refusal = await refusalOf(
      markExpenseRequestReimbursed(APPROVER, request.id, {
        snapshot: seen,
        occurredOn: '2026-09-04',
        accountId: refs.rubAccountId,
        amount: 120_000n,
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-548')
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({ status: 'submitted' })
    expect(await transfersSettling(request.id)).toEqual([])
  })

  it('EARS-544: a refund with a receipt on a refused or cancelled request is a readable refusal, nothing linked', async () => {
    const refs = await seedRefs()
    const refused = await submitted(MEMBER, ownFunds(refs))
    await refuseExpenseRequest(APPROVER, refused.id, 'не наш расход')
    const cancelled = await submitted(MEMBER, ownFunds(refs))
    await cancelExpenseRequest(MEMBER, cancelled.id)
    const receipt = await upload(ENTRY, [])

    for (const request of [refused, cancelled]) {
      const refusal = await refusalOf(
        markExpenseRequestReimbursed(APPROVER, request.id, {
          snapshot: await snapshotOf(request.id),
          occurredOn: '2026-09-04',
          accountId: refs.rubAccountId,
          amount: 120_000n,
          documentIds: [receipt.id],
        }),
      )
      expect(refusal).toBeInstanceOf(FinanceRefusal)
      expect(String(refusal)).toContain(`#${request.id}`)
      expect(String(refusal)).toMatch(/EARS-524\/544/)
    }
    const links = await db.execute(sql`
      select count(*)::int as n from core.finance_document_link where document_id = ${receipt.id}
    `)
    expect((links.rows[0] as { n: number }).n).toBe(0)
  })

  it('EARS-544: a role-less member cannot mark a refund', async () => {
    const refs = await seedRefs()
    const request = await submitted(MEMBER, ownFunds(refs))
    const refusal = await refusalOf(
      markExpenseRequestReimbursed(MEMBER, request.id, {
        snapshot: 'x',
        occurredOn: '2026-09-04',
        accountId: refs.rubAccountId,
        amount: 120_000n,
      }),
    )
    expect(refusal).toBeInstanceOf(FinanceAccessRefusal)
  })
})

describe('every non-backfill reimbursement names the item it settles (EARS-528)', () => {
  /** A posted RUB personal-funds request of MEMBER — the debt to settle. */
  async function postedDebt(refs: Refs, amount = 120_000n) {
    const request = await submitted(MEMBER, ownFunds(refs, { amount }))
    return markExpenseRequestPaid(APPROVER, request.id, {
      snapshot: await snapshotOf(request.id),
      occurredOn: '2026-09-01',
    })
  }

  function reimbursement(refs: Refs, overrides: Record<string, unknown> = {}) {
    return {
      occurredOn: '2026-09-05',
      accountId: refs.rubAccountId,
      amount: 120_000n,
      currency: 'RUB',
      memberId: refs.memberMemberId,
      projectId: refs.projectId,
      ...overrides,
    }
  }

  it('EARS-528: a liability transfer without settles_item is refused', async () => {
    const refs = await seedRefs()
    await postedDebt(refs)
    const refusal = await refusalOf(createReimbursementTransfer(ENTRY, reimbursement(refs)))
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
  })

  it('EARS-528: a different member, currency or amount than the settled item is refused', async () => {
    const refs = await seedRefs()
    const debt = await postedDebt(refs)

    const otherMember = await refusalOf(
      createReimbursementTransfer(
        ENTRY,
        reimbursement(refs, { settlesItemId: debt.id, memberId: refs.otherMemberId }),
      ),
    )
    const otherAmount = await refusalOf(
      createReimbursementTransfer(
        ENTRY,
        reimbursement(refs, { settlesItemId: debt.id, amount: 100_000n }),
      ),
    )
    // A USD liability account has to exist for the currency refusal to be the
    // settlement rule's and not «no debt in USD».
    const usdDebt = await submitted(MEMBER, ownFunds(refs, { amount: 5_000n, currency: 'USD' }))
    await markExpenseRequestPaid(APPROVER, usdDebt.id, {
      snapshot: await snapshotOf(usdDebt.id),
      occurredOn: '2026-09-01',
    })
    const otherCurrency = await refusalOf(
      createReimbursementTransfer(
        ENTRY,
        reimbursement(refs, {
          settlesItemId: debt.id,
          accountId: refs.usdAccountId,
          currency: 'USD',
        }),
      ),
    )

    for (const refusal of [otherMember, otherAmount, otherCurrency]) {
      expect(refusal).toBeInstanceOf(FinanceRefusal)
      expect(String(refusal)).toContain('EARS-528')
    }
    expect(String(otherMember)).toMatch(/участник/i)
    expect(String(otherAmount)).toMatch(/сумм/i)
    expect(String(otherCurrency)).toMatch(/валют/i)
  })

  it('EARS-528: naming an item another transfer already settles is refused', async () => {
    const refs = await seedRefs()
    const debt = await postedDebt(refs)
    await createReimbursementTransfer(ENTRY, reimbursement(refs, { settlesItemId: debt.id }))

    const refusal = await refusalOf(
      createReimbursementTransfer(ENTRY, reimbursement(refs, { settlesItemId: debt.id })),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
    expect(String(refusal)).toContain(`#${debt.id}`)
  })

  it('EARS-528: naming an item that is not a posted personal-funds item is refused', async () => {
    const refs = await seedRefs()
    const unposted = await submitted(MEMBER, ownFunds(refs))
    const refusal = await refusalOf(
      createReimbursementTransfer(ENTRY, reimbursement(refs, { settlesItemId: unposted.id })),
    )
    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain('EARS-528')
  })

  it('EARS-528: a backfill liability transfer without settles_item still posts', async () => {
    const refs = await seedRefs()
    await postedDebt(refs)
    const liability = await db.execute(sql`
      select id from core.finance_account where kind = 'liability' and currency = 'RUB'
    `)
    const liabilityId = Number((liability.rows[0] as { id: number }).id)
    const item = await createIntakeItem(ENTRY, {
      source: 'backfill',
      kind: 'transfer',
      occurredOn: '2026-09-05',
      accountId: refs.rubAccountId,
      counterAccountId: liabilityId,
      amount: 50_000n,
      currency: 'RUB',
      projectId: refs.projectId,
      memberId: refs.memberMemberId,
      sourceRef: 'mm:post-backfill-reimbursement',
    })
    await transitionIntakeItem(ENTRY, item.id, 'submit')
    await transitionIntakeItem(APPROVER, item.id, 'approve')
    await upload(ENTRY, [item.id])

    const posted = await postIntakeItem(APPROVER, item.id)

    expect(posted).toMatchObject({ status: 'posted' })
  })

  /** The migration's data step, exactly as 0019 ships it. */
  function dataStepSql(): string {
    const step = readFileSync(
      resolve(process.cwd(), 'src/lib/platform/db/migrations/0019_finance_settles_item.sql'),
      'utf8',
    )
    const begin = step.indexOf('-- data-step:begin')
    const end = step.indexOf('-- data-step:end')
    expect(begin).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(begin)
    return step.slice(begin, end).replaceAll('--> statement-breakpoint', '')
  }

  /** A posted RUB liability transfer written the pre-0019 way — no `settles_item_id`. */
  async function legacyTransfer(refs: Refs): Promise<number> {
    return fixtureWrite(async (tx) => {
      const liability = await tx.execute(sql`
        select id from core.finance_account where kind = 'liability' and currency = 'RUB'
      `)
      const liabilityId = Number((liability.rows[0] as { id: number }).id)
      const operation = await tx.execute(sql`
        insert into core.finance_operation (occurred_on, source) values ('2026-09-06', 'manual')
        returning id
      `)
      const inserted = await tx.execute(sql`
        insert into core.finance_intake_item
          (source, kind, status, occurred_on, account_id, counter_account_id, amount,
           currency, project_id, member_id, created_by, decided_by, decided_at,
           posted_by, posted_at, operation_id)
        values ('manual', 'transfer', 'posted', '2026-09-06', ${refs.rubAccountId},
                ${liabilityId}, 120000, 'RUB', ${refs.projectId}, ${refs.memberMemberId},
                ${refs.entryMemberId}, ${refs.approverMemberId}, now(),
                ${refs.approverMemberId}, now(),
                ${Number((operation.rows[0] as { id: number }).id)})
        returning id
      `)
      return Number((inserted.rows[0] as { id: number }).id)
    })
  }

  it('EARS-528: the one-time data step links a pre-column transfer to its single candidate and stops on ambiguity', async () => {
    const dataStep = dataStepSql()
    const refs = await seedRefs()
    const debt = await postedDebt(refs)

    const linked = await legacyTransfer(refs)
    await asMigrator((client) => client.query(dataStep))
    const after = await db.execute(sql`
      select settles_item_id from core.finance_intake_item where id = ${linked}
    `)
    expect((after.rows[0] as { settles_item_id: number | null }).settles_item_id).toBe(debt.id)

    // A second transfer of the same member and sum: no unsettled candidate is
    // left for it, so the step must stop and name it rather than guess.
    const orphan = await legacyTransfer(refs)
    const refusal = await refusalOf(asMigrator((client) => client.query(dataStep)))
    expect(String(refusal)).toContain(String(orphan))
  })

  it('EARS-528: the data step stops on MORE than one candidate, names the transfer and links nothing', async () => {
    const dataStep = dataStepSql()
    const refs = await seedRefs()
    // Two identical posted debts of one member: the transfer could settle
    // either, so the step must not pick one.
    await postedDebt(refs)
    await postedDebt(refs)
    const ambiguous = await legacyTransfer(refs)

    const refusal = await refusalOf(asMigrator((client) => client.query(dataStep)))

    expect(String(refusal)).toContain('EARS-528')
    expect(String(refusal)).toContain(`#${ambiguous} (кандидатов: 2)`)
    const after = await db.execute(sql`
      select count(*)::int as n from core.finance_intake_item where settles_item_id is not null
    `)
    expect((after.rows[0] as { n: number }).n).toBe(0)
  })
})

describe('the queue stage and the «без чека» fact come from the read model (EARS-535)', () => {
  it('EARS-535: listExpenseRequests carries the derived stage and whether a document is attached', async () => {
    const refs = await seedRefs()
    const decide = await submitted(MEMBER, preSpend(refs))
    const pay = await approved(MEMBER, preSpend(refs))
    const companyPaid = await submitted(
      ENTRY,
      preSpend(refs, {
        occurredOn: '2026-09-01',
        accountId: refs.rubAccountId,
        alreadyPaid: true,
      }),
    )
    const reimburse = await submitted(MEMBER, ownFunds(refs))
    const refused = await submitted(MEMBER, preSpend(refs))
    await refuseExpenseRequest(APPROVER, refused.id, 'не наш расход')
    await upload(MEMBER, [pay.id])

    const rows = new Map((await listExpenseRequests(APPROVER)).map((row) => [row.id, row]))

    expect(rows.get(decide.id)).toMatchObject({ stage: 'decide', hasDocument: false })
    expect(rows.get(pay.id)).toMatchObject({ stage: 'pay', hasDocument: true })
    expect(rows.get(companyPaid.id)).toMatchObject({ stage: 'pay' })
    expect(rows.get(reimburse.id)).toMatchObject({ stage: 'reimburse' })
    expect(rows.get(refused.id)).toMatchObject({ stage: 'refused' })
    expect(typeof rows.get(pay.id)?.snapshot).toBe('string')
  })
})

describe('a receipt may follow the posting (EARS-545)', () => {
  it('EARS-545: a document attached after posting is readable from the operation; deleting it is refused', async () => {
    const refs = await seedRefs()
    const request = await approved(MEMBER, preSpend(refs))
    const posted = await markExpenseRequestPaid(APPROVER, request.id, {
      snapshot: await snapshotOf(request.id),
      occurredOn: '2026-09-02',
      accountId: refs.rubAccountId,
    })

    const document = await upload(MEMBER, [request.id])

    const viaOperation = await db.execute(sql`
      select dl.document_id
        from core.finance_document_link dl
        join core.finance_intake_item i on i.id = dl.intake_item_id
       where i.operation_id = ${posted.operationId}
    `)
    expect(
      viaOperation.rows.map((row) => Number((row as { document_id: number }).document_id)),
    ).toEqual([document.id])
    expect((await queueRow(APPROVER, request.id)).hasDocument).toBe(true)
    expect(await getExpenseRequest(APPROVER, request.id)).toMatchObject({
      status: 'posted',
      amount: posted.amount,
    })
    await expect(deleteFinanceDocument(MEMBER, document.id, storage)).rejects.toThrow(/EARS-516/)
  })

  it('EARS-545: attaching to a refused or cancelled request stays refused — module and database', async () => {
    const refs = await seedRefs()
    const refused = await submitted(MEMBER, preSpend(refs))
    await refuseExpenseRequest(APPROVER, refused.id, 'не наш расход')

    await expect(upload(MEMBER, [refused.id])).rejects.toThrow(FinanceRefusal)

    const direct = await refusalOf(
      fixtureWrite(async (tx) => {
        const inserted = await tx.execute(sql`
          insert into core.finance_document
            (storage_key, content_digest, filename, mime, size, kind, uploaded_by)
          values (${`finance/documents/direct-${Date.now()}.pdf`},
                  ${`sha256:${'1'.repeat(64)}`}, 'direct.pdf', 'application/pdf', 6, 'other',
                  ${refs.entryMemberId})
          returning id
        `)
        await tx.execute(sql`
          insert into core.finance_document_link (document_id, intake_item_id, linked_by)
          values (${Number((inserted.rows[0] as { id: number }).id)}, ${refused.id},
                  ${refs.entryMemberId})
        `)
      }),
    )
    const cause = (direct as { cause?: { message?: string } } | null)?.cause
    expect(String(cause?.message ?? direct)).toMatch(/EARS-516|EARS-545/)
  })
})

describe('the bulk retroactive act (EARS-547/548)', () => {
  it('EARS-547: bulk over 3 eligible RUB items and 1 USD item posts exactly 3 in one transaction', async () => {
    const refs = await seedRefs()
    const rubs = [
      await approved(MEMBER, preSpend(refs, { amount: 10_000n })),
      await approved(MEMBER, preSpend(refs, { amount: 20_000n })),
      await approved(MEMBER, preSpend(refs, { amount: 30_000n })),
    ]
    const usd = await approved(MEMBER, preSpend(refs, { amount: 5_000n, currency: 'USD' }))
    const noPurpose = await approved(MEMBER, preSpend(refs, { amount: 40_000n }))
    await fixtureWrite((tx) =>
      tx.execute(sql`
        update core.finance_intake_item set purpose_id = null where id = ${noPurpose.id}
      `),
    )
    const queue = await listExpenseRequests(APPROVER)
    const shown = queue.filter((row) => row.stage === 'pay')
    expect(shown.map((row) => row.id).sort()).toEqual(
      [...rubs.map((row) => row.id), usd.id, noPurpose.id].sort(),
    )
    const since = await auditCursor()

    const result = await bulkMarkExpenseRequestsPaid(APPROVER, {
      group: 'pay',
      accountId: refs.rubAccountId,
      items: shown.map((row) => ({ id: row.id, snapshot: row.snapshot! })),
    })

    expect(result.posted.map((row) => row.id).sort()).toEqual(rubs.map((row) => row.id).sort())
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: usd.id, reason: expect.stringContaining('USD') }),
        expect.objectContaining({ id: noPurpose.id, reason: expect.stringMatching(/назначени/i) }),
      ]),
    )
    expect(result.excluded).toHaveLength(2)
    expect(await getExpenseRequest(APPROVER, usd.id)).toMatchObject({ status: 'approved' })
    expect(await getExpenseRequest(APPROVER, noPurpose.id)).toMatchObject({ status: 'approved' })

    const postingEvents = (await eventsSince(since, 'finance_intake_item')).filter(
      (event) => event.diff.status?.new === 'posted',
    )
    expect(postingEvents).toHaveLength(3)
    expect(new Set(postingEvents.map((event) => event.txid)).size).toBe(1)
    expect(new Set(postingEvents.map((event) => event.actor_email))).toEqual(
      new Set([APPROVER.email]),
    )
  })

  it('EARS-547: the reimburse group books and settles every row at its own date, oldest first', async () => {
    const refs = await seedRefs()
    const later = await submitted(MEMBER, ownFunds(refs, { occurredOn: '2026-09-07' }))
    const earlier = await submitted(MEMBER, ownFunds(refs, { occurredOn: '2026-09-03' }))
    const shown = (await listExpenseRequests(APPROVER)).filter((row) => row.stage === 'reimburse')

    const result = await bulkMarkExpenseRequestsPaid(APPROVER, {
      group: 'reimburse',
      accountId: refs.rubAccountId,
      items: shown.map((row) => ({ id: row.id, snapshot: row.snapshot! })),
    })

    expect(result.posted.map((row) => row.id)).toEqual([earlier.id, later.id])
    for (const [request, date] of [
      [earlier, '2026-09-03'],
      [later, '2026-09-07'],
    ] as const) {
      expect(await transfersSettling(request.id)).toEqual([
        expect.objectContaining({ status: 'posted', occurred_on: date, amount: '120000' }),
      ])
      expect((await queueRow(APPROVER, request.id)).stage).toBe('paid')
    }
    expect(rubBalance(await liabilityBalances({ memberId: refs.memberMemberId }))).toBe(0n)
  })

  it('EARS-547: a debt a pending manual transfer already settles is listed ineligible; the rest of the batch posts', async () => {
    const refs = await seedRefs()
    const pending = await submitted(MEMBER, ownFunds(refs, { occurredOn: '2026-09-02' }))
    await markExpenseRequestPaid(APPROVER, pending.id, {
      snapshot: await snapshotOf(pending.id),
      occurredOn: '2026-09-02',
    })
    const manual = await createReimbursementTransfer(ENTRY, {
      occurredOn: '2026-09-05',
      accountId: refs.rubAccountId,
      amount: 120_000n,
      currency: 'RUB',
      memberId: refs.memberMemberId,
      projectId: refs.projectId,
      settlesItemId: pending.id,
    })
    const free = await submitted(MEMBER, ownFunds(refs, { occurredOn: '2026-09-03' }))
    const shown = (await listExpenseRequests(APPROVER)).filter((row) => row.stage === 'reimburse')
    expect(shown.map((row) => row.id).sort()).toEqual([pending.id, free.id].sort())

    const items = shown.map((row) => ({ id: row.id, snapshot: row.snapshot! }))
    const preview = await bulkMarkExpenseRequestsPaid(APPROVER, {
      group: 'reimburse',
      accountId: refs.rubAccountId,
      items,
      preview: true,
    })
    expect(preview.planned.map((row) => row.id)).toEqual([free.id])

    const result = await bulkMarkExpenseRequestsPaid(APPROVER, {
      group: 'reimburse',
      accountId: refs.rubAccountId,
      items,
    })

    expect(result.posted.map((row) => row.id)).toEqual([free.id])
    expect(result.excluded).toEqual([
      expect.objectContaining({
        id: pending.id,
        reason: expect.stringContaining(`#${manual.id}`),
      }),
    ])
    expect(await transfersSettling(pending.id)).toEqual([
      expect.objectContaining({ id: manual.id }),
    ])
    expect(await transfersSettling(free.id)).toEqual([
      expect.objectContaining({ status: 'posted' }),
    ])
  })

  it('EARS-547: a role-less member cannot run the bulk act', async () => {
    const refs = await seedRefs()
    const refusal = await refusalOf(
      bulkMarkExpenseRequestsPaid(MEMBER, {
        group: 'pay',
        accountId: refs.rubAccountId,
        items: [{ id: 1, snapshot: 'x' }],
      }),
    )
    expect(refusal).toBeInstanceOf(FinanceAccessRefusal)
  })

  it('EARS-548: if one item’s snapshot is stale, the whole batch posts nothing and names it', async () => {
    const refs = await seedRefs()
    const first = await approved(MEMBER, preSpend(refs, { amount: 10_000n }))
    const second = await approved(MEMBER, preSpend(refs, { amount: 20_000n }))
    const shown = (await listExpenseRequests(APPROVER)).filter((row) => row.stage === 'pay')
    await fixtureWrite((tx) =>
      tx.execute(sql`
        update core.finance_intake_item set note = 'изменено после открытия диалога'
         where id = ${second.id}
      `),
    )

    const refusal = await refusalOf(
      bulkMarkExpenseRequestsPaid(APPROVER, {
        group: 'pay',
        accountId: refs.rubAccountId,
        items: shown.map((row) => ({ id: row.id, snapshot: row.snapshot! })),
      }),
    )

    expect(refusal).toBeInstanceOf(FinanceRefusal)
    expect(String(refusal)).toContain(`#${second.id}`)
    expect(String(refusal)).toContain('EARS-548')
    expect(await getExpenseRequest(APPROVER, first.id)).toMatchObject({ status: 'approved' })
    expect(await getExpenseRequest(APPROVER, second.id)).toMatchObject({ status: 'approved' })
  })
})
