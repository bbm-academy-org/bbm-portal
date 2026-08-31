// @vitest-environment node
import { createHash } from 'node:crypto'

import { sql } from 'drizzle-orm'
import type { Client } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  applyFinanceHistoryPlan,
  buildFinanceHistoryPlan,
  createAccount,
  createCurrency,
  FinanceDocumentUploadPending,
  systemAccount,
  type FinanceDocumentStorage,
  type FinanceHistoryApplyResult,
  type FinanceHistoryPlan,
  type FinanceHistorySnapshot,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { auditEventsSince, auditWatermark } from './audit-helpers'
import { ADMIN, ENTRY, seedIntakeReferences, truncateFinanceTables } from './finance-helpers'
import { asMigrator } from './privilege-helpers'

const db = getPlatformDb()

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

function memoryStorage(): FinanceDocumentStorage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>()
  return {
    driver: 'local',
    bucket: null,
    objects,
    async put(key, bytes) {
      const existing = objects.get(key)
      if (existing !== undefined && !existing.equals(bytes)) throw new Error('replacement')
      objects.set(key, Buffer.from(bytes))
    },
    async get(key) {
      const bytes = objects.get(key)
      if (bytes === undefined) throw new Error('missing')
      return Buffer.from(bytes)
    },
    async remove(key) {
      objects.delete(key)
    },
  }
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

async function historyFixture(sourceRef: string): Promise<{
  plan: FinanceHistoryPlan
  receipt: Buffer
}> {
  const refs = await seedIntakeReferences()
  const receipt = Buffer.from('%PDF-1.4\nfixture\n%%EOF')
  const contentDigest = `sha256:${createHash('sha256').update(receipt).digest('hex')}`
  const snapshot: FinanceHistorySnapshot = {
    version: 1,
    channel: { id: 'finance-channel', name: 'BBM Finance' },
    posts: [
      {
        id: sourceRef,
        rootId: null,
        createdAt: '2025-01-15T12:00:00.000Z',
        message: 'History fixture',
        fileIds: [`file-${sourceRef}`],
      },
    ],
    files: [
      {
        id: `file-${sourceRef}`,
        postId: sourceRef,
        filename: 'receipt.pdf',
        mime: 'application/pdf',
        size: receipt.byteLength,
        contentDigest,
        sourcePath: `finance/${sourceRef}.pdf`,
      },
    ],
  }
  return {
    receipt,
    plan: buildFinanceHistoryPlan({
      snapshot,
      mappings: [
        {
          sourcePostId: sourceRef,
          operation: {
            kind: 'expense',
            occurredOn: '2025-01-15',
            amount: '5000',
            currency: 'RUB',
            accountId: refs.accountId,
            projectId: refs.projectId,
            counterpartyId: refs.counterpartyId,
            purpose: { id: refs.purposeId, name: 'Hosting', categoryId: null },
            documentFileIds: [`file-${sourceRef}`],
          },
        },
      ],
      existingOperations: [],
    }),
  }
}

