// @vitest-environment node
import { createHash } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  applyFinanceHistoryPlan,
  buildFinanceHistoryPlan,
  type FinanceDocumentStorage,
  type FinanceHistorySnapshot,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { auditEventsSince, auditWatermark } from './audit-helpers'
import { ENTRY, seedIntakeReferences, truncateFinanceTables } from './finance-helpers'

const db = getPlatformDb()

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

function memoryStorage(): FinanceDocumentStorage {
  const objects = new Map<string, Buffer>()
  return {
    driver: 'local',
    bucket: null,
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
})
