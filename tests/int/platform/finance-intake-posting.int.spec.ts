// @vitest-environment node
import { sql } from 'drizzle-orm'
import type { Client } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  createCurrency,
  createIntakeItem,
  createPurpose,
  editIntakeItem,
  financeAuditContext,
  FinanceRefusal,
  getIntakeItem,
  liabilityBalances,
  postIntakeItem,
  recordConversion,
  recordOperation,
  systemAccount,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'
import { platformTransaction, type PlatformTx } from '@/lib/platform/db/transaction'

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
import { asMigrator } from './privilege-helpers'

const db = getPlatformDb()

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

async function seedPostingReferences() {
  const entryMemberId = await seedMember(ENTRY.email, 'Entry Clerk')
  const approverMemberId = await seedMember(APPROVER.email, 'Approver Person')
  const payerMemberId = await seedMember('payer@bbm.academy', 'Payer Person')
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
  const rubAccount = await createAccount(ADMIN, {
    name: 'Карта RUB',
    kind: 'card',
    currency: 'RUB',
  })
  const thbAccount = await createAccount(ADMIN, {
    name: 'Счёт THB',
    kind: 'bank',
    currency: 'THB',
  })
  const purpose = await createPurpose(ADMIN, {
    name: 'Хостинг',
    productBinding: 'forbidden',
  })
  const projectId = await fundProjectId()
  const counterpartyId = await seedCounterparty('Vendor', entryMemberId)
  return {
    approverMemberId,
    payerMemberId,
    rubAccountId: rubAccount.id,
    thbAccountId: thbAccount.id,
    purposeId: purpose.id,
    projectId,
    counterpartyId,
  }
}

type Refs = Awaited<ReturnType<typeof seedPostingReferences>>

function expenseInput(refs: Refs, overrides: Record<string, unknown> = {}) {
  return {
    source: 'manual' as const,
    kind: 'expense' as const,
    occurredOn: '2026-08-20',
    accountId: refs.rubAccountId,
    amount: 120_000n,
    currency: 'RUB',
    purposeId: refs.purposeId,
    projectId: refs.projectId,
    counterpartyId: refs.counterpartyId,
    ...overrides,
  }
}

async function approve(itemId: number, approverMemberId: number): Promise<void> {
  await fixtureWrite((tx) =>
    tx.execute(sql`
      update core.finance_intake_item
         set status = 'approved', decided_by = ${approverMemberId}, decided_at = now()
       where id = ${itemId}
    `),
  )
}

async function attachDocument(itemId: number, linkedBy: number): Promise<number> {
  return fixtureWrite(async (tx) => {
    const inserted = await tx.execute(sql`
      insert into core.finance_document
        (storage_key, content_digest, filename, mime, size, kind, storage_state, uploaded_by)
      values (${`finance/documents/posting-${itemId}.pdf`},
              ${`sha256:${'0'.repeat(64)}`}, 'receipt.pdf', 'application/pdf', 10,
              'fiscal_receipt', 'ready', ${linkedBy})
      returning id
    `)
    const documentId = Number((inserted.rows[0] as { id: number }).id)
    await tx.execute(sql`
      insert into core.finance_document_link (document_id, intake_item_id, linked_by)
      values (${documentId}, ${itemId}, ${linkedBy})
    `)
    return documentId
  })
}

async function postingsOf(operationId: number) {
  const result = await db.execute(sql`
    select a.kind, p.account_id, p.amount::text as amount, p.currency, p.member_id,
           p.conversion_step_id
      from core.finance_posting p
      join core.finance_account a on a.id = p.account_id
     where p.operation_id = ${operationId}
     order by p.id
  `)
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    kind: String(row.kind),
    accountId: Number(row.account_id),
    amount: BigInt(String(row.amount)),
    currency: String(row.currency),
    memberId: row.member_id === null ? null : Number(row.member_id),
    conversionStepId: row.conversion_step_id === null ? null : Number(row.conversion_step_id),
  }))
}