describe('the controlled direct history reconstruction', () => {
  it('EARS-518: applies the exact plan through intake, private documents and one named audit source; rerun skips', async () => {
    const refs = await seedIntakeReferences()
    const receipt = Buffer.from('%PDF-1.4\nfixture\n%%EOF')
    const contentDigest = `sha256:${createHash('sha256').update(receipt).digest('hex')}`
    const snapshot: FinanceHistorySnapshot = {
      version: 1,
      channel: { id: 'finance-channel', name: 'BBM Finance' },
      posts: [
        {
          id: 'post-42',
          rootId: null,
          createdAt: '2025-01-15T12:00:00.000Z',
          message: 'Hosting paid',
          fileIds: ['file-42'],
        },
      ],
      files: [
        {
          id: 'file-42',
          postId: 'post-42',
          filename: 'receipt.pdf',
          mime: 'application/pdf',
          size: receipt.byteLength,
          contentDigest,
          sourcePath: 'finance/receipt.pdf',
        },
      ],
    }
    const plan = buildFinanceHistoryPlan({
      snapshot,
      mappings: [
        {
          sourcePostId: 'post-42',
          operation: {
            kind: 'expense',
            occurredOn: '2025-01-15',
            amount: '5000',
            currency: 'RUB',
            accountId: refs.accountId,
            projectId: refs.projectId,
            counterpartyId: refs.counterpartyId,
            purpose: { id: refs.purposeId, name: 'Hosting', categoryId: null },
            documentFileIds: ['file-42'],
          },
        },
      ],
      existingOperations: [],
    })
    const storage = memoryStorage()
    const mark = await auditWatermark(db)

    const first = await applyFinanceHistoryPlan(plan, plan.planDigest, {
      operatorEmail: ENTRY.email,
      storage,
      loadDocumentBytes: async (file) => {
        expect(file.sourcePath).toBe('finance/receipt.pdf')
        return receipt
      },
    })
    expect(first).toMatchObject({
      applied: [{ sourceRef: 'post-42' }],
      skipped: [],
    })

    const facts = await db.execute(sql`
      select i.status, o.source, o.source_ref, o.backdated,
             count(distinct p.id)::int as postings,
             count(distinct dl.document_id)::int as documents
        from core.finance_intake_item i
        join core.finance_operation o on o.id = i.operation_id
        join core.finance_posting p on p.operation_id = o.id
        join core.finance_document_link dl on dl.intake_item_id = i.id
       where o.source_ref = 'post-42'
       group by i.status, o.source, o.source_ref, o.backdated
    `)
    expect(facts.rows[0]).toMatchObject({
      status: 'posted',
      source: 'backfill',
      source_ref: 'post-42',
      backdated: true,
      postings: 2,
      documents: 1,
    })
    const audit = await auditEventsSince(db, mark)
    expect(audit.filter((event) => event.table_name.startsWith('finance_'))).not.toHaveLength(0)
    expect(
      audit
        .filter((event) => event.table_name.startsWith('finance_'))
        .every(
          (event) => event.source === 'cli:finance-history-backfill' && event.actor_email === null,
        ),
    ).toBe(true)

    const repeated = await applyFinanceHistoryPlan(plan, plan.planDigest, {
      operatorEmail: ENTRY.email,
      storage,
      loadDocumentBytes: async () => receipt,
    })
    expect(repeated).toMatchObject({
      applied: [],
      skipped: [{ sourceRef: 'post-42', operationId: first.applied[0].operationId }],
    })
    const count = await db.execute(sql`
      select count(*)::int as count from core.finance_operation
       where source = 'backfill' and source_ref = 'post-42'
    `)
    expect(count.rows[0]).toMatchObject({ count: 1 })
  })

  it('EARS-517: refuses an intra-plan duplicate before documents or intake rows are written', async () => {
    const { plan: single, receipt } = await historyFixture('post-duplicate-plan')
    const operation = single.operations[0]
    const plan = buildFinanceHistoryPlan({
      snapshot: {
        version: 1,
        channel: { id: single.source.channelId, name: single.source.channelName },
        posts: [
          {
            id: operation.sourcePostId!,
            rootId: null,
            createdAt: '2025-01-15T12:00:00.000Z',
            message: 'History fixture',
            fileIds: [operation.documents[0].id],
          },
        ],
        files: operation.documents,
      },
      mappings: [
        {
          sourcePostId: operation.sourcePostId,
          documentNumber: 'DUPLICATE-PLAN-REF',
          operation: {
            ...operation,
            purpose: operation.purpose,
            documentFileIds: operation.documents.map((document) => document.id),
          },
        },
        {
          sourcePostId: operation.sourcePostId,
          documentNumber: 'DUPLICATE-PLAN-REF',
          operation: {
            ...operation,
            purpose: operation.purpose,
            documentFileIds: operation.documents.map((document) => document.id),
          },
        },
      ],
      existingOperations: [],
    })

    await expect(
      applyFinanceHistoryPlan(plan, plan.planDigest, {
        operatorEmail: ENTRY.email,
        storage: memoryStorage(),
        loadDocumentBytes: async () => receipt,
      }),
    ).rejects.toThrow(/duplicate/i)
    const counts = await db.execute(sql`
      select (select count(*)::int from core.finance_document) as documents,
             (select count(*)::int from core.finance_intake_item) as items
    `)
    expect(counts.rows[0]).toMatchObject({ documents: 0, items: 0 })
  })

  it('EARS-517: serializes concurrent applies into one applied result and one existing-operation skip', async () => {
    const { plan, receipt } = await historyFixture('post-concurrent-history')
    const storage = memoryStorage()
    const barrierKey = 387_517
    let outcomes: PromiseSettledResult<FinanceHistoryApplyResult>[] = []

    await asMigrator(async (client) => {
      await client.query(`
        create or replace function core.finance_test_history_apply_barrier() returns trigger language plpgsql as $$
        begin
          if new.source = 'backfill' then
            perform pg_advisory_xact_lock(${barrierKey}::bigint);
          end if;
          return new;
        end $$;
        drop trigger if exists finance_test_history_apply_barrier on core.finance_intake_item;
        create trigger finance_test_history_apply_barrier before insert on core.finance_intake_item
        for each row execute function core.finance_test_history_apply_barrier();
      `)
      await client.query('select pg_advisory_lock($1::bigint)', [barrierKey])
      let lockHeld = true
      try {
        const pid = Number(
          (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid,
        )
        const first = applyFinanceHistoryPlan(plan, plan.planDigest, {
          operatorEmail: ENTRY.email,
          storage,
          loadDocumentBytes: async () => receipt,
        })
        await waitForBlockedBy(client, pid, 1)
        const pending = Promise.allSettled([
          first,
          applyFinanceHistoryPlan(plan, plan.planDigest, {
            operatorEmail: ENTRY.email,
            storage,
            loadDocumentBytes: async () => receipt,
          }),
        ])
        await waitForBlockedBy(client, pid, 2)
        await client.query('select pg_advisory_unlock($1::bigint)', [barrierKey])
        lockHeld = false
        outcomes = await pending
      } finally {
        if (lockHeld) await client.query('select pg_advisory_unlock($1::bigint)', [barrierKey])
        await client.query(
          'drop trigger if exists finance_test_history_apply_barrier on core.finance_intake_item',
        )
        await client.query('drop function if exists core.finance_test_history_apply_barrier()')
      }
    })

    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true)
    const fulfilled = outcomes.flatMap((outcome) =>
      outcome.status === 'fulfilled' ? [outcome.value] : [],
    )
    expect(fulfilled.flatMap((outcome) => outcome.applied)).toHaveLength(1)
    expect(fulfilled.flatMap((outcome) => outcome.skipped)).toHaveLength(1)
    const counts = await db.execute(sql`
      select (select count(*)::int from core.finance_operation) as operations,
             (select count(*)::int from core.finance_document) as documents
    `)
    expect(counts.rows[0]).toMatchObject({ operations: 1, documents: 1 })
  })

  it('EARS-517: an operation-index race skips a conversion without adding intake, steps or postings', async () => {
    const sourceRef = 'post-concurrent-conversion-operation'
    const refs = await seedIntakeReferences()
    await createCurrency(ADMIN, { code: 'THB', name: 'Baht', precision: 2 })
    const target = await createAccount(ADMIN, {
      name: 'Kasikorn THB',
      kind: 'bank',
      currency: 'THB',
    })
    const conversionRub = await systemAccount(ADMIN, 'conversion', 'RUB')
    const conversionThb = await systemAccount(ADMIN, 'conversion', 'THB')
    const receipt = Buffer.from('%PDF-1.4\nconversion fixture\n%%EOF')
    const contentDigest = `sha256:${createHash('sha256').update(receipt).digest('hex')}`
    const plan = buildFinanceHistoryPlan({
      snapshot: {
        version: 1,
        channel: { id: 'finance-channel', name: 'BBM Finance' },
        posts: [
          {
            id: sourceRef,
            rootId: null,
            createdAt: '2025-01-15T12:00:00.000Z',
            message: 'Converted RUB to THB',
            fileIds: [`file-${sourceRef}`],
          },
        ],
        files: [
          {
            id: `file-${sourceRef}`,
            postId: sourceRef,
            filename: 'conversion.pdf',
            mime: 'application/pdf',
            size: receipt.byteLength,
            contentDigest,
            sourcePath: `finance/${sourceRef}.pdf`,
          },
        ],
      },
      mappings: [
        {
          sourcePostId: sourceRef,
          operation: {
            kind: 'conversion',
            occurredOn: '2025-01-15',
            amount: '8750',
            currency: 'RUB',
            paidAmount: '3500',
            paidCurrency: 'THB',
            accountId: refs.accountId,
            counterAccountId: target.id,
            projectId: refs.projectId,
            documentFileIds: [`file-${sourceRef}`],
          },
        },
      ],
      existingOperations: [],
    })
    expect(plan.invalidRows).toEqual([])

    const barrierKey = 387_518
    let outcome: FinanceHistoryApplyResult | undefined
    let existingOperationId: number | undefined
    await asMigrator(async (client) => {
      await client.query(`
        create or replace function core.finance_test_history_operation_barrier() returns trigger language plpgsql as $$
        begin
          if new.source = 'backfill' and new.source_ref = '${sourceRef}' then
            perform pg_advisory_xact_lock(${barrierKey}::bigint);
          end if;
          return new;
        end $$;
        drop trigger if exists finance_test_history_operation_barrier on core.finance_operation;
        create trigger finance_test_history_operation_barrier before insert on core.finance_operation
        for each row execute function core.finance_test_history_operation_barrier();
      `)
      await client.query('select pg_advisory_lock($1::bigint)', [barrierKey])
      let lockHeld = true
      try {
        const pid = Number(
          (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid,
        )
        const pending = applyFinanceHistoryPlan(plan, plan.planDigest, {
          operatorEmail: ENTRY.email,
          storage: memoryStorage(),
          loadDocumentBytes: async () => receipt,
        })
        await waitForBlockedBy(client, pid, 1)

        await client.query('begin')
        try {
          const existing = await client.query<{ id: number }>(
            `insert into core.finance_operation
               (occurred_on, source, source_ref, backdated)
             values ('2025-01-15', 'backfill', $1, true)
             returning id`,
            [sourceRef],
          )
          existingOperationId = Number(existing.rows[0].id)
          const step = await client.query<{ id: number }>(
            `insert into core.finance_conversion_step
               (operation_id, step_no, from_currency, to_currency, rate)
             values ($1, 1, 'RUB', 'THB', '0.4')
             returning id`,
            [existingOperationId],
          )
          const stepId = Number(step.rows[0].id)
          await client.query(
            `insert into core.finance_posting
               (operation_id, account_id, amount, currency, conversion_step_id)
             values
               ($1, $2, -8750, 'RUB', null),
               ($1, $3,  3500, 'THB', null),
               ($1, $4,  8750, 'RUB', $6),
               ($1, $5, -3500, 'THB', $6)`,
            [
              existingOperationId,
              refs.accountId,
              target.id,
              conversionRub.id,
              conversionThb.id,
              stepId,
            ],
          )
          await client.query('commit')
        } catch (error) {
          await client.query('rollback')
          throw error
        }

        await client.query('select pg_advisory_unlock($1::bigint)', [barrierKey])
        lockHeld = false
        outcome = await pending
      } finally {
        if (lockHeld) await client.query('select pg_advisory_unlock($1::bigint)', [barrierKey])
        await client.query(
          'drop trigger if exists finance_test_history_operation_barrier on core.finance_operation',
        )
        await client.query('drop function if exists core.finance_test_history_operation_barrier()')
      }
    })

    expect(outcome).toMatchObject({
      applied: [],
      skipped: [{ sourceRef, operationId: existingOperationId }],
    })
    const counts = await db.execute(sql`
      select (select count(*)::int from core.finance_operation) as operations,
             (select count(*)::int from core.finance_intake_item) as intakes,
             (select count(*)::int from core.finance_conversion_step) as steps,
             (select count(*)::int from core.finance_posting) as postings
    `)
    expect(counts.rows[0]).toMatchObject({ operations: 1, intakes: 0, steps: 1, postings: 4 })
  })

  it('EARS-518: exposes and reuses the durable document id after a PUT failure', async () => {
    const { plan, receipt } = await historyFixture('post-put-retry')
    const durable = memoryStorage()
    let failPut = true
    const storage: FinanceDocumentStorage = {
      ...durable,
      async put(key, bytes) {
        if (failPut) {
          failPut = false
          throw new Error('injected PUT failure')
        }
        await durable.put(key, bytes)
      },
    }
    const first = await applyFinanceHistoryPlan(plan, plan.planDigest, {
      operatorEmail: ENTRY.email,
      storage,
      loadDocumentBytes: async () => receipt,
    }).catch((error: unknown) => error)
    expect(first).toBeInstanceOf(FinanceDocumentUploadPending)
    const pendingId = (first as FinanceDocumentUploadPending).documentId

    const retry = await applyFinanceHistoryPlan(plan, plan.planDigest, {
      operatorEmail: ENTRY.email,
      storage,
      loadDocumentBytes: async () => receipt,
    })
    expect(retry.applied).toHaveLength(1)
    const documents = await db.execute(sql`
      select id, storage_state from core.finance_document order by id
    `)
    expect(documents.rows).toEqual([{ id: pendingId, storage_state: 'ready' }])
    expect(durable.objects.size).toBe(1)
  })

  it('EARS-518: resumes the same audited pending row after storage succeeds but ready commit fails', async () => {
    const { plan, receipt } = await historyFixture('post-ready-retry')
    const storage = memoryStorage()
    const mark = await auditWatermark(db)
    await asMigrator(async (client) => {
      await client.query(`
        create or replace function core.finance_test_history_ready_failure() returns trigger language plpgsql as $$
        begin
          if new.storage_state = 'ready' then
            raise exception 'injected ready failure';
          end if;
          return new;
        end $$;
        drop trigger if exists finance_test_history_ready_failure on core.finance_document;
        create trigger finance_test_history_ready_failure before update on core.finance_document
        for each row execute function core.finance_test_history_ready_failure();
      `)
    })
    let first: unknown
    try {
      first = await applyFinanceHistoryPlan(plan, plan.planDigest, {
        operatorEmail: ENTRY.email,
        storage,
        loadDocumentBytes: async () => receipt,
      }).catch((error: unknown) => error)
    } finally {
      await asMigrator(async (client) => {
        await client.query(
          'drop trigger if exists finance_test_history_ready_failure on core.finance_document',
        )
        await client.query('drop function if exists core.finance_test_history_ready_failure()')
      })
    }
    expect(first).toBeInstanceOf(FinanceDocumentUploadPending)
    const pendingId = (first as FinanceDocumentUploadPending).documentId
    expect(storage.objects.size).toBe(1)

    const retry = await applyFinanceHistoryPlan(plan, plan.planDigest, {
      operatorEmail: ENTRY.email,
      storage,
      loadDocumentBytes: async () => receipt,
    })
    expect(retry.applied).toHaveLength(1)
    const documents = await db.execute(sql`
      select id, storage_state from core.finance_document order by id
    `)
    expect(documents.rows).toEqual([{ id: pendingId, storage_state: 'ready' }])
    expect(storage.objects.size).toBe(1)
    const audit = (await auditEventsSince(db, mark)).filter(
      (event) => event.table_name === 'finance_document',
    )
    expect(audit).not.toHaveLength(0)
    expect(audit.every((event) => event.source === 'cli:finance-history-backfill')).toBe(true)
  })
})