async function waitForBlockedBy(
  blocker: Client,
  blockerPid: number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const result = await blocker.query<{ blocked: number }>(
      `with recursive waiters(pid) as (
         select pid
           from pg_stat_activity
          where $1 = any(pg_blocking_pids(pid))
         union
         select activity.pid
           from pg_stat_activity activity
           join waiters on waiters.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::int as blocked from waiters`,
      [blockerPid],
    )
    if (Number(result.rows[0]?.blocked ?? 0) >= expected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Expected ${expected} transaction(s) to wait behind backend ${blockerPid}.`)
}

describe('posting an intake item is one document-gated fact (EARS-505/506)', () => {
  it('EARS-505: records and links the operation with documents and poster metadata, then locks edits', async () => {
    const refs = await seedPostingReferences()
    const item = await createIntakeItem(ENTRY, expenseInput(refs))
    await approve(item.id, refs.approverMemberId)
    const documentId = await attachDocument(item.id, refs.approverMemberId)

    const posted = await postIntakeItem(APPROVER, item.id)

    expect(posted.status).toBe('posted')
    expect(posted.operationId).not.toBeNull()
    expect(posted.postedBy).toBe(refs.approverMemberId)
    expect(posted.postedAt).toBeInstanceOf(Date)
    const carried = await db.execute(sql`
      select dl.document_id
        from core.finance_document_link dl
        join core.finance_intake_item i on i.id = dl.intake_item_id
       where i.operation_id = ${posted.operationId}
    `)
    expect(carried.rows).toEqual([{ document_id: documentId }])
    await expect(editIntakeItem(ENTRY, item.id, { amount: 130_000n })).rejects.toBeInstanceOf(
      FinanceRefusal,
    )
  })

  it('EARS-505: public ledger doors reject a caller transaction that could split authorization from audit identity', async () => {
    const refs = await seedPostingReferences()
    const expense = await systemAccount(ADMIN, 'expense', 'RUB')
    const unsafeRecordOperation = recordOperation as unknown as (
      actor: Parameters<typeof recordOperation>[0],
      input: Parameters<typeof recordOperation>[1],
      tx: PlatformTx,
    ) => ReturnType<typeof recordOperation>
    await expect(
      platformTransaction(financeAuditContext(ENTRY), (tx) =>
        unsafeRecordOperation(
          APPROVER,
          {
            occurredOn: '2026-08-20',
            source: 'manual',
            postings: [
              {
                accountId: refs.rubAccountId,
                amount: -100n,
                currency: 'RUB',
              },
              {
                accountId: expense.id,
                amount: 100n,
                currency: 'RUB',
                projectId: refs.projectId,
              },
            ],
          },
          tx,
        ),
      ),
    ).rejects.toThrow(/caller-supplied transaction/)

    const unsafeRecordConversion = recordConversion as unknown as (
      actor: Parameters<typeof recordConversion>[0],
      input: Parameters<typeof recordConversion>[1],
      tx: PlatformTx,
    ) => ReturnType<typeof recordConversion>
    await expect(
      platformTransaction(financeAuditContext(ENTRY), (tx) =>
        unsafeRecordConversion(
          APPROVER,
          {
            occurredOn: '2026-08-20',
            sourceAccountId: refs.rubAccountId,
            targetAccountId: refs.thbAccountId,
            steps: [
              {
                fromCurrency: 'RUB',
                toCurrency: 'THB',
                fromAmount: 250n,
                toAmount: 100n,
                rate: '0.4',
              },
            ],
          },
          tx,
        ),
      ),
    ).rejects.toThrow(/caller-supplied transaction/)

    const operations = await db.execute(
      sql`select count(*)::int as count from core.finance_operation`,
    )
    expect(Number((operations.rows[0] as { count: number }).count)).toBe(0)
  })

  it('EARS-505: a failure while linking the item rolls the operation back too', async () => {
    const refs = await seedPostingReferences()
    const item = await createIntakeItem(ENTRY, expenseInput(refs))
    await approve(item.id, refs.approverMemberId)
    await attachDocument(item.id, refs.approverMemberId)

    await asMigrator(async (client) => {
      await client.query(`
        create or replace function core.finance_test_fail_post() returns trigger language plpgsql as $$
        begin
          if new.status = 'posted' then raise exception 'fixture link failure'; end if;
          return new;
        end $$;
        create trigger finance_test_fail_post before update on core.finance_intake_item
        for each row execute function core.finance_test_fail_post();
      `)
    })
    try {
      await expect(postIntakeItem(APPROVER, item.id)).rejects.toThrow()
    } finally {
      await asMigrator(async (client) => {
        await client.query(
          'drop trigger if exists finance_test_fail_post on core.finance_intake_item',
        )
        await client.query('drop function if exists core.finance_test_fail_post()')
      })
    }

    expect(await getIntakeItem(APPROVER, item.id)).toMatchObject({
      status: 'approved',
      operationId: null,
      postedBy: null,
      postedAt: null,
    })
    const operations = await db.execute(
      sql`select count(*)::int as count from core.finance_operation`,
    )
    expect(Number((operations.rows[0] as { count: number }).count)).toBe(0)
  })

  it('EARS-506: refuses an approved item without a document and posts nothing', async () => {
    const refs = await seedPostingReferences()
    const item = await createIntakeItem(ENTRY, expenseInput(refs))
    await approve(item.id, refs.approverMemberId)

    await expect(postIntakeItem(APPROVER, item.id)).rejects.toThrow(/EARS-506/)
    expect(await getIntakeItem(APPROVER, item.id)).toMatchObject({
      status: 'approved',
      operationId: null,
    })
    const operations = await db.execute(
      sql`select count(*)::int as count from core.finance_operation`,
    )
    expect(Number((operations.rows[0] as { count: number }).count)).toBe(0)
  })
})

describe('intake posting is never an hours event (EARS-507)', () => {
  it('EARS-507: refuses `hours` as an intake source and creates no operation', async () => {
    const refs = await seedPostingReferences()
    await expect(
      createIntakeItem(ENTRY, { ...expenseInput(refs), source: 'hours' } as never),
    ).rejects.toThrow(/EARS-503\/525/)
    const operations = await db.execute(
      sql`select count(*)::int as count from core.finance_operation`,
    )
    expect(Number((operations.rows[0] as { count: number }).count)).toBe(0)
  })
})

describe('every intake posting branch enters through the same atomic door (EARS-505)', () => {
  it('EARS-505: posts income to the named money account and the income result account', async () => {
    const refs = await seedPostingReferences()
    const item = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'income',
      occurredOn: '2026-08-20',
      accountId: refs.thbAccountId,
      amount: 250_000n,
      currency: 'THB',
      projectId: refs.projectId,
      counterpartyId: refs.counterpartyId,
    })
    await approve(item.id, refs.approverMemberId)
    await attachDocument(item.id, refs.approverMemberId)

    const posted = await postIntakeItem(APPROVER, item.id)
    expect(await postingsOf(posted.operationId!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'income',
          amount: -250_000n,
          currency: 'THB',
        }),
        expect.objectContaining({
          accountId: refs.thbAccountId,
          amount: 250_000n,
          currency: 'THB',
        }),
      ]),
    )
  })

  it('marks ordinary, own-conversion and cross-currency backfill postings as backdated', async () => {
    const refs = await seedPostingReferences()
    const inputs = [
      expenseInput(refs, {
        source: 'backfill',
        sourceRef: 'review-backfill-ordinary',
      }),
      {
        source: 'backfill' as const,
        sourceRef: 'review-backfill-own-conversion',
        kind: 'conversion' as const,
        occurredOn: '2026-08-20',
        accountId: refs.rubAccountId,
        counterAccountId: refs.thbAccountId,
        amount: 875_000n,
        currency: 'RUB',
        paidAmount: 350_000n,
        paidCurrency: 'THB',
        projectId: refs.projectId,
      },
      expenseInput(refs, {
        source: 'backfill',
        sourceRef: 'review-backfill-cross-currency',
        amount: 350_000n,
        currency: 'THB',
        paidAmount: 875_000n,
        paidCurrency: 'RUB',
      }),
    ]
    const operationIds: number[] = []
    for (const input of inputs) {
      const item = await createIntakeItem(ENTRY, input)
      await approve(item.id, refs.approverMemberId)
      await attachDocument(item.id, refs.approverMemberId)
      const posted = await postIntakeItem(APPROVER, item.id)
      operationIds.push(posted.operationId!)
    }

    const operations = await db.execute(sql`
      select source, backdated
        from core.finance_operation
       where id in (${operationIds[0]}, ${operationIds[1]}, ${operationIds[2]})
       order by id
    `)
    expect(operations.rows).toEqual([
      { source: 'backfill', backdated: true },
      { source: 'backfill', backdated: true },
      { source: 'backfill', backdated: true },
    ])
  })

  it('EARS-505: posts an ordinary same-currency transfer between two money accounts', async () => {
    const refs = await seedPostingReferences()
    const target = await createAccount(ADMIN, {
      name: 'Reserve RUB',
      kind: 'bank',
      currency: 'RUB',
    })
    const item = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'transfer',
      occurredOn: '2026-08-20',
      accountId: refs.rubAccountId,
      counterAccountId: target.id,
      amount: 75_000n,
      currency: 'RUB',
      projectId: refs.projectId,
    })
    await approve(item.id, refs.approverMemberId)
    await attachDocument(item.id, refs.approverMemberId)

    const posted = await postIntakeItem(APPROVER, item.id)
    expect(await postingsOf(posted.operationId!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: refs.rubAccountId, amount: -75_000n }),
        expect.objectContaining({ accountId: target.id, amount: 75_000n }),
      ]),
    )
  })

  it('EARS-505: serializes simultaneous posting attempts into one operation and one refusal', async () => {
    const refs = await seedPostingReferences()
    const item = await createIntakeItem(ENTRY, expenseInput(refs))
    await approve(item.id, refs.approverMemberId)
    await attachDocument(item.id, refs.approverMemberId)

    const attempts = await Promise.allSettled([
      postIntakeItem(APPROVER, item.id),
      postIntakeItem(APPROVER, item.id),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    const posted = await getIntakeItem(APPROVER, item.id)
    if (posted === null) throw new Error('the concurrently posted item disappeared')
    expect(posted.status).toBe('posted')
    const operations = await db.execute(sql`select id from core.finance_operation order by id`)
    expect(operations.rows).toEqual([{ id: posted.operationId }])
  })
})

describe('cross-currency intake builds one authoritative conversion step', () => {
  it('refuses cross-currency income instead of disposing an unrelated FX holding', async () => {
    const refs = await seedPostingReferences()
    await recordConversion(APPROVER, {
      occurredOn: '2026-01-10',
      sourceAccountId: refs.rubAccountId,
      targetAccountId: refs.thbAccountId,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'THB',
          fromAmount: 875_000n,
          toAmount: 350_000n,
          rate: '0.4',
        },
      ],
    })
    const poolBefore = await db.execute(sql`
      select p.currency, sum(p.amount)::text as balance
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
       where a.kind = 'conversion'
       group by p.currency
       order by p.currency
    `)
    const item = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'income',
      occurredOn: '2026-03-10',
      accountId: refs.rubAccountId,
      amount: 350_000n,
      currency: 'THB',
      paidAmount: 1_000_000n,
      paidCurrency: 'RUB',
      projectId: refs.projectId,
      counterpartyId: refs.counterpartyId,
    })
    await approve(item.id, refs.approverMemberId)
    await attachDocument(item.id, refs.approverMemberId)

    await expect(postIntakeItem(APPROVER, item.id)).rejects.toThrow(/Межвалютный доход/)
    expect(await getIntakeItem(APPROVER, item.id)).toMatchObject({
      status: 'approved',
      operationId: null,
    })
    const poolAfter = await db.execute(sql`
      select p.currency, sum(p.amount)::text as balance
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
       where a.kind = 'conversion'
       group by p.currency
       order by p.currency
    `)
    expect(poolAfter.rows).toEqual(poolBefore.rows)
    const fx = await db.execute(sql`
      select count(*)::int as count
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
       where a.kind = 'fx_result'
    `)
    expect(fx.rows).toEqual([{ count: 0 }])
  })

  it('EARS-505: posts the 3,500 THB / 8,750 RUB worked example and its fee without computing either amount', async () => {
    const refs = await seedPostingReferences()
    const item = await createIntakeItem(
      ENTRY,
      expenseInput(refs, {
        amount: 350_000n,
        currency: 'THB',
        paidAmount: 875_000n,
        paidCurrency: 'RUB',
        feeAmount: 1_000n,
        feeCurrency: 'RUB',
      }),
    )
    await approve(item.id, refs.approverMemberId)
    await attachDocument(item.id, refs.approverMemberId)

    const posted = await postIntakeItem(APPROVER, item.id)
    const legs = await postingsOf(posted.operationId!)

    expect(
      legs
        .filter((leg) => leg.currency === 'THB')
        .map((leg) => leg.amount)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    ).toEqual([-350_000n, 350_000n])
    expect(
      legs
        .filter((leg) => leg.currency === 'RUB')
        .map((leg) => leg.amount)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    ).toEqual([-875_000n, -1_000n, 1_000n, 875_000n])
    const steps = await db.execute(sql`
      select from_currency, to_currency, rate
        from core.finance_conversion_step where operation_id = ${posted.operationId}
    `)
    expect(steps.rows).toEqual([{ from_currency: 'RUB', to_currency: 'THB', rate: '0.4' }])
    expect(legs.filter((leg) => leg.conversionStepId !== null)).toHaveLength(4)
  })

  it('serializes first use of an FX pair without deadlocking opposing posting paths', async () => {
    const refs = await seedPostingReferences()
    const ownConversion = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'conversion',
      occurredOn: '2026-01-10',
      accountId: refs.rubAccountId,
      counterAccountId: refs.thbAccountId,
      amount: 100_000n,
      currency: 'RUB',
      paidAmount: 300_000n,
      paidCurrency: 'THB',
      projectId: refs.projectId,
    })
    const vendorExpense = await createIntakeItem(
      ENTRY,
      expenseInput(refs, {
        occurredOn: '2026-03-10',
        amount: 380_000n,
        currency: 'THB',
        paidAmount: 100_000n,
        paidCurrency: 'RUB',
      }),
    )
    for (const item of [ownConversion, vendorExpense]) {
      await approve(item.id, refs.approverMemberId)
      await attachDocument(item.id, refs.approverMemberId)
    }

    const barrierKey = 385_004
    let results: PromiseSettledResult<Awaited<ReturnType<typeof postIntakeItem>>>[] = []
    await asMigrator(async (client) => {
      await client.query(`
        create or replace function core.finance_test_first_pair_barrier() returns trigger language plpgsql as $$
        begin
          if new.kind = 'conversion' then
            perform pg_advisory_xact_lock(${barrierKey}::bigint);
          end if;
          return new;
        end $$;
        drop trigger if exists finance_test_first_pair_barrier on core.finance_account;
        create trigger finance_test_first_pair_barrier after insert on core.finance_account
        for each row execute function core.finance_test_first_pair_barrier();
      `)
      await client.query('select pg_advisory_lock($1::bigint)', [barrierKey])
      let lockHeld = true
      try {
        const pid = Number(
          (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid,
        )
        const vendorPending = postIntakeItem(APPROVER, vendorExpense.id)
        await waitForBlockedBy(client, pid, 1)
        const pending = Promise.allSettled([
          postIntakeItem(APPROVER, ownConversion.id),
          vendorPending,
        ])
        await waitForBlockedBy(client, pid, 2)
        await client.query('select pg_advisory_unlock($1::bigint)', [barrierKey])
        lockHeld = false
        results = await pending
      } finally {
        if (lockHeld) await client.query('select pg_advisory_unlock($1::bigint)', [barrierKey])
        await client.query(
          'drop trigger if exists finance_test_first_pair_barrier on core.finance_account',
        )
        await client.query('drop function if exists core.finance_test_first_pair_barrier()')
      }
    })

    const errorCodes = results.flatMap((result) => {
      if (result.status === 'fulfilled') return []
      const error = result.reason as { code?: string; cause?: { code?: string } }
      return [error.cause?.code ?? error.code ?? 'unknown']
    })
    expect(errorCodes).toEqual([])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2)
  })

  it('serializes the FX pool across two different concurrent intake items', async () => {
    const refs = await seedPostingReferences()
    await systemAccount(ADMIN, 'conversion', 'RUB')
    await systemAccount(ADMIN, 'conversion', 'THB')
    const acquisition = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'conversion',
      occurredOn: '2026-01-10',
      accountId: refs.thbAccountId,
      counterAccountId: refs.rubAccountId,
      amount: 300_000n,
      currency: 'THB',
      paidAmount: 100_000n,
      paidCurrency: 'RUB',
      projectId: refs.projectId,
    })
    const disposal = await createIntakeItem(
      ENTRY,
      expenseInput(refs, {
        occurredOn: '2026-03-10',
        amount: 380_000n,
        currency: 'THB',
        paidAmount: 100_000n,
        paidCurrency: 'RUB',
      }),
    )
    for (const item of [acquisition, disposal]) {
      await approve(item.id, refs.approverMemberId)
      await attachDocument(item.id, refs.approverMemberId)
    }

    const barrierKey = 385_003
    let results: Awaited<ReturnType<typeof postIntakeItem>>[] = []
    await asMigrator(async (client) => {
      await client.query(`
        create or replace function core.finance_test_fx_barrier() returns trigger language plpgsql as $$
        begin
          perform pg_advisory_xact_lock(${barrierKey}::bigint);
          return new;
        end $$;
        drop trigger if exists finance_test_fx_barrier on core.finance_conversion_step;
        create trigger finance_test_fx_barrier before insert on core.finance_conversion_step
        for each row execute function core.finance_test_fx_barrier();
      `)
      await client.query('select pg_advisory_lock($1::bigint)', [barrierKey])
      let lockHeld = true
      try {
        const pid = Number(
          (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid,
        )
        const pending = Promise.all([
          postIntakeItem(APPROVER, acquisition.id),
          postIntakeItem(APPROVER, disposal.id),
        ])
        await waitForBlockedBy(client, pid, 2)
        await client.query('select pg_advisory_unlock($1::bigint)', [barrierKey])
        lockHeld = false
        results = await pending
      } finally {
        if (lockHeld) await client.query('select pg_advisory_unlock($1::bigint)', [barrierKey])
        await client.query(
          'drop trigger if exists finance_test_fx_barrier on core.finance_conversion_step',
        )
        await client.query('drop function if exists core.finance_test_fx_barrier()')
      }
    })

    const fx = await db.execute(sql`
      select p.amount::text as amount
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
       where p.operation_id = ${results[1].operationId}
         and a.kind = 'fx_result'
         and p.currency = 'THB'
    `)
    expect(fx.rows).toEqual([{ amount: '-80000' }])
    const clearing = await db.execute(sql`
      select p.currency, sum(p.amount)::text as balance
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
       where a.kind = 'conversion' and p.currency in ('RUB', 'THB')
       group by p.currency
       order by p.currency
    `)
    expect(clearing.rows).toEqual([
      { currency: 'RUB', balance: '0' },
      { currency: 'THB', balance: '0' },
    ])
  })

  it('EARS-505/328: prices a vendor disposal from the realized-FX pool and leaves no clearing residue', async () => {
    const refs = await seedPostingReferences()
    await recordConversion(APPROVER, {
      occurredOn: '2026-01-10',
      sourceAccountId: refs.thbAccountId,
      targetAccountId: refs.rubAccountId,
      steps: [
        {
          fromCurrency: 'THB',
          toCurrency: 'RUB',
          fromAmount: 300_000n,
          toAmount: 100_000n,
          rate: '0.333333333333333333',
        },
      ],
      backdated: true,
    })
    const item = await createIntakeItem(
      ENTRY,
      expenseInput(refs, {
        occurredOn: '2026-03-10',
        amount: 380_000n,
        currency: 'THB',
        paidAmount: 100_000n,
        paidCurrency: 'RUB',
      }),
    )
    await approve(item.id, refs.approverMemberId)
    await attachDocument(item.id, refs.approverMemberId)

    const posted = await postIntakeItem(APPROVER, item.id)
    const fx = await db.execute(sql`
      select p.amount::text as amount
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
       where p.operation_id = ${posted.operationId}
         and a.kind = 'fx_result'
         and p.currency = 'THB'
    `)
    expect(fx.rows).toEqual([{ amount: '-80000' }])

    const clearing = await db.execute(sql`
      select p.currency, sum(p.amount)::text as balance
        from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
       where a.kind = 'conversion' and p.currency in ('RUB', 'THB')
       group by p.currency
       order by p.currency
    `)
    expect(clearing.rows).toEqual([
      { currency: 'RUB', balance: '0' },
      { currency: 'THB', balance: '0' },
    ])
  })

  it('EARS-505: kind=conversion uses the same pair as one implicit own-account step', async () => {
    const refs = await seedPostingReferences()
    const item = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'conversion',
      occurredOn: '2026-08-20',
      accountId: refs.rubAccountId,
      counterAccountId: refs.thbAccountId,
      amount: 875_000n,
      currency: 'RUB',
      paidAmount: 350_000n,
      paidCurrency: 'THB',
      projectId: refs.projectId,
    })
    await approve(item.id, refs.approverMemberId)
    await attachDocument(item.id, refs.approverMemberId)

    const posted = await postIntakeItem(APPROVER, item.id)
    const legs = await postingsOf(posted.operationId!)
    expect(legs.find((leg) => leg.accountId === refs.rubAccountId)?.amount).toBe(-875_000n)
    expect(legs.find((leg) => leg.accountId === refs.thbAccountId)?.amount).toBe(350_000n)
    const steps = await db.execute(sql`
      select count(*)::int as count from core.finance_conversion_step
       where operation_id = ${posted.operationId}
    `)
    expect(Number((steps.rows[0] as { count: number }).count)).toBe(1)
  })
})

describe('personal funds and reimbursements share the liability cut (EARS-513/527/528)', () => {
  it('EARS-513/527/528: records debt in the charged currency, filters it by member, then settles it with a transfer', async () => {
    const refs = await seedPostingReferences()
    const debt = await createIntakeItem(
      ENTRY,
      expenseInput(refs, {
        accountId: null,
        amount: 350_000n,
        currency: 'THB',
        paidAmount: 875_000n,
        paidCurrency: 'RUB',
        alreadyPaid: true,
        personalFunds: true,
        memberId: refs.payerMemberId,
      }),
    )
    await approve(debt.id, refs.approverMemberId)
    await attachDocument(debt.id, refs.approverMemberId)
    const postedDebt = await postIntakeItem(APPROVER, debt.id)
    const liability = await systemAccount(ADMIN, 'liability', 'RUB')
    expect(await postingsOf(postedDebt.operationId!)).toContainEqual(
      expect.objectContaining({
        accountId: liability.id,
        amount: -875_000n,
        currency: 'RUB',
        memberId: refs.payerMemberId,
      }),
    )
    expect(await liabilityBalances({ memberId: refs.payerMemberId })).toEqual([
      expect.objectContaining({
        memberId: refs.payerMemberId,
        currency: 'RUB',
        balance: -875_000n,
      }),
    ])
    expect(await liabilityBalances({ memberId: refs.approverMemberId })).toEqual([])

    const repayment = await createIntakeItem(ENTRY, {
      source: 'manual',
      kind: 'transfer',
      occurredOn: '2026-08-21',
      accountId: refs.rubAccountId,
      counterAccountId: liability.id,
      amount: 875_000n,
      currency: 'RUB',
      projectId: refs.projectId,
      memberId: refs.payerMemberId,
    })
    await approve(repayment.id, refs.approverMemberId)
    await attachDocument(repayment.id, refs.approverMemberId)
    const postedRepayment = await postIntakeItem(APPROVER, repayment.id)
    expect(await postingsOf(postedRepayment.operationId!)).toContainEqual(
      expect.objectContaining({
        accountId: liability.id,
        amount: 875_000n,
        memberId: refs.payerMemberId,
      }),
    )
    expect(await liabilityBalances({ memberId: refs.payerMemberId })).toEqual([])
  })
})
